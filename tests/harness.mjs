/* ============================================================================
 * Minimal browser stub + OpenWeather fixtures, used by tests/app.test.mjs.
 *
 * app.js is a classic script that touches the DOM at evaluation time, so the
 * harness gives it just enough of a DOM to run for real: elements remember
 * their text, listeners are recorded so a test can dispatch events, and fetch
 * answers with shaped OpenWeather/NWS payloads. That makes the whole pipeline
 * (fetch -> derive -> render) testable in plain `node --test`.
 * ========================================================================== */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
export const APP_SOURCE = readFileSync(join(HERE, "..", "app.js"), "utf8");

/* ------------------------------- DOM ------------------------------- */

class StubClassList {
  constructor() {
    this.set = new Set();
  }
  add(...names) {
    names.forEach((name) => this.set.add(name));
  }
  remove(...names) {
    names.forEach((name) => this.set.delete(name));
  }
  contains(name) {
    return this.set.has(name);
  }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : Boolean(force);
    if (on) this.set.add(name);
    else this.set.delete(name);
    return on;
  }
  toString() {
    return [...this.set].join(" ");
  }
}

class StubStyle {
  constructor() {
    this.props = new Map();
  }
  setProperty(name, value) {
    this.props.set(name, String(value));
  }
  getPropertyValue(name) {
    return this.props.get(name) ?? "";
  }
}

export class StubElement {
  constructor(tag = "div", id = "") {
    this.tagName = String(tag).toUpperCase();
    this._className = "";
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.classList = new StubClassList();
    this.style = new StubStyle();
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this._text = "";
    this._html = "";
    this.hidden = false;
    this.disabled = false;
    this.tabIndex = -1;
    this.title = "";
    this.type = "";
    this.value = "";
    this.checked = false;
    this.focusCount = 0;
    this.clickCount = 0;
  }

  get className() {
    return this._className || this.classList.toString();
  }
  set className(value) {
    this._className = String(value ?? "");
    this.classList = new StubClassList();
    this._className.split(/\s+/).filter(Boolean).forEach((name) => this.classList.add(name));
  }

  /* attributes ------------------------------------------------------ */
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "class") this.classList = new StubClassList();
  }
  getAttribute(name) {
    if (name === "class") return this.classList.toString() || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }

  /* text ------------------------------------------------------------ */
  get textContent() {
    if (this.children.length) return this.children.map((child) => child.textContent).join("");
    return this._text;
  }
  set textContent(value) {
    this._text = value === null || value === undefined ? "" : String(value);
    this.children = [];
  }
  get innerHTML() {
    return this._html;
  }
  set innerHTML(value) {
    this._html = String(value ?? "");
    // A test can assert on the raw markup; children are rebuilt lazily.
    this.children = [];
    if (this._html) {
      const child = new StubElement("fragment");
      child._text = this._html.replace(/<[^>]*>/g, "");
      this.children.push(child);
    }
  }
  get childElementCount() {
    return this.children.length;
  }
  get firstElementChild() {
    return this.children[0] ?? null;
  }

  /* tree ------------------------------------------------------------ */
  append(...nodes) {
    nodes.forEach((node) => {
      if (!node) return;
      node.parentNode = this;
      this.children.push(node);
      this._text = "";
    });
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((item) => item !== this);
  }
  closest(selector) {
    // Enough for the selectors the app uses (".search-panel", "[data-detail]", …).
    if (selector.includes("data-detail") && this.dataset.detail !== undefined) return this;
    if (selector.includes("search-panel") && this.classList.contains("search-panel")) return this;
    if (selector.startsWith("li[") && this.tagName === "LI" && this.dataset.index !== undefined) return this;
    return null;
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }

  /* behaviour ------------------------------------------------------- */
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== handler));
  }
  dispatch(type, event = {}) {
    (this.listeners.get(type) ?? []).forEach((handler) =>
      handler({
        type,
        target: this,
        currentTarget: this,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {},
        ...event,
      })
    );
  }
  click() {
    this.clickCount += 1;
    this.dispatch("click", {});
  }
  focus() {
    this.focusCount += 1;
  }
  blur() {}
  select() {}
  matches() {
    return false;
  }
}

