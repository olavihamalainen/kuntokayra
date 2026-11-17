import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, DEFAULT_ALLOWED_ORIGIN, PREVIEW_ALLOWED_ORIGIN, WORKER_VERSION } from './worker.mjs';

const CURRENT_TIME = Date.parse('2026-11-17T10:00:00Z');
const APP_TOKEN = 'synthetic_test_app_token_0123456789_abcdefghi';
const API_KEY = 'synthetic_test_garmin_key_0123456789';
const ENV = { APP_ACCESS_TOKEN: APP_TOKEN, GARMIN_API_KEY: API_KEY };
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const LEAK_MARKER = 'SENSITIVE_UPSTREAM_BODY_DO_NOT_RETURN';

function jwt(current = CURRENT_TIME, extra = {}) {
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part({ exp: Math.floor(current / 1000) + 86400, ...extra })}.synthetic_signature`;
}
function record(timestamp = '2026-11-17T04:05:00.000Z', weight = 78.5) {
  // The helper accepts kg for readability and emits Garmin's wire-format grams.
  return { timestampGMT: timestamp, calendarDate: '2026-11-17', weight: typeof weight === 'number' ? weight * 1000 : weight };
}
function data(entries = [record()]) {
  return { dailyWeightSummaries: [{ summaryDate: '2026-11-17', numOfWeightEntries: entries.length, allWeightMetrics: entries }] };
}
function request(query = 'from=2026-11-17&to=2026-11-17', options = {}) {
  return new Request(`https://worker.example/v1/weights?${query}`, {
    ...options,
    headers: { Origin: DEFAULT_ALLOWED_ORIGIN, Authorization: `Bearer ${APP_TOKEN}`, ...options.headers },
  });
}
function setup({ payload = data(), tokenStatus = 200, dataStatus = 200, tokenText = jwt(), timeoutMs = 10000, ...options } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (new URL(url).pathname === TOKEN_PATH) return new Response(tokenStatus === 200 ? tokenText : LEAK_MARKER, { status: tokenStatus });
    return new Response(dataStatus === 200 ? JSON.stringify(payload) : LEAK_MARKER, { status: dataStatus });
  };
  const worker = createWorker({ fetchImpl, now: () => CURRENT_TIME, timeoutMs, ...options });
  return { worker, calls };
}

