import test from "node:test";
import assert from "node:assert/strict";
import { boot, plain } from "./helpers/browser-harness.mjs";
import { ex, workout, legacy, history } from "./helpers/fixtures.mjs";

const key = "kuntokayra_v1";
const numericWeight = (value) => Number(String(value).replace(",", "."));
const hintText = (app, exercise, set) =>
  app.document
    .getElementById(`previous-reps-${exercise}-${set}`)
    .textContent.replace(/^Sarja \d+ · /, "");

await test("Legacy storage loads and reopening performs zero writes or categorization", async () => {
  const a = boot(legacy);
  assert.deepEqual(a.state(), legacy);
  assert.equal(a.writes.length, 0);
  const b = boot(null, a.storage);
  assert.deepEqual(b.state(), legacy);
  assert.equal(b.writes.length, 0);
  await b.click("new-workout");
  assert.equal(b.draft().category, "Etukroppa");
  assert.deepEqual(b.state(), legacy);
});
await test("New set defaults copy first current weight and never propagate edits", async () => {
  const a = boot();
  await a.click("new-workout");
  await a.input("weight", "50");
  await a.click("add-set", { ex: 0 });
  assert.equal(a.weight(0, 1), "50");
  await a.input("weight", "45", 0, 1);
  await a.input("weight", "60");
  assert.equal(a.weight(0, 1), "45");
  await a.click("add-set", { ex: 0 });
  assert.equal(a.weight(0, 2), "60");
  assert.deepEqual(
    a.draft().exercises[0].sets.map((s) => s.weight),
    ["60", "45", "60"],
  );
  await a.input("weight", "65", 0, 2);
  assert.equal(a.weight(0, 0), "60");
});
await test("Zero, comma decimal, blank and individual movement first weights", async () => {
  const a = boot();
  await a.click("new-workout");
  for (const value of ["0", "62,5", ""]) {
    await a.input("weight", value);
    await a.click("add-set", { ex: 0 });
    assert.equal(
      value === ""
        ? a.draft().exercises[0].sets.at(-1).weight
        : numericWeight(a.draft().exercises[0].sets.at(-1).weight),
      value === "" ? "" : numericWeight(value),
    );
  }
  await a.click("add-exercise");
  await a.input("weight", "22", 1);
  await a.click("add-set", { ex: 1 });
  assert.equal(a.weight(1, 1), "22");
  assert.equal(a.weight(0, 0), "");
});
await test("Last saved category alternates regardless of workout date; manual override works", async () => {
  const a = boot(history);
  await a.click("new-workout");
  assert.equal(a.draft().category, "Takakroppa");
  await a.input("category", "Etukroppa", 0, 0, "change");
  assert.equal(a.draft().category, "Etukroppa");
  await a.input("name", "Uusi liike");
  await a.input("weight", "15");
  await a.input("reps", "8");
  await a.input("date", "2026-10-01");
  await a.click("save-workout");
  assert.equal(a.state().workouts.at(-1).category, "Etukroppa");
  const b = boot(null, a.storage);
  await b.click("new-workout");
  assert.equal(b.draft().category, "Takakroppa");
  await b.input("name", "Toinen uusi");
  await b.input("weight", "20");
  await b.input("reps", "8");
  await b.click("save-workout");
  await b.click("new-workout");
  assert.equal(b.draft().category, "Etukroppa");
});
await test("Suggestions are category specific, latest training order then older unique names", async () => {
  const a = boot(history);
  await a.click("new-workout");
  assert.deepEqual(a.options(), ["Kulmasoutu", "Leuanveto"]);
  await a.input("category", "Etukroppa", 0, 0, "change");
  assert.deepEqual(a.options(), [
    "Pystypunnerrus",
    "Penkkipunnerrus",
    "Hauiskääntö",
  ]);
  assert.ok(!a.options().includes("Maastaveto"));
});
await test("Choosing previous exercise suggests latest FIRST set weight and remains editable", async () => {
  const a = boot(history);
  await a.click("new-workout");
  await a.input("category", "Etukroppa", 0, 0, "change");
  await a.click("choose-exercise", { name: "Penkkipunnerrus" });
  assert.equal(a.weight(), "55");
  await a.input("weight", "57,5");
  await a.click("add-set", { ex: 0 });
  assert.equal(numericWeight(a.weight(0, 1)), 57.5);
  assert.equal(a.draft().exercises[0].name, "Penkkipunnerrus");
});
await test("Typed movement name matching ignores case and extra whitespace; unknown stays blank", async () => {
  const a = boot(history);
  await a.click("new-workout");
  await a.input("name", "  PENKKIPUNNERRUS  ");
  assert.equal(a.weight(), "55");
  await a.click("add-exercise");
  await a.input("name", "Uusi keksitty liike", 1);
  assert.equal(a.weight(1), "");
  await a.click("add-exercise");
  await a.input("name", "Leuanveto", 2);
  assert.equal(a.weight(2), "0");
});
await test("Manual or cleared weights are never overwritten when names/categories change", async () => {
  const a = boot(history);
  await a.click("new-workout");
  await a.input("weight", "123");
  await a.input("name", "Penkkipunnerrus");
  assert.equal(a.weight(), "123");
  await a.input("category", "Etukroppa", 0, 0, "change");
  assert.equal(a.weight(), "123");
  await a.click("add-exercise");
  await a.input("weight", "");
  await a.input("weight", "", 1);
  await a.input("name", "Kulmasoutu", 1);
  assert.equal(a.weight(1), "");
});
await test("Existing entry edits protect saved weights and legacy category stays absent", async () => {
  const a = boot(legacy);
  await a.click("edit-workout", { id: "legacy" });
  assert.equal(a.weight(), "30");
  await a.input("name", "Maastaveto");
  assert.equal(a.weight(), "30");
  await a.click("save-workout");
  assert.ok(!("category" in a.state().workouts[0]));
  assert.deepEqual(a.state().sleep, legacy.sleep);
  assert.deepEqual(a.state().weight, legacy.weight);
});
await test("Current and legacy backup export/import/reopen preserve values, categories and series", async () => {
  for (const initial of [legacy, history]) {
    const a = boot(initial);
    await a.click("export");
    assert.equal(a.downloads.length, 1);
    const backup = JSON.parse(await a.blobs[0].text());
    assert.equal(backup.version, 1);
    assert.deepEqual(backup.data, initial);
    const b = boot({ workouts: [], sleep: [], weight: [] });
    await b.importBackup(backup);
    assert.equal(b.alerts.length, 0);
    const oldSeries = plain(a.api.exerciseSeries("Penkkipunnerrus", "volume"));
    assert.deepEqual(
      plain(b.api.exerciseSeries("Penkkipunnerrus", "volume")),
      oldSeries,
    );
    assert.deepEqual(
      b.state().workouts.map((r) => ({
        date: r.date,
        category: r.category,
        exercises: r.exercises,
        savedAt: r.savedAt,
      })),
      initial.workouts.map((r) => ({
        date: r.date,
        category: r.category,
        exercises: r.exercises,
        savedAt: r.savedAt,
      })),
    );
    assert.deepEqual(
      b.state().sleep.map(({ id, ...r }) => r),
      initial.sleep.map(({ id, ...r }) => r),
    );
    assert.deepEqual(
      b.state().weight.map(({ id, ...r }) => r),
      initial.weight.map(({ id, ...r }) => r),
    );
    const c = boot(null, b.storage);
    assert.deepEqual(c.state(), b.state());
    assert.equal(c.writes.length, 0);
    await c.click("export");
    const exportedAgain = JSON.parse(await c.blobs[0].text());
    assert.deepEqual(exportedAgain.data, c.state());
  }
});
await test("Weight history spans categories and movement matching deduplicates normalized names", async () => {
  const initial = plain(history);
  initial.workouts.push(
    workout(
      "b2",
      "2026-11-15",
      "Takakroppa",
      [ex("penkkipunnerrus", 57.5), ex("Kulmasoutu", 65)],
      "2026-11-15T10:00:00.000Z",
    ),
  );
  const a = boot(initial);
  await a.click("new-workout");
  await a.input("category", "Etukroppa", 0, 0, "change");
  await a.input("name", "PENKKIPUNNERRUS");
  assert.equal(a.weight(), "57.5");
  await a.input("category", "Takakroppa", 0, 0, "change");
  assert.deepEqual(a.options(), ["penkkipunnerrus", "Kulmasoutu", "Leuanveto"]);
});
await test("Suggestion choice preserves typed values and adds another movement without replacement", async () => {
  const a = boot(history);
  await a.click("new-workout");
  await a.input("weight", "123");
  await a.click("choose-exercise", { name: "Kulmasoutu" });
  assert.equal(a.weight(), "123");
  await a.input("reps", "9");
  await a.click("choose-exercise", { name: "Leuanveto" });
  assert.equal(a.draft().exercises.length, 2);
  assert.equal(a.draft().exercises[0].name, "Kulmasoutu");
  assert.equal(a.weight(), "123");
  assert.equal(a.weight(1), "0");
  await a.input("category", "Etukroppa", 0, 0, "change");
  assert.equal(a.draft().exercises[0].sets[0].reps, "9");
  assert.equal(a.weight(), "123");
  assert.equal(a.weight(1), "0");
});
await test("Save/reopen/export retain independent edited sets and strip editor flags", async () => {
  const a = boot(history);
  await a.click("new-workout");
  await a.input("name", "Penkkipunnerrus");
  await a.input("weight", "57,5");
  await a.input("reps", "8");
  await a.click("add-set", { ex: 0 });
  await a.input("weight", "50", 0, 1);
  await a.input("reps", "10", 0, 1);
  await a.input("weight", "60");
  await a.click("save-workout");
  const saved = a.state().workouts.at(-1);
  assert.deepEqual(saved.exercises[0].sets, [
    { weight: 60, reps: 8 },
    { weight: 50, reps: 10 },
  ]);
  for (const set of saved.exercises[0].sets)
    assert.deepEqual(Object.keys(set).sort(), ["reps", "weight"]);
  const b = boot(null, a.storage);
  assert.deepEqual(b.state(), a.state());
  await b.click("export");
  const backup = JSON.parse(await b.blobs[0].text());
  assert.deepEqual(
    backup.data.workouts.at(-1).exercises[0].sets,
    saved.exercises[0].sets,
  );
});
await test("Editing an older workout makes its explicitly selected category the last saved", async () => {
  const a = boot(history);
  await a.click("edit-workout", { id: "f1" });
  await a.input("category", "Takakroppa", 0, 0, "change");
  await a.click("save-workout");
  assert.equal(
    a.state().workouts.find((r) => r.id === "f1").category,
    "Takakroppa",
  );
  assert.ok(
    Date.parse(a.state().workouts.find((r) => r.id === "f1").savedAt) >
      Date.parse(history.workouts.at(-1).savedAt),
  );
  await a.click("new-workout");
  assert.equal(a.draft().category, "Etukroppa");
});
await test("Workout/import storage failures preserve previous data and retryable draft", async () => {
  const a = boot(history);
  const raw = a.storage.get(key);
  await a.click("new-workout");
  await a.input("name", "Uusi liike");
  await a.input("weight", "23");
  await a.input("reps", "8");
  const draft = a.draft();
  a.setStorageFailure(true);
  await a.click("save-workout");
  assert.deepEqual(a.state(), history);
  assert.equal(a.storage.get(key), raw);
  assert.deepEqual(a.draft(), draft);
  assert.ok(a.document.getElementById("entry-dialog").open);
  assert.ok(a.document.getElementById("form-error").textContent);
  a.setStorageFailure(false);
  await a.click("save-workout");
  assert.equal(a.state().workouts.length, history.workouts.length + 1);
  const afterSave = a.state(),
    storedAfterSave = a.storage.get(key);
  a.setStorageFailure(true);
  await a.importBackup({ version: 1, data: legacy });
  assert.deepEqual(a.state(), afterSave);
  assert.equal(a.storage.get(key), storedAfterSave);
});
await test("Cancelled/invalid imports leave existing data and storage untouched", async () => {
  const a = boot(history);
  a.setConfirmation(false);
  await a.importBackup({ version: 1, data: legacy });
  assert.deepEqual(a.state(), history);
  assert.equal(a.writes.length, 0);
  a.setConfirmation(true);
  await a.importBackup({
    version: 1,
    data: { workouts: [{ date: "invalid" }], sleep: [], weight: [] },
  });
  assert.equal(a.alerts.length, 1);
  assert.deepEqual(a.state(), history);
  assert.equal(a.writes.length, 0);
});

