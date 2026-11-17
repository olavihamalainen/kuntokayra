import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { boot, plain } from "./helpers/browser-harness.mjs";
import { history } from "./helpers/fixtures.mjs";

const key = "kuntokayra_v1";
const setRest = async (app, minutes, seconds) => {
  await app.click(undefined, { tab: "settings" });
  await app.fillSimple({ minutes, seconds });
  await app.emit("submit", app.document.getElementById("rest-settings-form"));
};
const startTimer = async (app) => {
  await app.click("new-workout");
  await app.input("name", "Testiliike");
  await app.input("weight", "50");
  await app.input("reps", "8");
  await app.clock.tick(800);
};

await test("Adding movements with empty history never focuses a date field or changes the date", async () => {
  const app = boot();
  await app.click("new-workout");
  const date = app.draft().date;
  await app.input("name", "Ensimmäinen");
  await app.input("weight", "35");
  await app.click("add-exercise");
  assert.equal(app.document.activeElement.id, "exercise-1");
  assert.equal(app.document.activeElement.attributes.type, "text");
  assert.equal(
    app.focusCalls.some((call) => call.id === "workout-date"),
    false,
  );
  assert.equal(app.draft().date, date);
  assert.equal(app.weight(), "35");
  await app.click("add-exercise");
  assert.equal(app.document.activeElement.id, "exercise-2");
  assert.equal(
    app.focusCalls.some((call) => call.id === "workout-date"),
    false,
  );
});

await test("Dialog open and category changes do not activate native date/select pickers automatically", async () => {
  const app = boot(history);
  await app.click("new-workout");
  await app.input("category", "Etukroppa", 0, 0, "change");
  await app.click("choose-exercise", { name: "Penkkipunnerrus" });
  assert.equal(
    app.focusCalls.some(
      (call) => call.id === "workout-date" || call.id === "workout-category",
    ),
    false,
  );
  const date = app.document.getElementById("workout-date");
  const touch = await app.emit("touchstart", date, { touches: [{}] });
  assert.equal(touch.defaultPrevented, false);
  date.focus();
  assert.equal(app.document.activeElement, date);
});