test('uses official plain JWT token protocol and converts individual grams to kilograms with stable IDs', async () => {
  const { worker, calls } = setup({ payload: {
    ...data([record('2026-11-17T04:05:00.000Z', 78.5), record('2026-11-17T12:05:00.000Z', 79)]),
    totalAverage: { weight: 999 }, previousDateWeight: record('2026-11-16T04:00:00Z', 999), nextDateWeight: record('2026-11-18T04:00:00Z', 999),
  } });
  const response = await worker.fetch(request(), ENV), result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result, {
    measurements: [
      { id: 'garmin-1794888300000', timestamp: Date.parse('2026-11-17T04:05:00.000Z'), weight: 78.5 },
      { id: 'garmin-1794917100000', timestamp: Date.parse('2026-11-17T12:05:00.000Z'), weight: 79 },
    ], from: '2026-11-17', to: '2026-11-17',
  });
  assert.equal(calls[0].url, `https://personal.connectapi.garmin.com${TOKEN_PATH}`);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `ApiKey ${API_KEY}`);
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[1].url, 'https://personal.connectapi.garmin.com/weight-service/weight/range/2026-11-17/2026-11-17?includeAll=true');
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${jwt()}`);
  assert.ok(calls.every(call => call.init.redirect === 'manual' && call.init.cache === 'no-store'));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), DEFAULT_ALLOWED_ORIGIN);
  assert.equal(response.headers.get('X-Kuntokayra-Worker-Version'), WORKER_VERSION);
  assert.ok(!JSON.stringify(result).includes(API_KEY));
});

test('literal Garmin gram values are divided once, preserve precision and never guess kilogram input', async () => {
  const timestamp = Date.parse('2026-11-17T04:05:00Z');
  for (const [grams, kilograms] of [[75000, 75], [78345.67, 78.34567], [1000, 1], [1000000, 1000]]) {
    const { worker } = setup({ payload: data([{ timestampGMT: timestamp, weight: grams }]) });
    const response = await worker.fetch(request(), ENV);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).measurements, [{ id: `garmin-${timestamp}`, timestamp, weight: kilograms }]);
  }
  // Unsupported kg-shaped input cannot silently enter the diary at the wrong scale.
  const { worker } = setup({ payload: data([{ timestampGMT: timestamp, weight: 75 }]) });
  const rejected = await worker.fetch(request(), ENV);
  assert.equal(rejected.status, 502);
  assert.equal((await rejected.json()).detail, 'WEIGHT_VALUE');
});

test('unauthenticated preflight works without Garmin or application secrets', async () => {
  const { worker, calls } = setup();
  const response = await worker.fetch(request('', { method: 'OPTIONS', headers: {
    Authorization: '', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization, content-type',
  } }), {});
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), DEFAULT_ALLOWED_ORIGIN);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
  assert.ok(!response.headers.has('Access-Control-Allow-Credentials'));
  assert.equal(calls.length, 0);
});

test('production and preview origins both work while requests reflect only the matching origin and always require authentication', async () => {
  assert.equal(DEFAULT_ALLOWED_ORIGIN, 'https://olavihamalainen.github.io');
  const { worker } = setup();
  for (const origin of [DEFAULT_ALLOWED_ORIGIN, PREVIEW_ALLOWED_ORIGIN]) {
    const preflight = await worker.fetch(request('', { method: 'OPTIONS', headers: {
      Origin: origin, Authorization: '', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization',
    } }), {});
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
    const response = await worker.fetch(request(undefined, { headers: { Origin: origin } }), ENV);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    const unauthenticated = await worker.fetch(request(undefined, { headers: { Origin: origin, Authorization: '' } }), ENV);
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get('Access-Control-Allow-Origin'), origin);
  }
  for (const origin of ['https://other-user.github.io', 'https://olavihamalainen.github.io.evil.example', `${DEFAULT_ALLOWED_ORIGIN}/kuntokayra/`]) {
    const response = await worker.fetch(request(undefined, { headers: { Origin: origin } }), ENV);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
});

test('an explicit ALLOWED_ORIGIN remains a strict single-origin override and rejects paths or multiple origins', async () => {
  const { worker } = setup();
  const env = { ...ENV, ALLOWED_ORIGIN: PREVIEW_ALLOWED_ORIGIN };
  const rejected = await worker.fetch(request(), env);
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('Access-Control-Allow-Origin'), null);
  const accepted = await worker.fetch(request(undefined, { headers: { Origin: PREVIEW_ALLOWED_ORIGIN } }), env);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get('Access-Control-Allow-Origin'), PREVIEW_ALLOWED_ORIGIN);
  for (const value of [`${DEFAULT_ALLOWED_ORIGIN}/kuntokayra/`, `${DEFAULT_ALLOWED_ORIGIN},${PREVIEW_ALLOWED_ORIGIN}`]) {
    const response = await worker.fetch(request(), { ...ENV, ALLOWED_ORIGIN: value });
    assert.equal(response.status, 503);
  }
});

test('CORS does not authenticate data and disallows other origins and headers', async () => {
  const { worker, calls } = setup();
  for (const origin of ['https://evil.example', `${DEFAULT_ALLOWED_ORIGIN}.evil.example`, 'null']) {
    const response = await worker.fetch(request(undefined, { headers: { Origin: origin } }), ENV);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  const preflight = await worker.fetch(request('', { method: 'OPTIONS', headers: {
    'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-secret',
  } }), ENV);
  assert.equal(preflight.status, 403);
  const unauthenticated = await worker.fetch(request(undefined, { headers: { Authorization: '' } }), ENV);
  assert.equal(unauthenticated.status, 401);
  assert.equal((await unauthenticated.json()).error, 'UNAUTHORIZED');
  assert.equal(calls.length, 0);
});

test('bad application authentication and missing configuration fail before Garmin fetch', async () => {
  const { worker, calls } = setup();
  const bad = await worker.fetch(request(undefined, { headers: { Authorization: `Bearer ${APP_TOKEN.toUpperCase()}` } }), ENV);
  assert.equal(bad.status, 401);
  for (const env of [{}, { ...ENV, APP_ACCESS_TOKEN: 'short' }, { APP_ACCESS_TOKEN: APP_TOKEN }, { ...ENV, ALLOWED_ORIGIN: 'https://evil.example/path' }]) {
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'NOT_CONFIGURED');
  }
  assert.equal(calls.length, 0);
});

test('only the expected GET route is supported', async () => {
  const { worker, calls } = setup();
  assert.equal((await worker.fetch(request(undefined, { method: 'POST' }), ENV)).status, 405);
  assert.equal((await worker.fetch(new Request('https://worker.example/'), ENV)).status, 404);
  assert.equal(calls.length, 0);
});

test('date queries are strict, bounded and cannot point outside the recent Helsinki window', async () => {
  const { worker, calls } = setup();
  for (const query of [
    'from=2026-11-18&to=2026-11-18', 'from=2026-10-17&to=2026-11-17',
    'from=2026-11-17&to=2026-11-16', 'from=2026-02-30&to=2026-11-17',
    'from=2026-11-17', 'from=2026-11-17&to=2026-11-17&extra=1',
    'from=2026-11-17&from=2026-11-16&to=2026-11-17',
  ]) {
    const response = await worker.fetch(request(query), ENV);
    assert.equal(response.status, 400, query);
    assert.equal((await response.json()).error, 'INVALID_RANGE');
  }
  assert.equal(calls.length, 0);
  assert.equal((await worker.fetch(request('from=2026-10-18&to=2026-11-17'), ENV)).status, 200);
});

test('Helsinki current date is used across UTC midnight', async () => {
  const { worker } = setup({ now: () => Date.parse('2026-11-16T22:30:00Z') });
  assert.equal((await worker.fetch(request(), ENV)).status, 200);
  assert.equal((await worker.fetch(request('from=2026-11-18&to=2026-11-18'), ENV)).status, 400);
});

test('zoned date fallback and compact numeric UTC offsets preserve the real instant', async () => {
  const { worker } = setup({ payload: data([
    { date: '2026-11-17T06:05:00+02:00', weight: 78500 },
    record('2026-11-17T05:05:00.000+0000', 78.7),
  ]) });
  const result = await (await worker.fetch(request(), ENV)).json();
  assert.deepEqual(result.measurements.map(row => row.timestamp), [Date.parse('2026-11-17T04:05:00Z'), Date.parse('2026-11-17T05:05:00Z')]);
});

test('missing, unzoned or invalid timestamps reject the whole response', async () => {
  for (const entry of [
    { calendarDate: '2026-11-17', weight: 78500 },
    { date: '2026-11-17T06:05:00', weight: 78500 },
    record('2026-02-30T06:00:00Z'), record('2026-11-17T25:00:00Z'),
    { ...record('broken'), date: '2026-11-17T06:00:00Z' },
  ]) {
    const { worker } = setup({ payload: data([record(), entry]) });
    const response = await worker.fetch(request(), ENV);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'GARMIN_RESPONSE_INVALID');
  }
});

test('invalid gram values and aggregate-only responses cannot become measurements', async () => {
  const payloads = [
    data([record(undefined, '78.5')]), data([record(undefined, -1)]), data([record(undefined, 0.5)]), data([record(undefined, 1001)]),
    { dailyWeightSummaries: [{ latestWeight: record(), numOfWeightEntries: 1 }] }, [], {},
  ];
  for (const payload of payloads) {
    const { worker } = setup({ payload });
    const response = await worker.fetch(request(), ENV);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'GARMIN_RESPONSE_INVALID');
  }
});

test('empty summaries are valid; duplicate records are stable and out-of-range instants are omitted', async () => {
  const empty = setup({ payload: { dailyWeightSummaries: [] } });
  assert.deepEqual((await (await empty.worker.fetch(request(), ENV)).json()).measurements, []);
  const { worker } = setup({ payload: data([record(), record(), record('2026-11-16T04:00:00Z')]) });
  const result = await (await worker.fetch(request(), ENV)).json();
  assert.equal(result.measurements.length, 1);
});

test('numeric epoch milliseconds preserve the instant and deduplicate with equivalent ISO timestamps', async () => {
  const timestamp = Date.parse('2026-11-17T04:05:00Z');
  const { worker } = setup({ payload: data([record(), record(timestamp)]) });
  const result = await (await worker.fetch(request(), ENV)).json();
  assert.deepEqual(result.measurements, [{ id: `garmin-${timestamp}`, timestamp, weight: 78.5 }]);
  for (const invalid of [Math.floor(timestamp / 1000), timestamp + 0.5, 9000000000000000]) {
    const bad = setup({ payload: data([record(invalid)]) });
    assert.equal((await bad.worker.fetch(request(), ENV)).status, 502);
  }
});

test('conflicting weights at one instant reject the response while later sync corrections keep the ID', async () => {
  const conflict = setup({ payload: data([record(), record(undefined, 79)]) });
  assert.equal((await conflict.worker.fetch(request(), ENV)).status, 502);
  const first = setup(), corrected = setup({ payload: data([record(undefined, 79)]) });
  const original = (await (await first.worker.fetch(request(), ENV)).json()).measurements[0];
  const changed = (await (await corrected.worker.fetch(request(), ENV)).json()).measurements[0];
  assert.equal(changed.id, original.id);
  assert.equal(changed.weight, 79);
});

test('redirects are rejected without following a Location or exposing authorization', async () => {
  const calls = [];
  const worker = createWorker({ now: () => CURRENT_TIME, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/' } });
  } });
  const response = await worker.fetch(request(), ENV);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'GARMIN_UNAVAILABLE');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(new URL(calls[0].url).origin, 'https://personal.connectapi.garmin.com');
});

test('a valid token is cached in memory and refreshes before expiration', async () => {
  let currentTime = CURRENT_TIME;
  const { worker, calls } = setup({ now: () => currentTime, tokenText: jwt(CURRENT_TIME, { exp: Math.floor(CURRENT_TIME / 1000) + 90 }) });
  assert.equal((await worker.fetch(request(), ENV)).status, 200);
  assert.equal((await worker.fetch(request(), ENV)).status, 200);
  assert.equal(calls.filter(call => new URL(call.url).pathname === TOKEN_PATH).length, 1);
  currentTime += 40000;
  assert.equal((await worker.fetch(request(), ENV)).status, 200);
  assert.equal(calls.filter(call => new URL(call.url).pathname === TOKEN_PATH).length, 2);
});

test('a rejected bearer token is renewed once and Garmin failures are not client auth401s', async () => {
  let tokenCalls = 0, dataCalls = 0;
  const worker = createWorker({ now: () => CURRENT_TIME, fetchImpl: async url => {
    if (new URL(url).pathname === TOKEN_PATH) { tokenCalls++; return new Response(jwt(CURRENT_TIME, { nonce: tokenCalls })); }
    dataCalls++;
    return dataCalls === 1 ? new Response(LEAK_MARKER, { status: 401 }) : Response.json(data());
  } });
  assert.equal((await worker.fetch(request(), ENV)).status, 200);
  assert.equal(tokenCalls, 2);
  assert.equal(dataCalls, 2);
  const rejected = setup({ dataStatus: 401 });
  const response = await rejected.worker.fetch(request(), ENV);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'GARMIN_TOKEN_REJECTED');
});

test('expired or rejected Garmin keys produce safe distinct codes without secret/upstream text', async () => {
  for (const [options, expected] of [
    [{ tokenStatus: 401 }, 'GARMIN_KEY_REJECTED'], [{ tokenStatus: 403 }, 'GARMIN_KEY_REJECTED'],
    [{ tokenStatus: 429 }, 'GARMIN_RATE_LIMITED'], [{ dataStatus: 403 }, 'GARMIN_ACCESS_DENIED'],
    [{ dataStatus: 429 }, 'GARMIN_RATE_LIMITED'], [{ dataStatus: 500 }, 'GARMIN_UNAVAILABLE'],
  ]) {
    const { worker } = setup(options);
    const response = await worker.fetch(request(), ENV), text = await response.text();
    assert.equal(response.status, 502);
    assert.equal(JSON.parse(text).error, expected);
    assert.ok(![API_KEY, APP_TOKEN, LEAK_MARKER, jwt()].some(secret => text.includes(secret)));
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});

test('token JSON wrappers and expired JWTs are rejected rather than guessed', async () => {
  for (const tokenText of [JSON.stringify({ access_token: jwt() }), 'invalid-token', jwt(CURRENT_TIME, { exp: 1 })]) {
    const { worker } = setup({ tokenText });
    assert.equal((await worker.fetch(request(), ENV)).status, 502);
  }
});

test('JWT NumericDate accepts fractional seconds but not missing, nonnumeric or unbounded expiration', async () => {
  const valid = setup({ tokenText: jwt(CURRENT_TIME, { exp: CURRENT_TIME / 1000 + 3600.5 }) });
  assert.equal((await valid.worker.fetch(request(), ENV)).status, 200);
  for (const exp of [null, '9999999999', 1e100]) {
    const { worker } = setup({ tokenText: jwt(CURRENT_TIME, { exp }) });
    const response = await worker.fetch(request(), ENV);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).detail, 'TOKEN_EXPIRATION');
  }
});

test('invalid upstream responses identify fixed parser stages without revealing the offending data', async () => {
  for (const [options, detail] of [
    [{ tokenText: LEAK_MARKER }, 'TOKEN_FORMAT'],
    [{ tokenText: jwt(CURRENT_TIME, { exp: 1 }) }, 'TOKEN_EXPIRATION'],
    [{ payload: { unexpected: LEAK_MARKER } }, 'WEIGHT_SUMMARIES'],
    [{ payload: { dailyWeightSummaries: [{ allWeightMetrics: LEAK_MARKER }] } }, 'WEIGHT_ENTRIES'],
    [{ payload: data([record(undefined, LEAK_MARKER)]) }, 'WEIGHT_VALUE'],
    [{ payload: data([record(LEAK_MARKER)]) }, 'TIMESTAMP_FORMAT'],
    [{ payload: data([record(), record(undefined, 79)]) }, 'WEIGHT_CONFLICT'],
    [{ payload: data(Array.from({ length: 2049 }, () => record())) }, 'MEASUREMENT_LIMIT'],
  ]) {
    const { worker } = setup(options);
    const response = await worker.fetch(request(), ENV), body = await response.text();
    assert.equal(response.status, 502);
    assert.equal(JSON.parse(body).error, 'GARMIN_RESPONSE_INVALID');
    assert.equal(JSON.parse(body).detail, detail);
    assert.ok(![API_KEY, APP_TOKEN, LEAK_MARKER, jwt()].some(secret => body.includes(secret)));
  }
});

test('upstream responses have bounded size and record count', async () => {
  const tooLarge = createWorker({ now: () => CURRENT_TIME, fetchImpl: async () => new Response('x', { headers: { 'Content-Length': '2000000' } }) });
  assert.equal((await tooLarge.fetch(request(), ENV)).status, 502);
  const tooMany = setup({ payload: data(Array.from({ length: 2049 }, () => record())) });
  assert.equal((await tooMany.worker.fetch(request(), ENV)).status, 502);
});

test('stream byte limits apply even without Content-Length headers', async () => {
  for (const oversizedToken of [true, false]) {
    const worker = createWorker({ now: () => CURRENT_TIME, fetchImpl: async url => {
      if (new URL(url).pathname === TOKEN_PATH) return new Response(oversizedToken ? 'x'.repeat(16385) : jwt());
      return new Response(JSON.stringify({ dailyWeightSummaries: [], padding: 'x'.repeat(1024 * 1024) }));
    } });
    const response = await worker.fetch(request(), ENV);
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, 'GARMIN_RESPONSE_INVALID');
  }
});

test('rotating Garmin secrets never reuses a token from another key', async () => {
  let latestToken;
  let tokenCalls = 0;
  const worker = createWorker({ now: () => CURRENT_TIME, fetchImpl: async (url, init) => {
    if (new URL(url).pathname === TOKEN_PATH) {
      latestToken = jwt(CURRENT_TIME, { keyMarker: init.headers.Authorization });
      tokenCalls++;
      return new Response(latestToken);
    }
    assert.equal(init.headers.Authorization, `Bearer ${latestToken}`);
    return Response.json(data());
  } });
  assert.equal((await worker.fetch(request(), ENV)).status, 200);
  assert.equal((await worker.fetch(request(), { ...ENV, GARMIN_API_KEY: `${API_KEY}_rotated` })).status, 200);
  assert.equal(tokenCalls, 2);
});

test('network timeouts and errors return generic safe failures', async () => {
  const slow = createWorker({ now: () => CURRENT_TIME, timeoutMs: 5, fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error(LEAK_MARKER)), { once: true });
  }) });
  const timeout = await slow.fetch(request(), ENV);
  assert.equal(timeout.status, 502);
  assert.equal((await timeout.json()).error, 'GARMIN_TIMEOUT');
  const broken = createWorker({ now: () => CURRENT_TIME, fetchImpl: async () => { throw new Error(`${API_KEY} ${LEAK_MARKER}`); } });
  const response = await broken.fetch(request(), ENV);
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes(LEAK_MARKER));
});
