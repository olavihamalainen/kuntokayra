import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';
import vm from 'node:vm';
import { createSyncWorker } from '../sync-worker/worker.mjs';
import { pkceChallenge, randomToken } from '../sync-worker/browser-auth.mjs';
import { testD1 } from './helpers/d1.mjs';
import { boot, plain } from './helpers/browser-harness.mjs';

const workerOrigin = 'https://sync.example.test';
const frontendUrl = 'https://pages.example.test/kuntokayra/';
const frontendOrigin = new URL(frontendUrl).origin;
const browserPath = '/auth/browser-session';
const journalPath = '/journal-sync/v1';
const migration = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const migrations = [migration('../sync-worker/migrations/0000_journal_sync.sql'), migration('../sync-worker/migrations/0001_google_sessions.sql')];
const grants = migration('../sync-worker/migrations/0002_google_browser_grants.sql');
const browserBootstrap = migration('../browser-bootstrap.js');
const storageKey = 'kuntokayra_v1';

function setup(t, { withGrants = true } = {}) {
  const { DB, sqlite } = testD1(t, ...migrations, ...(withGrants ? [grants] : []));
  sqlite.exec("INSERT INTO google_test_sessions VALUES ('existing-session', 'prior-account', 9999999999999)");
  const worker = createSyncWorker(async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(options.body.get('redirect_uri'), `${workerOrigin}/auth/google/callback`);
      return Response.json({ token_type: 'Bearer', access_token: options.body.get('code') });
    }
    assert.equal(url, 'https://openidconnect.googleapis.com/v1/userinfo');
    const sub = options.headers.Authorization.split(' ')[1];
    return Response.json({ sub, email: `${sub}@example.test`, email_verified: true });
  });
  const env = { DB, APP_ORIGIN: workerOrigin, APP_FRONTEND_URL: frontendUrl, GOOGLE_CLIENT_ID: 'test', GOOGLE_CLIENT_SECRET: 'example', GOOGLE_ALLOWED_EMAILS: 'alice@example.test,bob@example.test' };
  const fetchWorker = (path, init = {}) => worker.fetch(new Request(workerOrigin + path, init), env);
  const post = (path, body, token, origin = frontendOrigin, cookie) => fetchWorker(path, {
    method: 'POST', body: JSON.stringify(body),
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  });
  const device = (body, token) => post(browserPath, body, token);
  async function signIn(subject, verifier = randomToken(), state = randomToken()) {
    const target = new URLSearchParams({ state, challenge: await pkceChallenge(verifier), redirect_uri: 'https://unauthorized.example.test/' });
    const started = await fetchWorker(`/auth/connect?${target}`);
    assert.equal(started.status, 303);
    const google = new URL(started.headers.get('Location'));
    assert.equal(google.origin, 'https://accounts.google.com');
    const googleState = google.searchParams.get('state');
    const callback = await fetchWorker(`/auth/google/callback?code=${subject}&state=${googleState}`, { headers: {
      Cookie: started.headers.get('Set-Cookie').split(';')[0],
    } });
    assert.equal(callback.status, 303);
    const returned = new URL(callback.headers.get('Location'));
    const values = new URLSearchParams(returned.hash.slice(1));
    assert.equal(returned.origin + returned.pathname, frontendUrl);
    assert.equal(values.get('sync_state'), state);
    return { code: values.get('sync_code'), result: values.get('sync_result'), verifier, returned, callback };
  }
  return { fetchWorker, post, device, signIn, sqlite };
}

async function openBrowser(app, { local = new Map(), pending = new Map(), url = frontendUrl } = {}) {
  let loaded;
  const ready = new Promise(resolve => { loaded = resolve; });
  const requests = [];
  const store = map => ({ getItem: key => map.get(key) ?? null, setItem: (key, val) => map.set(key, val), removeItem: key => map.delete(key) });
  const location = { href: url, assign: newUrl => { location.assigned = newUrl; }, replace: newUrl => { location.replaced = newUrl; } };
  const context = {
    localStorage: store(local), sessionStorage: store(pending), location,
    history: { replaceState: (_state, _title, path) => { location.href = new URL(path, frontendOrigin).href; } },
    window: { addEventListener() {} }, document: { createElement: () => ({}), body: { append: loaded } },
    URL, URLSearchParams, AbortSignal, Response, btoa, crypto, TextEncoder,
    KuntokayraSync: globalThis.KuntokayraSync, KuntokayraBrowserConfig: { workerOrigin, storageKey },
    fetch: async (input, init) => {
      assert.equal(new URL(input).origin, workerOrigin);
      assert.equal(init.credentials, 'omit');
      const path = new URL(input).pathname;
      requests.push(path);
      return app.fetchWorker(path, { ...init, headers: { ...init.headers, Origin: frontendOrigin } });
    },
  };
  vm.runInNewContext(browserBootstrap, context);
  assert.equal((await ready).src, './app.js');
  return { user: context.KuntokayraGoogleSession, requests, local, pending, location };
}

