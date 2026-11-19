import '../garmin-core.js';
import '../sync-core.js';
import {
  browserFrontend, browserPreflight, browserReturn, browserVisitor, handleBrowserSession,
  issueBrowserGrant, pkceChallenge, randomToken, validBrowserFlow, withBrowserCors,
} from './browser-auth.mjs';
import { syncJournal } from './journal.mjs';

const Sync = globalThis.KuntokayraSync;
const flowCookie = '__Host-kuntokayra_google_flow';
const flowSeconds = 600;
const callbackPath = '/auth/google/callback';

function flow(request) {
  const cookie = (request.headers.get('Cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${flowCookie}=`));
  return (cookie?.slice(flowCookie.length + 1) ?? '').split('.');
}

function redirect(location, value, maxAge) {
  return new Response(null, { status: 303, headers: {
    Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'Set-Cookie': `${flowCookie}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`,
  } });
}

function json(value, status) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

async function startLogin(env, frontend, browserState, challenge, ready) {
  if (!validBrowserFlow(browserState, challenge)) return json({ error: 'INPUT' }, 400);
  if (!ready) return redirect(browserReturn(frontend, browserState, 'unavailable'), '', 0);
  const state = randomToken();
  const verifier = randomToken();
  const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  target.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: env.APP_ORIGIN + callbackPath, response_type: 'code',
    scope: 'openid email', state, code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256', prompt: 'select_account',
  });
  return redirect(target.href, `${state}.${verifier}.${Date.now() + flowSeconds * 1000}.${browserState}.${challenge}`, flowSeconds);
}

async function completeLogin(url, request, env, frontend, upstream, allowedEmails, ready) {
  const [state, verifier, expiresAt, browserState, challenge] = flow(request);
  const result = (status, grant) => redirect(browserReturn(frontend, browserState ?? '', status, grant), '', 0);
  const code = url.searchParams.get('code');
  if (!ready) return result('unavailable');
  if (!validBrowserFlow(browserState, challenge) || !Sync.validAccount(state) || !Sync.validAccount(verifier) ||
      !/^\d{13}$/.test(expiresAt ?? '') || Number(expiresAt) <= Date.now() || url.searchParams.get('state') !== state ||
      !code || code.length > 4096 || url.searchParams.has('error')) return result('retry');

  const tokenResponse = await upstream('https://oauth2.googleapis.com/token', {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, code_verifier: verifier,
      client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.APP_ORIGIN + callbackPath,
    }),
  });
  if (!tokenResponse.ok) return result('retry');
  const { access_token: token, token_type: type } = await tokenResponse.json();
  if (typeof token !== 'string' || !token || typeof type !== 'string' || type.toLowerCase() !== 'bearer') return result('retry');

  const userResponse = await upstream('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'manual', signal: AbortSignal.timeout(10_000),
  });
  if (!userResponse.ok) return result('retry');
  const user = await userResponse.json();
  if (typeof user.sub !== 'string' || !/^[a-zA-Z0-9_-]{1,255}$/.test(user.sub) || user.email_verified !== true ||
      typeof user.email !== 'string' || !allowedEmails.includes(user.email.toLowerCase())) return result('denied');

  const account = await Sync.hash(`kuntokayra-google\n${user.sub}`);
  return result('signed-in', await issueBrowserGrant(env.DB, frontend, challenge, account));
}

export function createSyncWorker(upstream = fetch) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.origin !== env.APP_ORIGIN || url.protocol !== 'https:') return json({ error: 'ORIGIN' }, 403);
      const frontend = browserFrontend(env);
      if (!frontend) return json({ error: 'UNAVAILABLE' }, 503);
      const emails = String(env.GOOGLE_ALLOWED_EMAILS ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
      const ready = Boolean(env.DB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && emails.length);

      const browserSession = url.pathname === '/auth/browser-session';
      if (browserSession || url.pathname === '/journal-sync/v1') {
        if (request.headers.get('Origin') !== frontend.origin) return json({ error: 'ORIGIN' }, 403);
        if (request.method === 'OPTIONS') return browserPreflight(frontend.origin);
        try {
          if (!env.DB) return withBrowserCors(json({ error: 'UNAVAILABLE' }, 503), frontend.origin);
          const response = browserSession ? await handleBrowserSession(request, env, frontend, ready)
            : await syncJournal(request, env.DB, await browserVisitor(request, env.DB));
          return withBrowserCors(response, frontend.origin);
        } catch { return withBrowserCors(json({ error: 'UNAVAILABLE' }, 503), frontend.origin); }
      }

      if (request.method === 'GET' && url.pathname === '/auth/connect') {
        return startLogin(env, frontend, url.searchParams.get('state'), url.searchParams.get('challenge'), ready);
      }
      if (request.method === 'GET' && url.pathname === callbackPath) {
        try { return await completeLogin(url, request, env, frontend, upstream, emails, ready); }
        catch { return redirect(browserReturn(frontend, flow(request)[3] ?? '', 'retry'), '', 0); }
      }
      return json({ error: 'NOT_FOUND' }, 404);
    },
  };
}

export default createSyncWorker();
