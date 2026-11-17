import test from "node:test";
import assert from "node:assert/strict";
import { boot, plain } from "./helpers/browser-harness.mjs";

const KG_PER_LB = 0.45359237;
const points = values => values.map((value, index) => ({ date: `2026-11-${String(index + 10).padStart(2, "0")}`, value }));
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should equal ${expected}`);
const checkBounds = (axis, values) => {
  assert.ok(Number.isFinite(axis.min) && Number.isFinite(axis.max));
  assert.ok(Number.isFinite(axis.step) && axis.step > 0);
  assert.ok(axis.max > axis.min);
  assert.ok(axis.min <= Math.min(...values) + 1e-9);
  assert.ok(axis.max >= Math.max(...values) - 1e-9);
  assert.ok(axis.ticks.length >= 2);
  assert.ok(axis.ticks.every(Number.isFinite));
  for (let index = 1; index < axis.ticks.length; index++) close(Math.abs(axis.ticks[index] - axis.ticks[index - 1]), axis.step);
};
const fixture = () => ({
  workouts: [], weight: [],
  sleep: [
    { id: "older-outside-period", date: "2026-08-01", bed: "19:00", wake: "05:00", duration: 10 },
    { id: "night-one", date: "2026-11-13", bed: "23:00", wake: "05:01", duration: 6 + 1 / 60 },
    { id: "night-two", date: "2026-11-14", bed: "23:00", wake: "06:02", duration: 7 + 2 / 60 },
    { id: "night-three", date: "2026-11-15", bed: "23:00", wake: "07:03", duration: 8 + 3 / 60 },
  ],
});
const sleepChartId = app => {
  const svg = app.document.getElementById("main").querySelector("svg[data-chart-svg]");
  assert.ok(svg, "Sleep page must render its interactive chart");
  return svg.dataset.chartSvg;
};
const point = (app, id, index) => {
  const node = app.document.getElementById(`${id}-point-${index}`);
  assert.ok(node, `Missing chart point ${id}/${index}`);
  return node;
};
const detailText = (app, id) => {
  const node = app.document.getElementById(`${id}-details`);
  assert.ok(node, `Missing chart details ${id}`);
  return node.textContent;
};
const fullDate = date => new Intl.DateTimeFormat("fi-FI", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${date}T12:00:00`));

await test("Sleep axis uses exact half-hour steps with hour/minute labels rather than decimal hours", () => {
  const app = boot();
  const values = [6.1, 6.9, 7.4];
  const axis = plain(app.api.chartAxis(points(values), "sleep"));
  checkBounds(axis, values);
  close(axis.step, 0.5);
  for (const tick of axis.ticks) close(tick * 2, Math.round(tick * 2));
  const html = app.api.chart(points(values), "sleep", "#7678b6", false, "all");
  assert.ok(html.includes("6 h 30 min"));
  assert.ok(!html.includes(">6,5</text>"));
  assert.equal(app.writes.length, 0);
});

await test("Bodyweight ticks use whole kilograms and single/near-zero charts remain bounded and nonnegative", () => {
  const app = boot();
  const body = plain(app.api.chartAxis(points([75.2, 78.7]), "weight", "kg"));
  checkBounds(body, [75.2, 78.7]);
  assert.equal(body.step, 1);
  assert.ok(body.ticks.every(Number.isInteger));
  for (const [metric, values] of [["weight", [0]], ["max", [0, 0.1]], ["sleep", [0.25]], ["weight", [75.2, 75.2]]]) {
    const axis = plain(app.api.chartAxis(points(values), metric, "kg"));
    checkBounds(axis, values);
    assert.ok(axis.min >= 0, `${metric} must not introduce negative ticks near zero`);
    assert.ok(axis.ticks.every(value => value >= 0));
  }
});

