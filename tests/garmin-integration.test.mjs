import test from "node:test";
import assert from "node:assert/strict";
import { boot, plain } from "./helpers/browser-harness.mjs";
import { legacy, history } from "./helpers/fixtures.mjs";
import { createWorker, DEFAULT_ALLOWED_ORIGIN } from "../garmin-worker/worker.mjs";

const key = "kuntokayra_v1";
const connectionKey = "kuntokayra_garmin_connection_v1";
const endpoint = "https://kuntokayra-synthetic.workers.dev";
const accessToken = "synthetic-garmin-test-secret-".repeat(3);
const now = Date.parse("2026-11-16T12:00:00.000Z");
const response = (measurements = [], status = 200) => new Response(JSON.stringify({ measurements }), { status, headers: { "Content-Type": "application/json" } });
const rawResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const m = (id, timestamp, weight) => ({ id, timestamp: Date.parse(timestamp), weight });
const morning = [
  m("before-six", "2026-11-13T03:59:00.000Z", 90),
  m("first-thirteen", "2026-11-13T04:00:00.000Z", 76.2),
  m("later-thirteen", "2026-11-13T06:00:00.000Z", 77.2),
  m("first-fifteen", "2026-11-15T04:15:00.000Z", 76),
  m("first-sixteen", "2026-11-16T04:05:00.000Z", 75.9),
  m("at-twelve", "2026-11-16T10:00:00.000Z", 88),
];
const settings = async app => app.click(undefined, { tab: "settings" });
const submit = async (app, id, values) => {
  await app.fillSimple(values);
  const form = app.document.getElementById(id);
  assert.ok(form, `Missing form ${id}`);
  return app.emit("submit", form);
};
const configure = async app => {
  await settings(app);
  await submit(app, "garmin-connection-form", { endpoint, accessToken });
  await app.flush();
  assert.ok(app.storage.get(connectionKey), "Explicit connection must persist its separate configuration");
};
const configured = async (initial = history) => {
  const app = boot(initial, undefined, { fetch: () => response() });
  await configure(app);
  return app;
};
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const markedRow = (id = "first-thirteen", timestamp = "2026-11-13T04:00:00.000Z", value = 76.2) => ({
  id: `garmin-${id}`, date: "2026-11-13", value,
  source: "garmin", garminId: id, measuredAt: timestamp,
});

await test("Unconfigured Garmin startup remains offline and leaves legacy storage untouched; token generation is unsaved", async () => {
  const app = boot(legacy);
  const raw = app.storage.get(key);
  await app.flush();
  assert.equal(app.fetchCalls.length, 0);
  assert.equal(app.writes.length, 0);
  assert.equal(app.storage.get(key), raw);
  assert.deepEqual(app.state(), legacy);
  assert.equal(app.storage.has(connectionKey), false);
  await settings(app);
  await app.click("garmin-new-token");
  const first = app.simpleValue("accessToken");
  assert.ok(typeof first === "string" && first.length >= 32);
  await app.click("garmin-new-token");
  assert.notEqual(app.simpleValue("accessToken"), first);
  assert.equal(app.storage.has(connectionKey), false);
  assert.equal(app.writes.length, 0);
  assert.equal(app.fetchCalls.length, 0);
});

await test("Garmin morning-window settings coexist with rest preferences, persist, and reject invalid changes atomically", async () => {
  const initial = { ...plain(history), settings: { restSeconds: 120 } };
  const app = boot(initial);
  await settings(app);
  assert.equal(app.simpleValue("start"), "06:00");
  assert.equal(app.simpleValue("end"), "12:00");
  await submit(app, "garmin-window-form", { start: "07:30", end: "11:00" });
  assert.deepEqual(app.state().settings, { restSeconds: 120, garmin: { start: "07:30", end: "11:00" } });
  await submit(app, "rest-settings-form", { minutes: "2", seconds: "15" });
  assert.deepEqual(app.state().settings, { restSeconds: 135, garmin: { start: "07:30", end: "11:00" } });
  const saved = app.state(), raw = app.storage.get(key);
  await submit(app, "garmin-window-form", { start: "12:00", end: "06:00" });
  assert.deepEqual(app.state(), saved);
  assert.equal(app.storage.get(key), raw);
  assert.ok(app.document.getElementById("garmin-window-error").textContent);
  app.setStorageFailure(true);
  await submit(app, "garmin-window-form", { start: "08:00", end: "11:00" });
  assert.deepEqual(app.state(), saved);
  assert.equal(app.storage.get(key), raw);
  app.setStorageFailure(false);
  const reopened = boot(null, app.storage);
  assert.deepEqual(reopened.state(), saved);
  assert.equal(reopened.writes.length, 0);
  assert.equal(reopened.fetchCalls.length, 0);
});

