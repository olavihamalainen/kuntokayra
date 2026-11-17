import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../garmin-core.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context, { filename: "garmin-core.js" });
const core = context.KuntokayraGarmin;
assert.ok(core, "The pure Garmin core must expose KuntokayraGarmin");

const plain = value => JSON.parse(JSON.stringify(value));
const at = value => Date.parse(value);
const NOW = at("2026-11-20T12:00:00.000Z");
const EARLIEST = at("2000-01-01T00:00:00.000Z");
const measurement = (id, iso, weight = 75) => ({ id, timestamp: at(iso), weight });
const selected = (id, iso, weight = 75) => {
  const value = measurement(id, iso, weight);
  return { ...value, date: core.getDate(value.timestamp) };
};
const garminRow = (id, iso, weight = 75) => ({
  id: `garmin-${id}`,
  date: core.getDate(at(iso)),
  value: weight,
  source: "garmin",
  garminId: id,
  measuredAt: new Date(at(iso)).toISOString(),
});

await test("Garmin defaults use the explicit Helsinki timezone and a valid 06:00–12:00 morning window", () => {
  assert.equal(core.TIME_ZONE, "Europe/Helsinki");
  assert.deepEqual(plain(core.DEFAULT_WINDOW), { start: "06:00", end: "12:00" });
  for (const window of [{ start: "00:00", end: "23:59" }, { start: "06:00", end: "06:01" }]) {
    assert.equal(core.validWindow(window), true);
  }
  for (const window of [null, undefined, [], {}, { start: "6:00", end: "12:00" }, { start: "06:00", end: "24:00" }, { start: "06:60", end: "12:00" }, { start: "12:00", end: "06:00" }, { start: "06:00", end: "06:00" }, { start: 6, end: 12 }]) {
    assert.equal(core.validWindow(window), false, JSON.stringify(window));
  }
});

await test("Helsinki dates follow local midnight rather than the measurement's UTC date, including both DST changes", () => {
  for (const [iso, date] of [
    ["2026-11-16T21:59:59.999Z", "2026-11-16"],
    ["2026-11-16T22:00:00.000Z", "2026-11-17"],
    ["2026-03-28T22:30:00.000Z", "2026-03-29"],
    ["2026-03-29T21:00:00.000Z", "2026-03-30"],
    ["2026-10-24T21:30:00.000Z", "2026-10-25"],
    ["2026-10-25T22:00:00.000Z", "2026-10-26"],
  ]) assert.equal(core.getDate(at(iso)), date, iso);
});

await test("Measurement normalization sorts deterministic copies without mutating the input", () => {
  const input = [measurement("z", "2026-11-17T05:00:00Z", 76), measurement("b", "2026-11-16T05:00:00Z", 75), measurement("a", "2026-11-16T05:00:00Z", 74)];
  const original = plain(input);
  const output = core.normalizeMeasurements(input, NOW);
  assert.deepEqual(plain(output.map(item => item.id)), ["a", "b", "z"]);
  assert.deepEqual(plain(input), original);
  for (const row of output) assert.notEqual(row, input.find(item => item.id === row.id));
});

await test("Normalization validates numeric weight/time bounds and opaque IDs instead of coercing or trimming them", () => {
  const base = measurement("valid", "2026-11-17T05:00:00Z");
  assert.equal(core.normalizeMeasurements([{ ...base, id: "x".repeat(150), timestamp: EARLIEST, weight: 1 }], NOW).length, 1);
  assert.equal(core.normalizeMeasurements([{ ...base, timestamp: NOW, weight: 1000 }], NOW).length, 1);
  const invalid = [
    ...["", " ", " padded", "padded ", "x".repeat(151), "line\nbreak", "nul\0byte", "del\u007fbyte", 123, null].map(id => ({ ...base, id })),
    ...[EARLIEST - 1, NOW + 1, NaN, Infinity, -Infinity, "2026-11-17T05:00:00Z", new Date(base.timestamp)].map(timestamp => ({ ...base, timestamp })),
    ...[0, -1, 1000.001, NaN, Infinity, "75", null].map(weight => ({ ...base, weight })),
  ];
  for (const row of invalid) assert.throws(() => core.normalizeMeasurements([base, row], NOW));
  for (const input of [null, {}, "measurements"]) assert.throws(() => core.normalizeMeasurements(input, NOW));
});

