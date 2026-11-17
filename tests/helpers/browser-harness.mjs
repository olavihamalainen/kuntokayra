// Minimal DOM/localStorage/clock test doubles; this is not a browser engine.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";

// Load the production app relative to this module, independent of cwd.
const appPath = fileURLToPath(new URL("../../app.js", import.meta.url));
const appSource = fs.readFileSync(appPath, "utf8");
const garminCorePath = fileURLToPath(new URL("../../garmin-core.js", import.meta.url));
const garminCoreSource = fs.existsSync(garminCorePath) ? fs.readFileSync(garminCorePath, "utf8") : null;
assert.match(
  appSource,
  /\}\)\(\);\s*$/,
  "Update test instrumentation if the app IIFE wrapper changes",
);
// Only this in-memory test copy exposes state; app.js is never modified.
const source = appSource.replace(
  /\}\)\(\);\s*$/,
  `globalThis.__test = {getState:()=>state,getDraft:()=>workoutDraft,exerciseSeries,rawSeries,validateBackup,openWorkout,renderWorkoutEditor,chartAxis,sleepSummary,chart,getCharts:()=>charts,getGarminCore:()=>globalThis.KuntokayraGarmin,garminWindow:()=>garminWindow(),loadGarminConnection:()=>loadGarminConnection(),syncGarmin:(options)=>syncGarmin(options),disconnectGarmin:()=>disconnectGarmin()};\n})();`,
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