await test("Exercise tick thresholds apply at physical 5/10 kg ranges in both display units", () => {
  const app = boot();
  for (const [range, kgStep, lbsStep] of [[5, 1, 2], [5.001, 2.5, 5], [9.999, 2.5, 5], [10, 5, 10]]) {
    const kgValues = [50, 50 + range], lbsValues = kgValues.map(value => value / KG_PER_LB);
    const kgAxis = plain(app.api.chartAxis(points(kgValues), "max", "kg"));
    const lbsAxis = plain(app.api.chartAxis(points(lbsValues), "max", "lbs"));
    checkBounds(kgAxis, kgValues);
    checkBounds(lbsAxis, lbsValues);
    close(kgAxis.step, kgStep);
    close(lbsAxis.step, lbsStep);
  }
});

await test("Very wide load and volume ranges use readable tick counts while rep ticks remain integers", () => {
  const app = boot();
  for (const [metric, values, unit] of [["max", [20, 620], "kg"], ["max", [40, 1400], "lbs"], ["volume", [150, 12000], "kg"], ["reps", [1, 42], "kg"]]) {
    const axis = plain(app.api.chartAxis(points(values), metric, unit));
    checkBounds(axis, values);
    assert.ok(axis.ticks.length <= 10, `${metric}/${unit} has ${axis.ticks.length} crowded ticks`);
    if (metric === "reps") assert.ok(axis.ticks.every(Number.isInteger));
  }
});

await test("Sleep summary retains fractional-minute averages/deviations and handles empty and one-night periods", () => {
  const app = boot();
  const values = [6 + 1 / 60, 7 + 2 / 60, 8 + 4 / 60];
  const expected = values.reduce((sum, value) => sum + value, 0) / values.length;
  const summary = plain(app.api.sleepSummary(points(values)));
  assert.equal(summary.count, 3);
  close(summary.average, expected, 1e-12);
  close(summary.latestDifference, values.at(-1) - expected, 1e-12);
  assert.notEqual(summary.average, Math.round(summary.average * 60) / 60, "The mathematical average must not be rounded before comparisons");
  assert.deepEqual(plain(app.api.sleepSummary([])), { average: null, latestDifference: null, count: 0 });
  const one = plain(app.api.sleepSummary(points([6.25])));
  assert.deepEqual(one, { average: 6.25, latestDifference: 0, count: 1 });
});

await test("Sleep point click through its child circle shows date, bed/wake, duration and selected-period difference", async () => {
  const initial = fixture(), app = boot(initial), serialized = app.storage.get("kuntokayra_v1");
  await app.click(undefined, { tab: "sleep" });
  await app.click(undefined, { period: "30" });
  const id = sleepChartId(app), first = point(app, id, 0);
  assert.equal(first.getAttribute("role"), "button");
  assert.equal(first.getAttribute("tabindex"), "0");
  const circle = first.querySelector("circle");
  assert.ok(circle, "SVG hit target must contain a circle");
  assert.equal(circle.closest("[data-chart-point]"), first);
  await app.emit("click", circle);
  const text = detailText(app, id);
  assert.ok(text.includes(fullDate("2026-11-13")));
  assert.ok(text.includes("23:00") && text.includes("05:01"));
  assert.ok(text.includes("6 h 01 min"));
  assert.match(text, /[−-]\s*(?:61 min|1 h 0?1 min)/);
  assert.deepEqual(app.state(), initial);
  assert.equal(app.storage.get("kuntokayra_v1"), serialized);
  assert.equal(app.writes.length, 0);
});