export function createDocument() {
  const byId = new Map();
  const docListeners = new Map();
  const extra = new Map();

  const INPUT_IDS = new Set(["cityInput", "settingsApiKey", "settingsAnimations", "settingsOneCall"]);
  const SELECT_IDS = new Set(["settingsTheme", "settingsUnits", "settingsLanguage", "settingsRefresh"]);
  const BUTTON_HINTS = ["Btn", "btn", "favorite", "Toggle"];

  const getElement = (id) => {
    if (!byId.has(id)) {
      const tag = INPUT_IDS.has(id) ? "input" : SELECT_IDS.has(id) ? "select" : BUTTON_HINTS.some((hint) => id.includes(hint)) ? "button" : "div";
      byId.set(id, new StubElement(tag, id));
    }
    return byId.get(id);
  };

  const document = {
    readyState: "complete",
    title: "Atmosphere Desk",
    byId,
    getElementById: (id) => (id ? getElement(id) : null),
    createElement: (tag) => new StubElement(tag),
    createElementNS: (_ns, tag) => new StubElement(tag),
    createTextNode: (text) => {
      const node = new StubElement("text");
      node._text = String(text);
      return node;
    },
    querySelector: (selector) => {
      if (!extra.has(selector)) extra.set(selector, new StubElement("div"));
      return extra.get(selector);
    },
    querySelectorAll: () => [],
    addEventListener: (type, handler) => {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(handler);
    },
    removeEventListener: () => {},
    dispatch(type, event = {}) {
      (docListeners.get(type) ?? []).forEach((handler) =>
        handler({
          type,
          target: document.body,
          preventDefault() {},
          stopPropagation() {},
          ...event,
        })
      );
    },
    documentElement: new StubElement("html"),
    body: new StubElement("body"),
    hidden: false,
  };

  // The app looks the compass tick group up by class.
  extra.set(".compass-ticks", new StubElement("g"));
  return document;
}

export function createStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    seed,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    get size() {
      return map.size;
    },
    raw: map,
  };
}

/* ---------------------------- Fixtures ---------------------------- */

const KELVIN = 273.15;

export function currentFixture({
  name = "London",
  country = "GB",
  lat = 51.5072,
  lon = -0.1276,
  tempC = 12,
  humidity = 71,
  speed = 5.1,
  deg = 240,
  pressure = 1004,
  visibility = 10000,
  clouds = 78,
  condition = "Clouds",
  description = "overcast clouds",
  icon = "04d",
  timezone = 3600,
  dt = 1_750_000_000,
} = {}) {
  const k = (c) => Number((c + KELVIN).toFixed(2));
  return {
    coord: { lat, lon },
    weather: [{ id: 804, main: condition, description, icon }],
    base: "stations",
    main: {
      temp: k(tempC),
      feels_like: k(tempC - 2),
      temp_min: k(tempC - 3),
      temp_max: k(tempC + 2),
      pressure,
      humidity,
    },
    visibility,
    wind: { speed, deg, gust: speed + 6 },
    clouds: { all: clouds },
    dt,
    sys: { sunrise: dt - 3600 * 4, sunset: dt + 3600 * 5, country },
    timezone,
    id: 2643743,
    name,
    cod: 200,
  };
}

