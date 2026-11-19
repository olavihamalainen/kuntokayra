import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate as nextTick } from 'node:timers/promises';
import '../garmin-core.js';
import '../sync-core.js';
import { syncJournal } from '../sync-worker/journal.mjs';
import { boot, plain } from './helpers/browser-harness.mjs';
import { history } from './helpers/fixtures.mjs';
import { testD1 } from './helpers/d1.mjs';

const Sync = globalThis.KuntokayraSync;
const origin = 'https://sync.example.test';
const route = '/journal-sync/v1';
const accountKey = 'a'.repeat(64);
const storageKey = `kuntokayra_v1_google_${accountKey}`;
const migration = readFileSync(new URL('../sync-worker/migrations/0000_journal_sync.sql', import.meta.url), 'utf8');
const weigh = (id, value = 75.5, date = '2026-11-10') => ({ id, date, value });
const entry = record => ({ kind: 'weight', id: record.id, record });
const empty = () => ({ workouts: [], sleep: [], weight: [] });

function service(t) {
  const { sqlite, DB } = testD1(t, migration);
  const fetchAs = account => async (url, init) => {
    return syncJournal(new Request(new URL(url, origin), init), DB, account ? await Sync.hash(account) : null);
  };
  const post = (account, body) => fetchAs(account)(route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const rows = () => sqlite.prepare('SELECT revision, account, changes FROM journal_sync_commits ORDER BY revision').all();
  return { fetchAs, post, rows };
}

const mount = (backend, { initial, storage, user = 'test-account-a', fetch } = {}) =>
  boot(initial, storage, { googleSession: {account: accountKey}, fetch: fetch ?? backend.fetchAs(user) });

async function enable(app) {
  await app.click(undefined, { tab: 'settings' });
  await app.click('cloud-enable');
  assert.equal(app.state()[Sync.metadataKey]?.enabled, true, app.document.getElementById('cloud-sync-status')?.textContent);
}

async function until(condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await nextTick();
  }
  assert.fail('Automatic synchronization did not complete');
}

test('Private API authorizes each account and atomically rejects uploads based on a stale revision', async t => {
  const api = service(t);
  const a = await (await api.post('test-account-a', { action: 'pull', after: 0 })).json();
  const b = await (await api.post('test-account-b', { action: 'pull', after: 0 })).json();
  assert.notEqual(a.account, b.account);
  const change = { action: 'push', after: 0, account: a.account, changes: [entry(weigh('sample'))] };
  assert.equal((await api.post(null, change)).status, 401);
  assert.equal((await api.post('test-account-b', change)).status, 403);
  assert.equal((await api.post('test-account-a', { ...change, changes: [entry(weigh('bad', 0))] })).status, 400);
  assert.equal(api.rows().length, 0);
  const added = await api.post('test-account-a', change);
  assert.equal(added.status, 200);
  assert.equal((await api.post('test-account-a', change)).status, 409);
  assert.equal((await api.post('test-account-b', { action: 'pull', account: a.account, after: 0 })).status, 403);
  const other = await (await api.post('test-account-b', { action: 'pull', after: 0 })).json();
  assert.deepEqual(other.commits, []);
  assert.equal(api.rows().length, 1);
});

test('Updates and deletions remain in the cloud history and pagination can reconstruct the latest copy', async t => {
  const api = service(t);
  const user = 'test-account-a';
  const { account } = await (await api.post(user, { action: 'pull', after: 0 })).json();
  let revision = 0;
  for (let index = 0; index < 10; index++) {
    const response = await api.post(user, { action: 'push', account, after: revision, changes: [entry(weigh('w', 75 + index))] });
    assert.equal(response.status, 200);
    revision = (await response.json()).revision;
  }
  assert.equal((await api.post(user, { action: 'push', account, after: revision, changes: [{ kind: 'weight', id: 'w', record: null }] })).status, 200);
  const app = mount(api);
  await enable(app);
  assert.equal(app.state().weight.length, 0);
  assert.equal(app.fetchCalls.length, 2);
  assert.equal(api.rows().length, 11);
  assert.equal(JSON.parse(api.rows()[0].changes)[0].record.value, 75);
});

test('Google sign-in leaves an existing diary byte-for-byte alone until the copy is explicitly enabled', async t => {
  const api = service(t);
  const app = mount(api, { initial: history });
  const before = app.storage.get(storageKey);
  await app.click(undefined, { tab: 'settings' });
  assert.ok(app.document.getElementById('cloud-enable'));
  app.setConfirmation(false);
  await app.click('cloud-enable');
  await app.emitWindow('pageshow');
  await app.emitWindow('online');
  assert.equal(app.fetchCalls.length, 0);
  assert.equal(app.writes.length, 0);
  assert.equal(app.storage.get(storageKey), before);
  assert.equal(api.rows().length, 0);
});