await test("Keyboard viewport resize/scroll does not resize or reposition the dialog or interrupt the focused movement", async () => {
  const app = boot();
  await app.click("new-workout");
  await app.input("name", "Penkkipunnerrus");
  const input = app.document.getElementById("exercise-0");
  input.focus();
  const inner = app.document.querySelector(".dialog-inner");
  inner.scrollTop = 240;
  const style = plain(app.document.documentElement.style),
    before = app.focusCalls.length;
  await app.emitViewport("resize", { height: 310, offsetTop: 180 });
  await app.emitViewport("scroll", { offsetTop: 210 });
  app.window.innerHeight = 310;
  await app.emitWindow("resize");
  assert.deepEqual(plain(app.document.documentElement.style), style);
  assert.equal(inner.scrollTop, 240);
  assert.equal(app.document.activeElement, input);
  assert.equal(app.focusCalls.length, before);
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.ok(css.includes("--app-stable-height:100svh"));
  assert.equal(css.includes("var(--app-viewport-height)"), false);
  assert.match(css, /#dialog-rest-timer-host \.rest-timer\{position:static/);
});

await test("Countdown ticks keep the same timer widgets and buttons so a tap is not discarded", async () => {
  const app = boot();
  await startTimer(app);
  const widgets = ["rest-timer-host", "dialog-rest-timer-host"].map((id) =>
    app.document.getElementById(`${id}-widget`),
  );
  const buttons = app.document.querySelectorAll('[data-action="rest-cancel"]');
  await app.clock.tick(3000);
  assert.equal(app.countdown(), "2:57");
  assert.deepEqual(
    ["rest-timer-host", "dialog-rest-timer-host"].map((id) =>
      app.document.getElementById(`${id}-widget`),
    ),
    widgets,
  );
  const after = app.document.querySelectorAll('[data-action="rest-cancel"]');
  assert.equal(after.length, buttons.length);
  after.forEach((button, index) => assert.equal(button, buttons[index]));
  await app.click("rest-cancel");
  assert.equal(app.countdown(), null);
});

await test("Settings save a custom rest duration across reopening without changing workout records", async () => {
  const app = boot(history);
  await setRest(app, "2", "15");
  assert.deepEqual(app.state().settings, { restSeconds: 135 });
  assert.deepEqual(app.state().workouts, history.workouts);
  const reopened = boot(null, app.storage);
  assert.equal(reopened.writes.length, 0);
  await startTimer(reopened);
  assert.equal(reopened.countdown(), "2:15");
  await reopened.clock.tick(1000);
  assert.equal(reopened.countdown(), "2:14");
});

await test("Changing preferences affects the next timer or restart, not the current deadline", async () => {
  const app = boot();
  await startTimer(app);
  await app.clock.tick(5000);
  await app.click("close");
  await setRest(app, "1", "0");
  assert.equal(app.countdown(), "2:55");
  await app.clock.tick(1000);
  assert.equal(app.countdown(), "2:54");
  await app.click("rest-restart");
  assert.equal(app.countdown(), "1:00");
  await app.clock.tick(60000);
  assert.equal(app.countdown(), "0:00");
});

await test("Invalid rest settings cannot overwrite the previous setting or user records", async () => {
  const app = boot(history);
  await setRest(app, "1", "30");
  const saved = app.storage.get(key),
    state = app.state();
  for (const [minutes, seconds] of [
    ["0", "0"],
    ["0", "14"],
    ["30", "1"],
    ["1.5", "0"],
    ["1", "60"],
    ["", "30"],
    ["1", "abc"],
  ]) {
    await setRest(app, minutes, seconds);
    assert.equal(app.storage.get(key), saved);
    assert.deepEqual(app.state(), state);
    assert.ok(app.document.getElementById("rest-settings-error").textContent);
  }
});

await test("A failed rest preference save leaves the original preference and form available", async () => {
  const app = boot(history);
  await setRest(app, "1", "30");
  const saved = app.storage.get(key);
  app.setStorageFailure(true);
  await setRest(app, "4", "0");
  assert.equal(app.state().settings.restSeconds, 90);
  assert.equal(app.storage.get(key), saved);
  assert.equal(app.simpleValue("minutes"), "4");
  assert.ok(app.document.getElementById("rest-settings-error").textContent);
  app.setStorageFailure(false);
  await app.emit("submit", app.document.getElementById("rest-settings-form"));
  assert.equal(app.state().settings.restSeconds, 240);
});

await test("Version 1 backups preserve rest settings and reject invalid settings before replacing data", async () => {
  const app = boot(history);
  await setRest(app, "0", "45");
  await app.click("export");
  const backup = JSON.parse(await app.blobs[0].text());
  const imported = boot();
  await imported.importBackup(backup);
  assert.deepEqual(imported.state().settings, { restSeconds: 45 });
  await startTimer(imported);
  assert.equal(imported.countdown(), "0:45");
  const before = app.state(),
    raw = app.storage.get(key);
  for (const settings of [
    null,
    { restSeconds: 0 },
    { restSeconds: 1801 },
    { restSeconds: "90" },
    { restSeconds: 45.5 },
  ]) {
    await app.importBackup({
      version: 1,
      data: { ...plain(history), settings },
    });
    assert.deepEqual(app.state(), before);
    assert.equal(app.storage.get(key), raw);
  }
});

await test("History suggestions update after a new save instead of using stale cached weights and units", async () => {
  const app = boot(history);
  await app.click("new-workout");
  await app.input("name", "Penkkipunnerrus");
  await app.input("unit", "lbs", 0, 0, "change");
  await app.input("weight", "90");
  await app.input("reps", "9");
  await app.click("save-workout");
  await app.click("new-workout");
  await app.input("name", " PENKKIPUNNERRUS ");
  assert.equal(app.unit(), "lbs");
  assert.equal(Number(app.weight()), 90);
  assert.match(
    app.document.getElementById("previous-reps-0-0").textContent,
    /9 toistoa/,
  );
});

await test("Typing movement names does not repeatedly sort the workout history", async () => {
  const app = boot(history);
  await app.click("new-workout");
  app.evaluate(
    "globalThis.historySorts=0;globalThis.originalSort=Array.prototype.sort;Array.prototype.sort=function(...args){historySorts++;return originalSort.apply(this,args)}",
  );
  for (const name of ["P", "Pe", "Pen", "Penk", "Penkkipunnerrus"])
    await app.input("name", name);
  assert.equal(app.evaluate("historySorts"), 0);
  assert.equal(app.weight(), "55");
});

await test("Failed deletion and clearing preserve records; successful clearing keeps timer preferences", async () => {
  const initial = { ...plain(history), settings: { restSeconds: 90 } },
    app = boot(initial),
    raw = app.storage.get(key);
  app.setStorageFailure(true);
  await app.click("delete-workout", { id: history.workouts[0].id });
  assert.deepEqual(app.state(), initial);
  assert.equal(app.storage.get(key), raw);
  await app.click("clear");
  assert.deepEqual(app.state(), initial);
  assert.equal(app.storage.get(key), raw);
  app.setStorageFailure(false);
  await app.click("clear");
  assert.deepEqual(app.state(), {
    workouts: [],
    sleep: [],
    weight: [],
    settings: { restSeconds: 90 },
  });
});
