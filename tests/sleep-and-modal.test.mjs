import test from "node:test";
import assert from "node:assert/strict";
import { boot, plain } from "./helpers/browser-harness.mjs";
import { legacy, history } from "./helpers/fixtures.mjs";

const key = "kuntokayra_v1";
const localNight = {
  start: new Date(2026, 10, 16, 22, 30).getTime(),
  wake: new Date(2026, 10, 17, 6, 30).getTime(),
};
const pending = (overrides = {}) => ({
  id: "synthetic-pending-night",
  startedAt: new Date(localNight.start).toISOString(),
  ...overrides,
});
const withPending = (run = pending()) => ({ ...plain(history), sleepPending: run });
const completedPending = (overrides = {}) => pending({ endedAt: new Date(localNight.wake).toISOString(), ...overrides });
const dialog = (app) => app.document.getElementById("entry-dialog");
const rawState = (app) => app.storage.get(key);

await test("Sleep start persists one pending night without modifying earlier entries or restarting it", async () => {
  const a = boot(history);
  a.clock.set(localNight.start);
  await a.click("sleep-start");
  const saved = a.state();
  assert.ok(saved.sleepPending?.id);
  assert.equal(saved.sleepPending.startedAt, new Date(localNight.start).toISOString());
  assert.ok(!("endedAt" in saved.sleepPending));
  assert.deepEqual(saved.workouts, history.workouts);
  assert.deepEqual(saved.sleep, history.sleep);
  assert.deepEqual(saved.weight, history.weight);
  assert.equal(a.writes.length, 1);
  assert.equal(dialog(a).open, false);
  assert.ok(a.mainHTML().includes('data-action="sleep-wake"'));
  a.clock.jump(60_000);
  await a.click("sleep-start");
  assert.deepEqual(a.state(), saved);
  assert.equal(a.writes.length, 1);
});

await test("A running or ended pending night reopens byte-for-byte without startup storage writes", async () => {
  for (const run of [pending(), completedPending()]) {
    const initial = withPending(run);
    const a = boot(initial);
    const serialized = rawState(a);
    const b = boot(null, a.storage);
    assert.deepEqual(b.state(), initial);
    assert.equal(rawState(b), serialized);
    assert.equal(b.writes.length, 0);
  }
});

await test("Wake captures time once and opens manual morning review; cancellation and reload keep that time", async () => {
  const a = boot(withPending());
  a.clock.set(localNight.wake);
  await a.click("sleep-wake");
  const fixed = a.state().sleepPending;
  assert.equal(fixed.endedAt, new Date(localNight.wake).toISOString());
  assert.equal(a.simpleValue("date"), "2026-11-17");
  assert.equal(a.simpleValue("bed"), "22:30");
  assert.equal(a.simpleValue("wake"), "06:30");
  assert.ok(dialog(a).open);
  assert.deepEqual(a.state().sleep, history.sleep);
  assert.equal(a.writes.length, 1);
  await a.click("close");
  assert.deepEqual(a.state().sleepPending, fixed);
  a.clock.jump(86_400_000);
  await a.click("sleep-wake");
  assert.deepEqual(a.state().sleepPending, fixed);
  assert.equal(a.writes.length, 1);
  assert.equal(a.simpleValue("date"), "2026-11-17");
  assert.equal(a.simpleValue("wake"), "06:30");
  const b = boot(null, a.storage);
  b.clock.set(localNight.wake + 2 * 86_400_000);
  await b.click("sleep-wake");
  assert.equal(b.writes.length, 0);
  assert.deepEqual(b.state().sleepPending, fixed);
  assert.equal(b.simpleValue("wake"), "06:30");
});

await test("Manual new-sleep and existing sleep editing preserve an unrelated pending night", async () => {
  const a = boot(withPending());
  a.clock.set(localNight.wake);
  await a.click("new-sleep");
  assert.equal(a.simpleValue("bed"), "");
  assert.equal(a.simpleValue("wake"), "");
  await a.fillSimple({ date: "2026-11-17", bed: "23:00", wake: "07:00" });
  await a.submitSimple();
  assert.equal(a.state().sleep.length, history.sleep.length + 1);
  assert.deepEqual(a.state().sleepPending, pending());
  assert.equal(a.state().sleep.at(-1).duration, 8);
  assert.equal(dialog(a).open, false);
  await a.click("edit-sleep", { id: history.sleep[0].id });
  await a.fillSimple({ bed: "23:00", wake: "06:00" });
  await a.submitSimple();
  assert.deepEqual(a.state().sleepPending, pending());
  assert.equal(a.state().sleep.find(row => row.id === history.sleep[0].id).duration, 7);
});