await test("Chart points support Enter/Space and changing the interval recalculates the sleep comparison", async () => {
  const app = boot(fixture());
  await app.click(undefined, { tab: "sleep" });
  await app.click(undefined, { period: "30" });
  const initialId = sleepChartId(app);
  const enter = await app.emit("keydown", point(app, initialId, 2), { key: "Enter" });
  assert.equal(enter.defaultPrevented, true);
  assert.match(detailText(app, initialId), /\+\s*(?:61 min|1 h 0?1 min)/);
  const space = await app.emit("keydown", point(app, initialId, 1), { key: " " });
  assert.equal(space.defaultPrevented, true);
  assert.ok(detailText(app, initialId).includes("7 h 02 min"));
  await app.emit("click", point(app, initialId, 0).querySelector("circle"));
  const selectedPeriodDetail = detailText(app, initialId);
  await app.click(undefined, { period: "all" });
  const allId = sleepChartId(app);
  assert.equal(app.document.getElementById(`${allId}-details`), null);
  assert.equal(app.document.getElementById(allId).querySelectorAll("[data-chart-point]").length, 0);
  assert.ok(selectedPeriodDetail.includes("Nukkumaan"));
  // The earlier ten-hour night is included only after choosing All.
  const allMean = (10 + (6 + 1 / 60) + (7 + 2 / 60) + (8 + 3 / 60)) / 4;
  const summary = plain(app.api.sleepSummary(app.api.rawSeries("sleep")));
  close(summary.average, allMean, 1e-12);
  assert.equal(app.writes.length, 0);
});

await test("Enlarged chart opens in a dialog, keeps point interaction and closes without a storage write", async () => {
  const initial = fixture(), app = boot(initial);
  await app.click(undefined, { tab: "sleep" });
  await app.click(undefined, { period: "30" });
  const originalId = sleepChartId(app);
  const expand = app.document.getElementById("main").querySelector(`[data-action="expand-chart"][data-chart="${originalId}"]`);
  assert.ok(expand, "Chart needs an enlarge control");
  await app.emit("click", expand);
  const dialog = app.document.getElementById("entry-dialog");
  assert.ok(dialog.open);
  const svg = app.document.getElementById("dialog-content").querySelector("svg[data-chart-svg]");
  assert.ok(svg, "Dialog must contain the enlarged chart");
  const expandedId = svg.dataset.chartSvg;
  assert.notEqual(expandedId, originalId);
  await app.emit("click", point(app, expandedId, 0).querySelector("circle"));
  assert.ok(detailText(app, expandedId).includes("05:01"));
  await app.emit("keydown", point(app, expandedId, 2), { key: "Enter" });
  assert.ok(detailText(app, expandedId).includes("07:03"));
  await app.click("close");
  assert.equal(dialog.open, false);
  assert.deepEqual(app.state(), initial);
  assert.equal(app.writes.length, 0);
});

await test("Bodyweight and exercise point readouts retain their displayed units without sleep-average text", async () => {
  const initial = {
    ...fixture(),
    weight: [{ id: "body-one", date: "2026-11-13", value: 75.2 }, { id: "body-two", date: "2026-11-14", value: 76.1 }],
    workouts: [
      { id: "exercise-one", date: "2026-11-13", category: "Etukroppa", savedAt: "2026-11-13T12:00:00.000Z", exercises: [{ name: "Testipunnerrus", unit: "lbs", sets: [{ weight: 100 * KG_PER_LB, reps: 8 }] }] },
      { id: "exercise-two", date: "2026-11-14", category: "Etukroppa", savedAt: "2026-11-14T12:00:00.000Z", exercises: [{ name: "Testipunnerrus", unit: "lbs", sets: [{ weight: 110 * KG_PER_LB, reps: 7 }] }] },
    ],
  };
  const app = boot(initial);
  await app.click(undefined, { tab: "weight" });
  await app.click(undefined, { period: "30" });
  let id = sleepChartId(app);
  await app.emit("click", point(app, id, 0).querySelector("circle"));
  assert.ok(detailText(app, id).includes("75,2 kg"));
  assert.ok(!/keskiarvo/i.test(detailText(app, id)));
  await app.click("view-exercise", { name: "Testipunnerrus" });
  id = sleepChartId(app);
  await app.emit("keydown", point(app, id, 0), { key: "Enter" });
  assert.ok(detailText(app, id).includes("100 lbs"));
  assert.ok(!/keskiarvo/i.test(detailText(app, id)));
  assert.deepEqual(app.state(), initial);
  assert.equal(app.writes.length, 0);
});

