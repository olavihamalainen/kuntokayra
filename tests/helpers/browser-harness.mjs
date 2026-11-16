// Minimal DOM/localStorage/clock test doubles; this is not a browser engine.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

// Load the production app relative to this module, independent of cwd.
const appPath = fileURLToPath(new URL("../../app.js", import.meta.url));
const appSource = fs.readFileSync(appPath, "utf8");
assert.match(
  appSource,
  /\}\)\(\);\s*$/,
  "Update test instrumentation if the app IIFE wrapper changes",
);
// Only this in-memory test copy exposes state; app.js is never modified.
const source = appSource.replace(
  /\}\)\(\);\s*$/,
  `globalThis.__test = {getState:()=>state,getDraft:()=>workoutDraft,exerciseSeries,rawSeries,validateBackup,openWorkout,renderWorkoutEditor};\n})();`,
);
export const plain = (value) => JSON.parse(JSON.stringify(value));
const decode = (value) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const key = "kuntokayra_v1";

export function boot(initial, existingStorage) {
  const storage =
    existingStorage ||
    new Map([
      [key, JSON.stringify(initial || { workouts: [], sleep: [], weight: [] })],
    ]);
  const writes = [],
    nodes = [],
    ids = new Map(),
    listeners = new Map(),
    windowListeners = new Map(),
    blobs = [],
    alerts = [],
    downloads = [],
    focusCalls = [],
    scrollCalls = [];
  // Deterministic clock shared by Date and timers. jumpClock intentionally models
  // elapsed background time without callbacks; tick then catches up pending work.
  let clockNow = Date.parse("2026-11-16T12:00:00.000Z"),
    timerSeq = 0;
  const clockOrigin = clockNow,
    timers = new Map();
  class ClockDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clockNow]));
    }
    static now() {
      return clockNow;
    }
  }
  function schedule(callback, delay, repeat, args) {
    const interval = Math.max(repeat ? 1 : 0, Number(delay) || 0),
      handle = ++timerSeq;
    timers.set(handle, {
      callback,
      args,
      at: clockNow + interval,
      interval: repeat ? interval : 0,
    });
    return handle;
  }
  const tick = async (milliseconds) => {
    const target = clockNow + milliseconds;
    let callbacks = 0;
    while (true) {
      const next = [...timers.entries()]
        .filter(([, job]) => job.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      if (++callbacks > 100000) throw Error("Fake-clock callback runaway");
      const [handle, job] = next;
      clockNow = Math.max(clockNow, job.at);
      if (job.interval) job.at = clockNow + job.interval;
      else timers.delete(handle);
      if (typeof job.callback !== "function")
        throw Error("Fake timers require a callback function");
      await job.callback(...job.args);
    }
    clockNow = target;
    await Promise.resolve();
  };
  let confirmation = true,
    storageFailure = false;
  function matches(node, selector) {
    return selector.split(",").some((part) => {
      part = part.trim();
      const tag = part.match(/^[\w-]+/)?.[0];
      if (tag && node.tagName !== tag.toLowerCase()) return false;
      const id = part.match(/#([\w-]+)/)?.[1];
      if (id && node.id !== id) return false;
      for (const c of part.matchAll(/\.([\w-]+)/g))
        if (
          !String(node.className || "")
            .split(" ")
            .includes(c[1])
        )
          return false;
      for (const a of part.matchAll(
        /\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g,
      )) {
        if (!(a[1] in node.attributes)) return false;
        if (a[2] !== undefined && node.attributes[a[1]] !== a[2]) return false;
      }
      return true;
    });
  }
  class Element {
    constructor(tag = "div", attrs = {}) {
      this.tagName = tag;
      this.attributes = attrs;
      this.dataset = {};
      this.listeners = new Map();
      this.value = attrs.value || "";
      this.id = attrs.id || "";
      this.className = attrs.class || "";
      this.textContent = "";
      this.open = "open" in attrs;
      this.children = [];
      for (const [k, v] of Object.entries(attrs))
        if (k.startsWith("data-"))
          this.dataset[
            k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
          ] = v;
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.scrollTop = 0;
      this.scrollLeft = 0;
      this.scrollHeight = 1600;
      this.clientHeight = 600;
      this.hidden = "hidden" in attrs;
      this.parentElement = null;
      if (this.id) ids.set(this.id, this);
      nodes.push(this);
    }
    set innerHTML(html) {
      this._html = html;
      const removeTree = (old) => {
        for (const child of old.children) removeTree(child);
        const i = nodes.indexOf(old);
        if (i >= 0) nodes.splice(i, 1);
        if (old.id && ids.get(old.id) === old) ids.delete(old.id);
      };
      for (const old of this.children) removeTree(old);
      this.children = [];
      for (const tag of html.matchAll(
        /<(input|button|select|option|datalist|div|p|span|section|article|details|summary|output|label|strong|small|aside)\b([^>]*)>/g,
      )) {
        const attrs = {};
        for (const a of tag[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))
          attrs[a[1]] = decode(a[2] || "");
        const node = new Element(tag[1], attrs);
        node.parentElement = this;
        node.textContent = decode(
          html.slice(tag.index + tag[0].length).split("<")[0],
        );
        this.children.push(node);
      }
      for (const select of this.children.filter(
        (n) => n.tagName === "select",
      )) {
        const block =
          html.match(
            new RegExp(
              `<select[^>]*id="${select.id}"[^>]*>([\\s\\S]*?)<\\/select>`,
            ),
          )?.[1] || "";
        const options = [...block.matchAll(/<option\b([^>]*)>/g)].map((m) => {
          const at = {};
          for (const a of m[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g))
            at[a[1]] = decode(a[2] || "");
          return at;
        });
        select.value =
          (options.find((o) => "selected" in o) || options[0])?.value || "";
      }
    }
    get innerHTML() {
      return this._html || "";
    }
    querySelector(sel) {
      return nodes.find((n) => matches(n, sel)) || null;
    }
    querySelectorAll(sel) {
      return nodes.filter((n) => matches(n, sel));
    }
    closest(sel) {
      return matches(this, sel) ? this : null;
    }
    addEventListener(type, fn) {
      const list = this.listeners.get(type) || [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    focus(options = {}) {
      document.activeElement = this;
      focusCalls.push({
        id: this.id,
        tag: this.tagName,
        dataset: { ...this.dataset },
        options: { ...options },
      });
    }
    blur() {
      if (document.activeElement === this) document.activeElement = null;
    }
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
      for (const fn of this.listeners.get("close") || [])
        fn({ target: this, type: "close" });
    }
    scrollIntoView(options = {}) {
      scrollCalls.push({
        target: this.id || this.className,
        method: "scrollIntoView",
        options,
      });
    }
    scrollTo(options, y) {
      const details =
        typeof options === "object" ? options : { left: options, top: y };
      if (details.top !== undefined) this.scrollTop = details.top;
      if (details.left !== undefined) this.scrollLeft = details.left;
      scrollCalls.push({
        target: this.id || this.className,
        method: "scrollTo",
        options: details,
      });
    }
    scrollBy(options) {
      this.scrollTo({
        top: this.scrollTop + (options.top || 0),
        left: this.scrollLeft + (options.left || 0),
      });
    }
    getBoundingClientRect() {
      return {
        top: 0,
        bottom: 40,
        left: 0,
        right: 300,
        width: 300,
        height: 40,
      };
    }
    getAttribute(name) {
      return this.attributes[name] ?? null;
    }
    removeAttribute(name) {
      delete this.attributes[name];
    }
    append(node) {
      this.children.push(node);
    }
    remove() {}
    click() {
      if (this.tagName === "a")
        downloads.push({ href: this.href, download: this.download });
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
    }
  }
  for (const id of [
    "main",
    "entry-dialog",
    "dialog-content",
    "header-date",
    "desktop-nav",
    "mobile-nav",
    "toast",
    "import-file",
    "rest-timer-host",
  ])
    new Element("div", { id });
  new Element("button", { class: "settings-button" });
  const body = new Element("body");
  const document = {
    activeElement: null,
    hidden: false,
    visibilityState: "visible",
    getElementById: (id) => ids.get(id) || null,
    querySelector: (sel) => nodes.find((n) => matches(n, sel)) || null,
    querySelectorAll: (sel) => nodes.filter((n) => matches(n, sel)),
    createElement: (tag) => new Element(tag),
    body,
    addEventListener(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
  };
  const localStorage = {
    getItem: (k) => storage.get(k) || null,
    setItem: (k, v) => {
      if (storageFailure) throw Error("QuotaExceededError");
      writes.push([k, v]);
      storage.set(k, v);
    },
    removeItem: (k) => {
      writes.push(["remove", k]);
      storage.delete(k);
    },
    clear: () => {
      writes.push(["clear"]);
      storage.clear();
    },
  };
  const browserWindow = {
    scrollY: 0,
    scrollX: 0,
    pageYOffset: 0,
    addEventListener(type, fn) {
      const list = windowListeners.get(type) || [];
      list.push(fn);
      windowListeners.set(type, list);
    },
    scrollTo(options, y) {
      const details =
        typeof options === "object" ? options : { left: options, top: y };
      this.scrollY = details.top ?? this.scrollY;
      this.pageYOffset = this.scrollY;
      this.scrollX = details.left ?? this.scrollX;
      scrollCalls.push({
        target: "window",
        method: "scrollTo",
        options: details,
      });
    },
  };
  const context = vm.createContext({
    document,
    localStorage,
    navigator: {},
    window: browserWindow,
    Intl,
    Date: ClockDate,
    Blob,
    crypto: webcrypto,
    performance: { now: () => clockNow - clockOrigin },
    URL: {
      createObjectURL(blob) {
        blobs.push(blob);
        return `blob:test-${blobs.length}`;
      },
      revokeObjectURL() {},
    },
    setTimeout: (fn, delay, ...args) => schedule(fn, delay, false, args),
    clearTimeout: (handle) => timers.delete(handle),
    setInterval: (fn, delay, ...args) => schedule(fn, delay, true, args),
    clearInterval: (handle) => timers.delete(handle),
    requestAnimationFrame: (fn) =>
      schedule(() => fn(clockNow - clockOrigin), 16, false, []),
    cancelAnimationFrame: (handle) => timers.delete(handle),
    confirm: () => confirmation,
    alert: (message) => alerts.push(message),
    console,
  });
  vm.runInContext(source, context, { filename: appPath });
  const emit = async (type, target) => {
    for (const fn of listeners.get(type) || [])
      await fn({ target, preventDefault() {} });
  };
  const input = async (field, value, ex = 0, set = 0, type = "input") => {
    const selector =
      field === "category"
        ? "#workout-category"
        : field === "date"
          ? "#workout-date"
          : `[data-draft="${field}"][data-ex="${ex}"]${["name", "unit"].includes(field) ? "" : `[data-set="${set}"]`}`;
    const el = document.querySelector(selector);
    assert.ok(el, `Missing input ${selector}`);
    el.value = String(value);
    await emit(type, el);
    return el;
  };
  const click = async (action, data = {}) => {
    const node = new Element("button", {
      ...(action ? { "data-action": action } : {}),
      ...Object.fromEntries(
        Object.entries(data).map(([k, v]) => ["data-" + k, String(v)]),
      ),
    });
    await emit("click", node);
  };
  const importBackup = async (payload) => {
    const el = document.getElementById("import-file");
    el.files = [{ size: 100, text: async () => JSON.stringify(payload) }];
    for (const fn of el.listeners.get("change") || []) await fn({ target: el });
  };
  return {
    document,
    window: browserWindow,
    storage,
    writes,
    blobs,
    alerts,
    downloads,
    focusCalls,
    scrollCalls,
    clock: {
      tick,
      jump: (milliseconds) => (clockNow += milliseconds),
      now: () => clockNow,
      timerCount: () => timers.size,
    },
    evaluate: (code) => vm.runInContext(code, context),
    emitWindow: async (type) => {
      for (const fn of windowListeners.get(type) || []) await fn({ type });
    },
    click,
    input,
    emit,
    importBackup,
    api: context.__test,
    setStorageFailure: (value) => (storageFailure = value),
    setConfirmation: (value) => (confirmation = value),
    state: () => plain(context.__test.getState()),
    draft: () => plain(context.__test.getDraft()),
    html: () => document.getElementById("dialog-content").innerHTML,
    countdown: () =>
      document.querySelector("[data-rest-countdown]")?.textContent ?? null,
    unit: (ex = 0) => document.getElementById(`exercise-unit-${ex}`)?.value,
    mainHTML: () => document.getElementById("main").innerHTML,
    weight: (ex = 0, set = 0) =>
      document.querySelector(
        `[data-draft="weight"][data-ex="${ex}"][data-set="${set}"]`,
      )?.value,
    options: () =>
      [
        ...(
          document.getElementById("exercise-suggestions")?.innerHTML ||
          "" ||
          document
            .getElementById("dialog-content")
            .innerHTML.match(
              /<datalist id="exercise-suggestions">([\s\S]*?)<\/datalist>/,
            )?.[1] ||
          ""
        ).matchAll(/<option value="([^"]*)"/g),
      ].map((m) => decode(m[1])),
  };
}
