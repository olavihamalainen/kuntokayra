import '../sync-core.js';
import { readBody } from './journal.mjs';

const Sync = globalThis.KuntokayraSync;
const sessionMillis = 7 * 24 * 60 * 60 * 1000;

export const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');

export async function pkceChallenge(verifier) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function browserFrontend(env) {
  try {
    const url = new URL(env.APP_FRONTEND_URL);
    if (url.protocol === 'https:' && url.origin !== env.APP_ORIGIN && !url.username && !url.password &&
        !url.search && !url.hash && url.pathname.endsWith('/')) return url;
  } catch { /* A browser frontend is optional for the original test app. */ }
  return null;
}

export const validBrowserFlow = (state, challenge) => Sync.validAccount(state) && /^[A-Za-z0-9_-]{43}$/.test(challenge ?? '');

export function browserReturn(frontend, state, result, code) {
  const target = new URL(frontend);
  target.hash = new URLSearchParams({ sync_state: state, sync_result: result, ...(code ? { sync_code: code } : {}) });
  return target.href;
}

export async function issueBrowserGrant(db, frontend, challenge, account) {
  const code = randomToken();
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM google_browser_grants WHERE expires_at <= ?').bind(now),
    db.prepare('INSERT INTO google_browser_grants (grant_hash, challenge, frontend_url, account, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await Sync.hash(code), challenge, frontend.href, account, now + 180_000),
  ]);
  return code;
}

function browserToken(request) {
  return /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization') ?? '')?.[1];
}

const sessionKey = token => Sync.hash(`browser-session\n${token}`);

export async function browserVisitor(request, db) {
  const token = browserToken(request);
  if (!token) return null;
  const session = await db.prepare('SELECT account FROM google_test_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await sessionKey(token), Date.now()).first();
  return session?.account ?? null;
}

function reply(payload, status = 200) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export function withBrowserCors(response, origin) {
  const headers = new Headers(response.headers);
  headers.append('Vary', 'Origin');
  headers.set('Access-Control-Allow-Origin', origin);
  return new Response(response.body, { status: response.status, headers });
}

export function browserPreflight(origin) {
  return withBrowserCors(new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '300',
  } }), origin);
}

async function exchangeGrant(db, frontend, code, verifier) {
  if (!Sync.validAccount(code) || !Sync.validAccount(verifier)) return reply({ error: 'INPUT' }, 400);
  const now = Date.now();
  const session = randomToken();
  const expiresAt = now + sessionMillis;
  const match = [await Sync.hash(code), await pkceChallenge(verifier), frontend.href, now];
  // Both statements use the same predicate in one D1 transaction. Only the
  // browser that supplied the original PKCE verifier can consume this grant.
  const [issued] = await db.batch([
    db.prepare(`INSERT INTO google_test_sessions (token_hash, account, expires_at)
      SELECT ?, account, ? FROM google_browser_grants
      WHERE grant_hash = ? AND challenge = ? AND frontend_url = ? AND expires_at > ?
      RETURNING account`).bind(await sessionKey(session), expiresAt, ...match),
    db.prepare('DELETE FROM google_browser_grants WHERE grant_hash = ? AND challenge = ? AND frontend_url = ? AND expires_at > ?').bind(...match),
    db.prepare('DELETE FROM google_test_sessions WHERE expires_at <= ?').bind(now),
  ]);
  const account = issued.results[0]?.account;
  return account ? reply({ session, account, expiresAt }) : reply({ error: 'SIGN_IN' }, 401);
}

export async function handleBrowserSession(request, env, frontend, loginReady) {
  if (request.method !== 'POST') return reply({ error: 'METHOD' }, 405);
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply({ error: 'CONTENT_TYPE' }, 415);
  let body;
  try { body = await readBody(request, 4096); }
  catch { return reply({ error: 'INPUT' }, 400); }
  if (body?.action === 'ready') {
    if (!loginReady) return reply({ error: 'UNAVAILABLE' }, 503);
    await env.DB.batch([
      env.DB.prepare('SELECT grant_hash FROM google_browser_grants LIMIT 0'),
      env.DB.prepare('SELECT token_hash FROM google_test_sessions LIMIT 0'),
      env.DB.prepare('SELECT revision FROM journal_sync_commits LIMIT 0'),
    ]);
    return reply({ ready: true });
  }
  if (body?.action === 'exchange') return exchangeGrant(env.DB, frontend, body.code, body.verifier);
  if (body?.action === 'sign-out') {
    const token = browserToken(request);
    if (token) await env.DB.prepare('DELETE FROM google_test_sessions WHERE token_hash = ?').bind(await sessionKey(token)).run();
    return reply({ signedOut: true });
  }
  return reply({ error: 'INPUT' }, 400);
}