test('A second device loads workouts, sleep, and Garmin weights and refreshes automatically on reopening', async t => {
  const api = service(t);
  const initial = {
    ...plain(history), settings: { restSeconds: 120 },
    weight: [...history.weight, { ...weigh('garmin-example', 74, '2026-11-13'), source: 'garmin', garminId: 'example', measuredAt: '2026-11-13T07:00:00.000Z' }],
  };
  const first = mount(api, { initial });
  await enable(first);
  assert.deepEqual(plain(Sync.retainedBackup(first.state())), initial);
  const second = mount(api);
  await enable(second);
  for (const kind of Sync.kinds) assert.deepEqual(second.state()[kind], first.state()[kind]);
  assert.equal(second.state().settings, undefined);
  assert.equal(api.rows().length, 1);
  assert.ok(first.fetchCalls.every(call => call.url === route));

  await first.click('new-weight');
  await first.fillSimple({ date: '2026-11-15', value: '73.8' });
  await first.submitSimple();
  await first.clock.tick(1001);
  assert.equal(api.rows().length, 2);
  assert.equal(JSON.parse(api.rows()[1].changes).length, 1);

  const reopened = mount(api, { storage: second.storage });
  await until(() => reopened.state().weight.some(row => row.value === 73.8));
  assert.equal(reopened.fetchCalls.length, 1);
  assert.equal(api.rows().length, 2);
});

test('Offline edits are preserved on both devices when the same record has changed', async t => {
  const api = service(t);
  const left = mount(api, { initial: { ...empty(), weight: [weigh('shared')] } });
  const right = mount(api);
  await enable(left);
  await enable(right);
  left.setOnline(false);
  right.setOnline(false);
  for (const [app, value] of [[left, '74'], [right, '73']]) {
    await app.click('edit-weight', { id: 'shared' });
    await app.fillSimple({ value });
    await app.submitSimple();
    await app.clock.tick(1001);
  }
  assert.equal(api.rows().length, 1);
  left.setOnline(true);
  await left.emitWindow('online');
  right.setOnline(true);
  await right.emitWindow('online');
  await left.click('cloud-refresh');
  for (const app of [left, right]) {
    assert.deepEqual(app.state().weight.map(row => row.value).sort(), [73, 74]);
    assert.equal(new Set(app.state().weight.map(row => row.id)).size, 2);
  }
  await right.click('edit-weight', { id: 'shared' });
  await right.fillSimple({ value: '75' });
  await right.submitSimple();
  assert.deepEqual(right.state().weight.map(row => row.value).sort(), [73, 75]);
});

test('Pausing a device keeps its diary offline and its cloud export remains available', async t => {
  const api = service(t);
  const app = mount(api, { initial: history });
  await enable(app);
  await app.click('cloud-pause');
  const requests = app.fetchCalls.length;
  await app.click('new-weight');
  await app.fillSimple({ date: '2026-11-16', value: '76.3' });
  await app.submitSimple();
  await app.clock.tick(2000);
  await app.emitWindow('pageshow');
  assert.equal(app.fetchCalls.length, requests);
  assert.equal(api.rows().length, 1);
  assert.ok(app.state().weight.some(row => row.value === 76.3));
  await app.click('cloud-export');
  const exported = JSON.parse(await app.blobs.at(-1).text());
  assert.equal(exported.version, 1);
  assert.deepEqual(exported.data.weight, history.weight);
  await app.click('export');
  const localCopy = JSON.parse(await app.blobs.at(-1).text());
  assert.equal(localCopy.data[Sync.metadataKey], undefined);
  assert.deepEqual(localCopy.data.weight, app.state().weight);
});

test('Backing up and replacing or clearing local records does not publish bulk cloud deletions', async t => {
  const api = service(t);
  const app = mount(api, { initial: history });
  await enable(app);
  await app.click('export');
  const backup = JSON.parse(await app.blobs.at(-1).text());
  await app.importBackup(backup);
  assert.equal(app.state()[Sync.metadataKey].enabled, false);
  await app.click('clear');
  await app.clock.tick(2000);
  assert.deepEqual(app.state().sleep, []);
  assert.equal(api.rows().length, 1);
  await enable(app);
  assert.deepEqual(app.state().sleep, history.sleep);
  assert.deepEqual(app.state().weight, history.weight);
  assert.equal(api.rows().length, 1);
});

test('A late pull cannot overwrite records after pausing, and a rejected browser write leaves data intact', async t => {
  const api = service(t);
  const a = mount(api, { initial: history });
  await enable(a);
  const b = mount(api);
  await enable(b);
  await b.click('new-weight');
  await b.fillSimple({ date: '2026-11-15', value: '73.8' });
  await b.submitSimple();
  await b.clock.tick(1001);

  a.setStorageFailure(true);
  await a.click('cloud-refresh');
  assert.deepEqual(a.state().weight, history.weight);
  a.setStorageFailure(false);
  let resolve;
  const late = new Promise(done => { resolve = done; });
  a.setFetch(async (url, init) => {
    const response = await api.fetchAs('test-account-a')(url, { ...init, signal: undefined });
    await late;
    return response;
  });
  const requested = a.click('cloud-refresh');
  await until(() => a.fetchCalls.length >= 4);
  await a.click('cloud-pause');
  resolve();
  await requested;
  assert.deepEqual(a.state().weight, history.weight);
  assert.equal(a.state()[Sync.metadataKey].enabled, false);
});
