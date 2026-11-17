// Standalone Cloudflare Worker. No credentials belong in this file.
export const DEFAULT_ALLOWED_ORIGIN = 'https://olavihamalainen.github.io';
export const PREVIEW_ALLOWED_ORIGIN = 'https://kuntokayra-olavi-esikatselu-20261116.festivecoyote3.chatgpt.site';
export const WORKER_VERSION = '2026-11-17.3';
const GARMIN_ORIGIN = 'https://personal.connectapi.garmin.com';
const TOKEN_URL = `${GARMIN_ORIGIN}/personalapitoken-service/personal-api/personal-api-key/token`;
const DAY_MS = 86400000;
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_MEASUREMENTS = 2048;
const helsinkiDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit',
});

class WorkerError extends Error {
  constructor(code, message, status = 502, detail) {
    super(message);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function invalidUpstream(detail = 'RESPONSE_FORMAT') {
  // Only fixed parser-stage codes leave this service, never Garmin's response.
  return new WorkerError('GARMIN_RESPONSE_INVALID', 'Garmin palautti virheellisen vastauksen. Yritä myöhemmin uudelleen.', 502, detail);
}

function localDate(timestamp) {
  const parts = Object.fromEntries(helsinkiDate.formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateNumber(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString().slice(0, 10) === value ? milliseconds / DAY_MS : null;
}

function parseRange(url, currentTime) {
  const keys = [...url.searchParams.keys()];
  if (keys.length !== 2 || keys.some(key => !['from', 'to'].includes(key)) ||
      url.searchParams.getAll('from').length !== 1 || url.searchParams.getAll('to').length !== 1) {
    throw new WorkerError('INVALID_RANGE', 'Anna kelvollinen alkupäivä ja loppupäivä.', 400);
  }
  const from = url.searchParams.get('from'), to = url.searchParams.get('to');
  const first = dateNumber(from), last = dateNumber(to), today = dateNumber(localDate(currentTime));
  if (first === null || last === null || first > last || last - first > 30 || first < today - 30 || last > today) {
    throw new WorkerError('INVALID_RANGE', 'Painotiedot voi hakea enintään 31 viimeisimmältä kalenteripäivältä.', 400);
  }
  return { from, to };
}

function validAppToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(value);
}

function constantTimeEqual(actual, expected) {
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < Math.max(actual.length, expected.length); index++) {
    difference |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function allowedOrigins(env) {
  if (env.ALLOWED_ORIGIN === undefined) return new Set([DEFAULT_ALLOWED_ORIGIN, PREVIEW_ALLOWED_ORIGIN]);
  // Preserve the earlier explicit single-origin override when it is configured.
  const value = env.ALLOWED_ORIGIN;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.origin === value && !url.username && !url.password) return new Set([value]);
  } catch { /* Invalid configuration is handled without returning its value. */ }
  throw new WorkerError('NOT_CONFIGURED', 'Garmin-yhteyttä ei ole vielä määritetty.', 503);
}

function headersFor(origin, allowed) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Kuntokayra-Worker-Version': WORKER_VERSION,
  });
  if (origin === allowed) headers.set('Access-Control-Allow-Origin', allowed);
  return headers;
}

function jsonResponse(payload, status, origin, allowed) {
  return new Response(JSON.stringify(payload), { status, headers: headersFor(origin, allowed) });
}

function timestampOf(record) {
  // A local, unzoned date cannot identify a real measurement instant.
  const value = record.timestampGMT ?? record.date;
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= Date.UTC(2000, 0, 1) && value <= 8640000000000000) return value;
    throw invalidUpstream('TIMESTAMP_FORMAT');
  }
  if (typeof value !== 'string') throw invalidUpstream('TIMESTAMP_FORMAT');
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})$/.exec(value);
  if (!match || dateNumber(match[1]) === null || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) {
    throw invalidUpstream('TIMESTAMP_FORMAT');
  }
  const zone = match[6];
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.replace(':', '').slice(3, 5)) > 59)) throw invalidUpstream('TIMESTAMP_FORMAT');
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) throw invalidUpstream('TIMESTAMP_FORMAT');
  return timestamp;
}