const footer = app => Object.fromEntries(app.document.getElementById("main").querySelectorAll(".detail-stat").map(cell => [cell.querySelector("span").textContent, cell.querySelector("strong").textContent]));

await test("Sleep footer shows the selected-period mean instead of first value in both sleep views", async () => {
  const app = boot(fixture());
  await app.click(undefined, { tab: "sleep" });
  let stats = footer(app);
  assert.deepEqual(Object.keys(stats), ["Aikavälin keskiarvo", "Viimeisin yö", "Ero keskiarvosta"]);
  assert.equal(stats["Aikavälin keskiarvo"], "7 h 02 min");
  assert.equal(stats["Viimeisin yö"], "8 h 03 min");
  await app.click(undefined, { period: "all" });
  stats = footer(app);
  // Durations are exactly 600, 361, 422 and 483 minutes: mean 466.5 min.
  assert.equal(stats["Aikavälin keskiarvo"], "7 h 47 min");
  assert.equal(stats["Ero keskiarvosta"], "+17 min");
  await app.click(undefined, { tab: "progress" });
  await app.click(undefined, { metric: "sleep" });
  assert.deepEqual(footer(app), stats);
  await app.click(undefined, { metric: "weight" });
  assert.deepEqual(Object.keys(footer(app)), ["Ensimmäinen", "Viimeisin", "Muutos"]);
  assert.equal(app.writes.length, 0);
});

await test("Single-night and empty sleep footers show a true zero difference or empty placeholders", async () => {
  for (const [sleep, expected] of [
    [[{ id: "single", date: "2026-11-15", bed: "23:00", wake: "05:15", duration: 6.25 }], { "Aikavälin keskiarvo": "6 h 15 min", "Viimeisin yö": "6 h 15 min", "Ero keskiarvosta": "0 min" }],
    [[], { "Aikavälin keskiarvo": "—", "Viimeisin yö": "—", "Ero keskiarvosta": "—" }],
  ]) {
    const app = boot({ workouts: [], weight: [], sleep });
    await app.click(undefined, { tab: "sleep" });
    assert.deepEqual(footer(app), expected);
    assert.equal(app.document.getElementById("main").querySelectorAll("[data-chart-svg]").length, sleep.length ? 1 : 0);
    assert.equal(app.writes.length, 0);
  }
});

await test("Chart registry stays bounded across rerenders and releases each enlarged chart on close", async () => {
  const app = boot(fixture());
  await app.click(undefined, { tab: "sleep" });
  for (let index = 0; index < 12; index++) {
    const interval = index % 2 ? "all" : "30";
    await app.click(undefined, { period: interval });
    assert.equal(app.api.getCharts().size, 1);
    const id = sleepChartId(app);
    await app.click("expand-chart", { chart: id });
    assert.equal(app.api.getCharts().size, 2);
    const expandedId = app.document.getElementById("dialog-content").querySelector("[data-chart-svg]").dataset.chartSvg;
    assert.ok(app.api.getCharts().has(expandedId));
    await app.click("close");
    assert.equal(app.api.getCharts().size, 1);
    assert.equal(app.api.getCharts().has(expandedId), false);
    assert.ok(app.api.getCharts().has(id));
    if (interval === "30") {
      await app.emit("keydown", point(app, id, 0), { key: "Enter" });
      assert.ok(detailText(app, id).includes("Nukkumaan"));
    } else {
      assert.equal(app.document.getElementById(`${id}-details`), null);
    }
  }
  await app.click(undefined, { tab: "settings" });
  assert.equal(app.api.getCharts().size, 0);
  assert.equal(app.writes.length, 0);
});