await test("Normalization deduplicates identical IDs but rejects conflicting copies and oversized batches", () => {
  const row = measurement("same", "2026-11-17T05:00:00Z");
  assert.deepEqual(plain(core.normalizeMeasurements([row, { ...row }], NOW)), [row]);
  assert.throws(() => core.normalizeMeasurements([row, { ...row, weight: 76 }], NOW));
  assert.throws(() => core.normalizeMeasurements([row, { ...row, timestamp: row.timestamp + 1 }], NOW));
  const limit = Array.from({ length: 10000 }, (_, index) => ({ id: `row-${index}`, timestamp: EARLIEST + index, weight: 75 }));
  assert.equal(core.normalizeMeasurements(limit, NOW).length, 10000);
  assert.throws(() => core.normalizeMeasurements([...limit, { id: "extra", timestamp: EARLIEST, weight: 75 }], NOW));
});

await test("Morning selection includes 06:00 and excludes 12:00 in Helsinki on both DST transition dates", () => {
  for (const [date, sixUtc, twelveUtc] of [["2026-03-29", 3, 9], ["2026-10-25", 4, 10]]) {
    const six = at(`${date}T${String(sixUtc).padStart(2, "0")}:00:00Z`);
    const twelve = at(`${date}T${String(twelveUtc).padStart(2, "0")}:00:00Z`);
    const rows = [
      { id: "before", timestamp: six - 1, weight: 74 },
      { id: "start", timestamp: six, weight: 75 },
      { id: "later", timestamp: twelve - 1, weight: 76 },
      { id: "end", timestamp: twelve, weight: 77 },
    ];
    assert.deepEqual(plain(core.selectMorning(rows, core.DEFAULT_WINDOW, NOW)), [{ ...rows[1], date }]);
    assert.deepEqual(plain(core.selectMorning([rows[0], rows[3]], core.DEFAULT_WINDOW, NOW)), []);
  }
});

await test("Selection takes each local day's earliest measurement, resolving timestamp ties by ID independently of input order", () => {
  const input = [measurement("late", "2026-11-17T08:00:00Z", 77), measurement("beta", "2026-11-17T05:00:00Z", 76), measurement("prior", "2026-11-16T05:00:00Z", 74), measurement("alpha", "2026-11-17T05:00:00Z", 75)];
  const expected = [selected("prior", "2026-11-16T05:00:00Z", 74), selected("alpha", "2026-11-17T05:00:00Z", 75)];
  assert.deepEqual(plain(core.selectMorning(input, core.DEFAULT_WINDOW, NOW)), expected);
  assert.deepEqual(plain(core.selectMorning([...input].reverse(), core.DEFAULT_WINDOW, NOW)), expected);
  assert.deepEqual(plain(core.selectMorning([], core.DEFAULT_WINDOW, NOW)), []);
  assert.throws(() => core.selectMorning(input, { start: "12:00", end: "06:00" }, NOW));
});

await test("A custom morning window changes eligibility while retaining start-inclusive/end-exclusive bounds", () => {
  const window = { start: "09:15", end: "10:30" };
  const rows = [measurement("before", "2026-11-17T07:14:59.999Z"), measurement("inside", "2026-11-17T07:15:00Z"), measurement("end", "2026-11-17T08:30:00Z")];
  assert.deepEqual(plain(core.selectMorning(rows, window, NOW)), [selected("inside", "2026-11-17T07:15:00Z")]);
});