await test("Add-set preserves inner and outer scroll and focuses new weight without scrolling", async () => {
  const a = boot(history);
  await a.click("new-workout");
  await a.input("name", "Penkkipunnerrus");
  await a.input("weight", "62,5");
  const dialog = a.document.getElementById("entry-dialog");
  a.document.querySelector(".dialog-inner").scrollTop = 475;
  dialog.scrollTop = 135;
  const previousFocuses = a.focusCalls.length;
  await a.click("add-set", { ex: 0 });
  assert.equal(a.document.querySelector(".dialog-inner").scrollTop, 475);
  assert.equal(dialog.scrollTop, 135);
  assert.equal(numericWeight(a.weight(0, 1)), 62.5);
  assert.ok(a.focusCalls.length > previousFocuses);
  assert.deepEqual(a.focusCalls.at(-1).dataset, {
    draft: "weight",
    ex: "0",
    set: "1",
  });
  assert.equal(a.focusCalls.at(-1).options.preventScroll, true);
  assert.equal(a.document.activeElement.dataset.set, "1");
});
await test("Add-exercise focuses the new movement name with preserved draft values", async () => {
  const a = boot(history);
  await a.click("new-workout");
  await a.input("name", "Ensimmäinen oma");
  await a.input("weight", "33");
  a.document.querySelector(".dialog-inner").scrollTop = 600;
  await a.click("add-exercise");
  assert.equal(a.draft().exercises.length, 2);
  assert.equal(a.weight(), "33");
  const active = a.document.activeElement;
  assert.equal(active?.id, "exercise-1");
  assert.equal(active?.attributes.type, "text");
});
await test("Previous reps show latest matching session/index/date without prefilling inputs", async () => {
  const a = boot(history);
  await a.click("new-workout");
  await a.input("name", "Penkkipunnerrus");
  assert.equal(hintText(a, 0, 0), "Viimeksi 13.11.: 8 toistoa");
  assert.equal(a.draft().exercises[0].sets[0].reps, "");
  await a.input("reps", "12");
  await a.click("add-set", { ex: 0 });
  assert.equal(hintText(a, 0, 1), "Viimeksi 13.11.: 5 toistoa");
  assert.equal(a.draft().exercises[0].sets[0].reps, "12");
  assert.equal(a.draft().exercises[0].sets[1].reps, "");
  await a.click("add-set", { ex: 0 });
  assert.equal(hintText(a, 0, 2), "Ei aiempaa vastaavaa sarjaa");
  assert.equal(a.draft().exercises[0].sets[2].reps, "");
});
await test("Name changes update reps hints even with protected manually edited weight/reps", async () => {
  const a = boot(history);
  await a.click("new-workout");
  await a.input("name", "Penkkipunnerrus");
  await a.input("weight", "123");
  await a.input("reps", "14");
  await a.click("add-set", { ex: 0 });
  await a.input("reps", "11", 0, 1);
  await a.input("name", "Kulmasoutu");
  assert.equal(a.weight(), "123");
  assert.equal(hintText(a, 0, 0), "Viimeksi 14.11.: 8 toistoa");
  assert.equal(hintText(a, 0, 1), "Ei aiempaa vastaavaa sarjaa");
  assert.deepEqual(
    a.draft().exercises[0].sets.map((s) => s.reps),
    ["14", "11"],
  );
  await a.input("name", "Tuntematon");
  assert.equal(hintText(a, 0, 0), "Ei aiempaa vastaavaa sarjaa");
  assert.equal(a.weight(), "123");
});
await test("Editing excludes current workout from historical reps and weight lookup", async () => {
  const initial = plain(history);
  initial.workouts.find((w) => w.id === "f1").exercises[0].sets[0].reps = 9;
  const a = boot(initial);
  await a.click("edit-workout", { id: "f2" });
  assert.equal(hintText(a, 1, 0), "Viimeksi 10.11.: 9 toistoa");
  assert.equal(hintText(a, 1, 1), "Ei aiempaa vastaavaa sarjaa");
  assert.equal(a.weight(1), "55");
  await a.click("add-exercise");
  await a.input("name", "Penkkipunnerrus", 2);
  assert.equal(a.weight(2), "40");
  assert.equal(hintText(a, 2, 0), "Viimeksi 10.11.: 9 toistoa");
});
await test("No prior matching movement shows missing history and keeps repetitions editable", async () => {
  const a = boot();
  await a.click("new-workout");
  await a.input("name", "Uusi liike");
  assert.equal(hintText(a, 0, 0), "Ei aiempaa vastaavaa sarjaa");
  assert.equal(a.weight(), "");
  assert.equal(a.draft().exercises[0].sets[0].reps, "");
  await a.input("reps", "17");
  await a.click("add-set", { ex: 0 });
  assert.equal(a.draft().exercises[0].sets[0].reps, "17");
  assert.equal(hintText(a, 0, 1), "Ei aiempaa vastaavaa sarjaa");
});

