(() => {
  'use strict';
  const config = globalThis.KuntokayraBrowserConfig;
  const Sync = globalThis.KuntokayraSync;
  const sessionKey = `${config.storageKey}_browser_session`;
  const pendingKey = `${sessionKey}_sign_in`;
  const workerOrigin = config.workerOrigin;

  function read(store, key) {
    try { return JSON.parse(store.getItem(key)); }
    catch { return null; }
  }

  function validSession(value) {
    return Sync.validAccount(value?.session) && Sync.validAccount(value.account) && Number.isSafeInteger(value.expiresAt);
  }

  function savedSession() {
    const value = read(localStorage, sessionKey);
    return validSession(value) ? value : null;
  }

  function post(path, body, token, signal = AbortSignal.timeout(10_000)) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(workerOrigin + path, {
      method: 'POST', headers, body: JSON.stringify(body), signal,
      credentials: 'omit', cache: 'no-store', redirect: 'error',
    });
  }

  const deviceRequest = (body, token) => post('/auth/browser-session', body, token);
  const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('');

  async function signIn() {
    try {
      const ready = await deviceRequest({ action: 'ready' });
      if (!ready.ok || (await ready.json()).ready !== true) throw Error();
    } catch { throw Error('Synkronointipalveluun ei saatu yhteyttä. Yritä uudelleen.'); }
    const verifier = random();
    const state = random();
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sessionStorage.setItem(pendingKey, JSON.stringify({ state, verifier, expiresAt: Date.now() + 600_000 }));
    const target = new URL(workerOrigin + '/auth/connect');
    target.search = new URLSearchParams({ challenge, state });
    location.assign(target.href);
  }

  async function finishSignIn(returned) {
    const pending = read(sessionStorage, pendingKey);
    if (!pending || !Sync.validAccount(pending.state) || returned.get('sync_state') !== pending.state ||
        !Number.isSafeInteger(pending.expiresAt) || pending.expiresAt <= Date.now() || !Sync.validAccount(pending.verifier)) return 'retry';
    sessionStorage.removeItem(pendingKey);
    const result = returned.get('sync_result');
    if (['denied', 'retry', 'unavailable'].includes(result)) return result;
    const code = returned.get('sync_code');
    if (result !== 'signed-in' || !Sync.validAccount(code)) return 'retry';

    let session;
    try {
      const response = await deviceRequest({ action: 'exchange', code, verifier: pending.verifier });
      if (!response.ok) return 'retry';
      session = await response.json();
      if (!validSession(session) || session.expiresAt <= Date.now()) return 'retry';
      const previous = savedSession();
      localStorage.setItem(sessionKey, JSON.stringify(session));
      if (previous && previous.session !== session.session) deviceRequest({ action: 'sign-out' }, previous.session).catch(() => {});
      return 'signed-in';
    } catch {
      if (validSession(session)) deviceRequest({ action: 'sign-out' }, session.session).catch(() => {});
      return 'retry';
    }
  }

  async function start() {
    const url = new URL(location.href);
    const returned = new URLSearchParams(url.hash.slice(1));
    let result = url.searchParams.get('auth') === 'signed-out' ? 'signed-out' : null;
    if (returned.has('sync_state') || returned.has('sync_code') || returned.has('sync_result')) {
      url.hash = '';
      history.replaceState(null, '', url.pathname + url.search);
      try { result = await finishSignIn(returned); }
      catch { result = 'retry'; }
    }
    if (url.searchParams.has('auth')) {
      url.searchParams.delete('auth');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }

    const session = savedSession();
    const current = () => savedSession()?.session === session?.session;
    const transport = (body, signal) => {
      if (!current() || !session || session.expiresAt <= Date.now()) return Response.json({ error: 'SIGN_IN' }, { status: 401 });
      return post('/journal-sync/v1', body, session.session, signal);
    };
    const signOut = async () => {
      if (current()) localStorage.removeItem(sessionKey);
      if (session) await deviceRequest({ action: 'sign-out' }, session.session).catch(() => {});
      url.searchParams.set('auth', 'signed-out');
      location.replace(url.href);
    };

    globalThis.KuntokayraGoogleSession = Object.freeze({
      account: session?.account ?? null, result, showSettings: Boolean(result), localStorageKey: config.storageKey,
      garminStorageKey: config.garminStorageKey, browserAuth: { signIn, signOut, transport },
    });

    window.addEventListener('storage', event => {
      if ((event.key === sessionKey || event.key === null) && !current()) location.reload();
    });
    window.addEventListener('pageshow', event => {
      if (event.persisted && !current()) location.reload();
    });

    const app = document.createElement('script');
    app.src = './app.js';
    document.body.append(app);
  }

  start();
})();