await test("Sleep spans through sixteen hours keep half-hour ticks and duplicate-date details follow record identity", async () => {
  const app = boot();
  const axis = plain(app.api.chartAxis(points([1 / 60, 16]), "sleep"));
  assert.equal(axis.step, 0.5);
  assert.equal(axis.min, 0);
  assert.equal(axis.max, 17);
  assert.equal(axis.ticks.length, 35);
  const initial = {
    workouts: [], weight: [], sleep: [
      { id: "same-date-a", date: "2026-11-15", bed: "22:00", wake: "05:00", duration: 7 },
      { id: "same-date-b", date: "2026-11-15", bed: "23:00", wake: "06:00", duration: 7 },
    ],
  };
  const duplicate = boot(initial);
  await duplicate.click(undefined, { tab: "sleep" });
  await duplicate.click(undefined, { period: "30" });
  const id = sleepChartId(duplicate), entry = duplicate.api.getCharts().get(id);
  for (let index = 0; index < entry.data.length; index++) {
    const record = initial.sleep.find(row => row.id === entry.data[index].recordId);
    assert.ok(record);
    await duplicate.emit("keydown", point(duplicate, id, index), { key: "Enter" });
    const text = detailText(duplicate, id);
    assert.ok(text.includes(record.bed) && text.includes(record.wake));
  }
  assert.deepEqual(duplicate.state(), initial);
  assert.equal(duplicate.writes.length, 0);
});

await test("Arrow keys move chart focus and pressed state with bounded endpoints without scrolling", async () => {
  const app = boot(fixture());
  await app.click(undefined, { tab: "sleep" });
  await app.click(undefined, { period: "30" });
  const id = sleepChartId(app), first = point(app, id, 0), middle = point(app, id, 1), last = point(app, id, 2);
  first.focus();
  let event = await app.emit("keydown", first, { key: "ArrowRight" });
  assert.equal(event.defaultPrevented, true);
  assert.equal(app.document.activeElement, middle);
  assert.equal(middle.getAttribute("aria-pressed"), "true");
  assert.equal(last.getAttribute("aria-pressed"), "false");
  assert.equal(app.focusCalls.at(-1).options.preventScroll, true);
  await app.emit("keydown", middle, { key: "ArrowLeft" });
  assert.equal(app.document.activeElement, first);
  await app.emit("keydown", first, { key: "ArrowLeft" });
  assert.equal(app.document.activeElement, first);
  await app.emit("keydown", last, { key: "ArrowRight" });
  assert.equal(app.document.activeElement, last);
  event = await app.emit("keydown", last, { key: "Tab" });
  assert.equal(event.defaultPrevented, false);
  assert.equal(app.writes.length, 0);
});

await test("A pointer inside an overlapping target selects the geometrically nearest visible point", async () => {
  const app = boot(fixture());
  await app.click(undefined, { tab: "sleep" });
  await app.click(undefined, { period: "30" });
  const id = sleepChartId(app), entry = app.api.getCharts().get(id);
  const svg = app.document.getElementById(`${id}-svg`);
  const rect = { left: 80, top: 120, width: entry.W / 2, height: entry.H / 2 };
  svg.getBoundingClientRect = () => rect;
  const [x, y] = entry.coords[0];
  // Simulate a later SVG group's transparent target receiving a tap that is
  // actually nearest to the first point after scaling into the viewBox.
  await app.emit("click", point(app, id, 2).querySelector("circle"), {
    detail: 1,
    clientX: rect.left + (x + 0.1) * rect.width / entry.W,
    clientY: rect.top + (y + 0.1) * rect.height / entry.H,
  });
  assert.equal(entry.selectedIndex, 0);
  assert.ok(detailText(app, id).includes("05:01"));
  assert.equal(point(app, id, 0).getAttribute("aria-pressed"), "true");
  assert.equal(app.writes.length, 0);
});