await test("Units default legacy weights to kg and switching converts each physical set independently", async () => {
  const a = boot(legacy);
  assert.equal(a.writes.length, 0);
  await a.click("new-workout");
  await a.input("name", "Penkkipunnerrus");
  assert.equal(a.unit(), "kg");
  await a.input("weight", "50");
  await a.click("add-set", { ex: 0 });
  await a.input("weight", "45", 0, 1);
  await a.input("reps", "12", 0, 1);
  await a.input("unit", "lbs", 0, 0, "change");
  assert.equal(a.unit(), "lbs");
  assert.ok(
    Math.abs(Number(a.weight().replace(",", ".")) * 0.45359237 - 50) < 0.01,
  );
  assert.ok(
    Math.abs(Number(a.weight(0, 1).replace(",", ".")) * 0.45359237 - 45) < 0.01,
  );
  assert.equal(a.draft().exercises[0].sets[1].reps, "12");
  await a.click("add-set", { ex: 0 });
  assert.equal(a.weight(0, 2), a.weight());
  await a.input("unit", "kg", 0, 0, "change");
  assert.equal(a.unit(), "kg");
  assert.ok(Math.abs(Number(a.weight().replace(",", ".")) - 50) < 0.01);
  assert.ok(Math.abs(Number(a.weight(0, 1).replace(",", ".")) - 45) < 0.01);
  assert.deepEqual(a.state(), legacy);
});
await test("Empty and zero weights survive unit switches and manual unit selection remains selectable", async () => {
  const a = boot();
  await a.click("new-workout");
  await a.input("unit", "lbs", 0, 0, "change");
  assert.equal(a.unit(), "lbs");
  assert.equal(a.weight(), "");
  await a.input("weight", "0");
  await a.input("unit", "kg", 0, 0, "change");
  assert.equal(Number(a.weight()), 0);
  await a.input("unit", "lbs", 0, 0, "change");
  assert.equal(Number(a.weight()), 0);
});
await test("Remembered exercise unit follows latest SAVE while first load/reps follow latest SESSION", async () => {
  const initial = plain(history);
  initial.workouts.find((w) => w.id === "saved-last").exercises[0].unit = "lbs";
  initial.workouts.find((w) => w.id === "f2").exercises[1].unit = "kg";
  const a = boot(initial);
  await a.click("new-workout");
  await a.input("name", " PENKKIPUNNERRUS ");
  assert.equal(a.unit(), "lbs");
  assert.ok(
    Math.abs(Number(a.weight().replace(",", ".")) * 0.45359237 - 55) < 0.01,
  );
  assert.equal(hintText(a, 0, 0), "Viimeksi 13.11.: 8 toistoa");
});
await test("Pounds save canonical kg, reopen remembered unit, and backup roundtrip/chart retain physical loads", async () => {
  const a = boot();
  await a.click("new-workout");
  await a.input("name", "Testiliike");
  await a.input("unit", "lbs", 0, 0, "change");
  await a.input("weight", "100");
  await a.input("reps", "8");
  await a.click("save-workout");
  const saved = a.state().workouts.at(-1).exercises[0];
  assert.equal(saved.unit, "lbs");
  assert.ok(Math.abs(saved.sets[0].weight - 45.359237) < 1e-6);
  assert.ok(
    Math.abs(a.api.exerciseSeries("Testiliike", "max")[0].value - 45.359237) <
      1e-6,
  );
  const b = boot(null, a.storage);
  await b.click("new-workout");
  await b.input("name", "testiliike");
  assert.equal(b.unit(), "lbs");
  assert.ok(Math.abs(Number(b.weight().replace(",", ".")) - 100) < 0.001);
  await b.click("export");
  const backup = JSON.parse(await b.blobs[0].text());
  const c = boot();
  await c.importBackup(backup);
  assert.equal(c.alerts.length, 0);
  assert.deepEqual(c.state().workouts[0].exercises, saved ? [saved] : []);
  await c.click("edit-workout", { id: c.state().workouts[0].id });
  assert.equal(c.unit(), "lbs");
  assert.ok(Math.abs(Number(c.weight().replace(",", ".")) - 100) < 0.001);
  await c.click("save-workout");
  assert.ok(
    Math.abs(c.state().workouts[0].exercises[0].sets[0].weight - 45.359237) <
      1e-6,
  );
});
await test("Category movement groups start collapsed and Forkut belongs in uncategorized browse only", async () => {
  const initial = plain(history);
  initial.workouts[1].exercises.push(ex("Forkut", 10));
  const a = boot(initial);
  await a.click(undefined, { tab: "workouts" });
  const groups = a.document.querySelectorAll("details.exercise-category");
  assert.deepEqual(
    groups.map((g) => g.dataset.category),
    ["Etukroppa", "Takakroppa", "uncategorized"],
  );
  assert.ok(groups.every((g) => !("open" in g.attributes) && !g.open));
  const html = a.mainHTML();
  const sections = [
    ...html.matchAll(
      /<details[^>]*data-category="([^"]+)"[^>]*>([\s\S]*?)<\/details>/g,
    ),
  ];
  assert.equal(sections.length, 3);
  const contents = Object.fromEntries(sections.map((m) => [m[1], m[2]]));
  assert.ok(contents.uncategorized.includes("Forkut"));
  assert.ok(!contents.Etukroppa.includes('data-name="Forkut"'));
  assert.ok(!contents.Takakroppa.includes('data-name="Forkut"'));
  assert.ok(contents.uncategorized.includes("Maastaveto"));
  assert.deepEqual(a.state(), initial);
  assert.equal(a.writes.length, 0);
  const b = boot();
  await b.click(undefined, { tab: "workouts" });
  assert.ok(b.mainHTML().includes("Forkut"));
  assert.deepEqual(b.state(), { workouts: [], sleep: [], weight: [] });
  assert.equal(b.writes.length, 0);
});