export function boot(initial, existingStorage, options = {}) {
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
    confirmations = [],
    eventRegistrations = [],
    focusCalls = [],
    scrollCalls = [],
    fetchCalls = [];
  let fetchHandler = options.fetch || (() => { throw Error("Network disabled in test harness"); });
  const fakeFetch = async (input, init = {}) => {
    fetchCalls.push({ url: String(input), options: init });
    return fetchHandler(input, init);
  };
  // Deterministic clock shared by Date and timers. jumpClock intentionally models
  // elapsed background time without callbacks; tick then catches up pending work.
  let clockNow = options.now ?? Date.parse("2026-11-16T12:00:00.000Z"),
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
      this.style = {
        position: "",
        top: "",
        width: "",
        left: "",
        right: "",
        overflow: "",
        height: "",
      };
      Object.defineProperties(this.style, {
        setProperty: {
          value(name, value) {
            this[name.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] =
              String(value);
          },
        },
        getPropertyValue: {
          value(name) {
            return (
              this[
                name.replace(/-([a-z])/g, (_, char) => char.toUpperCase())
              ] || ""
            );
          },
        },
        removeProperty: {
          value(name) {
            const property = name.replace(/-([a-z])/g, (_, char) =>
                char.toUpperCase(),
              ),
              previous = this[property] || "";
            this[property] = "";
            return previous;
          },
        },
      });
      const updateClasses = (values) => {
        this.className = [...values].join(" ");
        this.attributes.class = this.className;
      };
      this.classList = {
        add: (...names) =>
          updateClasses(
            new Set([...this.className.split(/\s+/).filter(Boolean), ...names]),
          ),
        remove: (...names) =>
          updateClasses(
            new Set(
              this.className
                .split(/\s+/)
                .filter((name) => name && !names.includes(name)),
            ),
          ),
        contains: (name) => this.className.split(/\s+/).includes(name),
        toggle: (name, force) => {
          const values = new Set(this.className.split(/\s+/).filter(Boolean));
          const added =
            force === undefined ? !values.has(name) : Boolean(force);
          if (added) values.add(name);
          else values.delete(name);
          updateClasses(values);
          return added;
        },
      };
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
      this._textContent = "";
      const removeTree = (old) => {
        for (const child of old.children) removeTree(child);
        const index = nodes.indexOf(old);
        if (index >= 0) nodes.splice(index, 1);
        if (old.id && ids.get(old.id) === old) ids.delete(old.id);
      };
      for (const old of this.children) removeTree(old);
      this.children = [];
      const stack = [this], parsed = [];
      const voidTags = new Set(["input", "img", "br", "hr", "meta", "link", "area", "base", "embed", "param", "source", "track", "wbr"]);
      for (const token of html.matchAll(/<\/?([A-Za-z][A-Za-z0-9:-]*)\b([^>]*)>|([^<]+)/g)) {
        if (token[3] !== undefined) {
          stack.at(-1)._textContent += decode(token[3]);
          continue;
        }
        const tagName = token[1].toLowerCase();
        if (token[0].startsWith("</")) {
          for (let index = stack.length - 1; index > 0; index--) {
            if (stack[index].tagName === tagName) { stack.length = index; break; }
          }
          continue;
        }
        const attrs = {};
        for (const attr of token[2].matchAll(/([\w:-]+)(?:="([^"]*)"|='([^']*)'|=([^\s>]+))?/g)) {
          if (attr[1] !== "/") attrs[attr[1]] = decode(attr[2] ?? attr[3] ?? attr[4] ?? "");
        }
        const node = new Element(tagName, attrs), parent = stack.at(-1);
        node.parentElement = parent;
        parent.children.push(node);
        parsed.push(node);
        if (!voidTags.has(tagName) && !/\/\s*>$/.test(token[0])) stack.push(node);
      }
      for (const select of parsed.filter(node => node.tagName === "select")) {
        const options = select.querySelectorAll("option");
        select.value = (options.find(option => "selected" in option.attributes) || options[0])?.attributes.value || "";
      }
    }
    get textContent() {
      return (this._textContent || "") + (this.children || []).map(child => child.textContent).join("");
    }
    set textContent(value) { this._textContent = String(value); }
    get innerHTML() {
      return this._html || "";
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) {
      const descendants = [];
      const visit = node => { for (const child of node.children) { if (matches(child, sel)) descendants.push(child); visit(child); } };
      visit(this);
      return descendants;
    }
    closest(sel) {
      for (let node = this; node; node = node.parentElement) if (matches(node, sel)) return node;
      return null;
    }
    addEventListener(type, fn, options) {
      eventRegistrations.push({
        scope: "element",
        target: this.id || this.tagName,
        type,
        options,
      });
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
      node.parentElement = this;
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
  ids.get("dialog-content").parentElement = ids.get("entry-dialog");
  ids.get("entry-dialog").children.push(ids.get("dialog-content"));
  new Element("button", { class: "settings-button" });
  const body = new Element("body");
  const documentElement = new Element("html");
  const document = {
    activeElement: null,
    hidden: false,
    visibilityState: "visible",
    getElementById: (id) => ids.get(id) || null,
    querySelector: (sel) => nodes.find((n) => matches(n, sel)) || null,
    querySelectorAll: (sel) => nodes.filter((n) => matches(n, sel)),
    createElement: (tag) => new Element(tag),
    body,
    documentElement,
    addEventListener(type, fn, options) {
      eventRegistrations.push({ scope: "document", type, options });
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
    addEventListener(type, fn, options) {
      eventRegistrations.push({ scope: "window", type, options });
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
  const viewportListeners = new Map();
  browserWindow.innerHeight = 844;
  browserWindow.innerWidth = 390;
  browserWindow.visualViewport = {
    height: 844,
    width: 390,
    offsetTop: 0,
    offsetLeft: 0,
    scale: 1,
    addEventListener(type, fn) {
      const items = viewportListeners.get(type) || [];
      items.push(fn);
      viewportListeners.set(type, items);
    },
  };
  class BrowserURL extends URL {
    static createObjectURL(blob) {
      blobs.push(blob);
      return `blob:test-${blobs.length}`;
    }
    static revokeObjectURL() {}
  }
  browserWindow.fetch = fakeFetch;
  const navigator = { onLine: true };
  const context = vm.createContext({
    document,
    localStorage,
    navigator,
    window: browserWindow,
    Intl,
    Date: ClockDate,
    Blob,
    FormData: class FakeFormData {
      constructor(form) {
        assert.equal(
          form?.tagName,
          "form",
          "FormData requires a rendered form",
        );
        this.values = new Map(
          document
            .querySelectorAll("input[name],select[name]")
            .map((field) => [field.attributes.name, field.value]),
        );
      }
      get(name) {
        return this.values.get(name) ?? null;
      }
      has(name) {
        return this.values.has(name);
      }
      entries() {
        return this.values.entries();
      }
    },
    crypto: webcrypto,
    performance: { now: () => clockNow - clockOrigin },
    URL: BrowserURL,
    URLSearchParams,
    AbortController,
    AbortSignal,
    DOMException,
    Headers,
    Response,
    fetch: fakeFetch,
    btoa,
    atob,
    setTimeout: (fn, delay, ...args) => schedule(fn, delay, false, args),
    clearTimeout: (handle) => timers.delete(handle),
    setInterval: (fn, delay, ...args) => schedule(fn, delay, true, args),
    clearInterval: (handle) => timers.delete(handle),
    requestAnimationFrame: (fn) =>
      schedule(() => fn(clockNow - clockOrigin), 16, false, []),
    cancelAnimationFrame: (handle) => timers.delete(handle),
    confirm: (message) => {
      confirmations.push(message);
      return confirmation;
    },
    alert: (message) => alerts.push(message),
    console,
  });
  if (garminCoreSource) vm.runInContext(garminCoreSource, context, { filename: garminCorePath });
  vm.runInContext(source, context, { filename: appPath });
  const makeEvent = (type, target, fields = {}) => ({
    type,
    target,
    cancelable: true,
    defaultPrevented: false,
    ...fields,
    preventDefault() {
      if (this.cancelable) this.defaultPrevented = true;
    },
  });
  const emit = async (type, target, fields = {}) => {
    const event = makeEvent(type, target, fields);
    for (const fn of listeners.get(type) || []) await fn(event);
    return event;
  };
  const emitElement = async (type, target, fields = {}) => {
    const event = makeEvent(type, target, fields);
    for (const fn of target.listeners.get(type) || []) await fn(event);
    return event;
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
    confirmations,
    eventRegistrations,
    focusCalls,
    scrollCalls,
    fetchCalls,
    setFetch: handler => { fetchHandler = handler; },
    setOnline: value => { navigator.onLine = Boolean(value); },
    flush: async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); },
    clock: {
      tick,
      jump: (milliseconds) => (clockNow += milliseconds),
      set: (milliseconds) => (clockNow = milliseconds),
      now: () => clockNow,
      timerCount: () => timers.size,
    },
    evaluate: (code) => vm.runInContext(code, context),
    emitWindow: async (type, fields = {}) => {
      const event = makeEvent(type, browserWindow, fields);
      for (const fn of windowListeners.get(type) || []) await fn(event);
      return event;
    },
    emitViewport: async (type, values = {}) => {
      Object.assign(browserWindow.visualViewport, values);
      const event = makeEvent(type, browserWindow.visualViewport);
      for (const fn of viewportListeners.get(type) || []) await fn(event);
      return event;
    },
    emitElement,
    click,
    input,
    emit,
    importBackup,
    fillSimple: async (values) => {
      for (const [name, value] of Object.entries(values)) {
        const field = document.querySelector(`[name="${name}"]`);
        assert.ok(field, `Missing simple form field ${name}`);
        field.value = String(value);
        await emit("input", field);
      }
    },
    submitSimple: () => {
      const form = document.getElementById("simple-form");
      assert.ok(form, "Missing rendered simple form");
      return emit("submit", form);
    },
    simpleValue: (name) => document.querySelector(`[name="${name}"]`)?.value,
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