export function forecastFixture({
  lat = 51.5072,
  lon = -0.1276,
  timezone = 3600,
  start = 1_750_000_000,
  entries = 40,
  tempC = 12,
  description = "light rain",
  condition = "Rain",
  icon = "10d",
} = {}) {
  const alignedStart = Math.ceil(start / 10800) * 10800;
  const list = [];
  for (let index = 0; index < entries; index += 1) {
    const dt = alignedStart + index * 10800;
    const hour = new Date((dt + timezone) * 1000).getUTCHours();
    const value = tempC + 4 * Math.sin(((hour - 9) / 24) * 2 * Math.PI) - index * 0.12;
    const pop = index % 5 === 0 ? 0.9 : index % 3 === 0 ? 0.45 : 0.1;
    const night = hour < 6 || hour >= 20;
    list.push({
      dt,
      main: {
        temp: Number((value + KELVIN).toFixed(2)),
        feels_like: Number((value - 1 + KELVIN).toFixed(2)),
        temp_min: Number((value - 0.8 + KELVIN).toFixed(2)),
        temp_max: Number((value + 1.1 + KELVIN).toFixed(2)),
        pressure: 1004 + (index % 4),
        humidity: Math.round(60 + (index % 5) * 6),
      },
      weather: [
        {
          id: 500,
          main: pop > 0.4 ? condition : "Clouds",
          description: pop > 0.4 ? description : "broken clouds",
          icon: pop > 0.4 ? icon : night ? "04n" : "04d",
        },
      ],
      clouds: { all: 40 + (index % 5) * 10 },
      wind: { speed: 3 + (index % 6) * 1.4, deg: (200 + index * 7) % 360, gust: 9 + (index % 4) },
      visibility: 10000,
      pop,
      ...(pop > 0.4 ? { rain: { "3h": Number((pop * 2.5).toFixed(2)) } } : {}),
      sys: { pod: night ? "n" : "d" },
      dt_txt: new Date(dt * 1000).toISOString().slice(0, 19).replace("T", " "),
    });
  }
  return {
    cod: "200",
    message: 0,
    cnt: entries,
    list,
    city: { id: 2643743, name: "London", coord: { lat, lon }, country: "GB", timezone, sunrise: 0, sunset: 0 },
  };
}

export function airFixture({ aqi = 2, pm25 = 14.2, pm10 = 28.6 } = {}) {
  return {
    coord: [51.5072, -0.1276],
    list: [
      {
        dt: 1_750_000_000,
        main: { aqi },
        components: {
          co: 220.4,
          no: 0.4,
          no2: 18.2,
          o3: 62.1,
          so2: 4.4,
          pm2_5: pm25,
          pm10,
          nh3: 1.2,
        },
      },
    ],
  };
}

export function nwsAlertFixture(event = "Flash Flood Warning") {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          id: "urn:oid:2.51.1.1",
          event,
          severity: "Severe",
          urgency: "Immediate",
          onset: "2026-06-15T12:00:00+00:00",
          ends: "2026-06-15T18:00:00+00:00",
          headline: `${event} until 6:00 PM UTC`,
          description: "Heavy rain has produced dangerous flooding in the warned area.",
          instruction: "Move to higher ground. Do not drive through flooded roads.",
          senderName: "National Weather Service",
          areaDesc: "Central London",
        },
      },
    ],
  };
}

/* --------------------------- Environment --------------------------- */

/**
 * Build a fresh, isolated app instance.
 *
 * @param {{
 *   storage?: Record<string, string>,
 *   respond?: (url: string) => any,
 *   status?: (url: string) => number,
 *   failWith?: Error,
 *   search?: string,
 *   hasChart?: boolean,
 * }} [options]
 */