await test("Automatic rest timer starts after stable valid set, counts 3:00 to zero using deadline", async () => {
  const a = boot();
  await a.click("new-workout");
  await a.input("name", "Testiliike");
  await a.input("weight", "50");
  await a.clock.tick(1000);
  assert.equal(a.countdown(), null);
  await a.input("reps", "8");
  await a.clock.tick(799);
  assert.equal(a.countdown(), null);
  await a.clock.tick(1);
  assert.equal(a.countdown(), "3:00");
  assert.equal(a.document.querySelectorAll("[data-rest-countdown]").length, 2);
  await a.clock.tick(1000);
  assert.equal(a.countdown(), "2:59");
  await a.clock.tick(178000);
  assert.equal(a.countdown(), "0:01");
  await a.clock.tick(1000);
  assert.equal(a.countdown(), "0:00");
  assert.ok(a.document.querySelector(".rest-timer.finished"));
  await a.clock.tick(1000);
  assert.equal(a.countdown(), "0:00");
  assert.equal(a.writes.length, 0);
});
await test("Rest timer uses elapsed background time and renders correctly on visibility change", async () => {
  const a = boot();
  await a.click("new-workout");
  await a.input("name", "Testiliike");
  await a.input("weight", "0");
  await a.input("reps", "5");
  await a.clock.tick(800);
  assert.equal(a.countdown(), "3:00");
  a.clock.jump(185000);
  await a.emit("visibilitychange", a.document);
  assert.equal(a.countdown(), "0:00");
  assert.ok(a.document.querySelector(".rest-timer.finished"));
  await a.clock.tick(1000);
  assert.equal(a.countdown(), "0:00");
});
await test("Editing completed set does not restart rest; completing next set starts fresh rest", async () => {
  const a = boot();
  await a.click("new-workout");
  await a.input("name", "Testiliike");
  await a.input("weight", "50");
  await a.input("reps", "8");
  await a.clock.tick(800);
  await a.clock.tick(10000);
  assert.equal(a.countdown(), "2:50");
  await a.input("reps", "9");
  await a.input("weight", "55");
  await a.clock.tick(800);
  assert.equal(a.countdown(), "2:50");
  await a.click("add-set", { ex: 0 });
  assert.equal(a.countdown(), "2:50");
  await a.input("reps", "10", 0, 1);
  await a.clock.tick(800);
  assert.equal(a.countdown(), "3:00");
  assert.ok(
    a.document
      .getElementById("dialog-rest-timer-host-context")
      .textContent.includes("sarja 2"),
  );
});
await test("Rest cancel/restart work, close keeps active countdown and cancels pending start", async () => {
  const a = boot();
  await a.click("new-workout");
  await a.input("name", "Testiliike");
  await a.input("weight", "50");
  await a.input("reps", "8");
  await a.clock.tick(800);
  await a.clock.tick(5000);
  assert.equal(a.countdown(), "2:55");
  await a.click("rest-restart");
  assert.equal(a.countdown(), "3:00");
  await a.click("close");
  await a.clock.tick(1000);
  assert.equal(a.countdown(), "2:59");
  assert.equal(
    a.document.getElementById("rest-timer-host-countdown").textContent,
    "2:59",
  );
  await a.click("rest-cancel");
  assert.equal(a.countdown(), null);
  await a.clock.tick(200000);
  assert.equal(a.countdown(), null);
  const b = boot();
  await b.click("new-workout");
  await b.input("name", "Uusi");
  await b.input("weight", "20");
  await b.input("reps", "8");
  await b.click("close");
  await b.clock.tick(1000);
  assert.equal(b.countdown(), null);
});
await test("Invalid/partial set input and existing workout/unit changes never auto-start rest", async () => {
  const a = boot();
  await a.click("new-workout");
  await a.input("name", "Testiliike");
  await a.input("weight", "50");
  for (const reps of ["", "0", "1001", "2.5", "-3"]) {
    await a.input("reps", reps);
    await a.clock.tick(1000);
    assert.equal(a.countdown(), null);
  }
  await a.input("weight", "");
  await a.input("reps", "8");
  await a.clock.tick(1000);
  assert.equal(a.countdown(), null);
  for (const weight of ["-1", "2001", "abc"]) {
    await a.input("weight", weight);
    await a.clock.tick(1000);
    assert.equal(a.countdown(), null);
  }
  const b = boot(history);
  await b.click("edit-workout", { id: "f2" });
  await b.clock.tick(1000);
  assert.equal(b.countdown(), null);
  await b.input("unit", "lbs", 0, 0, "change");
  await b.clock.tick(1000);
  assert.equal(b.countdown(), null);
  await b.input("reps", "10");
  await b.clock.tick(1000);
  assert.equal(b.countdown(), null);
});
await test("Stable-set debounce resets on typing and successful quick save starts timer without editor flags", async () => {
  const a = boot();
  await a.click("new-workout");
  await a.input("name", "Testiliike");
  await a.input("reps", "8");
  await a.input("weight", "5");
  await a.clock.tick(500);
  await a.input("weight", "50");
  await a.clock.tick(500);
  assert.equal(a.countdown(), null);
  await a.clock.tick(300);
  assert.equal(a.countdown(), "3:00");
  const b = boot();
  await b.click("new-workout");
  await b.input("name", "Pikakirjaus");
  await b.input("weight", "40");
  await b.input("reps", "8");
  await b.click("save-workout");
  assert.equal(b.countdown(), "3:00");
  const saved = b.state().workouts[0].exercises[0].sets[0];
  assert.deepEqual(Object.keys(saved).sort(), ["reps", "weight"]);
  assert.equal(saved.weight, 40);
});