await test("Manual Garmin sync imports Helsinki's first morning measurement, protects manual data and keeps repeated sync idempotent", async () => {
  const initial = { ...plain(history), weight: [...plain(history.weight), { id: "manual-fifteen", date: "2026-11-15", value: 82 }] };
  const app = await configured(initial);
  app.setFetch(() => response(morning));
  const before = app.fetchCalls.length;
  await app.click("garmin-sync");
  assert.equal(app.fetchCalls.length, before + 1);
  const call = app.fetchCalls.at(-1), url = new URL(call.url);
  assert.equal(url.origin, endpoint);
  assert.equal(url.pathname, "/v1/weights");
  assert.ok(url.searchParams.get("from") && url.searchParams.get("to"));
  assert.equal(new Headers(call.options.headers).get("Authorization"), `Bearer ${accessToken}`);
  assert.ok(!url.href.includes(accessToken));
  const rows = app.state().weight;
  assert.deepEqual(rows.find(row => row.date === "2026-11-13"), markedRow());
  assert.equal(rows.find(row => row.date === "2026-11-16").value, 75.9);
  assert.equal(rows.find(row => row.date === "2026-11-16").garminId, "first-sixteen");
  assert.deepEqual(rows.find(row => row.id === "manual-fifteen"), initial.weight.at(-1));
  assert.deepEqual(rows.find(row => row.id === history.weight[0].id), history.weight[0]);
  assert.ok(!rows.some(row => ["before-six", "later-thirteen", "at-twelve"].includes(row.garminId)));
  assert.deepEqual(app.state().workouts, initial.workouts);
  assert.deepEqual(app.state().sleep, initial.sleep);
  const count = rows.length, snapshot = rows.map(({ id, ...row }) => row);
  await app.click("garmin-sync");
  assert.equal(app.state().weight.length, count);
  assert.deepEqual(app.state().weight.map(({ id, ...row }) => row), snapshot);
});