export function createEnv(options = {}) {
  const { storage = {}, respond, status, failWith, search = "", hasChart = false, windowExtras = {} } = options;
  const requested = [];

  const document = createDocument();
  const localStorage = createStorage(storage);
  const listeners = new Map();
  const timers = [];
  let timerSeq = 0;
  const cancelled = new Set();

  const window = {
    ...windowExtras,
    location: { href: `https://weather.test/index.html${search}`, search, pathname: "/index.html", origin: "https://weather.test" },
    history: { replaceState(_state, _title, url) { this.last = url; }, last: null },
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener: () => {},
    matchMedia: (query) => ({
      matches: query.includes("prefers-reduced-motion") ? true : false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }),
    isSecureContext: false,
    dispatch(type, event = {}) {
      (listeners.get(type) ?? []).forEach((handler) => handler({ type, preventDefault() {}, ...event }));
    },
    listeners,
  };

  const fetchImpl = async (rawUrl) => {
    const url = String(rawUrl);
    requested.push(url);
    if (failWith) throw failWith;
    const code = status ? status(url) : 200;
    if (code && code !== 200) {
      const error = new Error(`HTTP ${code}`);
      error.response = { ok: false, status: code };
      return { ok: false, status: code, json: async () => ({ cod: String(code) }) };
    }
    if (respond) return { ok: true, status: 200, json: async () => respond(url) };
    return { ok: true, status: 200, json: async () => respondTo(url) };
  };

  function respondTo(url) {
    if (url.includes("/geo/1.0/direct")) {
      return [{ name: "London", state: "", country: "GB", lat: 51.5072, lon: -0.1276, local_names: { en: "London" } }];
    }
    if (url.includes("/data/2.5/weather")) return currentFixture();
    if (url.includes("/data/2.5/forecast")) return forecastFixture();
    if (url.includes("/air_pollution")) return airFixture();
    if (url.includes("api.weather.gov")) return nwsAlertFixture();
    if (url.includes("/data/3.0/onecall")) return { alerts: [] };
    return {};
  }

  class StubHTMLElement {}
  StubHTMLElement.prototype.inert = false;

  const globals = {
    document,
    window,
    localStorage,
    fetch: fetchImpl,
    navigator: {
      onLine: true,
      language: "en-US",
      share: undefined,
      clipboard: { writeText(value) { this.last = value; } },
    },
    requestAnimationFrame: (fn) => {
      const id = timers.push(fn) - 1;
      return id;
    },
    // Retries and focus bookkeeping use timers; run them as microtasks so a
    // test can assert on a failed request without waiting out real backoff.
    setTimeout: (fn, ms) => {
      const id = ++timerSeq;
      queueMicrotask(() => {
        if (!cancelled.has(id)) fn();
      });
      return id;
    },
    clearTimeout: (id) => cancelled.add(id),
    cancelAnimationFrame: () => {},
    HTMLElement: StubHTMLElement,
    Chart: hasChart
      ? class Chart {
          static instances = [];
          constructor(canvas, config) {
            this.canvas = canvas;
            this.config = config;
            Chart.instances.push(this);
          }
          destroy() {
            this.destroyed = true;
          }
        }
      : undefined,
    AbortController,
    setInterval: (fn, ms) => {
      timers.push(fn);
      return timers.length;
    },
    clearInterval: () => {},
  };

  const context = vm.createContext({
    ...globals,
    console,
    Date,
    Math,
    JSON,
    Intl,
    URL,
    URLSearchParams,
    Number,
    String,
    Object,
    Array,
    Boolean,
    Set,
    Map,
    Promise,
    Error,
    TypeError,
    isFinite,
    isNaN,
    parseFloat,
    parseInt,
    fetch: fetchImpl,
    window,
    document,
    localStorage,
    navigator: globals.navigator,
    requestAnimationFrame: globals.requestAnimationFrame,
    setTimeout: globals.setTimeout,
    clearInterval,
    setInterval: globals.setInterval,
    clearInterval,
    AbortController,
    HTMLElement: globals.HTMLElement,
    Chart: globals.Chart,
  });

  vm.runInContext(APP_SOURCE, context, { filename: "app.js" });

  /**
   * Drain the app's promise chains. Every await yields a microtask, so a handful
   * of macrotask rounds is enough even when the retry/backoff logic runs.
   */
  const flush = async (rounds = 25) => {
    for (let round = 0; round < rounds; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      while (timers.length) {
        const fn = timers.shift();
        try {
          fn();
        } catch (error) {
          errors.push(error);
        }
      }
    }
  };

  const errors = [];

  return {
    context,
    document,
    window,
    localStorage,
    requested,
    /** The app publishes its debug surface on window.WeatherDesk. */
    get WeatherDesk() {
      return window.WeatherDesk;
    },
    get api() {
      return window.WeatherDesk;
    },
    flush,
    element: (id) => document.getElementById(id),
    errors,
  };
}