function individualMeasurements(payload, range) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.dailyWeightSummaries) || payload.dailyWeightSummaries.length > 31) {
    throw invalidUpstream('WEIGHT_SUMMARIES');
  }
  const measurements = new Map();
  let count = 0;
  for (const day of payload.dailyWeightSummaries) {
    if (!day || typeof day !== 'object' || Array.isArray(day)) throw invalidUpstream('WEIGHT_ENTRIES');
    // includeAll=true is essential. Never substitute a daily latest/average value.
    let entries = day.allWeightMetrics;
    if (entries == null && day.numOfWeightEntries === 0) entries = [];
    if (!Array.isArray(entries)) throw invalidUpstream('WEIGHT_ENTRIES');
    count += entries.length;
    if (count > MAX_MEASUREMENTS) throw invalidUpstream('MEASUREMENT_LIMIT');
    for (const record of entries) {
      if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.weight !== 'number' ||
          !Number.isFinite(record.weight)) throw invalidUpstream('WEIGHT_VALUE');
      // Personal API's weight/range wire values are grams, regardless of profile
      // units. Normalize exactly once here; the browser and backups use kg.
      const weight = record.weight / 1000;
      if (weight < 1 || weight > 1000) throw invalidUpstream('WEIGHT_VALUE');
      const timestamp = timestampOf(record);
      const calendar = localDate(timestamp);
      if (calendar < range.from || calendar > range.to) continue;
      const id = `garmin-${timestamp}`;
      if (measurements.has(id) && measurements.get(id).weight !== weight) throw invalidUpstream('WEIGHT_CONFLICT');
      measurements.set(id, { id, timestamp, weight });
    }
  }
  return [...measurements.values()].sort((a, b) => a.timestamp - b.timestamp || a.weight - b.weight);
}

function jwtExpiration(token, currentTime) {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw invalidUpstream('TOKEN_FORMAT');
  try {
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
    const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    // JWT NumericDate permits fractional seconds as well as integer seconds.
    if (typeof claims?.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp > 8640000000000 || claims.exp * 1000 <= currentTime) throw invalidUpstream('TOKEN_EXPIRATION');
    // exp is used only for caching the token obtained over Garmin's HTTPS API.
    return Math.min(claims.exp * 1000, currentTime + DAY_MS);
  } catch (error) { throw error instanceof WorkerError ? error : invalidUpstream('TOKEN_FORMAT'); }
}