async function signInBrowser(app, browser, user) {
  await browser.user.browserAuth.signIn();
  const { state, verifier } = JSON.parse(browser.pending.values().next().value);
  const assigned = new URL(browser.location.assigned);
  assert.equal(assigned.origin, workerOrigin);
  assert.equal(assigned.searchParams.get('challenge'), await pkceChallenge(verifier));
  const login = await app.signIn(user, verifier, state);
  return openBrowser(app, { local: browser.local, pending: browser.pending, url: login.returned.href });
}

test('CORS only exposes the browser API to the configured frontend and never allows cookies', async t => {
  const app = setup(t);
  const preflight = await app.fetchWorker(journalPath, { method: 'OPTIONS', headers: { Origin: frontendOrigin, 'Access-Control-Request-Headers': 'authorization, content-type' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), frontendOrigin);
  assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'), null);
  assert.match(preflight.headers.get('Vary'), /Origin/);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.deepEqual(await (await app.device({ action: 'ready' })).json(), { ready: true });
  for (const origin of ['https://impersonator.example.test', 'null']) {
    const refused = await app.post(browserPath, { action: 'ready' }, undefined, origin);
    assert.equal(refused.status, 403);
    assert.equal(refused.headers.get('Access-Control-Allow-Origin'), null);
  }
});

test('The production readiness check requires the migrations and leaves existing sessions alone', async t => {
  const app = setup(t, { withGrants: false });
  assert.equal((await app.device({ action: 'ready' })).status, 503);
  assert.ok(app.sqlite.prepare('SELECT token_hash FROM google_test_sessions WHERE token_hash = ?').get('existing-session'));
});

test('Google returns a short-lived PKCE grant to the configured path and exactly one exchange succeeds', async t => {
  const app = setup(t);
  const denied = await app.signIn('unknown');
  assert.equal(denied.result, 'denied');
  assert.equal(denied.code, null);
  const login = await app.signIn('alice');
  assert.equal(login.result, 'signed-in');
  assert.equal(login.returned.search, '');
  assert.match(login.code, /^[a-f0-9]{64}$/);
  assert.ok(login.callback.headers.getSetCookie().every(value => value.startsWith('__Host-kuntokayra_google_flow=')));
  const exchange = { action: 'exchange', code: login.code, verifier: login.verifier };
  assert.equal((await app.device({ ...exchange, verifier: randomToken() })).status, 401);
  const replies = await Promise.all([app.device(exchange), app.device(exchange)]);
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 401]);
  const session = await replies.find(reply => reply.ok).json();
  assert.match(session.session, /^[a-f0-9]{64}$/);
  assert.equal(app.sqlite.prepare('SELECT count(*) n FROM google_browser_grants').get().n, 0);
  assert.equal(app.sqlite.prepare('SELECT count(*) n FROM google_test_sessions WHERE token_hash = ?').get(session.session).n, 0);

  const expired = await app.signIn('alice');
  app.sqlite.exec('UPDATE google_browser_grants SET expires_at = 0');
  assert.equal((await app.device({ action: 'exchange', code: expired.code, verifier: expired.verifier })).status, 401);
});

test('Private journal transfers use the Google account bound to the bearer session and allow revocation', async t => {
  const app = setup(t);
  async function session(subject) {
    const { code, verifier } = await app.signIn(subject);
    return (await app.device({ action: 'exchange', code, verifier })).json();
  }
  const a = await session('alice');
  const b = await session('bob');
  const start = { action: 'pull', after: 0 };
  const response = await app.post(journalPath, start, a.session);
  const account = (await response.json()).account;
  const change = { kind: 'weight', id: 'test-a', record: { id: 'test-a', date: '2026-11-19', value: 71.1 } };
  assert.equal((await app.post(journalPath, { action: 'push', after: 0, account, changes: [change] }, a.session)).status, 200);
  assert.equal((await app.post(journalPath, { ...start, account }, b.session)).status, 403);
  assert.deepEqual((await (await app.post(journalPath, start, b.session)).json()).commits, []);
  assert.equal((await app.post(journalPath, start, a.session, workerOrigin)).status, 403);
  assert.equal((await app.post(journalPath, start, undefined, frontendOrigin, '__Host-kuntokayra_google=' + a.session)).status, 401);
  assert.equal((await app.device({ action: 'sign-out' }, a.session)).status, 200);
  assert.equal((await app.post(journalPath, start, a.session)).status, 401);
  assert.equal((await app.post(journalPath, start, b.session)).status, 200);
  assert.deepEqual(JSON.parse(app.sqlite.prepare('SELECT changes FROM journal_sync_commits').get().changes), [change]);
});