await test("Real Garmin-shaped grams and epoch milliseconds flow through the Worker into persisted morning kilograms", async () => {
  const first = Date.parse("2026-11-16T04:05:00.000Z");
  let grams = 75000;
  const part = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${part({ alg: "RS256" })}.${part({ exp: now / 1000 + 3600.5 })}.synthetic_signature`;
  const upstreamCalls = [];
  const worker = createWorker({ now: () => now, fetchImpl: async (url, init) => {
    upstreamCalls.push({ url, init });
    if (new URL(url).pathname.endsWith("/token")) return new Response(token);
    return Response.json({ dailyWeightSummaries: [{
      summaryDate: "2026-11-16", numOfWeightEntries: 4,
      allWeightMetrics: [
        { timestampGMT: first + 3600000, weight: 76000 },
        { timestampGMT: first - 3600000, weight: 72000 },
        { timestampGMT: first, weight: grams },
        { timestampGMT: Date.parse("2026-11-16T10:00:00.000Z"), weight: 80000 },
      ], latestWeight: { weight: 80000 },
    }], totalAverage: { weight: 77000 } });
  } });
  const fetch = (url, options) => {
    const headers = new Headers(options.headers);
    headers.set("Origin", DEFAULT_ALLOWED_ORIGIN);
    return worker.fetch(new Request(url, { ...options, headers }), {
      APP_ACCESS_TOKEN: accessToken, GARMIN_API_KEY: "synthetic-garmin-integration-key",
    });
  };
  const initial = plain(history), app = boot(initial, undefined, { now, fetch });
  await configure(app);
  const row = app.state().weight.find(value => value.date === "2026-11-16");
  assert.equal(row.value, 75);
  assert.equal(row.measuredAt, new Date(first).toISOString());
  assert.equal(row.garminId, `garmin-${first}`);
  assert.equal(app.state().weight.length, initial.weight.length + 1);
  assert.deepEqual(app.state().workouts, initial.workouts);
  assert.deepEqual(app.state().sleep, initial.sleep);
  assert.ok(upstreamCalls.some(call => call.url.endsWith("?includeAll=true")));
  const persisted = app.storage.get(key);
  await app.click("garmin-sync");
  assert.equal(app.storage.get(key), persisted);
  // A malformed wire value rejects the whole sync and leaves saved data intact.
  grams = 75;
  await app.click("garmin-sync");
  assert.equal(app.storage.get(key), persisted);
  assert.ok(app.document.getElementById("garmin-status").textContent.includes("WEIGHT_VALUE"));
  const reopened = boot(null, app.storage, { now, fetch });
  await reopened.flush();
  assert.equal(reopened.state().weight.find(value => value.date === "2026-11-16").value, 75);
  assert.equal(reopened.writes.length, 0);
  assert.equal(reopened.fetchCalls.length, 0);
});

await test("Editing an imported Garmin weight manually protects the correction from subsequent sync", async () => {
  const app = await configured();
  app.setFetch(() => response([morning[4]]));
  await app.click("garmin-sync");
  const imported = app.state().weight.find(row => row.garminId === "first-sixteen");
  assert.ok(imported);
  await app.click("edit-weight", { id: imported.id });
  await app.fillSimple({ value: "80" });
  await app.submitSimple();
  const corrected = app.state().weight.find(row => row.date === "2026-11-16");
  assert.equal(corrected.value, 80);
  assert.equal(app.api.getGarminCore().isGarminRow(corrected), false);
  await app.click("garmin-sync");
  assert.equal(app.state().weight.find(row => row.date === "2026-11-16").value, 80);
});

await test("Configured reopening syncs once per Helsinki day without adding duplicates or overwriting credentials in state", async () => {
  const app = await configured();
  app.setFetch(() => response([morning[4]]));
  await app.click("garmin-sync");
  const saved = app.state();
  const sameDay = boot(null, app.storage, { now, fetch: () => response([morning[4]]) });
  await sameDay.flush();
  assert.equal(sameDay.fetchCalls.length, 0);
  assert.deepEqual(sameDay.state(), saved);
  const next = m("next-day", "2026-11-17T04:30:00.000Z", 75.8);
  const nextDay = boot(null, app.storage, { now: now + 86_400_000, fetch: () => response([morning[4], next]) });
  await nextDay.flush();
  assert.equal(nextDay.fetchCalls.length, 1);
  assert.equal(nextDay.state().weight.filter(row => row.date === "2026-11-16").length, 1);
  assert.equal(nextDay.state().weight.filter(row => row.date === "2026-11-17").length, 1);
  await nextDay.api.syncGarmin({ automatic: true });
  assert.equal(nextDay.fetchCalls.length, 1);
  assert.ok(!JSON.stringify(nextDay.state()).includes(accessToken));
});

await test("Garmin connection credentials stay separate and never appear in version-1 backups or imported data", async () => {
  const app = await configured();
  await submit(app, "garmin-window-form", { start: "06:00", end: "11:30" });
  app.setFetch(() => response([morning[1]]));
  await app.click("garmin-sync");
  await app.click("export");
  const text = await app.blobs[0].text(), payload = JSON.parse(text);
  assert.equal(payload.version, 1);
  assert.ok(!text.includes(accessToken));
  assert.ok(!text.includes(endpoint));
  assert.ok(!text.includes("accessToken"));
  assert.deepEqual(payload.data.settings.garmin, { start: "06:00", end: "11:30" });
  const copied = boot();
  await copied.importBackup(payload);
  assert.equal(copied.alerts.length, 0);
  assert.equal(copied.storage.has(connectionKey), false);
  assert.equal(copied.fetchCalls.length, 0);
  const imported = copied.state().weight.find(row => row.garminId === "first-thirteen");
  assert.ok(typeof imported.id === "string" && imported.id.length > 0);
  const { id: importedId, ...importedData } = imported;
  const { id: originalId, ...originalData } = markedRow();
  assert.deepEqual(importedData, originalData);
  assert.equal(copied.api.getGarminCore().isGarminRow(imported), true);
  const reopened = boot(null, copied.storage);
  assert.deepEqual(reopened.state(), copied.state());
  assert.equal(reopened.writes.length, 0);
  assert.equal(reopened.fetchCalls.length, 0);
  const old = boot();
  await old.importBackup({ version: 1, data: legacy });
  assert.equal(old.alerts.length, 0);
  assert.ok(!old.state().settings?.garmin);
  assert.equal(old.storage.has(connectionKey), false);
});

await test("Invalid Garmin backup metadata/window is rejected before replacing records or the separate connection", async () => {
  const app = await configured();
  const saved = app.state(), raw = app.storage.get(key), connection = app.storage.get(connectionKey);
  for (const data of [
    { ...plain(legacy), weight: [{ ...markedRow(), date: "2026-11-14" }] },
    { ...plain(legacy), weight: [{ ...markedRow(), garminId: "" }] },
    { ...plain(legacy), settings: { garmin: { start: "12:00", end: "06:00" } } },
  ]) {
    const errors = app.alerts.length;
    await app.importBackup({ version: 1, data });
    assert.equal(app.alerts.length, errors + 1);
    assert.deepEqual(app.state(), saved);
    assert.equal(app.storage.get(key), raw);
    assert.equal(app.storage.get(connectionKey), connection);
  }
});

await test("Invalid JSON/schema, unauthorized responses, network/offline and storage failures cannot change weights", async () => {
  const app = await configured();
  const failures = [
    () => rawResponse({ measurements: "bad" }),
    () => rawResponse({ unexpected: [] }),
    () => new Response("broken-json", { status: 200 }),
    () => response([], 401),
    () => { throw new TypeError("Synthetic network failure"); },
    () => response([m("bad-weight", "2026-11-16T04:00:00.000Z", -1)]),
  ];
  for (const handler of failures) {
    const saved = app.state(), raw = app.storage.get(key);
    app.setFetch(handler);
    await app.click("garmin-sync");
    assert.deepEqual(app.state(), saved);
    assert.equal(app.storage.get(key), raw);
  }
  app.setOnline(false);
  const before = app.fetchCalls.length;
  app.setFetch(() => response([morning[1]]));
  const saved = app.state(), raw = app.storage.get(key);
  await app.click("garmin-sync");
  assert.equal(app.fetchCalls.length, before);
  assert.deepEqual(app.state(), saved);
  assert.equal(app.storage.get(key), raw);
  app.setOnline(true);
  app.setStorageFailure(true);
  const connection = app.storage.get(connectionKey);
  await app.click("garmin-sync");
  assert.deepEqual(app.state(), saved);
  assert.equal(app.storage.get(key), raw);
  assert.equal(app.storage.get(connectionKey), connection);
  app.setStorageFailure(false);
  await app.click("garmin-sync");
  assert.ok(app.state().weight.some(row => row.garminId === "first-thirteen"));
});

await test("Importing, clearing, or disconnecting during an in-flight Garmin sync prevents late results from applying", async () => {
  for (const action of ["import", "clear", "disconnect"]) {
    const app = await configured();
    const pending = deferred();
    app.setFetch(() => pending.promise);
    const syncing = app.click("garmin-sync");
    await app.flush();
    assert.ok(app.fetchCalls.at(-1).options.signal, "Sync needs a cancelable request");
    if (action === "import") await app.importBackup({ version: 1, data: legacy });
    else if (action === "clear") await app.click("clear");
    else await app.click("garmin-disconnect");
    const afterAction = app.state(), serialized = app.storage.get(key);
    pending.resolve(response([morning[1]]));
    await syncing;
    await app.flush();
    assert.deepEqual(app.state(), afterAction, action);
    assert.equal(app.storage.get(key), serialized, action);
    if (action === "disconnect") assert.equal(app.storage.has(connectionKey), false);
  }
});

await test("Invalid or failed Garmin connection saves never enable automatic sync or alter diary data", async () => {
  const app = boot(history);
  await settings(app);
  const raw = app.storage.get(key);
  await submit(app, "garmin-connection-form", { endpoint: "javascript:alert(1)", accessToken });
  assert.equal(app.storage.has(connectionKey), false);
  assert.equal(app.fetchCalls.length, 0);
  assert.ok(app.document.getElementById("garmin-connection-error").textContent);
  app.setStorageFailure(true);
  await submit(app, "garmin-connection-form", { endpoint, accessToken });
  assert.equal(app.storage.has(connectionKey), false);
  assert.deepEqual(app.state(), history);
  assert.equal(app.storage.get(key), raw);
  assert.equal(app.fetchCalls.length, 0);
});

await test("An empty early-morning Garmin fetch retries later for the first weighing, then automatic checks pause while manual sync remains available", async () => {
  // In November Helsinki is UTC+2: 04:30Z is 06:30 and 05:00Z is 07:00.
  const early = boot(history, undefined, {
    now: Date.parse("2026-11-16T04:30:00.000Z"),
    fetch: () => response(),
  });
  await configure(early);
  assert.equal(early.fetchCalls.length, 1);
  assert.ok(!early.state().weight.some(row => row.date === "2026-11-16"));
  const reading = m("later-morning", "2026-11-16T04:50:00.000Z", 75.7);
  const afterWeighing = boot(null, early.storage, {
    now: Date.parse("2026-11-16T05:00:00.000Z"),
    fetch: () => response([reading]),
  });
  await afterWeighing.flush();
  assert.equal(afterWeighing.fetchCalls.length, 1, "An empty 06:30 fetch must not suppress the later 07:00 weighing");
  assert.equal(afterWeighing.state().weight.find(row => row.date === "2026-11-16").garminId, reading.id);
  assert.equal(afterWeighing.state().weight.find(row => row.date === "2026-11-16").value, 75.7);
  const immediate = boot(null, afterWeighing.storage, {
    now: Date.parse("2026-11-16T05:01:00.000Z"),
    fetch: () => response([reading]),
  });
  await immediate.flush();
  assert.equal(immediate.fetchCalls.length, 0);
  const later = boot(null, afterWeighing.storage, {
    now: Date.parse("2026-11-16T06:30:00.000Z"),
    fetch: () => response([{ ...reading, weight: 75.6 }]),
  });
  await later.flush();
  assert.equal(later.fetchCalls.length, 0, "Today's recorded weight must suppress another automatic request after the retry interval");
  await later.click("garmin-sync");
  assert.equal(later.fetchCalls.length, 1, "The manual button must bypass automatic retry suppression");
  assert.equal(later.state().weight.filter(row => row.date === "2026-11-16").length, 1);
  assert.equal(later.state().weight.find(row => row.date === "2026-11-16").value, 75.6);
  assert.deepEqual(later.state().workouts, history.workouts);
  assert.deepEqual(later.state().sleep, history.sleep);
});

await test("A weighing created while Garmin fetch is pending is validated at receipt time, while a genuinely future timestamp stays rejected", async () => {
  const app = boot(history, undefined, {
    now: Date.parse("2026-11-16T04:30:00.000Z"),
    fetch: () => response(),
  });
  await configure(app);
  const pending = deferred(), requestedAt = app.clock.now();
  app.setFetch(() => pending.promise);
  const syncing = app.click("garmin-sync");
  await app.flush();
  app.clock.jump(10000);
  const reading = { id: "created-during-fetch", timestamp: requestedAt + 5000, weight: 75.25 };
  pending.resolve(response([reading]));
  await syncing;
  await app.flush();
  const imported = app.state().weight.find(row => row.garminId === reading.id);
  assert.ok(imported, "A valid reading made after request start must be imported once it is in the past at receipt");
  assert.equal(imported.value, 75.25);
  assert.equal(imported.measuredAt, new Date(reading.timestamp).toISOString());
  assert.equal(JSON.parse(app.storage.get(connectionKey)).lastSuccessAt, new Date(app.clock.now()).toISOString());
  assert.deepEqual(app.state().workouts, history.workouts);
  assert.deepEqual(app.state().sleep, history.sleep);

  const saved = app.state(), raw = app.storage.get(key), marker = app.storage.get(connectionKey);
  app.setFetch(() => response([{ id: "still-in-the-future", timestamp: app.clock.now() + 1000, weight: 75 }]));
  await app.click("garmin-sync");
  assert.deepEqual(app.state(), saved);
  assert.equal(app.storage.get(key), raw);
  assert.equal(app.storage.get(connectionKey), marker);
});

await test("Garmin failures show specific safe error codes instead of blaming every upstream failure on the key", async () => {
  const app = await configured();
  const saved = app.state(), stored = app.storage.get(key);
  for (const [code, expected] of [
    ["GARMIN_KEY_REJECTED", "henkilökohtaista API-avainta"],
    ["GARMIN_RESPONSE_INVALID", "vastauksen muoto"],
    ["GARMIN_ACCESS_DENIED", "esti pääsyn"],
    ["GARMIN_RATE_LIMITED", "rajoitti"],
    ["GARMIN_TIMEOUT", "vastannut ajoissa"],
    ["GARMIN_UNAVAILABLE", "ei ole juuri nyt"],
  ]) {
    app.setFetch(() => rawResponse({ error: code, message: "synthetic-sensitive-upstream-content" }, 502));
    await app.click("garmin-sync");
    const text = app.document.getElementById("garmin-status").textContent;
    assert.ok(text.includes(code));
    assert.ok(text.includes(expected));
    assert.ok(!text.includes("synthetic-sensitive-upstream-content"));
    assert.deepEqual(app.state(), saved);
    assert.equal(app.storage.get(key), stored);
  }
});

await test("Unknown or non-JSON Garmin error bodies never expose untrusted error text or change saved records", async () => {
  const app = await configured();
  const saved = app.state(), stored = app.storage.get(key);
  for (const result of [
    () => rawResponse({ error: "synthetic-secret-in-error-code", message: "synthetic-secret-in-message" }, 502),
    () => new Response("<html>synthetic-secret-in-html</html>", { status: 502 }),
    () => rawResponse({ error: "toString", message: "synthetic-secret-in-message" }, 502),
  ]) {
    app.setFetch(result);
    await app.click("garmin-sync");
    const text = app.document.getElementById("garmin-status").textContent;
    assert.ok(text.includes("HTTP 502"));
    assert.ok(!text.includes("synthetic-secret"));
    assert.ok(!text.includes("[object"));
    assert.deepEqual(app.state(), saved);
    assert.equal(app.storage.get(key), stored);
  }
});

await test("Only known parser-stage diagnostics are shown and all failure details preserve saved data", async () => {
  const app = await configured();
  const stored = app.storage.get(key), saved = app.state();
  for (const detail of ["WEIGHT_VALUE", "TIMESTAMP_FORMAT", "TOKEN_FORMAT", "TOKEN_EXPIRATION", "synthetic-private-data", "toString"]) {
    app.setFetch(() => rawResponse({ error: "GARMIN_RESPONSE_INVALID", detail, message: "synthetic-private-message" }, 502));
    await app.click("garmin-sync");
    const text = app.document.getElementById("garmin-status").textContent;
    assert.ok(text.includes("GARMIN_RESPONSE_INVALID"));
    if (detail.startsWith("synthetic") || detail === "toString") assert.ok(!text.includes(detail));
    else assert.ok(text.includes(`GARMIN_RESPONSE_INVALID/${detail}`));
    assert.ok(!text.includes("synthetic-private"));
    assert.deepEqual(app.state(), saved);
    assert.equal(app.storage.get(key), stored);
  }
});