await test("SVG screen mapping respects centered letterboxing and an affine screen matrix", async () => {
  const initial = {
    workouts: [], weight: [], sleep: [
      { id: "six", date: "2026-11-15", bed: "22:00", wake: "04:00", duration: 6 },
      { id: "seven", date: "2026-11-15", bed: "22:00", wake: "05:00", duration: 7 },
      { id: "eight", date: "2026-11-15", bed: "22:00", wake: "06:00", duration: 8 },
    ],
  };
  const app = boot(initial);
  await app.click(undefined, { tab: "sleep" });
  await app.click(undefined, { period: "30" });
  const id = sleepChartId(app), entry = app.api.getCharts().get(id);
  const svg = app.document.getElementById(`${id}-svg`);
  const wanted = entry.data.findIndex(row => row.value === 6);
  const wrong = entry.data.findIndex(row => row.value === 8);
  const [x, y] = entry.coords[wanted];
  const rect = { left: 50, top: 70, width: entry.W / 2, height: entry.H * 2 + 100 };
  svg.getBoundingClientRect = () => rect;
  // xMidYMid meet fits width and centers the short SVG drawing vertically.
  // Ignoring the blank bands would select the middle, seven-hour point.
  const scale = rect.width / entry.W;
  await app.emit("click", point(app, id, wrong).querySelector("circle"), {
    detail: 1,
    clientX: rect.left + x * scale,
    clientY: rect.top + (rect.height - entry.H * scale) / 2 + y * scale,
  });
  assert.equal(entry.selectedIndex, wanted);
  assert.ok(detailText(app, id).includes("04:00"));

  // A browser supplies the actual drawing-to-screen matrix; include translation,
  // shear, and differing x/y scales so a bounding-box shortcut cannot pass.
  const matrix = { a: 0.7, b: 0.2, c: -0.1, d: 0.5, e: 80, f: 120 };
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  let inverseCalls = 0, transformCalls = 0;
  svg.getScreenCTM = () => ({
    ...matrix,
    inverse() {
      inverseCalls++;
      return {
        a: matrix.d / determinant, b: -matrix.b / determinant,
        c: -matrix.c / determinant, d: matrix.a / determinant,
        e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
        f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
      };
    },
  });
  svg.createSVGPoint = () => ({
    x: 0, y: 0,
    matrixTransform(inverse) {
      transformCalls++;
      return { x: inverse.a * this.x + inverse.c * this.y + inverse.e, y: inverse.b * this.x + inverse.d * this.y + inverse.f };
    },
  });
  const matrixTarget = entry.data.findIndex(row => row.value === 7);
  const [mx, my] = entry.coords[matrixTarget];
  await app.emit("click", point(app, id, wrong).querySelector("circle"), {
    detail: 1,
    clientX: matrix.a * mx + matrix.c * my + matrix.e,
    clientY: matrix.b * mx + matrix.d * my + matrix.f,
  });
  assert.equal(inverseCalls, 1);
  assert.equal(transformCalls, 1);
  assert.equal(entry.selectedIndex, matrixTarget);
  assert.ok(detailText(app, id).includes("05:00"));
  assert.deepEqual(app.state(), initial);
  assert.equal(app.writes.length, 0);
});

await test("Axes reserve two final tick steps above and below measurements, clamping the lower edge at zero", () => {
  const app = boot();
  const examples = [
    ["sleep", "kg", [6.1, 7.4], 0.5, 5, 8.5],
    ["weight", "kg", [75.2, 78.7], 1, 73, 81],
    ["max", "kg", [50, 56], 2.5, 45, 62.5],
    ["max", "kg", [50, 60], 5, 40, 70],
    ["max", "lbs", [100, 125], 10, 80, 150],
    ["reps", "kg", [1, 8], 1, 0, 10],
    ["weight", "kg", [70.2], 1, 68, 73],
    ["max", "kg", [0], 1, 0, 2],
  ];
  for (const [metric, unit, values, step, min, max] of examples) {
    const axis = plain(app.api.chartAxis(points(values), metric, unit));
    checkBounds(axis, values);
    close(axis.step, step);
    close(axis.min, min);
    close(axis.max, max);
  }
  const wide = plain(app.api.chartAxis(points([20, 620]), "max", "kg"));
  assert.ok(wide.step >= 5);
  close(wide.max, Math.ceil(620 / wide.step) * wide.step + 2 * wide.step);
  close(wide.min, Math.max(0, Math.floor(20 / wide.step) * wide.step - 2 * wide.step));
  assert.equal(app.writes.length, 0);
});