test('The browser callback requires its pending state and preserves the original isolated local diary', async t => {
  const app = setup(t);
  const original = JSON.stringify({ workouts: [], sleep: [], weight: [{ id: 'old-local', date: '2026-11-18', value: 71.1 }] });
  const local = new Map([[storageKey, original]]);
  const first = await openBrowser(app, { local });
  assert.deepEqual(first.requests, []);
  const signedIn = await signInBrowser(app, first, 'alice');
  assert.equal(signedIn.user.result, 'signed-in');
  assert.equal(signedIn.location.href, frontendUrl);
  assert.deepEqual(signedIn.requests, [browserPath]);
  assert.equal(local.get(storageKey), original);
  const badReturn = await openBrowser(app, { local, url: `${frontendUrl}#sync_state=${randomToken()}&sync_result=signed-in&sync_code=${randomToken()}` });
  assert.equal(badReturn.user.result, 'retry');
  assert.equal(badReturn.user.account, signedIn.user.account);
  assert.deepEqual(badReturn.requests, []);
  assert.equal(local.get('kuntokayra_v1'), original);
});

test('A saved browser session reopens and automatically pulls new rows only after opt-in', async t => {
  const api = setup(t);
  const first = await signInBrowser(api, await openBrowser(api), 'alice');
  const firstApp = boot(undefined, first.local, { googleSession: first.user });
  assert.equal(first.requests.includes(journalPath), false);
  await firstApp.click(undefined, { tab: 'settings' });
  await firstApp.click('cloud-enable');
  assert.equal(firstApp.state()._journalSync.enabled, true);
  const otherDevice = await signInBrowser(api, await openBrowser(api), 'alice');
  const otherApp = boot(undefined, otherDevice.local, { googleSession: otherDevice.user });
  await otherApp.click(undefined, { tab: 'settings' });
  await otherApp.click('cloud-enable');
  await otherApp.click('new-weight');
  await otherApp.fillSimple({ value: '71.4' });
  await otherApp.submitSimple();
  await otherApp.clock.tick(1200);
  assert.equal(otherApp.state().weight[0].value, 71.4);

  const browser = await openBrowser(api, { local: first.local, pending: first.pending });
  const reopened = boot(undefined, browser.local, { googleSession: browser.user });
  for (let i = 0; i < 100 && reopened.state().weight.length === 0; i++) await tick();
  assert.deepEqual(plain(reopened.state().weight.map(record => record.value)), [71.4]);
  assert.deepEqual(browser.requests, [journalPath]);
  await browser.user.browserAuth.signOut();
  assert.equal((await browser.user.browserAuth.transport({ action: 'pull', after: 0 })).status, 401);
  const signedOut = await openBrowser(api, { local: first.local, pending: first.pending, url: browser.location.replaced });
  assert.equal(signedOut.user.account, null);
  assert.ok(first.local.has(`${storageKey}_google_${first.user.account}`));
});

test('The existing diary and Garmin connection copy to the signed-in browser only with consent', async t => {
  const api = setup(t);
  const garminKey = 'kuntokayra_garmin_connection_v1';
  const rows = { workouts: [], sleep: [], weight: [{ id: 'existing-weight', date: '2026-11-18', value: 71.1 }] };
  const connection = { endpoint: 'https://garmin-example.workers.dev', accessToken: 'test-local-token-'.repeat(3), autoSync: true };
  const local = new Map([[storageKey, JSON.stringify(rows)], [garminKey, JSON.stringify(connection)]]);
  const browser = await signInBrowser(api, await openBrowser(api, { local }), 'alice');
  const app = boot(undefined, local, { googleSession: browser.user });
  const linkedGarminKey = `${garminKey}_google_${browser.user.account}`;
  assert.deepEqual(plain(app.state().weight), []);
  assert.equal(local.has(linkedGarminKey), false);
  assert.equal(api.sqlite.prepare('SELECT count(*) n FROM journal_sync_commits').get().n, 0);

  await app.click(undefined, { tab: 'settings' });
  app.setConfirmation(false);
  await app.click('copy-local-diary');
  await app.click('garmin-copy-connection');
  assert.deepEqual(plain(app.state().weight), []);
  assert.equal(local.has(linkedGarminKey), false);
  app.setConfirmation(true);
  await app.click('copy-local-diary');
  await app.click('garmin-copy-connection');
  assert.deepEqual(plain(app.state().weight), rows.weight);
  assert.deepEqual(JSON.parse(local.get(linkedGarminKey)), connection);
  assert.equal(local.get(garminKey), JSON.stringify(connection));
  assert.equal(local.get(storageKey), JSON.stringify(rows));
  assert.equal(app.fetchCalls.length, 0);

  await app.click('export');
  const exported = await app.blobs.at(-1).text();
  assert.ok(!exported.includes(connection.accessToken));
  await app.click('cloud-enable');
  assert.equal(app.state()._journalSync.enabled, true);
  const commit = api.sqlite.prepare('SELECT changes FROM journal_sync_commits').get();
  assert.ok(!commit.changes.includes(connection.accessToken));

  const other = await signInBrowser(api, browser, 'bob');
  const otherApp = boot(undefined, local, { googleSession: other.user });
  assert.deepEqual(plain(otherApp.state().weight), []);
  assert.equal(local.has(`${garminKey}_google_${other.user.account}`), false);
});