await test("Garmin row recognition requires matching opaque identity, ISO timestamp, Helsinki date and numeric kilograms", () => {
  const good = garminRow("valid", "2026-11-16T22:30:00Z", 75);
  assert.equal(core.isGarminRow(good), true);
  assert.equal(core.isGarminRow({ ...good, id: "local-id-regenerated-by-backup-import" }), true);
  assert.equal(core.isGarminRow(garminRow("future", "2040-01-01T05:00:00Z", 75)), true, "Metadata recognition must not depend on today's clock");
  for (const row of [
    null, {}, { ...good, id: "" }, { ...good, id: null }, { ...good, source: "manual" }, { ...good, garminId: "" },
    { ...good, garminId: " padded", id: "garmin- padded" }, { ...good, date: "2026-11-16" }, { ...good, date: "2026-02-30" },
    { ...good, measuredAt: "2026-11-16T22:30:00+00:00" }, { ...good, measuredAt: "invalid" },
    { ...good, value: "75" }, { ...good, value: 0 }, { ...good, value: 1000.01 }, { ...good, value: NaN },
  ]) assert.equal(core.isGarminRow(row), false);
});

await test("Merge adds canonical Garmin rows and a repeated sync is idempotent with the original rows reference", () => {
  const existing = [];
  const incoming = [selected("first", "2026-11-16T05:00:00Z", 75), selected("second", "2026-11-17T05:00:00Z", 76)];
  const result = core.mergeWeights(existing, incoming);
  assert.deepEqual(plain(result.rows), [garminRow("first", "2026-11-16T05:00:00Z", 75), garminRow("second", "2026-11-17T05:00:00Z", 76)]);
  assert.equal(result.added, 2);
  assert.equal(result.updated, 0);
  assert.deepEqual(existing, []);
  const again = core.mergeWeights(result.rows, incoming);
  assert.equal(again.rows, result.rows);
  assert.equal(again.added, 0);
  assert.equal(again.updated, 0);
});

await test("Manual, legacy and malformed Garmin-looking date conflicts are preserved without mutating existing data", () => {
  const existing = [
    { id: "manual", date: "2026-11-15", value: 74, source: "manual" },
    { id: "legacy", date: "2026-11-16", value: 75 },
    { ...garminRow("broken", "2026-11-17T05:00:00Z", 76), measuredAt: "invalid" },
  ];
  const snapshot = plain(existing);
  const result = core.mergeWeights(existing, [selected("new-15", "2026-11-15T05:00:00Z", 80), selected("new-16", "2026-11-16T05:00:00Z", 81), selected("new-17", "2026-11-17T05:00:00Z", 82)]);
  assert.equal(result.rows, existing);
  assert.deepEqual(plain(existing), snapshot);
  assert.equal(result.added, 0);
  assert.equal(result.updated, 0);
  assert.equal(result.skipped, 3);
});

await test("A manual entry alongside a valid Garmin row blocks replacement of the whole conflicting date", () => {
  const existing = [garminRow("old", "2026-11-17T07:00:00Z", 75), { id: "manual", date: "2026-11-17", value: 79 }];
  const result = core.mergeWeights(existing, [selected("earlier", "2026-11-17T05:00:00Z", 74)]);
  assert.equal(result.rows, existing);
  assert.equal(result.updated, 0);
  assert.equal(result.skipped, 1);
});

await test("Merge can update a previously synced measurement's changed weight without duplicating its row", () => {
  const existing = [garminRow("same", "2026-11-17T05:00:00Z", 75)];
  const result = core.mergeWeights(existing, [selected("same", "2026-11-17T05:00:00Z", 75.4)]);
  assert.equal(result.added, 0);
  assert.equal(result.updated, 1);
  assert.deepEqual(plain(result.rows), [garminRow("same", "2026-11-17T05:00:00Z", 75.4)]);
  assert.equal(existing[0].value, 75);
});