await test("Successful reviewed save consumes only its pending night and preserves earlier data on reopening", async () => {
  const a = boot(withPending());
  a.clock.set(localNight.wake);
  await a.click("sleep-wake");
  await a.fillSimple({ bed: "23:00", wake: "07:15" });
  await a.submitSimple();
  const saved = a.state();
  assert.ok(!("sleepPending" in saved));
  assert.equal(saved.sleep.length, history.sleep.length + 1);
  assert.deepEqual(saved.sleep.at(-1), {
    id: saved.sleep.at(-1).id,
    date: "2026-11-17", bed: "23:00", wake: "07:15", duration: 8.25,
  });
  assert.deepEqual(saved.workouts, history.workouts);
  assert.deepEqual(saved.weight, history.weight);
  assert.deepEqual(saved.sleep.slice(0, -1), history.sleep);
  assert.equal(dialog(a).open, false);
  const b = boot(null, a.storage);
  assert.deepEqual(b.state(), saved);
  assert.equal(b.writes.length, 0);
});

await test("A stale review cannot save or consume a newly imported pending identity or changed timestamps", async () => {
  for (const change of [
    { id: "other-pending-night" },
    { startedAt: new Date(localNight.start - 3_600_000).toISOString() },
    { endedAt: new Date(localNight.wake + 3_600_000).toISOString() },
  ]) {
    const a = boot(withPending(completedPending()));
    a.clock.set(localNight.wake);
    await a.click("sleep-wake");
    const staleForm = a.document.getElementById("simple-form");
    const incoming = { workouts: [], sleep: [], weight: [], sleepPending: completedPending(change) };
    await a.importBackup({ version: 1, data: incoming });
    assert.equal(a.alerts.length, 0);
    const imported = a.state(), serialized = rawState(a), writes = a.writes.length;
    await a.emit("submit", staleForm);
    assert.deepEqual(a.state(), imported);
    assert.equal(rawState(a), serialized);
    assert.equal(a.writes.length, writes);
    assert.equal(a.state().sleep.length, 0);
    assert.ok(a.document.getElementById("form-error")?.textContent);
  }
});

await test("Sleep start, wake, review save, cancellation and import failures preserve stored and visible state", async () => {
  const a = boot(history);
  a.clock.set(localNight.start);
  await a.click("new-sleep");
  await a.fillSimple({ bed: "21:45", wake: "06:15" });
  a.setStorageFailure(true);
  const before = rawState(a);
  await a.click("sleep-start");
  assert.deepEqual(a.state(), history);
  assert.equal(rawState(a), before);
  assert.ok(dialog(a).open);
  assert.equal(a.simpleValue("bed"), "21:45");
  a.setStorageFailure(false);
  await a.click("sleep-start");
  const started = a.state(), startedRaw = rawState(a);
  a.clock.set(localNight.wake);
  a.setStorageFailure(true);
  await a.click("sleep-wake");
  assert.deepEqual(a.state(), started);
  assert.equal(rawState(a), startedRaw);
  assert.equal(dialog(a).open, false);
  a.setStorageFailure(false);
  await a.click("sleep-wake");
  await a.fillSimple({ bed: "23:00", wake: "07:00" });
  const review = a.state(), reviewRaw = rawState(a);
  a.setStorageFailure(true);
  await a.submitSimple();
  assert.deepEqual(a.state(), review);
  assert.equal(rawState(a), reviewRaw);
  assert.ok(dialog(a).open);
  assert.equal(a.simpleValue("bed"), "23:00");
  assert.equal(a.simpleValue("wake"), "07:00");
  assert.ok(a.document.getElementById("form-error").textContent);
  await a.click("sleep-cancel");
  assert.deepEqual(a.state(), review);
  assert.equal(rawState(a), reviewRaw);
  assert.ok(dialog(a).open);
  await a.importBackup({ version: 1, data: withPending(completedPending({ id: "imported-pending" })) });
  assert.deepEqual(a.state(), review);
  assert.equal(rawState(a), reviewRaw);
  assert.ok(dialog(a).open);
  assert.equal(a.simpleValue("bed"), "23:00");
  a.setStorageFailure(false);
  await a.submitSimple();
  assert.ok(!("sleepPending" in a.state()));
  assert.equal(a.state().sleep.at(-1).bed, "23:00");
});