export function createWorker({ fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = 10000 } = {}) {
  let cachedToken = null;
  let tokenInFlight = null;

  async function boundedFetch(url, init, maximumBytes) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new WorkerError('GARMIN_TIMEOUT', 'Garmin ei vastannut ajoissa. Yritä myöhemmin uudelleen.'));
      }, timeoutMs);
    });
    async function perform() {
      const response = await fetchImpl(url, { ...init, redirect: 'manual', signal: controller.signal, cache: 'no-store' });
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => {});
        return { status: response.status, text: '' };
      }
      const declaredLength = response.headers.get('Content-Length');
      if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
        await response.body?.cancel().catch(() => {});
        throw invalidUpstream('BODY_LIMIT');
      }
      if (!response.body) throw invalidUpstream('EMPTY_RESPONSE');
      const reader = response.body.getReader(), chunks = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maximumBytes) {
            await reader.cancel().catch(() => {});
            throw invalidUpstream('BODY_LIMIT');
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw invalidUpstream(); }
      return { status: response.status, text };
    }
    try { return await Promise.race([perform(), timeout]); }
    catch (error) {
      if (error instanceof WorkerError) throw error;
      throw new WorkerError('GARMIN_UNAVAILABLE', 'Garmin-yhteys ei ole juuri nyt käytettävissä.');
    } finally { clearTimeout(timer); }
  }

  async function tokenFor(apiKey, force = false) {
    if (!force && cachedToken?.apiKey === apiKey && cachedToken.expiresAt > now() + 60000) return cachedToken.token;
    if (tokenInFlight?.apiKey === apiKey) return tokenInFlight.promise;
    const promise = (async () => {
      const response = await boundedFetch(TOKEN_URL, {
        method: 'POST', headers: { 'Authorization': `ApiKey ${apiKey}`, 'Accept': '*/*' },
      }, 16384);
      if ([401, 403].includes(response.status)) throw new WorkerError('GARMIN_KEY_REJECTED', 'Garmin-avain ei kelpaa tai on vanhentunut. Tarkista palvelun asetukset.');
      if (response.status === 429) throw new WorkerError('GARMIN_RATE_LIMITED', 'Garmin rajoitti hakutiheyttä. Yritä myöhemmin uudelleen.');
      if (response.status !== 200) throw new WorkerError('GARMIN_UNAVAILABLE', 'Garmin-yhteys ei ole juuri nyt käytettävissä.');
      const token = response.text.trim(); // Official endpoint returns a plain JWT, not JSON.
      cachedToken = { apiKey, token, expiresAt: jwtExpiration(token, now()) };
      return token;
    })();
    tokenInFlight = { apiKey, promise };
    try { return await promise; }
    finally { if (tokenInFlight?.promise === promise) tokenInFlight = null; }
  }

  async function readWeights(apiKey, range) {
    const dataUrl = `${GARMIN_ORIGIN}/weight-service/weight/range/${range.from}/${range.to}?includeAll=true`;
    async function query(token) {
      return boundedFetch(dataUrl, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } }, MAX_BODY_BYTES);
    }
    let response = await query(await tokenFor(apiKey));
    if (response.status === 401) {
      cachedToken = null;
      response = await query(await tokenFor(apiKey, true));
    }
    if (response.status === 401) throw new WorkerError('GARMIN_TOKEN_REJECTED', 'Garmin-yhteyden käyttöoikeus ei kelpaa. Tarkista Garmin-avain.');
    if (response.status === 403) throw new WorkerError('GARMIN_ACCESS_DENIED', 'Garmin ei sallinut painotietojen hakua.');
    if (response.status === 429) throw new WorkerError('GARMIN_RATE_LIMITED', 'Garmin rajoitti hakutiheyttä. Yritä myöhemmin uudelleen.');
    if (response.status !== 200) throw new WorkerError('GARMIN_UNAVAILABLE', 'Garmin-yhteys ei ole juuri nyt käytettävissä.');
    let payload;
    try { payload = JSON.parse(response.text); } catch { throw invalidUpstream('WEIGHT_JSON'); }
    return individualMeasurements(payload, range);
  }

  return {
    async fetch(request, env = {}) {
      const origin = request.headers.get('Origin');
      let allowed = DEFAULT_ALLOWED_ORIGIN;
      try {
        const origins = allowedOrigins(env);
        allowed = origins.has(origin) ? origin : [...origins][0];
        const url = new URL(request.url);
        if (origin !== null && origin !== allowed) throw new WorkerError('ORIGIN_DENIED', 'Tämä sovellusosoite ei ole sallittu.', 403);
        if (url.pathname !== '/v1/weights') throw new WorkerError('NOT_FOUND', 'Osoitetta ei löytynyt.', 404);
        if (request.method === 'OPTIONS') {
          const requestedHeaders = (request.headers.get('Access-Control-Request-Headers') || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
          if (origin !== allowed || request.headers.get('Access-Control-Request-Method') !== 'GET' || requestedHeaders.some(value => !['authorization', 'content-type'].includes(value))) {
            throw new WorkerError('ORIGIN_DENIED', 'Tämä sovelluspyyntö ei ole sallittu.', 403);
          }
          const headers = headersFor(origin, allowed);
          headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
          headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
          return new Response(null, { status: 204, headers });
        }
        if (request.method !== 'GET') throw new WorkerError('METHOD_NOT_ALLOWED', 'Vain painotietojen luku on sallittu.', 405);
        if (!validAppToken(env.APP_ACCESS_TOKEN)) throw new WorkerError('NOT_CONFIGURED', 'Garmin-yhteyttä ei ole vielä määritetty.', 503);
        const authorization = /^Bearer ([A-Za-z0-9_-]{32,256})$/i.exec(request.headers.get('Authorization') || '');
        if (!authorization || !constantTimeEqual(authorization[1], env.APP_ACCESS_TOKEN)) throw new WorkerError('UNAUTHORIZED', 'Yhteyden tunniste puuttuu tai on virheellinen.', 401);
        const range = parseRange(url, now());
        const apiKey = typeof env.GARMIN_API_KEY === 'string' ? env.GARMIN_API_KEY.trim() : '';
        if (!apiKey || apiKey.length > 4096 || /[^\x21-\x7e]/.test(apiKey)) throw new WorkerError('NOT_CONFIGURED', 'Garmin-yhteyttä ei ole vielä määritetty.', 503);
        const measurements = await readWeights(apiKey, range);
        return jsonResponse({ measurements, ...range }, 200, origin, allowed);
      } catch (error) {
        const safe = error instanceof WorkerError ? error : new WorkerError('GARMIN_UNAVAILABLE', 'Garmin-yhteys ei ole juuri nyt käytettävissä.');
        return jsonResponse({ error: safe.code, message: safe.message, ...(safe.detail ? { detail: safe.detail } : {}) }, safe.status, origin, allowed);
      }
    },
  };
}

export default createWorker();