await test("Harness clock supports intervals, cancellation and background elapsed time", async () => {
  const a = boot();
  a.evaluate(
    "globalThis.clockTicks=[];globalThis.clockHandle=setInterval(()=>clockTicks.push(Date.now()),1000)",
  );
  const start = a.clock.now();
  await a.clock.tick(2500);
  assert.deepEqual(plain(a.evaluate("clockTicks")), [
    start + 1000,
    start + 2000,
  ]);
  a.evaluate("clearInterval(clockHandle)");
  a.clock.jump(180000);
  assert.equal(a.clock.now(), start + 182500);
  await a.clock.tick(1000);
  assert.equal(a.evaluate("clockTicks.length"), 2);
});
await test("Harness captures focused field options and independent scroll positions", async () => {
  const a = boot();
  await a.click("new-workout");
  const inner = a.document.querySelector(".dialog-inner");
  inner.scrollTop = 460;
  const input = a.document.getElementById("exercise-0");
  input.focus({ preventScroll: true });
  assert.equal(inner.scrollTop, 460);
  assert.equal(a.document.activeElement, input);
  assert.deepEqual(a.focusCalls.at(-1).options, { preventScroll: true });
  a.window.scrollTo({ top: 180 });
  assert.equal(a.window.scrollY, 180);
  assert.equal(a.scrollCalls.at(-1).target, "window");
});

// New sleep-session and viewport guards share the same dependency-free runner.
await import("./sleep-and-modal.test.mjs");

await import("./mobile-rest-settings.test.mjs");

await import("./charts.test.mjs");