await test("Duplicate-date decline keeps review and pending data; acceptance replaces only the selected night", async () => {
  const start = new Date(2026, 10, 1, 22, 30).getTime();
  const wake = new Date(2026, 10, 2, 6, 30).getTime();
  const initial = { ...plain(legacy), sleepPending: pending({ startedAt: new Date(start).toISOString() }) };
  const a = boot(initial);
  a.clock.set(wake);
  await a.click("sleep-wake");
  await a.fillSimple({ bed: "23:00", wake: "07:00" });
  const before = a.state(), serialized = rawState(a), writes = a.writes.length;
  a.setConfirmation(false);
  await a.submitSimple();
  assert.deepEqual(a.state(), before);
  assert.equal(rawState(a), serialized);
  assert.equal(a.writes.length, writes);
  assert.ok(dialog(a).open);
  assert.equal(a.simpleValue("bed"), "23:00");
  assert.ok(a.confirmations.length > 0);
  a.setConfirmation(true);
  await a.submitSimple();
  assert.equal(a.state().sleep.length, 1);
  assert.equal(a.state().sleep[0].date, "2026-11-02");
  assert.equal(a.state().sleep[0].bed, "23:00");
  assert.ok(!("sleepPending" in a.state()));
  assert.deepEqual(a.state().workouts, legacy.workouts);
  assert.deepEqual(a.state().weight, legacy.weight);
});

await test("Pending cancellation requires confirmation and removes only pending data", async () => {
  const initial = withPending(completedPending());
  const a = boot(initial);
  a.setConfirmation(false);
  await a.click("sleep-cancel");
  assert.deepEqual(a.state(), initial);
  assert.equal(a.writes.length, 0);
  a.setConfirmation(true);
  await a.click("sleep-cancel");
  assert.deepEqual(a.state(), history);
  assert.equal(a.writes.length, 1);
});

await test("Stale nights over 16 elapsed hours require amended review fields before a valid clock-time save", async () => {
  const staleWake = new Date(2026, 10, 18, 6, 30).getTime();
  const a = boot(withPending());
  a.clock.set(staleWake);
  await a.click("sleep-wake");
  assert.equal(a.simpleValue("date"), "2026-11-18");
  assert.equal(a.simpleValue("bed"), "22:30");
  assert.equal(a.simpleValue("wake"), "06:30");
  const before = a.state(), serialized = rawState(a);
  await a.submitSimple();
  assert.deepEqual(a.state(), before);
  assert.equal(rawState(a), serialized);
  assert.ok(dialog(a).open);
  assert.ok(a.document.getElementById("form-error").textContent);
  await a.fillSimple({ bed: "23:00", wake: "07:00" });
  await a.submitSimple();
  assert.ok(!("sleepPending" in a.state()));
  assert.equal(a.state().sleep.at(-1).duration, 8);
});

await test("Version 1 backup roundtrip retains running or ended pending nights and earlier chart data", async () => {
  for (const run of [pending(), completedPending(), completedPending({ endedAt: new Date(localNight.wake + 2 * 86_400_000).toISOString() })]) {
    const initial = withPending(run);
    const a = boot(initial);
    await a.click("export");
    const payload = JSON.parse(await a.blobs[0].text());
    assert.equal(payload.version, 1);
    assert.deepEqual(payload.data.sleepPending, run);
    const b = boot();
    await b.importBackup(payload);
    assert.equal(b.alerts.length, 0);
    assert.deepEqual(b.state().sleepPending, run);
    assert.deepEqual(plain(b.api.exerciseSeries("Penkkipunnerrus", "volume")), plain(a.api.exerciseSeries("Penkkipunnerrus", "volume")));
    assert.deepEqual(b.state().sleep.map(({ id, ...row }) => row), initial.sleep.map(({ id, ...row }) => row));
    const c = boot(null, b.storage);
    assert.deepEqual(c.state(), b.state());
    assert.equal(c.writes.length, 0);
    await c.click("export");
    assert.deepEqual(JSON.parse(await c.blobs[0].text()).data.sleepPending, run);
  }
});