await test("Every nonmonthly interval renders only an overview and guards delegated selection in normal and enlarged charts", async () => {
  const initial = fixture(), app = boot(initial);
  await app.click(undefined, { tab: "sleep" });
  for (const interval of ["90", "180", "365", "all"]) {
    await app.click(undefined, { period: interval });
    const id = sleepChartId(app);
    await assertOverview(id);
    await app.click("expand-chart", { chart: id });
    const expandedId = app.document.getElementById("dialog-content").querySelector("[data-chart-svg]").dataset.chartSvg;
    await assertOverview(expandedId);
    await app.click("close");
  }
  assert.deepEqual(app.state(), initial);
  assert.equal(app.writes.length, 0);

  async function assertOverview(id) {
    const entry = app.api.getCharts().get(id), region = app.document.getElementById(id);
    assert.equal(entry.interactive, false);
    assert.equal(region.querySelectorAll("[data-chart-point]").length, 0);
    assert.equal(app.document.getElementById(`${id}-details`), null);
    const originalIndex = entry.selectedIndex;
    const fakePoint = app.document.createElement("g");
    fakePoint.setAttribute("data-chart-point", id);
    fakePoint.dataset.chartPoint = id;
    fakePoint.dataset.index = "0";
    await app.emit("click", fakePoint);
    for (const key of ["Enter", " ", "ArrowRight", "ArrowLeft"]) {
      const event = await app.emit("keydown", fakePoint, { key });
      assert.equal(event.defaultPrevented, false);
    }
    const svg = app.document.getElementById(`${id}-svg`);
    await app.emit("click", svg, { detail: 1, clientX: 100, clientY: 100 });
    assert.equal(entry.selectedIndex, originalIndex);
    assert.equal(app.document.getElementById(`${id}-details`), null);
  }
});

await test("Normal and enlarged charts reflow their viewBox to available width while keeping all measurements in bounds", async () => {
  const initial = fixture(), app = boot(initial);
  await app.click(undefined, { tab: "sleep" });
  await app.click(undefined, { period: "30" });
  const id = sleepChartId(app);
  await verifyReflow(id, [260, 320, 720]);
  await app.click("expand-chart", { chart: id });
  const expandedId = app.document.getElementById("dialog-content").querySelector("[data-chart-svg]").dataset.chartSvg;
  await verifyReflow(expandedId, [280, 360, 950]);
  await app.click("close");
  assert.deepEqual(app.state(), initial);
  assert.equal(app.writes.length, 0);

  async function verifyReflow(id, widths) {
    const plot = app.document.getElementById(`${id}-plot`);
    assert.ok(plot, "Responsive chart needs a measurable plot container");
    for (const width of widths) {
      plot.getBoundingClientRect = () => ({ left: 0, top: 0, width, height: 400 });
      await app.emitWindow("resize");
      await app.clock.tick(20);
      const entry = app.api.getCharts().get(id), svg = app.document.getElementById(`${id}-svg`);
      close(entry.W, width);
      const box = svg.getAttribute("viewBox").split(/\s+/).map(Number);
      assert.deepEqual(box, [0, 0, entry.W, entry.H]);
      for (const [x, y] of entry.coords) {
        assert.ok(x >= 0 && x <= width, `x=${x} must fit width=${width}`);
        assert.ok(y >= 0 && y <= entry.H, `y=${y} must fit height=${entry.H}`);
      }
      assert.equal(entry.interactive, true);
    }
  }
});