await test("A backup-imported Garmin row keeps its regenerated local ID during idempotent sync and weight updates", () => {
  const existing = [{ ...garminRow("same", "2026-11-17T05:00:00Z", 75), id: "imported-local-uuid" }];
  const same = core.mergeWeights(existing, [selected("same", "2026-11-17T05:00:00Z", 75)]);
  assert.equal(same.rows, existing);
  const updated = core.mergeWeights(existing, [selected("same", "2026-11-17T05:00:00Z", 75.4)]);
  assert.equal(updated.updated, 1);
  assert.deepEqual(plain(updated.rows), [{ ...existing[0], value: 75.4 }]);
  assert.equal(existing[0].value, 75);
});

await test("Cross-date Garmin identity conflicts are preserved, while an incoming date is derived from its timestamp", () => {
  const existing = [garminRow("same", "2026-11-16T05:00:00Z", 75)];
  const blocked = core.mergeWeights(existing, [selected("same", "2026-11-17T05:00:00Z", 76)]);
  assert.equal(blocked.rows, existing);
  assert.equal(blocked.skipped, 1);
  const incoming = { ...selected("different", "2026-11-17T05:00:00Z", 76), date: "2026-11-19" };
  const derived = core.mergeWeights([], [incoming]);
  assert.deepEqual(plain(derived.rows), [garminRow("different", "2026-11-17T05:00:00Z", 76)]);
});

await test("A strictly earlier eligible candidate replaces an auto row, but later and equal-time different IDs do not", () => {
  const existing = [garminRow("middle", "2026-11-17T06:00:00Z", 75)];
  const earlier = core.mergeWeights(existing, [selected("early", "2026-11-17T05:00:00Z", 74)]);
  assert.equal(earlier.updated, 1);
  assert.deepEqual(plain(earlier.rows), [{ ...garminRow("early", "2026-11-17T05:00:00Z", 74), id: existing[0].id }]);
  for (const incoming of [selected("later", "2026-11-17T07:00:00Z", 76), selected("aaa", "2026-11-17T06:00:00Z", 74), selected("middle", "2026-11-17T07:00:00Z", 76)]) {
    const result = core.mergeWeights(existing, [incoming]);
    assert.equal(result.rows, existing);
    assert.equal(result.updated, 0);
  }
});

await test("Changing the morning window may replace an old auto row outside that window but never deletes other dates", () => {
  const existing = [garminRow("early", "2026-11-17T05:00:00Z", 74), garminRow("older-day", "2026-11-16T05:00:00Z", 73)];
  const result = core.mergeWeights(existing, [selected("new-window", "2026-11-17T08:00:00Z", 75)], { start: "09:00", end: "12:00" });
  assert.equal(result.added, 0);
  assert.equal(result.updated, 1);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(plain(result.rows.find(row => row.date === "2026-11-17")), { ...garminRow("new-window", "2026-11-17T08:00:00Z", 75), id: existing[0].id });
  assert.deepEqual(plain(result.rows.find(row => row.date === "2026-11-16")), existing[1]);
  const none = core.mergeWeights(existing, [], { start: "09:00", end: "12:00" });
  assert.equal(none.rows, existing);
  assert.equal(none.added, 0);
  assert.equal(none.updated, 0);
});

await test("The 30-day query range uses inclusive Helsinki calendar dates across DST, midnight and leap years", () => {
  for (const [iso, expected] of [
    ["2026-03-30T22:00:00Z", { from: "2026-03-02", to: "2026-03-31" }],
    ["2026-10-25T21:59:59.999Z", { from: "2026-09-26", to: "2026-10-25" }],
    ["2026-10-25T22:00:00Z", { from: "2026-09-27", to: "2026-10-26" }],
    ["2024-03-01T10:00:00Z", { from: "2024-02-01", to: "2024-03-01" }],
    ["2026-01-01T10:00:00Z", { from: "2025-12-03", to: "2026-01-01" }],
  ]) assert.deepEqual(plain(core.dateRange30(at(iso))), expected, iso);
});