await test("Invalid pending backup metadata is rejected before replacing any user data", async () => {
  const cases = [
    null, {}, pending({ id: "" }), pending({ id: "a".repeat(101) }),
    pending({ startedAt: "not-a-date" }), pending({ startedAt: "2026-11-16" }),
    pending({ startedAt: "2026-11-16T22:30:00+02:00" }),
    pending({ endedAt: "not-a-date" }), pending({ endedAt: null }),
    pending({ endedAt: new Date(localNight.start - 1).toISOString() }),
  ];
  for (const run of cases) {
    const initial = withPending(completedPending());
    const a = boot(initial), serialized = rawState(a);
    await a.importBackup({ version: 1, data: { workouts: [], sleep: [], weight: [], sleepPending: run } });
    assert.equal(a.alerts.length, 1, JSON.stringify(run));
    assert.deepEqual(a.state(), initial);
    assert.equal(rawState(a), serialized);
    assert.equal(a.writes.length, 0);
  }
});

await test("Modal page lock keeps original scroll and inline styles through rerender and native close", async () => {
  const a = boot(history);
  const bodyStyle = a.document.body.style, rootStyle = a.document.documentElement.style;
  Object.assign(bodyStyle, { position: "relative", top: "3px", left: "4px", right: "5px", width: "80%", overflow: "auto" });
  rootStyle.overflow = "scroll";
  const originalBody = plain(bodyStyle), originalRoot = plain(rootStyle);
  a.window.scrollTo({ top: 640 });
  await a.click("new-workout");
  assert.equal(bodyStyle.position, "fixed");
  assert.equal(bodyStyle.top, "-640px");
  assert.equal(rootStyle.overflow, "hidden");
  a.window.scrollY = 0;
  a.document.querySelector(".dialog-inner").scrollTop = 420;
  await a.click("add-set", { ex: 0 });
  assert.equal(bodyStyle.top, "-640px");
  assert.equal(a.document.querySelector(".dialog-inner").scrollTop, 420);
  const cancel = await a.emitElement("cancel", dialog(a));
  if (!cancel.defaultPrevented) dialog(a).close();
  assert.equal(dialog(a).open, false);
  assert.deepEqual(plain(bodyStyle), originalBody);
  assert.deepEqual(plain(rootStyle), originalRoot);
  assert.equal(a.window.scrollY, 640);
  assert.equal(a.scrollCalls.at(-1).options.top, 640);
});

await test("Backdrop close and successful form save release the page lock without losing scroll", async () => {
  const a = boot();
  a.window.scrollTo({ top: 275 });
  await a.click("new-sleep");
  assert.equal(a.document.body.style.position, "fixed");
  await a.emitElement("click", dialog(a));
  assert.equal(dialog(a).open, false);
  assert.equal(a.document.body.style.position, "");
  assert.equal(a.window.scrollY, 275);
  await a.click("new-sleep");
  await a.fillSimple({ date: "2026-11-17", bed: "22:30", wake: "06:30" });
  await a.submitSimple();
  assert.equal(dialog(a).open, false);
  assert.equal(a.document.body.style.position, "");
  assert.equal(a.window.scrollY, 275);
});

await test("Gesture guards prevent multitouch zoom while preserving ordinary one-finger movement", async () => {
  const a = boot();
  for (const type of ["touchstart", "touchmove"]) {
    const one = await a.emit(type, a.document.body, { touches: [{}] });
    assert.equal(one.defaultPrevented, false, `${type} one finger`);
    const two = await a.emit(type, a.document.body, { touches: [{}, {}] });
    assert.equal(two.defaultPrevented, true, `${type} two fingers`);
    const registration = a.eventRegistrations.find(row => row.scope === "document" && row.type === type);
    assert.equal(registration?.options?.passive, false, `${type} must allow preventDefault`);
  }
  for (const type of ["gesturestart", "gesturechange"]) {
    const event = await a.emit(type, a.document.body, { scale: 1.3 });
    assert.equal(event.defaultPrevented, true, type);
  }
});
