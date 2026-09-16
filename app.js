/* ============================================================================
 * Atmosphere Desk — weather intelligence dashboard
 * ----------------------------------------------------------------------------
 * Design notes
 *  - No build step and no required dependencies: one classic script, so the page
 *    still works when opened straight from the filesystem.
 *  - Requests always use `units=standard` (Kelvin / m/s / hPa / metres). Unit
 *    preference is therefore a pure rendering concern: switching Celsius and
 *    Fahrenheit re-renders instead of re-fetching, which doubles the effective
 *    quota and keeps the cache shared.
 *  - Everything that reaches the DOM is built with textContent or passed through
 *    esc(). API strings are never trusted.
 *  - One network layer (requestJson) adds timeouts, bounded retries, HTTP-status
 *    aware messages and a small TTL cache.
 *  - The dashboard degrades in a defined order:
 *      live API -> cached response -> last saved snapshot -> generated demo data
 *    so it never renders an empty shell.
 * ========================================================================== */

(function () {
  "use strict";

  /* ============================== Configuration ============================== */

  const APP_VERSION = "2.1.0";
  const KELVIN = 273.15;

  /**
   * Demo key committed so the app works on first open. Override it with your own
   * (Settings → API key, or `?apikey=…`); for anything you publish, set this to
   * "" and let visitors paste their own key instead of sharing one quota.
   */
  const BUILT_IN_API_KEY = "bac7893eaffd11c1ff3b45e7f7f541ad";

  const ENDPOINTS = {
    api: "https://api.openweathermap.org/data/2.5",
    geo: "https://api.openweathermap.org/geo/1.0",
    oneCall: "https://api.openweathermap.org/data/3.0/onecall",
    nws: "https://api.weather.gov",
  };

  const STORAGE_KEYS = {
    history: "weather-history-v3",
    favorites: "weather-favorites-v3",
    theme: "weather-theme-v3",
    units: "weather-units-v3",
    language: "weather-language-v1",
    autoRefresh: "weather-refresh-minutes-v1",
    animations: "weather-animations-v1",
    oneCallAlerts: "weather-onecall-alerts-v1",
    apiKey: "weather-api-key-v1",
    lastPlace: "weather-last-place-v3",
    snapshot: "weather-snapshot-v1",
  };

  const LIMITS = {
    history: 8,
    favorites: 12,
    favoritesShown: 6,
    suggestions: 8,
    alertsShown: 4,
  };

  /** How long a response may be reused instead of re-requested (ms). */
  const TTL = {
    current: 10 * 60 * 1000,
    forecast: 15 * 60 * 1000,
    aqi: 30 * 60 * 1000,
    alerts: 5 * 60 * 1000,
    geo: 24 * 60 * 60 * 1000,
  };

  const REQUEST = { timeoutMs: 11000, retries: 2, memoMax: 80 };

  /**
   * Curated starting points. They double as offline shortcuts: the coordinates
   * ship with the entry, so choosing one never costs a geocoding call, and demo
   * mode can still "find" these cities without an API key.
   */
  const POPULAR_CITIES = [
    { label: "New York, US", query: "New York, NY", lat: 40.7143, lon: -74.006 },
    { label: "London, GB", query: "London", lat: 51.5072, lon: -0.1276 },
    { label: "Tokyo, JP", query: "Tokyo", lat: 35.6895, lon: 139.6917 },
    { label: "Paris, FR", query: "Paris", lat: 48.8566, lon: 2.3522 },
    { label: "Dubai, AE", query: "Dubai", lat: 25.2048, lon: 55.2708 },
    { label: "Singapore, SG", query: "Singapore", lat: 1.2897, lon: 103.8501 },
    { label: "Sydney, AU", query: "Sydney", lat: -33.871, lon: 151.2071 },
    { label: "Toronto, CA", query: "Toronto", lat: 43.6535, lon: -79.3839 },
    { label: "Mumbai, IN", query: "Mumbai", lat: 19.0728, lon: 72.8826 },
    { label: "S\u00e3o Paulo, BR", query: "Sao Paulo", lat: -23.5475, lon: -46.6361 },
    { label: "Delhi, IN", query: "Delhi", lat: 28.652, lon: 77.2315 },
    { label: "Cairo, EG", query: "Cairo", lat: 30.0626, lon: 31.2497 },
    { label: "Moscow, RU", query: "Moscow", lat: 55.7522, lon: 37.6156 },
    { label: "Cape Town, ZA", query: "Cape Town", lat: -33.9258, lon: 18.4232 },
    { label: "Reykjavik, IS", query: "Reykjavik", lat: 64.1355, lon: -21.8954 },
    { label: "Anchorage, US", query: "Anchorage", lat: 61.2177, lon: -149.8993 },
  ];



  const AQI_LEVELS = {
    1: {
      name: "Good",
      advice: "Air quality is satisfactory for everyone.",
      cards: ["Great day for outdoor plans", "Open the windows", "Low risk for sensitive groups"],
    },
    2: {
      name: "Fair",
      advice: "Acceptable air quality; sensitive groups may notice it.",
      cards: ["Most outdoor plans are fine", "Pace long sessions if sensitive", "Keep water handy"],
    },
    3: {
      name: "Moderate",
      advice: "Shorten intense outdoor exercise if you feel irritation.",
      cards: ["Trim hard workouts", "Watch for coughing", "Close windows near traffic"],
    },
    4: {
      name: "Poor",
      advice: "Limit time outdoors and keep indoor air filtered.",
      cards: ["Skip outdoor training", "Mask up if you must go out", "Run air filtration"],
    },
    5: {
      name: "Very poor",
      advice: "Stay indoors where possible and protect sensitive people.",
      cards: ["Stay inside", "Postpone outdoor work", "Protect children and elders"],
    },
  };

  const AQI_BREAKPOINTS = {
    pm25: [
      { cLow: 0.0, cHigh: 12.0, iLow: 0, iHigh: 50 },
      { cLow: 12.1, cHigh: 35.4, iLow: 51, iHigh: 100 },
      { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150 },
      { cLow: 55.5, cHigh: 150.4, iLow: 151, iHigh: 200 },
      { cLow: 150.5, cHigh: 250.4, iLow: 201, iHigh: 300 },
      { cLow: 250.5, cHigh: 350.4, iLow: 301, iHigh: 400 },
      { cLow: 350.5, cHigh: 500.4, iLow: 401, iHigh: 500 },
    ],
    pm10: [
      { cLow: 0, cHigh: 54, iLow: 0, iHigh: 50 },
      { cLow: 55, cHigh: 154, iLow: 51, iHigh: 100 },
      { cLow: 155, cHigh: 254, iLow: 101, iHigh: 150 },
      { cLow: 255, cHigh: 354, iLow: 151, iHigh: 200 },
      { cLow: 355, cHigh: 424, iLow: 201, iHigh: 300 },
      { cLow: 425, cHigh: 504, iLow: 301, iHigh: 400 },
      { cLow: 505, cHigh: 604, iLow: 401, iHigh: 500 },
    ],
  };

  /** Reference concentrations (µg/m³) used to grade individual pollutants. */
  const POLLUTANTS = [
    { key: "pm2_5", label: "PM2.5", limit: 55, note: "Fine particles — the main health driver." },
    { key: "pm10", label: "PM10", limit: 154, note: "Coarse dust and soot that reach the airways." },
    { key: "no2", label: "NO₂", limit: 200, note: "Mostly traffic and combustion." },
    { key: "o3", label: "O₃", limit: 180, note: "Ground ozone; peaks on sunny afternoons." },
    { key: "so2", label: "SO₂", limit: 350, note: "Industrial burning and volcanic gas." },
    { key: "co", label: "CO", limit: 9000, note: "Carbon monoxide; indoor sources matter most." },
  ];

  const WEATHER_THEME_KEYS = {
    clear: "clear",
    clouds: "clouds",
    rain: "rain",
    drizzle: "drizzle",
    thunderstorm: "thunderstorm",
    snow: "snow",
    mist: "mist",
    smoke: "mist",
    haze: "mist",
    dust: "mist",
    fog: "mist",
    sand: "mist",
    ash: "mist",
    squall: "rain",
    tornado: "thunderstorm",
  };

  const EFFECT_KEYS = {
    clear: "clear",
    clouds: "clouds",
    rain: "rain",
    drizzle: "drizzle",
    thunderstorm: "storm",
    snow: "snow",
    mist: "fog",
    smoke: "fog",
    haze: "fog",
    dust: "fog",
    fog: "fog",
    sand: "fog",
    ash: "fog",
    squall: "wind",
    tornado: "storm",
  };

  const DETAIL_HELP = {
    highLow: [
      "High / low today",
      "The warmest and coolest temperature expected within the local day, taken from the forecast rather than one station reading.",
    ],
    humidity: [
      "Humidity",
      "How much water vapour the air holds, as a share of what it could hold at this temperature. Above ~70% sweat evaporates slowly and heat feels harsher; below ~30% skin and airways dry out.",
    ],
    wind: [
      "Wind",
      "Sustained wind speed averaged over the ten minutes before the observation. Short-lived peaks are reported separately as gusts.",
    ],
    rain: [
      "Rain chance",
      "Probability that at least 0.1 mm of precipitation falls in the current forecast window. It says nothing about how heavy the rain would be.",
    ],
    pressure: [
      "Air pressure",
      "Weight of the atmosphere reduced to sea level. Falling pressure usually means a front is approaching; steady high pressure means settled, often calmer weather.",
    ],
    visibility: [
      "Visibility",
      "The greatest distance at which a clear object can be seen. Fog, haze, rain and smoke all shorten it.",
    ],
    clouds: [
      "Cloud cover",
      "Share of the sky obscured by clouds above this location. 0% is clear sky, 100% is fully overcast.",
    ],
    dew: [
      "Dew point",
      "The temperature the air must cool to before water condenses — the honest measure of humidity. Below 10 °C feels dry, above 18 °C feels muggy. Estimated here from temperature and relative humidity (Magnus formula).",
    ],
    gust: [
      "Wind gust",
      "Short-lived peak wind speed, usually lasting only seconds. Gusts matter most for umbrellas, cycling, boats and ladders.",
    ],
    precip: [
      "24 hour precipitation",
      "Rain plus melted snow expected over the next 24 hours, summed from the 3-hourly forecast.",
    ],
    timezone: [
      "Timezone",
      "Offset from UTC used for every clock on this page, so sunrise and the hourly strip follow the city's own time.",
    ],
    observed: [
      "Observed",
      "When the source last updated this observation. OpenWeather refreshes current conditions roughly every ten minutes.",
    ],
  };

  const SHORTCUTS = [
    ["/", "Jump to the city search box"],
    ["Enter", "Search for the typed city"],
    ["↑ ↓ then Enter", "Pick a suggestion"],
    ["R", "Refresh data for the current place"],
    ["U", "Switch Celsius / Fahrenheit"],
    ["D", "Switch light / dark theme"],
    ["F", "Add or remove the current city from favorites"],
    ["S", "Open settings"],
    ["Esc", "Close a dialog or the suggestions"],
  ];

  /* ================================ Utilities ================================ */

  const $ = (id) => document.getElementById(id);

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const round = (value, digits = 0) => {
    const factor = 10 ** digits;
    return Math.round(Number(value) * factor) / factor;
  };

  const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  /** Escape anything that came from an API before it is interpolated into HTML. */
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ENTITIES[char]);

  const capitalize = (value) => {
    const text = String(value ?? "");
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  const svgIcon = (symbolId, className = "ico") =>
    `<svg class="${className}" aria-hidden="true" focusable="false"><use href="#${symbolId}"></use></svg>`;

  const isNumeric = (value) => typeof value === "number" && Number.isFinite(value);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  const clearNode = (node) => {
    if (node) node.textContent = "";
  };

  const prefersReducedMotion = () =>
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ================================ Storage ================================ */

  const store = {
    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (error) {
        return fallback;
      }
    },
    write(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        return false; // private mode or quota exceeded
      }
    },
    readText(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null || raw === "" ? fallback : raw;
      } catch (error) {
        return fallback;
      }
    },
    writeText(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (error) {
        /* settings simply do not persist */
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        /* ignore */
      }
    },
  };

  /**
   * History and favorites used to be arrays of strings. Accept both shapes and
   * always return `{ label, query, lat, lon, savedAt }`, so returning to a known
   * place skips the geocoding request.
   */
  function readPlaces(key) {
    const raw = store.read(key, []);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        if (typeof item === "string") return { label: item, query: item, lat: null, lon: null, savedAt: 0 };
        if (!item || typeof item !== "object" || typeof item.label !== "string") return null;
        return {
          label: item.label,
          query: typeof item.query === "string" ? item.query : item.label,
          lat: isNumeric(item.lat) ? item.lat : null,
          lon: isNumeric(item.lon) ? item.lon : null,
          savedAt: isNumeric(item.savedAt) ? item.savedAt : 0,
        };
      })
      .filter(Boolean);
  }

  const writePlaces = (key, list) => store.write(key, list.slice(0, LIMITS.favorites));

  /* =========================== Units and formatting =========================== */

  /* The API always answers in Kelvin; every display value is converted here. */
  const isMetric = () => state.settings.units === "metric";
  const tempUnit = () => (isMetric() ? "°C" : "°F");
  const speedUnit = () => (isMetric() ? "m/s" : "mph");

  const toDisplayTemp = (kelvin) => (isMetric() ? kelvin - KELVIN : ((kelvin - KELVIN) * 9) / 5 + 32);
  /** Celsius is what the derived metrics (dew point) are computed in. */
  const toDisplayCelsius = (celsius) => (isMetric() ? celsius : (celsius * 9) / 5 + 32);
  const formatTemp = (kelvin, digits = 0) => (isNumeric(kelvin) ? round(toDisplayTemp(kelvin), digits) : "--");
  const formatDeg = (kelvin) => `${formatTemp(kelvin)}°`;
  const formatSpeed = (ms) => (isNumeric(ms) ? round(isMetric() ? ms : ms * 2.23694, ms < 20 ? 1 : 0) : "--");
  const formatPressure = (hPa) => (isMetric() ? `${round(hPa)} hPa` : `${round(hPa * 0.02953, 2)} inHg`);
  const formatDistance = (metres) =>
    isMetric() ? `${(metres / 1000).toFixed(1)} km` : `${(metres / 1609.34).toFixed(1)} mi`;
  const formatDepth = (mm) => (isMetric() ? `${mm.toFixed(1)} mm` : `${(mm / 25.4).toFixed(2)} in`);

  const formatOffset = (offsetSeconds) => {
    const offset = isNumeric(offsetSeconds) ? offsetSeconds : 0;
    const sign = offset >= 0 ? "+" : "−";
    const abs = Math.abs(offset);
    return `UTC${sign}${String(Math.floor(abs / 3600)).padStart(2, "0")}:${String(Math.floor((abs % 3600) / 60)).padStart(2, "0")}`;
  };

  /** Format an epoch second as wall-clock time at the location. */
  const formatLocal = (epochSeconds, offsetSeconds, options) => {
    if (!isNumeric(epochSeconds)) return "--";
    const shifted = new Date((epochSeconds + (offsetSeconds || 0)) * 1000);
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(shifted);
  };

  const formatClock = (epochSeconds, offsetSeconds) =>
    formatLocal(epochSeconds, offsetSeconds, { hour: "numeric", minute: "2-digit" });

  const dateKeyOf = (epochSeconds, offsetSeconds) => {
    const shifted = new Date((epochSeconds + (offsetSeconds || 0)) * 1000);
    return [
      shifted.getUTCFullYear(),
      String(shifted.getUTCMonth() + 1).padStart(2, "0"),
      String(shifted.getUTCDate()).padStart(2, "0"),
    ].join("-");
  };

  /* A YYYY-MM-DD key is read at UTC noon so the weekday cannot drift. */
  const partsForDateKey = (key) => {
    const date = new Date(`${key}T12:00:00Z`);
    return {
      weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()],
      label: new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date),
    };
  };

  const relativeTime = (ms) => {
    if (!isNumeric(ms) || !ms) return "never";
    const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (seconds < 45) return "just now";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = round(minutes / 60, 1);
    if (hours < 24) return `${hours} h ago`;
    return `${round(hours / 24, 1)} d ago`;
  };

  const formatDuration = (seconds) => {
    const total = Math.max(0, Math.round(seconds / 60) * 60);
    const hours = Math.floor(total / 3600);
    const minutes = Math.round((total % 3600) / 60);
    if (!hours) return `${minutes} min`;
    return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  };

  const COMPASS_POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

  const windArrow = (degrees) => {
    if (!isNumeric(degrees)) return "--";
    const normalized = ((degrees % 360) + 360) % 360;
    return COMPASS_POINTS[Math.round(normalized / 22.5) % COMPASS_POINTS.length];
  };

  /** Magnus formula — dew point in °C from temperature (K) and relative humidity. */
  const dewPointC = (tempKelvin, humidity) => {
    if (!isNumeric(tempKelvin) || !isNumeric(humidity)) return null;
    const tempC = tempKelvin - KELVIN;
    const rh = clamp(humidity, 1, 100);
    const gamma = Math.log(rh / 100) + (17.625 * tempC) / (243.04 + tempC);
    return (243.04 * gamma) / (17.625 - gamma);
  };

  const comfortFromDew = (dewC) => {
    if (!isNumeric(dewC)) return "";
    if (dewC < 5) return "air feels dry";
    if (dewC < 12) return "comfortable";
    if (dewC < 17) return "a touch humid";
    if (dewC < 21) return "humid";
    return "oppressive";
  };

  const feelsLikeNote = (tempKelvin, feelsKelvin) => {
    if (!isNumeric(tempKelvin) || !isNumeric(feelsKelvin)) return "";
    // Threshold is "2.5 °C of surprise"; in Fahrenheit that is 4.5 °F, so scale
    // the delta into the unit on screen instead of comparing raw kelvin offsets.
    const delta = (feelsKelvin - tempKelvin) * (isMetric() ? 1 : 1.8);
    if (delta <= -2.5) return "wind makes it feel colder";
    if (delta >= 2.5) return "humidity makes it feel hotter";
    return "close to the real temperature";
  };

  /* ================================ API key ================================ */

  function readKeyFromUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("apikey") || params.get("appid") || params.get("key") || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Resolution order, documented in the README:
   *   1. a key pasted into Settings for this test (state.apiKey)
   *   2. the key saved in this browser
   *   3. ?apikey=… (this page view only, never persisted)
   *   4. window.__ATMOSPHERE_DESK__ (set from a script tag or config.local.js)
   *   5. the key compiled into app.js
   */
  function resolveApiKey() {
    if (state.apiKey) return state.apiKey;
    const saved = store.readText(STORAGE_KEYS.apiKey, "");
    if (saved) return saved;
    const fromUrl = readKeyFromUrl();
    if (fromUrl) return fromUrl;
    const injected = window.__ATMOSPHERE_DESK__ && window.__ATMOSPHERE_DESK__.apiKey;
    if (typeof injected === "string" && injected.trim()) return injected.trim();
    return BUILT_IN_API_KEY || "";
  }

  const apiKey = () => resolveApiKey();
  const hasApiKey = () => Boolean(resolveApiKey());

  function describeKeySource() {
    if (state.apiKey) return "pasted for this test only";
    if (store.readText(STORAGE_KEYS.apiKey, "")) return "saved in this browser";
    if (readKeyFromUrl()) return "read from the URL (not saved)";
    if (typeof (window.__ATMOSPHERE_DESK__ || {}).apiKey === "string") return "provided by the page";
    return BUILT_IN_API_KEY ? "built-in demo key" : "none — demo mode";
  }

  /* ================================ Networking ================================ */

  class ApiError extends Error {
    constructor(message, code = "network", status = null) {
      super(message);
      this.name = "ApiError";
      this.code = code;
      this.status = status;
    }
  }

  function httpError(status) {
    if (status === 401 || status === 403)
      return new ApiError(
        "The weather service rejected this API key. Add your own key in Settings to switch to live data.",
        "key",
        status
      );
    if (status === 404) return new ApiError("That location is not available from the weather service.", "not-found", status);
    if (status === 429)
      return new ApiError("Rate limit reached — the free quota refills after a minute or two.", "rate-limit", status);
    if (status >= 500) return new ApiError("The weather service is temporarily unavailable.", "server", status);
    return new ApiError(`The weather service responded with HTTP ${status}.`, "http", status);
  }

  const isOffline = () => typeof navigator.onLine === "boolean" && navigator.onLine === false;

  /** Short-lived cache keyed by URL: re-rendering must never cost quota. */
  const memo = new Map();

  function memoRemember(url, promise, ttl) {
    if (memo.size > REQUEST.memoMax) memo.clear();
    memo.set(url, { promise, expires: Date.now() + ttl });
    promise.then(
      (value) => memo.set(url, { value, expires: Date.now() + ttl }),
      () => memo.delete(url)
    );
  }

  async function fetchOnce(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!response.ok) throw httpError(response.status);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @param {string} url
   * @param {{ttl?: number, label?: string, retries?: number, timeoutMs?: number}} [options]
   */
  function requestJson(url, options = {}) {
    const { ttl = 0, label = "Request", retries = REQUEST.retries, timeoutMs = REQUEST.timeoutMs } = options;

    if (ttl > 0) {
      const cached = memo.get(url);
      if (cached && cached.expires > Date.now()) return cached.promise ?? Promise.resolve(cached.value);
    }

    const run = async () => {
      let lastError;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (isOffline()) throw new ApiError("You appear to be offline.", "offline");
        try {
          return await fetchOnce(url, timeoutMs);
        } catch (error) {
          if (error instanceof ApiError && error.code === "offline") {
            lastError = error;
          } else if (error instanceof ApiError && !["server", "timeout"].includes(error.code)) {
            throw error; // key, quota, not-found: retrying only wastes quota
          } else if (error instanceof ApiError) {
            lastError = error;
          } else if (error && error.name === "AbortError") {
            lastError = new ApiError(`${label} timed out after ${round(timeoutMs / 1000)} s.`, "timeout");
          } else {
            lastError = new ApiError("Could not reach the weather service.", "network");
          }
          if (attempt < retries) await delay(240 * 2 ** attempt);
        }
      }
      throw lastError ?? new ApiError(`${label} failed.`, "network");
    };

    const promise = run();
    if (ttl > 0) memoRemember(url, promise, ttl);
    return promise;
  }

  const buildUrl = (base, params) => {
    const url = new URL(base);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    });
    return url.toString();
  };

  /** Coordinates rounded to ~11 m: better cache hits, less precise tracking. */
  const q = (value) => Number(value).toFixed(4);

  const geoUrl = (query, limit) => buildUrl(`${ENDPOINTS.geo}/direct`, { q: query, limit, appid: apiKey() });

  const geocode = (query, limit = 5) =>
    requestJson(geoUrl(query, limit), { ttl: TTL.geo, label: "City lookup" });

  const geocodeOne = async (query) => {
    const results = await geocode(query, 1);
    const place = Array.isArray(results) ? results[0] : null;
    if (!place) throw new ApiError(`No match for “${query}”. Try a bigger city or a postcode.`, "not-found");
    return place;
  };

  const weatherParams = (lat, lon) => ({
    lat: q(lat),
    lon: q(lon),
    units: "standard",
    lang: state.settings.language,
    appid: apiKey(),
  });

  const fetchCurrent = (lat, lon) =>
    requestJson(buildUrl(`${ENDPOINTS.api}/weather`, weatherParams(lat, lon)), {
      ttl: TTL.current,
      label: "Current conditions",
    });

  const fetchForecast = (lat, lon) =>
    requestJson(buildUrl(`${ENDPOINTS.api}/forecast`, weatherParams(lat, lon)), {
      ttl: TTL.forecast,
      label: "Forecast",
    });

  const fetchAirQuality = (lat, lon) =>
    requestJson(buildUrl(`${ENDPOINTS.api}/air_pollution`, { lat: q(lat), lon: q(lon), appid: apiKey() }), {
      ttl: TTL.aqi,
      label: "Air quality",
    });

  const inUnitedStates = (lat, lon) => lat >= 24 && lat <= 72 && lon <= -66 && lon >= -125;

  const parseIso = (value) => {
    const ms = Date.parse(value ?? "");
    return Number.isFinite(ms) ? ms : null;
  };

  /** Free, keyless official alerts for US locations (NWS allows browser requests). */
  async function fetchNwsAlerts(lat, lon) {
    const url = `${ENDPOINTS.nws}/alerts/active?point=${Number(lat).toFixed(4)},${Number(lon).toFixed(4)}`;
    const data = await requestJson(url, { ttl: TTL.alerts, label: "US alerts", retries: 1 });
    const features = Array.isArray(data?.features) ? data.features : [];
    return features
      .filter((feature) => feature?.properties?.event)
      .map((feature) => {
        const p = feature.properties;
        return {
          id: p.id || `${p.event}-${p.onset}`,
          event: p.event,
          severity: String(p.severity || "unknown").toLowerCase(),
          urgency: String(p.urgency || "").toLowerCase(),
          startsMs: parseIso(p.onset ?? p.effective),
          endsMs: parseIso(p.ends ?? p.expires),
          description: p.description || p.headline || "",
          instruction: p.instruction || "",
          sender: p.senderName || "National Weather Service",
          areas: p.areaDesc || "",
        };
      })
      .slice(0, LIMITS.alertsShown);
  }

  /** OpenWeather One Call 3.0 exposes alerts, but only for subscribed keys. */
  async function fetchOneCallAlerts(lat, lon) {
    const data = await requestJson(
      buildUrl(ENDPOINTS.oneCall, {
        lat: q(lat),
        lon: q(lon),
        appid: apiKey(),
        exclude: "minutely,hourly,daily,current",
      }),
      { ttl: TTL.alerts, label: "Alerts", retries: 0 }
    );
    const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
    return alerts
      .map((alert, index) => ({
        id: `${alert.event || "alert"}-${index}`,
        event: alert.event || "Weather alert",
        severity: "severe",
        urgency: "expected",
        startsMs: isNumeric(alert.start) ? alert.start * 1000 : null,
        endsMs: isNumeric(alert.end) ? alert.end * 1000 : null,
        description: alert.description || "",
        instruction: "",
        sender: alert.sender_name || "Weather authority",
        areas: Array.isArray(alert.cities) ? alert.cities.join(", ") : "",
      }))
      .slice(0, LIMITS.alertsShown);
  }

  async function fetchAlerts(lat, lon) {
    if (inUnitedStates(lat, lon)) {
      try {
        return { alerts: await fetchNwsAlerts(lat, lon), source: "National Weather Service" };
      } catch (error) {
        if (!state.settings.oneCallAlerts) {
          return { alerts: [], source: "National Weather Service", unavailable: true, error };
        }
      }
    }
    if (state.settings.oneCallAlerts && hasApiKey()) {
      try {
        return { alerts: await fetchOneCallAlerts(lat, lon), source: "OpenWeather One Call" };
      } catch (error) {
        return { alerts: [], source: null, unavailable: true, error };
      }
    }
    return { alerts: [], source: null };
  }

  /* ============================== Weather maths ============================== */

  function calculateAqi(concentration, breakpoints) {
    if (!isNumeric(concentration)) return null;
    const value = Math.max(0, concentration);
    const bracket =
      breakpoints.find(({ cLow, cHigh }) => value >= cLow && value <= cHigh) ?? breakpoints[breakpoints.length - 1];
    const { cLow, cHigh, iLow, iHigh } = bracket;
    const span = cHigh - cLow || 1;
    return Math.round(clamp(((iHigh - iLow) / span) * (value - cLow) + iLow, 0, 500));
  }

  const levelFromAqi = (aqi) => (aqi <= 50 ? 1 : aqi <= 100 ? 2 : aqi <= 150 ? 3 : aqi <= 200 ? 4 : 5);

  /**
   * Prefer the PM-derived EPA index (computed from raw concentrations) and fall
   * back to the provider's 1-5 category when the components are missing.
   */
  function summarizeAirQuality(response) {
    const entry = response?.list?.[0];
    const components = entry?.components;
    const candidates = components
      ? [calculateAqi(components.pm2_5, AQI_BREAKPOINTS.pm25), calculateAqi(components.pm10, AQI_BREAKPOINTS.pm10)].filter(
          (value) => value !== null
        )
      : [];

    if (candidates.length) {
      const value = Math.max(...candidates);
      return { value, level: levelFromAqi(value), components, precise: true };
    }
    const reported = entry?.main?.aqi;
    if (!isNumeric(reported)) return null;
    return {
      value: Math.min(500, Math.max(1, Math.round(((reported - 1) / 4) * 100) || 1)),
      level: clamp(Math.round(reported), 1, 5),
      components: components ?? {},
      precise: false,
    };
  }

  const themeKeyFor = (mainCondition = "") => WEATHER_THEME_KEYS[String(mainCondition).toLowerCase()] ?? "default";
  const effectFor = (mainCondition = "") => EFFECT_KEYS[String(mainCondition).toLowerCase()] ?? "none";

  const iconSymbolFor = (iconCode = "", mainCondition = "") => {
    const night = String(iconCode).endsWith("n");
    const group = String(mainCondition).toLowerCase();
    if (group === "clear") return night ? "wx-clear-night" : "wx-clear-day";
    if (group === "clouds") return night ? "wx-clouds-night" : "wx-clouds-day";
    if (group === "rain") return "wx-rain";
    if (group === "drizzle") return "wx-drizzle";
    if (group === "thunderstorm") return "wx-thunderstorm";
    if (group === "snow") return "wx-snow";
    if (group === "squall") return "wx-squall";
    return "wx-mist";
  };

  const hourOf = (epochSeconds, offsetSeconds) => new Date((epochSeconds + (offsetSeconds || 0)) * 1000).getUTCHours();

  const entryDepth = (entry) => (entry?.rain?.["3h"] || 0) + (entry?.snow?.["3h"] || 0);

  /** Group the 3-hourly list into at most five local days, keyed by date. */
  function buildDailyForecast(list, offsetSeconds, todayKey) {
    const days = new Map();

    (list || []).forEach((entry) => {
      const key = dateKeyOf(entry.dt, offsetSeconds);
      if (!days.has(key)) {
        // Accumulators start empty; the loop below folds in the first entry too.
        days.set(key, {
          key,
          min: entry.main?.temp_min ?? entry.main?.temp,
          max: entry.main?.temp_max ?? entry.main?.temp,
          pop: entry.pop || 0,
          depth: 0,
          midday: entry,
          middayGap: Infinity,
          wind: entry.wind?.speed || 0,
          humidity: entry.main?.humidity ?? 0,
          isToday: key === todayKey,
        });
      }
      const day = days.get(key);
      const temps = [entry.main?.temp_min, entry.main?.temp, entry.main?.temp_max].filter(isNumeric);
      if (temps.length) {
        day.min = Math.min(day.min, ...temps);
        day.max = Math.max(day.max, ...temps);
      }
      day.pop = Math.max(day.pop, entry.pop || 0);
      day.depth += entryDepth(entry);
      day.wind = Math.max(day.wind, entry.wind?.speed || 0);
      day.humidity = Math.max(day.humidity, entry.main?.humidity ?? 0);

      const gap = Math.abs(hourOf(entry.dt, offsetSeconds) - 13);
      if (gap < day.middayGap) {
        day.middayGap = gap;
        day.midday = entry;
      }
    });

    return [...days.values()].sort((a, b) => (a.key < b.key ? -1 : 1)).slice(0, 5);
  }

  /** First wet slot plus the total depth across a window. */
  function findRainWindow(entries, offsetSeconds) {
    let total = 0;
    let firstWet = null;
    (entries || []).forEach((entry) => {
      total += entryDepth(entry);
      const wet = (entry.pop || 0) >= 0.4 || entryDepth(entry) > 0.15;
      if (wet && !firstWet) firstWet = entry;
    });
    return { total, firstWet, label: firstWet ? formatClock(firstWet.dt, offsetSeconds) : null };
  }

  /* ============================== Demo dataset ============================== */

  const mulberry32 = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const hashSeed = (...parts) => parts.reduce((acc, part) => (Math.imul(acc, 31) + Math.trunc(Number(part) * 1000)) | 0, 7);

  /** Day-length approximation so demo mode still draws a believable sun arc. */
  function sunTimesFor(lat, lon, dayUtcMs) {
    const midnight = Math.floor(dayUtcMs / 86400000) * 86400;
    const dayOfYear = Math.floor((dayUtcMs - Date.UTC(new Date(dayUtcMs).getUTCFullYear(), 0, 0)) / 86400000);
    const declination = 0.4093 * Math.sin((2 * Math.PI * (dayOfYear - 81)) / 364.65);
    const phi = (lat * Math.PI) / 180;
    const zenith = 90.833 * (Math.PI / 180);
    const cosHour =
      (Math.cos(zenith) - Math.sin(phi) * Math.sin(declination)) / (Math.cos(phi) * Math.cos(declination) || 1e-6);

    if (cosHour > 1) return { sunrise: midnight, sunset: midnight, daylightHours: 0, polar: "night" };
    if (cosHour < -1) return { sunrise: midnight, sunset: midnight + 86400, daylightHours: 24, polar: "day" };

    const daylightHours = (2 * (Math.acos(clamp(cosHour, -1, 1)) * (180 / Math.PI))) / 15;
    const solarNoon = midnight + (12 - lon / 15) * 3600;
    const half = (daylightHours / 2) * 3600;
    return { sunrise: solarNoon - half, sunset: solarNoon + half, daylightHours, polar: null };
  }

  /**
   * Deterministic OpenWeather-shaped payload (Kelvin units) for offline use and
   * for the moment before a working key exists. Seeded by coordinate + day, so a
   * city keeps the same demo weather all day.
   */
  function buildDemoDataset(lat, lon, label) {
    const nowMs = Date.now();
    const now = new Date(nowMs);
    const rand = mulberry32(hashSeed(lat, lon, now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const offsetSeconds = Math.round((Number(lon) || 0) / 15) * 3600;
    const local = new Date(nowMs + offsetSeconds * 1000);
    const localHour = local.getUTCHours() + local.getUTCMinutes() / 60;

    const season = Math.cos((((local.getUTCMonth() + 1 - 7) / 12) * 2 * Math.PI) / 1);
    const latitude = Number(lat) || 0;
    const baseC = clamp(26 - Math.abs(latitude) * 0.42 + season * 11 * (latitude >= 0 ? 1 : -1) + (rand() - 0.5) * 5, -34, 45);
    const swing = 2.5 + rand() * 4.5; // realistic day/night range, not a desert
    const wetness = rand();
    const stormy = wetness > 0.5 && wetness < 0.58;

    let condition;
    if (baseC <= 0 && wetness > 0.55) condition = { main: "Snow", description: "light snow", icon: "13d" };
    else if (stormy) condition = { main: "Thunderstorm", description: "thunderstorm with light rain", icon: "11d" };
    else if (wetness > 0.86) condition = { main: "Rain", description: "shower rain", icon: "10d" };
    else if (wetness > 0.72) condition = { main: "Clouds", description: "overcast clouds", icon: "04d" };
    else if (wetness > 0.6) condition = { main: "Drizzle", description: "light drizzle", icon: "09d" };
    else if (wetness > 0.34) condition = { main: "Clouds", description: "scattered clouds", icon: "03d" };
    else condition = { main: "Clear", description: "clear sky", icon: "01d" };

    const kFromC = (value) => round(value + KELVIN, 1);
    const tempAt = (hour, drift = 0) => baseC + swing * Math.sin(((hour - 9.5) / 24) * 2 * Math.PI) + drift;
    const sun = sunTimesFor(latitude, Number(lon) || 0, nowMs + offsetSeconds * 1000);
    const dt = Math.floor(nowMs / 1000);
    const humidity = Math.round(42 + wetness * 48);

    const current = {
      coord: { lat: Number(lat), lon: Number(lon) },
      weather: [condition],
      base: "stations",
      visibility: Math.round((2.5 + rand() * 8.5) * 1000),
      wind: { speed: round(1 + rand() * 8, 1), deg: Math.round(rand() * 360), gust: round(4 + rand() * 14, 1) },
      clouds: { all: Math.round(clamp(wetness * 100 + 10, 0, 100)) },
      dt,
      sys: {
        country: String(label ?? "").split(",").pop().trim().slice(0, 2).toUpperCase() || "DE",
        sunrise: Math.round(sun.sunrise),
        sunset: Math.round(sun.sunset),
      },
      main: {
        temp: kFromC(tempAt(localHour)),
        feels_like: kFromC(tempAt(localHour) - rand() * 2.4 - (humidity > 75 ? 1.5 : 0)),
        temp_min: kFromC(tempAt(5)),
        temp_max: kFromC(tempAt(15)),
        pressure: Math.round(998 + rand() * 28),
        humidity,
      },
      name: String(label || "Demo City").split(",")[0].trim() || "Demo City",
      timezone: offsetSeconds,
      id: 0,
    };

    const wet = condition.main === "Rain" || condition.main === "Drizzle" || condition.main === "Thunderstorm" || condition.main === "Snow";
    const list = [];
    const firstSlot = Math.ceil((localHour + 1) / 3) * 3;
    for (let step = 0; step < 40; step += 1) {
      const slot = firstSlot + step * 3;
      const dayShift = Math.floor(slot / 24);
      const hour = ((slot % 24) + 24) % 24;
      const entryEpoch = Math.floor((nowMs + offsetSeconds * 1000) / 1000);
      const dayStart = Math.floor(entryEpoch / 86400) * 86400 - offsetSeconds;
      const dtEntry = dayStart + dayShift * 86400 + hour * 3600;
      const drift = -step * 0.16 + (rand() - 0.5) * 2.4;
      const tempC = tempAt(hour, drift);
      const pop = clamp((wet ? 0.62 : 0.2) + (rand() - 0.55) * 0.5 - dayShift * 0.02, 0, 1);
      const isWet = pop > 0.45;
      const night = hour < 6 || hour >= 19;
      const iconSuffix = night ? "n" : "d";
      const entryCondition = isWet
        ? condition.main === "Snow"
          ? { main: "Snow", description: "snow", icon: `13${iconSuffix}` }
          : { main: "Rain", description: "light rain", icon: `10${iconSuffix}` }
        : { ...condition, icon: `${condition.icon.slice(0, 2)}${iconSuffix}` };

      list.push({
        dt: dtEntry,
        main: {
          temp: kFromC(tempC),
          feels_like: kFromC(tempC - rand() * 1.8),
          temp_min: kFromC(tempC - 1.1),
          temp_max: kFromC(tempC + 1.3),
          pressure: current.main.pressure + Math.round((rand() - 0.5) * 6),
          humidity: clamp(humidity + Math.round((rand() - 0.5) * 20), 14, 100),
        },
        weather: [entryCondition],
        clouds: { all: Math.round(clamp(current.clouds.all + (rand() - 0.5) * 34, 0, 100)) },
        wind: { speed: round(Math.max(0.4, current.wind.speed + (rand() - 0.5) * 3.4), 1), deg: Math.round(rand() * 360) },
        visibility: current.visibility,
        pop: round(pop, 2),
        rain: isWet && condition.main !== "Snow" ? { "3h": round(pop * 3.2, 2) } : undefined,
        snow: isWet && condition.main === "Snow" ? { "3h": round(pop * 1.8, 2) } : undefined,
        sys: { pod: night ? "n" : "d" },
      });
    }

    const aqiLevel = wetness > 0.93 ? 4 : wetness > 0.68 ? 3 : wetness > 0.4 ? 2 : 1;
    const scale = { 1: 8, 2: 24, 3: 55, 4: 120, 5: 220 }[aqiLevel];
    const air = {
      coord: [Number(lat), Number(lon)],
      list: [
        {
          dt,
          main: { aqi: aqiLevel },
          components: {
            co: round(scale * 58 + rand() * 160, 2),
            no: round(scale * 1.1, 2),
            no2: round(scale * 1.5 + rand() * 9, 2),
            o3: round(scale * 2.3 + rand() * 24, 2),
            so2: round(scale * 0.8 + rand() * 7, 2),
            pm2_5: round(scale * 0.4 + rand() * 3.5, 2),
            pm10: round(scale * 0.92 + rand() * 7, 2),
            nh3: round(scale * 0.3, 2),
          },
        },
      ],
    };

    return {
      current,
      forecast: { list },
      aqi: air,
      alerts: { alerts: [], source: "Demo data", note: "Demo mode never fetches alerts." },
    };
  }

  /* =============================== Application state =============================== */

  const state = {
    settings: {
      units: store.readText(STORAGE_KEYS.units, "metric") === "imperial" ? "imperial" : "metric",
      language: store.readText(STORAGE_KEYS.language, "en"),
      theme: ["light", "dark", "auto"].includes(store.readText(STORAGE_KEYS.theme, "auto"))
        ? store.readText(STORAGE_KEYS.theme, "auto")
        : "auto",
      refreshMinutes: [0, 5, 10, 30].includes(Number(store.readText(STORAGE_KEYS.autoRefresh, "10")))
        ? Number(store.readText(STORAGE_KEYS.autoRefresh, "10"))
        : 10,
      animations: store.readText(STORAGE_KEYS.animations, "on") !== "off",
      oneCallAlerts: store.readText(STORAGE_KEYS.oneCallAlerts, "off") === "on",
    },
    apiKey: null,
    data: null,
    label: null,
    coords: null,
    place: null,
    source: "idle",
    fetchedAt: 0,
    loading: false,
    refreshTimer: null,
    relativeTimer: null,
    resizeTimer: null,
    suggestions: [],
    activeSuggestionIndex: -1,
    suggestionToken: 0,
    suggestionDebounce: null,
    favoritesToken: 0,
    recognition: null,
    isListening: false,
    installPrompt: null,
    lastRequestKey: null,
    demoNoticeShown: false,
    charts: { trend: null, aqi: null },
  };

  /* ================================= Elements ================================= */

  const elements = {
    app: $("app"),
    effects: $("weatherEffects"),
    livePillLabel: $("livePillLabel"),
    themeWeatherLabel: $("themeWeatherLabel"),
    coordLabel: $("coordLabel"),
    updatedLabel: $("updatedLabel"),
    dataSourceLabel: $("dataSourceLabel"),
    unitToggle: $("unitToggle"),
    themeToggle: $("themeToggle"),
    shareBtn: $("shareBtn"),
    settingsBtn: $("settingsBtn"),
    installBtn: $("installBtn"),
    banner: $("dataBanner"),
    bannerText: $("dataBannerText"),
    bannerAction: $("dataBannerAction"),
    bannerDismiss: $("dataBannerDismiss"),
    form: $("searchForm"),
    input: $("cityInput"),
    suggestions: $("suggestionsList"),
    searchBtn: $("searchBtn"),
    voiceBtn: $("voiceBtn"),
    locateBtn: $("locateBtn"),
    refreshBtn: $("refreshBtn"),
    status: $("statusMessage"),
    error: $("errorMessage"),
    retryBtn: $("errorRetryBtn"),
    historyList: $("historyList"),
    favoritesList: $("favoritesList"),
    clearHistoryBtn: $("clearHistoryBtn"),
    clearFavoritesBtn: $("clearFavoritesBtn"),
    favoriteBtn: $("favoriteBtn"),
    currentCity: $("currentCity"),
    currentTime: $("currentTime"),
    currentIconUse: $("currentIconUse"),
    currentIconCaption: $("currentIconCaption"),
    currentTemp: $("currentTemp"),
    tempUnitSymbol: $("tempUnitSymbol"),
    currentCondition: $("currentCondition"),
    currentFeels: $("currentFeels"),
    feelsUnitSymbol: $("feelsUnitSymbol"),
    feelsNote: $("feelsNote"),
    narrative: $("weatherNarrative"),
    highLow: $("currentHighLow"),
    humidity: $("currentHumidity"),
    wind: $("currentWind"),
    rainChance: $("currentRainChance"),
    rainTiming: $("rainTiming"),
    pressure: $("detailPressure"),
    visibility: $("detailVisibility"),
    clouds: $("detailClouds"),
    dewPoint: $("detailDewPoint"),
    gust: $("detailGust"),
    precip: $("detailPrecip"),
    timezone: $("detailTimezone"),
    observed: $("detailObserved"),
    sunrise: $("detailSunrise"),
    sunset: $("detailSunset"),
    dayPhase: $("dayPhaseLabel"),
    sunArcFill: $("sunArcFill"),
    sunArcDot: $("sunArcDot"),
    compassNeedle: $("compassNeedle"),
    compassTicks: document.querySelector(".compass-ticks"),
    compassNote: $("compassNote"),
    windDirection: $("detailWindDirection"),
    aqiValue: $("aqiValue"),
    aqiLabel: $("aqiLabel"),
    aqiLevel: $("aqiLevel"),
    aqiAdvice: $("aqiAdvice"),
    aqiHealthGrid: $("aqiHealthGrid"),
    aqiPollutants: $("aqiPollutants"),
    aqiChart: $("aqiChart"),
    aqiFallback: $("aqiFallback"),
    suggestionsGrid: $("weatherSuggestions"),
    alertsList: $("alertsList"),
    alertsSource: $("alertsSource"),
    alertsBadge: $("alertsBadge"),
    favoriteDashboard: $("favoriteDashboard"),
    favoriteDashboardRefresh: $("favoriteDashboardRefresh"),
    forecastGrid: $("forecastGrid"),
    forecastNote: $("forecastRangeNote"),
    hourlyStrip: $("hourlyStrip"),
    hourlyNote: $("hourlyNote"),
    tempChart: $("tempChart"),
    chartFallback: $("chartFallback"),
    chartSummary: $("chartSummary"),
    footerExtra: $("footerExtra"),
    appVersion: $("appVersion"),
    loadingOverlay: $("loadingOverlay"),
    loadingLabel: $("loadingLabel"),
    toastRegion: $("toastRegion"),
    detailModal: $("detailModal"),
    detailModalTitle: $("detailModalTitle"),
    detailModalBody: $("detailModalBody"),
    closeDetailModal: $("closeDetailModal"),
    settingsModal: $("settingsModal"),
    settingsForm: $("settingsForm"),
    settingsTheme: $("settingsTheme"),
    settingsUnits: $("settingsUnits"),
    settingsLanguage: $("settingsLanguage"),
    settingsRefresh: $("settingsRefresh"),
    settingsAnimations: $("settingsAnimations"),
    settingsOneCall: $("settingsOneCall"),
    settingsApiKey: $("settingsApiKey"),
    saveApiKeyBtn: $("saveApiKeyBtn"),
    testApiKeyBtn: $("testApiKeyBtn"),
    clearApiKeyBtn: $("clearApiKeyBtn"),
    apiKeyStatus: $("apiKeyStatus"),
    settingsMeta: $("settingsMeta"),
    resetDataBtn: $("resetDataBtn"),
  };

  /* ========================== Status, banner, toast ========================== */

  function setStatus(message, tone = "") {
    if (!elements.status) return;
    elements.status.textContent = message || "";
    if (message && tone) elements.status.dataset.tone = tone;
    else delete elements.status.dataset.tone;
  }

  function setError(message, { retry = false } = {}) {
    if (elements.error) elements.error.textContent = message || "";
    if (elements.retryBtn) elements.retryBtn.hidden = !(message && retry);
  }

  const clearError = () => setError("", { retry: false });

  let bannerAction = null;
  let bannerDismissed = null;

  function showBanner(text, action = null) {
    if (!elements.banner) return;
    // A notice the reader dismissed stays gone until something genuinely
    // different needs to be said.
    if (bannerDismissed && bannerDismissed === text) return;
    elements.bannerText.textContent = text;
    bannerAction = action;
    if (action) {
      elements.bannerAction.hidden = false;
      elements.bannerAction.textContent = action.label;
    } else {
      elements.bannerAction.hidden = true;
    }
    elements.banner.dataset.tone = action?.tone || "info";
    elements.banner.hidden = false;
  }

  function hideBanner() {
    if (!elements.banner || elements.banner.hidden) return;
    elements.banner.hidden = true;
    elements.bannerText.textContent = "";
    bannerAction = null;
    bannerDismissed = null;
  }

  function toast(message, options = {}) {
    const { tone = "info", action = null, timeout = 4200 } = options;
    if (!elements.toastRegion) return;
    const node = el("div", `toast toast-${tone}`);
    node.append(el("span", "toast-text", message));

    let actionButton = null;
    if (action) {
      actionButton = el("button", "toast-action", action.label);
      actionButton.type = "button";
      actionButton.addEventListener("click", () => {
        action.onClick?.();
        node.remove();
      });
      node.append(actionButton);
    }

    elements.toastRegion.append(node);
    requestAnimationFrame(() => node.classList.add("is-visible"));
    const dismiss = () => {
      node.classList.add("is-leaving");
      setTimeout(() => node.remove(), 240);
    };
    const timer = setTimeout(dismiss, timeout);
    node.addEventListener("click", (event) => {
      if (event.target === actionButton) return;
      clearTimeout(timer);
      dismiss();
    });
    while (elements.toastRegion.children.length > 3) elements.toastRegion.firstElementChild.remove();
  }

  function setLoading(active, label) {
    state.loading = Boolean(active);
    elements.app?.setAttribute("aria-busy", String(Boolean(active)));
    elements.app?.classList.toggle("is-loading", Boolean(active));
    document.body.classList.toggle("is-busy", Boolean(active));
    if (elements.loadingOverlay) elements.loadingOverlay.setAttribute("aria-hidden", String(!active));
    if (label && elements.loadingLabel) elements.loadingLabel.textContent = label;
  }

  /* ========================= Theme, units, weather scene ========================= */

  const themeMedia = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  const resolvedTheme = () =>
    state.settings.theme === "auto" ? (themeMedia?.matches ? "dark" : "light") : state.settings.theme;

  function applyLanguage() {
    // Descriptions arrive in the chosen language, so the document language should
    // follow it — otherwise a screen reader reads Spanish text with an English voice.
    document.documentElement.lang = state.settings.language || "en";
  }

  function applyTheme({ persist = true } = {}) {
    const theme = resolvedTheme();
    applyLanguage();
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    if (persist) store.writeText(STORAGE_KEYS.theme, state.settings.theme);

    if (elements.themeToggle) {
      elements.themeToggle.innerHTML = `${svgIcon(theme === "dark" ? "i-moon" : "i-sun")}<span class="text">${
        theme === "dark" ? "Dark" : "Light"
      }</span>`;
      elements.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
      elements.themeToggle.title = `Switch to the ${theme === "dark" ? "light" : "dark"} theme (D)`;
    }

    const meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0b1220" : "#0369a1");

    renderCharts();
  }

  function applyWeatherScene(mainCondition) {
    document.body.dataset.weather = themeKeyFor(mainCondition);
    const enabled = state.settings.animations && !prefersReducedMotion() && !document.hidden;
    const effect = enabled ? effectFor(mainCondition) : "none";
    if (elements.effects) elements.effects.dataset.effect = effect;
    document.body.dataset.effect = effect;
  }

  function applyUnitLabels() {
    store.writeText(STORAGE_KEYS.units, state.settings.units);
    if (elements.unitToggle) {
      elements.unitToggle.innerHTML = `<span class="icon" aria-hidden="true">${tempUnit()}</span><span class="text">${
        isMetric() ? "Celsius" : "Fahrenheit"
      }</span>`;
      elements.unitToggle.setAttribute("aria-pressed", String(!isMetric()));
      elements.unitToggle.title = `Switch to ${isMetric() ? "Fahrenheit" : "Celsius"} (U)`;
    }
    if (elements.tempUnitSymbol) elements.tempUnitSymbol.textContent = tempUnit();
    if (elements.feelsUnitSymbol) elements.feelsUnitSymbol.textContent = tempUnit();
  }

  /* ============================== Modal manager ============================== */

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const openModals = [];

  const focusablesIn = (node) =>
    [...node.querySelectorAll(FOCUSABLE)].filter((item) => !item.hidden && item.getAttribute("tabindex") !== "-1");

  function openModal(modal, { focusElement = null } = {}) {
    if (!modal || openModals.includes(modal)) return;
    modal.dataset.returnFocusId = document.activeElement?.id || "";
    modal.hidden = false;
    openModals.push(modal);
    requestAnimationFrame(() => modal.classList.add("is-open"));
    document.body.classList.add("modal-open");
    if (elements.app && "inert" in HTMLElement.prototype) elements.app.inert = true;
    const target = focusElement || focusablesIn(modal)[0];
    setTimeout(() => target?.focus?.(), 30);
  }

  function closeModal(modal) {
    const index = openModals.indexOf(modal);
    if (!modal || index === -1) return;
    openModals.splice(index, 1);
    modal.classList.remove("is-open");
    if (!openModals.length) {
      document.body.classList.remove("modal-open");
      if (elements.app && "inert" in HTMLElement.prototype) elements.app.inert = false;
      const id = modal.dataset.returnFocusId;
      if (id) document.getElementById(id)?.focus?.();
    }
    setTimeout(() => {
      if (!openModals.includes(modal)) modal.hidden = true;
    }, 170);
  }

  function wireModal(modal, closeBtn) {
    if (!modal) return;
    modal.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal(modal);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusablesIn(modal);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    modal.addEventListener("mousedown", (event) => {
      if (event.target === modal) closeModal(modal);
    });
    closeBtn?.addEventListener("click", () => closeModal(modal));
  }

  function showDetailModal(title, html) {
    if (!elements.detailModal) return;
    elements.detailModalTitle.textContent = title;
    elements.detailModalBody.innerHTML = html;
    openModal(elements.detailModal, { focusElement: elements.closeDetailModal });
  }

  const openHelp = () =>
    showDetailModal(
      "Keyboard shortcuts",
      `<dl class="shortcut-list">${SHORTCUTS.map(
        ([keys, description]) => `<div><dt><kbd>${esc(keys)}</kbd></dt><dd>${esc(description)}</dd></div>`
      ).join("")}</dl>
      <p class="modal-foot">Shortcuts pause while you are typing in the search box, and never fire inside dialogs.</p>`
    );

  /* ========================== Suggestions and search ========================== */

  const updateSearchButtonState = () => {
    if (elements.searchBtn) elements.searchBtn.disabled = elements.input.value.trim().length === 0;
  };

  /** Cities this app knows by heart, so search still resolves without a key. */
  function lookupKnownCity(query) {
    const needle = String(query ?? "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ");
    if (!needle) return null;
    return (
      POPULAR_CITIES.find((city) => city.label.toLowerCase() === needle || city.query.toLowerCase() === needle) ??
      POPULAR_CITIES.find((city) => city.label.toLowerCase().startsWith(needle) || city.query.toLowerCase().startsWith(needle)) ??
      null
    );
  }

  function localSuggestions(query) {
    const lower = query.trim().toLowerCase();
    const favorites = readPlaces(STORAGE_KEYS.favorites).map((place) => ({ ...place, source: "Favorite" }));
    const history = readPlaces(STORAGE_KEYS.history).map((place) => ({ ...place, source: "Recent" }));
    const popular = POPULAR_CITIES.map((city) => ({ ...city, source: "Popular" }));
    const seen = new Set();

    return [...favorites, ...history, ...popular]
      .filter((item) => !lower || item.label.toLowerCase().includes(lower))
      .filter((item) => {
        const key = item.label.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, LIMITS.suggestions)
      .map((item) => ({
        label: item.label,
        query: item.query || item.label,
        source: item.source,
        lat: item.lat ?? null,
        lon: item.lon ?? null,
      }));
  }

  async function remoteSuggestions(query) {
    if (query.trim().length < 2 || !hasApiKey()) return [];
    try {
      const data = await geocode(query, 5);
      if (!Array.isArray(data)) return [];
      return data.map((place) => ({
        label: [place.name, place.state, place.country].filter(Boolean).join(", "),
        query: `${place.name}, ${place.country}`,
        source: "Live match",
        lat: place.lat,
        lon: place.lon,
      }));
    } catch (error) {
      return [];
    }
  }

  function renderSuggestions() {
    const list = elements.suggestions;
    list.textContent = "";

    if (!state.suggestions.length) {
      list.classList.remove("open");
      elements.input.setAttribute("aria-expanded", "false");
      elements.input.removeAttribute("aria-activedescendant");
      return;
    }

    state.suggestions.forEach((item, index) => {
      const option = document.createElement("li");
      option.className = index === state.activeSuggestionIndex ? "active" : "";
      option.id = `suggestion-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === state.activeSuggestionIndex));
      option.dataset.index = String(index);
      option.innerHTML = `<span class="suggestion-main">${esc(item.label)}</span><span class="suggestion-sub">${esc(
        item.source
      )}</span>`;
      list.append(option);
    });

    list.classList.add("open");
    elements.input.setAttribute("aria-expanded", "true");
    if (state.activeSuggestionIndex >= 0) {
      elements.input.setAttribute("aria-activedescendant", `suggestion-${state.activeSuggestionIndex}`);
    } else {
      elements.input.removeAttribute("aria-activedescendant");
    }
  }

  function hideSuggestions() {
    if (!state.suggestions.length && !elements.suggestions.classList.contains("open")) return;
    state.suggestions = [];
    state.activeSuggestionIndex = -1;
    renderSuggestions();
  }

  async function refreshSuggestions(query) {
    const token = ++state.suggestionToken;
    const local = localSuggestions(query);

    if (!query.trim()) {
      state.suggestions = local.slice(0, 6);
      state.activeSuggestionIndex = -1;
      renderSuggestions();
      return;
    }

    const remote = await remoteSuggestions(query);
    if (token !== state.suggestionToken) return; // a newer keystroke already answered

    const merged = [...local, ...remote].filter(
      (item, index, items) => items.findIndex((other) => other.label.toLowerCase() === item.label.toLowerCase()) === index
    );
    state.suggestions = merged.slice(0, LIMITS.suggestions);
    state.activeSuggestionIndex = -1;
    renderSuggestions();
  }

  const queueSuggestions = (query) => {
    clearTimeout(state.suggestionDebounce);
    state.suggestionDebounce = setTimeout(() => refreshSuggestions(query), 200);
  };

  async function applySuggestion(index) {
    const picked = state.suggestions[index];
    if (!picked) return;
    elements.input.value = picked.label;
    hideSuggestions();
    updateSearchButtonState();

    if (isNumeric(picked.lat)) {
      await loadWeather(picked.lat, picked.lon, { label: picked.label, remember: true });
    } else {
      await loadWeatherByQuery(picked.query, { labelHint: picked.label, remember: true });
    }
  }

  /* ============================== Rendering ============================== */

  function renderHero(weather) {
    const condition = weather?.weather?.[0] ?? {};
    const offset = weather?.timezone ?? 0;

    elements.currentCity.textContent = state.label || `${weather?.name ?? "Unknown"}, ${weather?.sys?.country ?? ""}`;
    elements.themeWeatherLabel.textContent = capitalize(condition.description || condition.main || "Unavailable");
    elements.coordLabel.textContent = weather?.coord
      ? `${round(weather.coord.lat, 2)}, ${round(weather.coord.lon, 2)}`
      : "--";

    const sources = {
      live: `Live · ${relativeTime(state.fetchedAt)}`,
      snapshot: `Offline · ${relativeTime(state.fetchedAt)}`,
      demo: "Demo data",
      idle: "--",
    };
    document.body.dataset.source = state.source;
    elements.dataSourceLabel.textContent = sources[state.source] ?? "Live";
    elements.dataSourceLabel.dataset.tone = state.source === "live" ? "ok" : "warn";
    elements.livePillLabel.textContent =
      state.source === "demo"
        ? "Demo data · add an API key for live readings"
        : state.source === "snapshot"
        ? "Offline · last saved reading"
        : "Live weather intelligence";

    elements.currentTime.textContent = `Local time ${formatLocal(weather?.dt ?? Date.now() / 1000, offset, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    })} · ${formatOffset(offset)}`;

    tickRelative();
  }

  const getHourIsNight = (epochSeconds, offsetSeconds) => {
    const hour = hourOf(epochSeconds, offsetSeconds);
    return hour < 6 || hour >= 20;
  };

  function renderCurrent(weather, forecast) {
    const condition = weather?.weather?.[0] ?? {};
    const main = weather?.main ?? {};
    const offset = weather?.timezone ?? 0;
    const dayEntries = (forecast?.list ?? []).slice(0, 8);
    const rain = findRainWindow(dayEntries, offset);

    elements.currentCondition.textContent = capitalize(condition.description || condition.main || "Unavailable");
    elements.currentTemp.textContent = formatTemp(main.temp);
    elements.currentFeels.textContent = formatTemp(main.feels_like ?? main.temp);
    elements.feelsNote.textContent = feelsLikeNote(main.temp, main.feels_like ?? main.temp);
    elements.humidity.textContent = isNumeric(main.humidity) ? `${main.humidity}%` : "--";
    elements.highLow.textContent =
      isNumeric(main.temp_max) && isNumeric(main.temp_min)
        ? `${formatDeg(main.temp_max)} / ${formatDeg(main.temp_min)}`
        : "--";
    elements.wind.textContent = isNumeric(weather?.wind?.speed)
      ? `${formatSpeed(weather.wind.speed)} ${speedUnit()}`
      : "--";
    elements.rainChance.textContent = dayEntries.length ? `${round(Math.max(...dayEntries.map((e) => (e.pop || 0) * 100)))}%` : "--";

    elements.currentIconUse.setAttribute("href", `#${iconSymbolFor(condition.icon, condition.main)}`);
    {
      const at = weather?.dt ?? Date.now() / 1000;
      const isNight =
        isNumeric(weather?.sys?.sunrise) && isNumeric(weather?.sys?.sunset)
          ? at < weather.sys.sunrise || at > weather.sys.sunset
          : getHourIsNight(at, weather?.timezone ?? 0);
      elements.currentIconCaption.textContent = isNight ? "Night" : "Daylight";
      document.body.dataset.pod = isNight ? "n" : "d";
    }

    elements.narrative.textContent = buildNarrative(weather, forecast, rain);
    const peak = round(Math.max(0, ...dayEntries.map((entry) => (entry.pop || 0) * 100)));
    elements.rainTiming.textContent = rain.firstWet
      ? `Next likely wet spell around ${rain.label} · ${formatDepth(rain.total)} over 24 h · peak chance ${peak}%`
      : "Nothing wet in the next 24 hours — plan outdoor time freely";

    if (weather) {
      document.title = `${weather.name ?? state.label ?? "Atmosphere Desk"} ${formatDeg(main.temp)} — Atmosphere Desk`;
    }
  }

  function buildNarrative(weather, forecast, rain) {
    const condition = weather?.weather?.[0] ?? {};
    const main = weather?.main ?? {};
    const head = `${capitalize(condition.description || condition.main || "Quiet skies")} over ${
      weather?.name || "this location"
    } at ${formatTemp(main.temp)}${tempUnit()}`;

    const extras = [];
    if (isNumeric(main.humidity)) extras.push(`${main.humidity}% humidity`);
    if (isNumeric(weather?.wind?.speed)) extras.push(`${formatSpeed(weather.wind.speed)} ${speedUnit()} wind`);
    if (isNumeric(weather?.visibility)) extras.push(`${formatDistance(weather.visibility)} visibility`);
    const middle = extras.length ? `, with ${extras.join(", ")}` : "";

    const tail = rain?.firstWet
      ? ` Showers look likely from about ${rain.label}, so bring something waterproof.`
      : ` The next day looks dry, so outdoor plans are safe.`;

    return `${head}${middle}.${tail}`;
  }

  function renderDetails(weather, forecast) {
    const main = weather?.main ?? {};
    const offset = weather?.timezone ?? 0;
    const dayEntries = (forecast?.list ?? []).slice(0, 8);
    const dewC = dewPointC(main.temp, main.humidity);

    elements.pressure.textContent = isNumeric(main.pressure) ? formatPressure(main.pressure) : "--";
    elements.visibility.textContent = isNumeric(weather?.visibility) ? formatDistance(weather.visibility) : "--";
    elements.clouds.textContent = isNumeric(weather?.clouds?.all) ? `${weather.clouds.all}%` : "--";
    elements.dewPoint.textContent =
      dewC === null ? "--" : `${round(toDisplayCelsius(dewC), 1)}° · ${comfortFromDew(dewC)}`;
    elements.gust.textContent = isNumeric(weather?.wind?.gust)
      ? `${formatSpeed(weather.wind.gust)} ${speedUnit()}`
      : "none reported";
    elements.precip.textContent = formatDepth(dayEntries.reduce((sum, entry) => sum + entryDepth(entry), 0));
    elements.timezone.textContent = formatOffset(offset);
    elements.observed.textContent = formatClock(weather?.dt ?? Date.now() / 1000, offset);
    elements.windDirection.textContent = isNumeric(weather?.wind?.deg)
      ? `${windArrow(weather.wind.deg)} · ${round(weather.wind.deg)}°`
      : "--";

    renderSunArc(weather);
    renderCompass(weather);
  }

  function renderSunArc(weather) {
    const sunrise = weather?.sys?.sunrise;
    const sunset = weather?.sys?.sunset;
    const offset = weather?.timezone ?? 0;

    elements.sunrise.textContent = isNumeric(sunrise) ? formatClock(sunrise, offset) : "--";
    elements.sunset.textContent = isNumeric(sunset) ? formatClock(sunset, offset) : "--";

    if (!isNumeric(sunrise) || !isNumeric(sunset) || sunset <= sunrise) {
      elements.dayPhase.textContent = isNumeric(sunrise) ? "Polar day or night" : "No sun data";
      elements.sunArcDot.dataset.night = "true";
      return;
    }

    const now = Date.now() / 1000;
    const arc = elements.sunArcFill;
    arc.setAttribute("pathLength", "100");
    arc.style.strokeDasharray = "100";

    let progress;
    if (now <= sunrise) {
      progress = 0;
      elements.dayPhase.textContent = `Sunrise in ${formatDuration(sunrise - now)}`;
    } else if (now >= sunset) {
      progress = 1;
      const daysToNextSunrise = Math.max(1, Math.ceil((now - sunrise) / 86400));
      const nextSunrise = sunrise + daysToNextSunrise * 86400;
      elements.dayPhase.textContent = now - nextSunrise > 86400
        ? "Night · daylight returns tomorrow"
        : `Night · sunrise in ${formatDuration(nextSunrise - now)}`;
    } else {
      progress = clamp((now - sunrise) / (sunset - sunrise), 0, 1);
      const remaining = sunset - now;
      elements.dayPhase.textContent = remaining > 45 * 60 ? `${formatDuration(remaining)} of daylight left` : "Sunset is close";
    }

    arc.style.strokeDashoffset = String(round((1 - progress) * 100, 1));
    elements.sunArcDot.dataset.night = String(now < sunrise || now > sunset);

    const p0 = { x: 8, y: 66 };
    const p1 = { x: 74, y: -2 };
    const p2 = { x: 140, y: 66 };
    const t = progress;
    elements.sunArcDot.setAttribute("cx", String(round((1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p1.x + t ** 2 * p2.x, 1)));
    elements.sunArcDot.setAttribute("cy", String(round((1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p1.y + t ** 2 * p2.y, 1)));
  }

  function renderCompass(weather) {
    if (elements.compassTicks && !elements.compassTicks.childElementCount) {
      const ns = "http://www.w3.org/2000/svg";
      for (let tick = 0; tick < 24; tick += 1) {
        const line = document.createElementNS(ns, "line");
        const angle = ((tick * 15) * Math.PI) / 180;
        const inner = tick % 6 === 0 ? 34 : 39;
        line.setAttribute("x1", String(round(60 + Math.sin(angle) * inner, 1)));
        line.setAttribute("y1", String(round(60 - Math.cos(angle) * inner, 1)));
        line.setAttribute("x2", String(round(60 + Math.sin(angle) * 44, 1)));
        line.setAttribute("y2", String(round(60 - Math.cos(angle) * 44, 1)));
        line.setAttribute("stroke-width", tick % 6 === 0 ? "2" : "1");
        elements.compassTicks.append(line);
      }
    }

    const deg = weather?.wind?.deg;
    if (!isNumeric(deg)) {
      elements.compassNeedle.style.transform = "rotate(0deg)";
      elements.compassNote.textContent = "Direction unavailable";
      return;
    }
    elements.compassNeedle.style.transform = `rotate(${round(deg)}deg)`;
    const beaufort = beaufortLabel(weather?.wind?.speed ?? 0);
    elements.compassNote.textContent = `From the ${windArrow(deg)} · ${beaufort}`;
  }

  function beaufortLabel(ms) {
    const table = [
      [0.3, "calm"],
      [1.6, "light air"],
      [3.4, "light breeze"],
      [5.5, "gentle breeze"],
      [8.0, "moderate breeze"],
      [10.8, "fresh breeze"],
      [13.9, "strong breeze"],
      [17.2, "near gale"],
      [20.8, "gale"],
      [24.5, "strong gale"],
      [28.5, "storm"],
      [32.7, "violent storm"],
    ];
    for (const [limit, label] of table) if (ms < limit) return label;
    return "hurricane-force";
  }

  function renderForecast(forecast, weather) {
    const offset = weather?.timezone ?? 0;
    const todayKey = dateKeyOf(weather?.dt ?? Date.now() / 1000, offset);
    const days = buildDailyForecast(forecast?.list, offset, todayKey);

    clearNode(elements.forecastGrid);
    if (!days.length) {
      elements.forecastGrid.append(el("p", "empty-state", "The forecast service returned no daily data."));
      elements.forecastNote.textContent = "--";
      return;
    }

    const weekMin = Math.min(...days.map((day) => day.min));
    const weekMax = Math.max(...days.map((day) => day.max));
    const span = Math.max(1, weekMax - weekMin);

    days.forEach((day, index) => {
      const condition = day.midday?.weather?.[0] ?? {};
      const parts = partsForDateKey(day.key);
      const card = el("article", `forecast-card tone-${themeKeyFor(condition.main)}`);
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `${day.isToday ? "Today" : parts.weekday}: ${formatDeg(day.max)} high, ${formatDeg(
        day.min
      )} low, ${round(day.pop * 100)}% rain chance.`);
      card.innerHTML = `
        <p class="forecast-date">${esc(day.isToday ? "Today" : `${parts.weekday}, ${parts.label}`)}</p>
        <svg class="wx-ico" aria-hidden="true"><use href="#${iconSymbolFor(condition.icon, condition.main)}"></use></svg>
        <p class="forecast-temp"><strong>${formatDeg(day.max)}</strong><span>${formatDeg(day.min)}</span></p>
        <div class="temp-range"><span style="left:${round(((day.min - weekMin) / span) * 100)}%;width:${round(
        ((day.max - day.min) / span) * 100,
        1
      )}%"></span></div>
        <p class="forecast-meta">${esc(capitalize(condition.description || condition.main || ""))}</p>
        <p class="forecast-rain">${round(day.pop * 100)}% rain · ${formatDepth(day.depth)}</p>
        <p class="forecast-wind">${svgIcon("i-wind", "ico-inline")} ${formatSpeed(day.wind)} ${speedUnit()} gusts</p>
      `;
      const open = () => showDayDetails(day, offset);
      card.addEventListener("click", open);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      });
      elements.forecastGrid.append(card);
    });

    const warmest = days.reduce((best, day) => (day.max > best.max ? day : best), days[0]);
    const coolest = days.reduce((best, day) => (day.min < best.min ? day : best), days[0]);
    const warmestLabel = warmest.isToday ? "today" : partsForDateKey(warmest.key).weekday;
    const coolestLabel = coolest.isToday ? "tonight" : partsForDateKey(coolest.key).weekday;
    elements.forecastNote.textContent = `${days.length}-day outlook · warmest ${warmestLabel} at ${formatDeg(
      warmest.max
    )}, coolest low ${coolestLabel} at ${formatDeg(coolest.min)}`;
  }

  function showDayDetails(day, offset) {
    const condition = day.midday?.weather?.[0] ?? {};
    const parts = partsForDateKey(day.key);
    showDetailModal(
      day.isToday ? "Today in detail" : `${parts.weekday}, ${parts.label}`,
      `<p class="modal-lede">${svgIcon(iconSymbolFor(condition.icon, condition.main), "modal-wx")} ${esc(
        capitalize(condition.description || condition.main || "")
      )}</p>
      <dl class="modal-grid">
        <div><dt>High</dt><dd>${formatTemp(day.max)}${tempUnit()}</dd></div>
        <div><dt>Low</dt><dd>${formatTemp(day.min)}${tempUnit()}</dd></div>
        <div><dt>Rain chance</dt><dd>${round(day.pop * 100)}%</dd></div>
        <div><dt>Precipitation</dt><dd>${formatDepth(day.depth)}</dd></div>
        <div><dt>Peak wind</dt><dd>${formatSpeed(day.wind)} ${speedUnit()}</dd></div>
        <div><dt>Peak humidity</dt><dd>${day.humidity}%</dd></div>
      </dl>
      <p class="modal-foot">Assembled from 3-hourly slots; the midday slot is shown for the icon and description. All times are local (${formatOffset(
        offset
      )}).</p>`
    );
  }

  function renderHourly(forecast, weather) {
    const offset = weather?.timezone ?? 0;
    const entries = (forecast?.list ?? []).slice(0, 8);
    const rain = findRainWindow(entries, offset);

    clearNode(elements.hourlyStrip);
    elements.hourlyStrip.setAttribute("aria-label", `${entries.length} three-hourly forecast cards`);

    entries.forEach((entry, index) => {
      const condition = entry.weather?.[0] ?? {};
      const card = el("article", `hour-card${entry.sys?.pod === "n" ? " is-night" : ""}`);
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.innerHTML = `
        <p class="hour-time">${index === 0 ? "Now" : esc(formatClock(entry.dt, offset, { hour: "numeric", minute: "2-digit" }))}</p>
        <svg class="wx-ico" aria-hidden="true"><use href="#${iconSymbolFor(condition.icon, condition.main)}"></use></svg>
        <p class="hour-temp">${formatTemp(entry.main?.temp)}${tempUnit()}</p>
        <p class="hour-rain">${round((entry.pop || 0) * 100)}% rain</p>
        <p class="hour-wind">${formatSpeed(entry.wind?.speed ?? 0)} ${speedUnit()}</p>
      `;
      card.addEventListener("click", () => showHourDetails(entry, offset, index));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          showHourDetails(entry, offset, index);
        }
      });
      elements.hourlyStrip.append(card);
    });

    elements.hourlyNote.textContent = rain.firstWet ? `wet spell from ~${rain.label}` : "dry for 24 hours";
  }

  function showHourDetails(entry, offset, index) {
    const condition = entry.weather?.[0] ?? {};
    const when = index === 0 ? "Now" : formatClock(entry.dt, offset, { weekday: "short", hour: "numeric", minute: "2-digit" });
    showDetailModal(
      `${when} · ${state.label ?? ""}`,
      `<dl class="modal-grid">
        <div><dt>Condition</dt><dd>${esc(capitalize(condition.description || condition.main || ""))}</dd></div>
        <div><dt>Temperature</dt><dd>${formatTemp(entry.main?.temp)}${tempUnit()}</dd></div>
        <div><dt>Feels like</dt><dd>${formatTemp(entry.main?.feels_like ?? entry.main?.temp)}${tempUnit()}</dd></div>
        <div><dt>Rain chance</dt><dd>${round((entry.pop || 0) * 100)}%</dd></div>
        <div><dt>Precipitation</dt><dd>${formatDepth(entryDepth(entry))}</dd></div>
        <div><dt>Wind</dt><dd>${formatSpeed(entry.wind?.speed ?? 0)} ${speedUnit()} from ${esc(windArrow(entry.wind?.deg))}</dd></div>
        <div><dt>Humidity</dt><dd>${entry.main?.humidity ?? "--"}%</dd></div>
        <div><dt>Cloud cover</dt><dd>${entry.clouds?.all ?? "--"}%</dd></div>
        <div><dt>Pressure</dt><dd>${isNumeric(entry.main?.pressure) ? formatPressure(entry.main.pressure) : "--"}</dd></div>
        <div><dt>Daylight</dt><dd>${entry.sys?.pod === "n" ? "Night" : "Day"}</dd></div>
      </dl>`
    );
  }

  function renderAqi(aqiResponse) {
    const summary = summarizeAirQuality(aqiResponse);
    clearNode(elements.aqiHealthGrid);
    elements.aqiPollutants.innerHTML = "";

    if (!summary) {
      elements.aqiValue.textContent = "--";
      elements.aqiValue.style.setProperty("--aqi-progress", "0");
      delete elements.aqiValue.dataset.level;
      elements.aqiLabel.textContent = "Unavailable";
      elements.aqiLevel.textContent = "No coverage here";
      elements.aqiAdvice.textContent = "This location is outside the air-quality grid right now.";
      elements.aqiHealthGrid.append(el("p", "empty-state", "Nothing to report — the air-quality feed returned no reading."));
      elements.aqiPollutants.hidden = true;
      renderAqiChart(null);
      return;
    }

    const level = AQI_LEVELS[summary.level] ?? AQI_LEVELS[3];
    elements.aqiValue.textContent = summary.value;
    elements.aqiValue.style.setProperty("--aqi-progress", String(summary.level * 20));
    elements.aqiValue.dataset.level = String(summary.level);
    elements.aqiLabel.textContent = level.name;
    elements.aqiLevel.textContent = `Level ${summary.level} of 5${summary.precise ? "" : " (category)"}`;
    elements.aqiAdvice.textContent = level.advice;
    elements.aqiPollutants.hidden = false;

    level.cards.forEach((text) => elements.aqiHealthGrid.append(el("article", "aqi-health-card", text)));

    const components = summary.components ?? {};
    let shown = 0;
    POLLUTANTS.forEach((pollutant) => {
      const value = components[pollutant.key];
      if (!isNumeric(value)) return;
      shown += 1;
      const ratio = clamp(value / pollutant.limit, 0, 1);
      const grade = ratio < 0.25 ? "good" : ratio < 0.5 ? "fair" : ratio < 0.78 ? "poor" : "bad";
      const row = el("div", `pollutant-row grade-${grade}`);
      row.title = pollutant.note;
      row.innerHTML = `
        <span class="pollutant-name">${esc(pollutant.label)}</span>
        <span class="pollutant-bar"><i style="width:${round(ratio * 100, 1)}%"></i></span>
        <span class="pollutant-value">${round(value, 1)} <small>µg/m³</small></span>
      `;
      elements.aqiPollutants.append(row);
    });
    elements.aqiPollutants.hidden = shown === 0;

    renderAqiChart(summary.level);
  }

  /* ====================== Advice, alerts, charts, favorites ====================== */

  function buildSuggestions(weather, forecast, aqiResponse) {
    const condition = String(weather?.weather?.[0]?.main ?? "").toLowerCase();
    const main = weather?.main ?? {};
    const offset = weather?.timezone ?? 0;
    const dayEntries = (forecast?.list ?? []).slice(0, 8);
    const rain = findRainWindow(dayEntries, offset);
    const pop = round(Math.max(0, ...dayEntries.map((entry) => (entry.pop || 0) * 100)));
    const summary = summarizeAirQuality(aqiResponse);
    const tempC = isNumeric(main.temp) ? main.temp - KELVIN : null;
    const dewC = dewPointC(main.temp, main.humidity);
    const items = [];

    if (condition.includes("rain") || condition.includes("drizzle") || pop >= 50) {
      items.push({
        icon: "wx-rain",
        title: "Take the umbrella",
        text: rain.firstWet
          ? `${pop}% peak rain chance in the next 24 hours, with a wet spell near ${rain.label}. Leave ten minutes early and wear shoes you do not mind soaking.`
          : `${pop}% chance of measurable rain over the next 24 hours — a shell is worth the bag space.`,
      });
    }
    if (condition.includes("snow")) {
      items.push({
        icon: "wx-snow",
        title: "Travel slowly",
        text: "Snow expected. Double your following distance, keep a blanket and water in the car, and start the walk early.",
      });
    }
    if (tempC !== null && tempC >= 29 && (condition.includes("clear") || condition.includes("cloud"))) {
      items.push({
        icon: "wx-clear-day",
        title: "Sun discipline",
        text: "Hot and bright. Refill water before you are thirsty, seek shade after 40 minutes outdoors, and cover the back of your neck.",
      });
    }
    if (tempC !== null && tempC <= 2) {
      items.push({
        icon: "wx-snow",
        title: "Cover up",
        text: "Near or below freezing. Gloves, a hat and one more layer than feels necessary make the walk pleasant.",
      });
    }
    if (dewC !== null && dewC >= 18 && tempC !== null && tempC >= 24) {
      items.push({
        icon: "wx-mist",
        title: "Muggy, so go easy",
        text: `Dew point around ${round(isMetric() ? dewC : (dewC * 9) / 5 + 32)}° means sweat barely evaporates. Move hard efforts to early morning.`,
      });
    }
    if ((weather?.wind?.speed ?? 0) >= 10) {
      items.push({
        icon: "i-wind",
        title: "Secure loose things",
        text: `Gusts of ${formatSpeed(weather.wind.gust ?? weather.wind.speed)} ${speedUnit()} will flip umbrellas and push a cyclist sideways. Clear the balcony.`,
      });
    }
    if (isNumeric(weather?.visibility) && weather.visibility < 2000) {
      items.push({
        icon: "wx-mist",
        title: "Low visibility",
        text: `Only ${formatDistance(weather.visibility)} of clear view. Use lights on the bike and leave extra distance on the road.`,
      });
    }
    if (summary && summary.level >= 4) {
      items.push({
        icon: "wx-mist",
        title: "Keep it indoors",
        text: `AQI ${summary.value} is ${AQI_LEVELS[summary.level].name.toLowerCase()}. Cancel outdoor training and run the air filter.`,
      });
    } else if (summary && summary.level === 3) {
      items.push({
        icon: "wx-mist",
        title: "Shorten hard efforts",
        text: `AQI ${summary.value} is moderate — long intense sessions are kinder indoors today.`,
      });
    }
    if (isNumeric(main.pressure)) {
      if (main.pressure <= 1000) {
        items.push({
          icon: "i-alert",
          title: "A front is moving in",
          text: `Pressure of ${round(main.pressure)} hPa is low, so conditions are likely to change within about 12 hours.`,
        });
      } else if (main.pressure >= 1026) {
        items.push({
          icon: "wx-clear-day",
          title: "Settled air",
          text: `High pressure at ${round(main.pressure)} hPa usually brings calm, clear skies — and cold, still mornings.`,
        });
      }
    }
    if (!items.length) {
      items.push({
        icon: "wx-clear-day",
        title: "Good to go",
        text: "Nothing in these numbers asks you to change plans. Comfortable conditions ahead.",
      });
    }

    return items.slice(0, 4);
  }

  function renderAdvice(weather, forecast, aqiResponse) {
    clearNode(elements.suggestionsGrid);
    buildSuggestions(weather, forecast, aqiResponse).forEach((item) => {
      const card = el("article", "suggestion-card");
      const glyph = item.icon.startsWith("wx-")
        ? `<svg class="wx-ico suggestion-ico" aria-hidden="true"><use href="#${esc(item.icon)}"></use></svg>`
        : svgIcon(item.icon, "ico suggestion-ico");
      card.innerHTML = `${glyph}<div><strong>${esc(item.title)}</strong><span>${esc(item.text)}</span></div>`;
      elements.suggestionsGrid.append(card);
    });
  }

  const SEVERITY_LABEL = { extreme: "Extreme", severe: "Severe", moderate: "Moderate", minor: "Minor", unknown: "Advisory" };

  function renderAlerts(payload) {
    const alerts = payload?.alerts ?? [];
    clearNode(elements.alertsList);

    elements.alertsBadge.hidden = alerts.length === 0;
    elements.alertsBadge.textContent = String(alerts.length);
    elements.alertsBadge.dataset.level = alerts.length ? "on" : "off";

    if (payload?.source && !payload.unavailable) {
      const usOnly = state.source === "live" && inUnitedStates(state.coords?.lat ?? 0, state.coords?.lon ?? 0);
      elements.alertsSource.textContent = `${payload.source}${usOnly ? " (US points only)" : ""}`;
    } else if (payload?.unavailable) {
      elements.alertsSource.textContent = "Alert feed unreachable right now";
    } else {
      elements.alertsSource.textContent = "US locations use NWS automatically; enable One Call in Settings elsewhere";
    }

    if (!alerts.length) {
      const calm = !payload?.unavailable;
      const card = el("article", `alert-card ${calm ? "calm" : "unknown"}`);
      card.innerHTML = `${svgIcon("i-alert", "ico")}<div><strong>${
        calm ? "No active alerts" : "Alerts unavailable"
      }</strong><span>${
        calm
          ? "No official warning is in effect for this location."
          : "The alert service did not answer. Your other data is unaffected — try again shortly."
      }</span></div>`;
      elements.alertsList.append(card);
      return;
    }

    const windowLabel = (ms) =>
      isNumeric(ms)
        ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
            new Date(ms)
          )
        : null;

    alerts.forEach((alert) => {
      const severity = SEVERITY_LABEL[alert.severity] ? alert.severity : "unknown";
      const card = el("article", `alert-card severe sev-${severity}`);
      const start = windowLabel(alert.startsMs);
      const end = windowLabel(alert.endsMs);
      const timing = start || end ? `${start ?? "now"} → ${end ?? "until further notice"}` : "timing unavailable";
      const description = alert.description || "Follow local guidance and stay aware of changing conditions.";
      card.innerHTML = `
        <p class="alert-top">${svgIcon("i-alert", "ico")}<strong>${esc(alert.event)}</strong><span class="sev-tag">${esc(
        SEVERITY_LABEL[severity]
      )}</span></p>
        <p class="alert-when">${esc(timing)}${alert.areas ? ` · ${esc(alert.areas)}` : ""}</p>
        <p class="alert-desc">${esc(description.slice(0, 260))}${description.length > 260 ? "…" : ""}</p>
        <details class="alert-more"><summary>Full alert text</summary><pre>${esc(description)}${
        alert.instruction ? `\n\nInstructions\n${esc(alert.instruction)}` : ""
      }</pre></details>
        <p class="alert-sender">${esc(alert.sender)}</p>
      `;
      elements.alertsList.append(card);
    });
  }

  /* ================================== Charts ================================== */

  function chartTheme() {
    const dark = resolvedTheme() === "dark";
    return {
      dark,
      accent: dark ? "#38bdf8" : "#0369a1",
      rain: dark ? "#f472b6" : "#db2777",
      text: dark ? "#cbd5e1" : "#475569",
      grid: dark ? "rgba(71, 85, 105, 0.35)" : "rgba(148, 163, 184, 0.3)",
      surface: dark ? "rgba(56, 189, 248, 0.18)" : "rgba(3, 105, 161, 0.12)",
      chip: dark ? "#1e293b" : "#e2e8f0",
    };
  }

  function renderCharts() {
    if (!state.data?.forecast) return;
    renderTrendChart(state.data.forecast, state.data.current?.timezone ?? 0);
    renderAqiChart(summarizeAirQuality(state.data.aqi)?.level ?? null);
  }

  function renderTrendChart(forecast, offset) {
    const entries = forecast?.list ?? [];
    const labels = entries.slice(0, 8).map((entry, index) =>
      index === 0 ? "Now" : formatClock(entry.dt, offset, { hour: "numeric", minute: "2-digit" })
    );
    const temps = entries.slice(0, 8).map((entry) => round(toDisplayTemp(entry.main?.temp ?? KELVIN), 1));
    const rain = entries.slice(0, 8).map((entry) => round((entry.pop || 0) * 100));

    const summary = temps.length
      ? `Temperature moves between ${round(Math.min(...temps), 1)}${tempUnit()} and ${round(Math.max(...temps), 1)}${tempUnit()} over the next 24 hours; rain chance peaks at ${Math.max(
          ...rain
        )}%.`
      : "No trend data available.";
    elements.chartSummary.textContent = summary;

    if (typeof Chart === "undefined" || !elements.tempChart) {
      renderChartFallback(labels, temps, rain);
      return;
    }

    elements.chartFallback.hidden = true;
    elements.tempChart.hidden = false;

    const theme = chartTheme();
    state.charts.trend?.destroy();
    state.charts.trend = new Chart(elements.tempChart, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: `Temperature (${tempUnit()})`,
            data: temps,
            borderColor: theme.accent,
            backgroundColor: theme.surface,
            yAxisID: "y",
            tension: 0.4,
            fill: true,
            borderWidth: 2.4,
            pointRadius: 4,
            pointBackgroundColor: theme.accent,
            pointBorderColor: theme.dark ? "#0b1220" : "#ffffff",
            pointBorderWidth: 2,
          },
          {
            label: "Rain chance",
            data: rain,
            borderColor: theme.rain,
            backgroundColor: "transparent",
            yAxisID: "y1",
            tension: 0.35,
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 3,
            pointBackgroundColor: theme.rain,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: prefersReducedMotion() ? false : { duration: 520 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { labels: { color: theme.text, usePointStyle: true, boxHeight: 8, padding: 14 } },
          tooltip: {
            callbacks: {
              label: (context) =>
                context.datasetIndex === 0 ? ` ${context.parsed.y}°${tempUnit()}` : ` ${context.parsed.y}% chance of rain`,
            },
          },
        },
        scales: {
          y: { ticks: { color: theme.text, callback: (value) => `${value}°` }, grid: { color: theme.grid } },
          y1: { beginAtZero: true, max: 100, position: "right", ticks: { color: theme.rain, stepSize: 25 }, grid: { drawOnChartArea: false } },
          x: { ticks: { color: theme.text, maxRotation: 0, autoSkipPadding: 10 }, grid: { color: "transparent" } },
        },
      },
    });
    elements.tempChart.setAttribute("aria-label", `24 hour temperature and rain trend. ${summary}`);
  }

  /** Inline SVG keeps the trend panel useful when Chart.js is unavailable. */
  function renderChartFallback(labels, temps, rain) {
    if (!elements.chartFallback) return;
    const width = 720;
    const height = 220;
    const pad = 28;
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const span = Math.max(1, max - min);
    const step = labels.length > 1 ? (width - pad * 2) / (labels.length - 1) : 0;
    const theme = chartTheme();

    const points = temps.map((value, index) => ({
      x: pad + index * step,
      y: height - pad - ((value - min) / span) * (height - pad * 2),
    }));
    const line = points.map((point, index) => `${index ? "L" : "M"}${round(point.x, 1)} ${round(point.y, 1)}`).join(" ");
    const area = points.length
      ? `${line} L${round(points[points.length - 1].x, 1)} ${height - pad} L${pad} ${height - pad} Z`
      : "";
    const bars = rain
      .map((value, index) => {
        const barHeight = (value / 100) * (height - pad * 2);
        return `<rect class="cf-bar" x="${round(points[index].x - 7, 1)}" y="${round(height - pad - barHeight, 1)}" width="14" height="${round(
          barHeight,
          1
        )}" rx="3"><title>${esc(labels[index])}: ${value}% rain chance</title></rect>`;
      })
      .join("");
    const dots = points
      .map(
        (point, index) =>
          `<circle class="cf-dot" cx="${round(point.x, 1)}" cy="${round(point.y, 1)}" r="3.4"><title>${esc(
            labels[index]
          )}: ${temps[index]}°</title></circle>`
      )
      .join("");
    const ticks = labels
      .map(
        (label, index) =>
          `<text class="cf-label" x="${round(points[index].x, 1)}" y="${height - 8}" text-anchor="middle">${esc(label)}</text>`
      )
      .join("");

    elements.tempChart.hidden = true;
    elements.chartFallback.hidden = false;
    elements.chartFallback.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(elements.chartSummary.textContent)}">
        <defs>
          <linearGradient id="cfFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${theme.accent}" stop-opacity="0.32" />
            <stop offset="1" stop-color="${theme.accent}" stop-opacity="0.02" />
          </linearGradient>
        </defs>
        ${bars}
        <path d="${area}" fill="url(#cfFill)" />
        <path class="cf-line" d="${line}" fill="none" stroke="${theme.accent}" />
        ${dots}
        ${ticks}
      </svg>
      <p class="cf-legend"><span class="swatch swatch-line"></span>Temperature · <span class="swatch swatch-bar"></span>Rain chance</p>`;
  }

  function renderAqiChart(level) {
    const labels = ["Good", "Fair", "Moderate", "Poor", "Very poor"];
    const colors = ["#22c55e", "#84cc16", "#f59e0b", "#f97316", "#ef4444"];

    if (typeof Chart === "undefined" || !elements.aqiChart) {
      if (elements.aqiChart) elements.aqiChart.hidden = true;
      if (elements.aqiFallback) {
        elements.aqiFallback.hidden = false;
        elements.aqiFallback.innerHTML = `<div class="aqi-segments">${labels
          .map(
            (label, index) =>
              `<span class="aqi-seg${index + 1 === level ? " is-active" : ""}" style="--seg:${colors[index]}"><i></i><em>${esc(
                label
              )}</em></span>`
          )
          .join("")}</div>`;
      }
      return;
    }

    elements.aqiChart.hidden = false;
    elements.aqiFallback.hidden = true;

    const theme = chartTheme();
    state.charts.aqi?.destroy();
    state.charts.aqi = new Chart(elements.aqiChart, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data: labels.map(() => 1),
            backgroundColor: labels.map((_, index) => (index + 1 === level ? colors[index] : theme.chip)),
            borderWidth: 0,
            hoverOffset: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        rotation: -90,
        animation: prefersReducedMotion() ? false : { duration: 450 },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (context) => ` ${context.label} — level ${context.dataIndex + 1}` } },
        },
      },
    });
    elements.aqiChart.setAttribute(
      "aria-label",
      `Air quality dial highlighting ${level ? labels[level - 1] : "no data"}.`
    );
  }

  /* ==================== History, favorites, dashboard, sharing ==================== */

  const rememberPlace = (list, place, limit) => [place, ...list.filter((item) => item.label !== place.label)].slice(0, limit);

  function saveHistory(place) {
    store.write(STORAGE_KEYS.history, rememberPlace(readPlaces(STORAGE_KEYS.history), place, LIMITS.history));
    renderHistory();
  }

  function renderHistory() {
    const history = readPlaces(STORAGE_KEYS.history).slice(0, LIMITS.history);
    clearNode(elements.historyList);
    if (!history.length) elements.historyList.append(el("span", "chip empty", "Nothing searched yet"));
    history.forEach((place) => elements.historyList.append(chipFor(place)));
    elements.clearHistoryBtn.disabled = !history.length;
  }

  const readFavorites = () => readPlaces(STORAGE_KEYS.favorites);

  function chipFor(place, { onRemove } = {}) {
    const wrap = el("span", "chip-wrap");
    const chip = el("button", "chip", place.label);
    chip.type = "button";
    chip.title = `Load weather for ${place.label}`;
    chip.addEventListener("click", () => {
      if (isNumeric(place.lat)) loadWeather(place.lat, place.lon, { label: place.label });
      else loadWeatherByQuery(place.query || place.label, { labelHint: place.label });
    });
    wrap.append(chip);

    if (onRemove) {
      const remove = el("button", "chip-x", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${place.label} from favorites`);
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        onRemove(place);
      });
      wrap.append(remove);
    }
    return wrap;
  }

  function renderFavorites() {
    const favorites = readFavorites();
    clearNode(elements.favoritesList);
    if (!favorites.length) elements.favoritesList.append(el("span", "chip empty", "No favorites yet — tap the star"));
    favorites.forEach((place) =>
      elements.favoritesList.append(
        chipFor(place, {
          onRemove: (target) => {
            const next = favorites.filter((item) => item.label !== target.label);
            writePlaces(STORAGE_KEYS.favorites, next);
            renderFavorites();
            renderFavoriteDashboard(next);
            toast(`${target.label} removed from favorites.`);
          },
        })
      )
    );
    elements.clearFavoritesBtn.disabled = !favorites.length;

    const isFavorite = favorites.some((place) => place.label === state.label);
    elements.favoriteBtn.classList.toggle("active", isFavorite);
    elements.favoriteBtn.setAttribute("aria-pressed", String(isFavorite));
    elements.favoriteBtn.setAttribute("aria-label", isFavorite ? "Remove this city from favorites" : "Save this city as a favorite");
    elements.favoriteBtn.title = `${isFavorite ? "Remove from" : "Add to"} favorites (F)`;
    elements.favoriteBtn.innerHTML = svgIcon(isFavorite ? "i-star-filled" : "i-star", "ico");
  }

  function toggleFavorite() {
    if (!state.label || !state.place) {
      toast("Load a location first, then save it.", { tone: "warn" });
      return;
    }
    const favorites = readFavorites();
    const existing = favorites.find((place) => place.label === state.label);
    const next = existing
      ? favorites.filter((place) => place.label !== state.label)
      : rememberPlace(favorites, { ...state.place, savedAt: Date.now() }, LIMITS.favorites);

    writePlaces(STORAGE_KEYS.favorites, next);
    renderFavorites();
    renderFavoriteDashboard(next);
    toast(existing ? `${state.label} removed from favorites.` : `${state.label} pinned to your dashboard.`, {
      tone: existing ? "info" : "success",
    });
  }

  function renderFavoriteDashboardCards(cards) {
    clearNode(elements.favoriteDashboard);
    if (!cards.length) {
      elements.favoriteDashboard.append(
        el("article", "favorite-weather-card empty", "Tap the star on any city and it gets a permanent live card here.")
      );
      return;
    }

    cards.forEach(({ place, weather, error }) => {
      if (!weather) {
        const card = el("article", "favorite-weather-card failed");
        card.innerHTML = `<span class="favorite-city">${esc(place.label)}</span><span class="favorite-temp">--</span><span class="favorite-meta">${esc(
          error ?? "Unavailable right now"
        )}</span>`;
        elements.favoriteDashboard.append(card);
        return;
      }
      const condition = weather.weather?.[0] ?? {};
      const card = el("button", "favorite-weather-card");
      card.type = "button";
      card.title = `Open the full dashboard for ${place.label}`;
      card.innerHTML = `
        <span class="favorite-city">${esc(place.label)}</span>
        <span class="favorite-row">
          <svg class="wx-ico" aria-hidden="true"><use href="#${iconSymbolFor(condition.icon, condition.main)}"></use></svg>
          <span class="favorite-temp">${formatTemp(weather.main?.temp)}${tempUnit()}</span>
        </span>
        <span class="favorite-meta">${esc(capitalize(condition.description || condition.main || ""))}</span>
        <span class="favorite-wind">${svgIcon("i-wind", "ico-inline")} ${formatSpeed(weather.wind?.speed ?? 0)} ${speedUnit()} · ${
        weather.main?.humidity ?? "--"
      }% humidity</span>
      `;
      card.addEventListener("click", () =>
        isNumeric(place.lat)
          ? loadWeather(place.lat, place.lon, { label: place.label, remember: true })
          : loadWeatherByQuery(place.query || place.label, { labelHint: place.label, remember: true })
      );
      elements.favoriteDashboard.append(card);
    });
  }

  async function renderFavoriteDashboard(favorites = readFavorites()) {
    const token = ++state.favoritesToken;
    const places = favorites.slice(0, LIMITS.favoritesShown);

    if (!places.length) {
      renderFavoriteDashboardCards([]);
      return;
    }

    clearNode(elements.favoriteDashboard);
    places.forEach(() => elements.favoriteDashboard.append(el("article", "favorite-weather-card skeleton-card")));

    const settled = await Promise.allSettled(
      places.map(async (place) => {
        let resolved = place;
        if (!isNumeric(resolved.lat)) {
          const found = await geocodeOne(resolved.query || resolved.label);
          resolved = {
            ...place,
            lat: found.lat,
            lon: found.lon,
            query: `${found.name}, ${found.country}`,
          };
          // Save the resolved coordinates so the next visit skips geocoding.
          writePlaces(
            STORAGE_KEYS.favorites,
            readFavorites().map((item) => (item.label === place.label ? resolved : item))
          );
        }
        return { place: resolved, weather: await fetchCurrent(resolved.lat, resolved.lon) };
      })
    );

    if (token !== state.favoritesToken) return; // favorites changed while fetching
    renderFavoriteDashboardCards(
      settled.map((result, index) =>
        result.status === "fulfilled" ? result.value : { place: places[index], error: "Unavailable right now" }
      )
    );
  }

  function syncUrl() {
    if (!state.coords) return;
    try {
      const url = new URL(window.location.href);
      url.search = "";
      url.searchParams.set("lat", q(state.coords.lat));
      url.searchParams.set("lon", q(state.coords.lon));
      if (state.label) url.searchParams.set("city", state.label);
      window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    } catch (error) {
      /* file:// or a blocked history object: deep links are just unavailable */
    }
  }

  async function shareLocation() {
    if (!state.coords) {
      toast("Load a location first, then copy its link.", { tone: "warn" });
      return;
    }
    const url = window.location.href;
    const title = `Weather in ${state.label}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text: "Live conditions, forecast and air quality", url });
        toast("Shared.", { tone: "success", timeout: 2200 });
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast("Link to this location copied.", { tone: "success" });
        return;
      }
      window.prompt("Copy this link", url);
    } catch (error) {
      if (error?.name !== "AbortError") window.prompt("Copy this link", url);
    }
  }

  /* ========================== Render orchestration ========================== */

  function renderAll({ refreshCharts = true } = {}) {
    const data = state.data;
    if (!data?.current) return;
    const { current, forecast, aqi, alerts } = data;
    applyWeatherScene(current.weather?.[0]?.main);
    renderHero(current);
    renderCurrent(current, forecast);
    renderDetails(current, forecast);
    renderForecast(forecast, current);
    renderHourly(forecast, current);
    renderAqi(aqi);
    renderAdvice(current, forecast, aqi);
    renderAlerts(alerts);
    if (refreshCharts) renderCharts();
    renderFavorites();
    scheduleRefresh();
  }

  /* ============================== Data loading ============================== */

  async function loadWeather(lat, lon, options = {}) {
    const { label = null, remember = true, silent = false, force = false } = options;
    if (!isNumeric(lat) || !isNumeric(lon)) return;

    const requestKey = `${q(lat)},${q(lon)},${state.settings.language},${state.settings.units}`;

    if (force) {
      memo.clear();
      state.lastRequestKey = null;
    } else if (state.data && requestKey === state.lastRequestKey && Date.now() - state.fetchedAt < TTL.current) {
      // Same place, same settings, fresh enough: re-render instead of re-request.
      renderAll();
      setStatus(`Reusing the reading from ${relativeTime(state.fetchedAt)} · press R to force a new fetch.`, "info");
      setLoading(false);
      return;
    }
    state.lastRequestKey = requestKey;

    if (!hasApiKey()) {
      enterDemoMode(lat, lon, label, "No API key is configured yet.");
      return;
    }

    if (!silent) {
      setLoading(true, "Fetching conditions, forecast, air quality and alerts…");
      clearError();
    }

    const settled = await Promise.allSettled([
      fetchCurrent(lat, lon),
      fetchForecast(lat, lon),
      fetchAirQuality(lat, lon),
      fetchAlerts(lat, lon),
    ]);
    const [currentResult, forecastResult, aqiResult, alertsResult] = settled;

    if (currentResult.status === "fulfilled" && forecastResult.status === "fulfilled") {
      const current = currentResult.value;
      current.name = current.name || String(label || "").split(",")[0] || "Current location";
      current.timezone = isNumeric(current.timezone) ? current.timezone : 0;

      state.data = {
        current,
        forecast: forecastResult.value,
        aqi: aqiResult.status === "fulfilled" ? aqiResult.value : null,
        alerts: alertsResult.status === "fulfilled" ? alertsResult.value : { alerts: [], source: null, unavailable: true },
      };
      state.source = "live";
      state.fetchedAt = Date.now();
      state.label = label || [current.name, current.sys?.country].filter(Boolean).join(", ");
      state.coords = { lat: Number(lat), lon: Number(lon) };
      state.place = { label: state.label, query: state.label, lat: Number(lat), lon: Number(lon), savedAt: Date.now() };

      if (aqiResult.status === "rejected") {
        showBanner("Air quality has no coverage for this spot — everything else is live.", {
          label: "Retry air quality",
          tone: "info",
          onClick: () => {
            memo.clear();
            state.lastRequestKey = null;
            loadWeather(lat, lon, { label: state.label, remember: false, silent: true });
          },
        });
      } else {
        hideBanner();
      }

      renderAll({ refreshCharts: false });
      finishLoad(remember, silent);
      return;
    }

    const reason = currentResult.reason ?? forecastResult.reason;
    const code = reason?.code ?? "network";
    const labelOrLat = label || `${round(lat, 2)}, ${round(lon, 2)}`;

    if (code === "key") {
      store.remove(STORAGE_KEYS.snapshot);
      enterDemoMode(lat, lon, label, "OpenWeather rejected the current API key.");
      return;
    }

    const unreachable = ["offline", "network", "timeout", "server", "http", "not-found"].includes(code);
    if (unreachable) {
      const snapshot = readSnapshot();
      if (snapshot?.data) {
        state.data = snapshot.data;
        state.source = "snapshot";
        state.fetchedAt = snapshot.savedAt ?? Date.now();
        state.label = snapshot.label ?? state.label;
        state.coords = { lat: snapshot.lat ?? Number(lat), lon: snapshot.lon ?? Number(lon) };
        renderAll();
        showBanner(`Offline — this is the reading saved ${relativeTime(state.fetchedAt)}.`, {
          label: "Try again",
          tone: "warn",
          onClick: () => loadWeather(state.coords.lat, state.coords.lon, { remember: false, force: true }),
        });
        setStatus("Offline mode: showing cached data.", "warn");
        setLoading(false);
        return;
      }
      enterDemoMode(lat, lon, label, `The weather service could not be reached for ${labelOrLat}.`);
      return;
    }

    setLoading(false);
    setError(reason?.message ?? "Weather data could not be loaded.", { retry: true });
    setStatus(
      code === "rate-limit" ? "The free quota refills shortly — try again in a minute." : "",
      code === "rate-limit" ? "warn" : "error"
    );
  }

  function enterDemoMode(lat, lon, label, reason) {
    const demo = buildDemoDataset(lat, lon, label);
    state.data = demo;
    state.source = "demo";
    state.fetchedAt = Date.now();
    state.coords = { lat: Number(lat), lon: Number(lon) };
    state.label = label || demo.current.name;
    state.place = { label: state.label, query: state.label, lat: Number(lat), lon: Number(lon), savedAt: Date.now() };
    renderAll();
    setLoading(false);
    setStatus("Demo mode — these numbers are generated, not observed.", "warn");
    showBanner(`${reason} You can explore everything the dashboard does with generated demo figures, then add a free OpenWeather key for live data.`, {
      label: "Add API key",
      tone: "warn",
      onClick: openSettings,
    });
    setError("", { retry: false });
    if (!state.demoNoticeShown) {
      state.demoNoticeShown = true;
      toast("Demo mode active. Settings → API key to go live.", { tone: "warn", timeout: 6500 });
    }
  }

  function finishLoad(remember, silent) {
    setLoading(false);
    renderCharts();
    persistSnapshot();
    store.write(STORAGE_KEYS.lastPlace, state.place);
    syncUrl();
    if (remember) saveHistory(state.place);
    renderFavoriteDashboard();
    scheduleRefresh();
    tickRelative();

    const offset = state.data?.current?.timezone ?? 0;
    const when = formatLocal(state.data?.current?.dt ?? Date.now() / 1000, offset, {
      hour: "numeric",
      minute: "2-digit",
    });
    const missing = [];
    if (!state.data?.aqi) missing.push("air quality");
    if (!state.data?.alerts?.source) missing.push("alerts");

    if (missing.length) {
      setStatus(`Updated ${when} local · no ${missing.join(" and no ")} here.`, "warn");
    } else {
      setStatus(`Updated ${when} local · ${relativeTime(state.fetchedAt)}`, "success");
      if (!silent) hideBanner();
    }
  }

  async function loadWeatherByQuery(query, options = {}) {
    const { labelHint = null, remember = true, silent = false } = options;
    const trimmed = String(query ?? "").trim();
    if (!trimmed) return;

    if (!silent) {
      setLoading(true, `Looking up “${trimmed}”…`);
      clearError();
      setStatus("Finding that place…");
    }

    if (!hasApiKey()) {
      const known = lookupKnownCity(trimmed);
      if (!known) {
        setLoading(false);
        setStatus("", "");
        setError(
          `Locating “${trimmed}” needs an API key. Known cities such as ${POPULAR_CITIES.slice(0, 4)
            .map((city) => city.label.split(",")[0])
            .join(", ")} work in demo mode.`,
          { retry: false }
        );
        return;
      }
      enterDemoMode(known.lat, known.lon, known.label, "Search ran without an API key, so this is generated demo weather.");
      return;
    }

    try {
      const place = await geocodeOne(trimmed);
      await loadWeather(place.lat, place.lon, {
        label: labelHint || [place.name, place.state, place.country].filter(Boolean).join(", "),
        remember,
        silent,
      });
    } catch (error) {
      setLoading(false);
      setStatus("", "");
      const known = lookupKnownCity(trimmed);
      if (known && error?.code !== "not-found") {
        enterDemoMode(
          known.lat,
          known.lon,
          known.label,
          error?.code === "key"
            ? "City lookup needs a working API key."
            : (error?.message ?? "The weather service is unreachable.")
        );
        return;
      }
      setError(error?.message ?? `No match for \u201c${trimmed}\u201d.`, { retry: error?.code !== "not-found" });
    }
  }

  async function refresh({ force = true } = {}) {
    if (!state.coords) {
      toast("Search for a city first.", { tone: "warn" });
      return;
    }
    if (state.source === "demo") {
      memo.clear();
      state.lastRequestKey = null;
      await loadWeather(state.coords.lat, state.coords.lon, { label: state.label, remember: false });
      return;
    }
    await loadWeather(state.coords.lat, state.coords.lon, {
      label: state.label,
      remember: false,
      force,
    });
    const outcomes = {
      live: ["Weather refreshed.", "success"],
      snapshot: ["Still offline — showing the last saved reading.", "warn"],
      demo: ["Live data is unavailable, so the dashboard is running on demo figures.", "warn"],
    };
    const [message, tone] = outcomes[state.source] ?? ["Weather refreshed.", "success"];
    toast(message, { tone, timeout: 2400 });
  }

  function persistSnapshot() {
    if (!state.data || !state.coords || state.source === "demo") return;
    store.write(STORAGE_KEYS.snapshot, {
      label: state.label,
      lat: state.coords.lat,
      lon: state.coords.lon,
      savedAt: Date.now(),
      data: state.data,
    });
  }

  const readSnapshot = () => store.read(STORAGE_KEYS.snapshot, null);

  /* ============================ Timers and lifecycle ============================ */

  function scheduleRefresh() {
    clearInterval(state.refreshTimer);
    const minutes = state.settings.refreshMinutes;
    if (!minutes || state.source === "demo") return;

    state.refreshTimer = setInterval(() => {
      if (document.hidden || !state.coords) return;
      if (Date.now() - state.fetchedAt < minutes * 60000 - 4000) return;
      loadWeather(state.coords.lat, state.coords.lon, { label: state.label, remember: false, silent: true }).then(() => {
        if (state.source !== "live") return;
        setStatus(
          `Auto-refreshed at ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date())}`,
          "success"
        );
      });
    }, 60000);
  }

  function tickRelative() {
    if (!elements.updatedLabel) return;
    elements.updatedLabel.textContent = state.fetchedAt ? relativeTime(state.fetchedAt) : "--";
    const stale = state.fetchedAt && Date.now() - state.fetchedAt > 60 * 60 * 1000;
    elements.updatedLabel.dataset.tone = stale ? "warn" : "ok";
    elements.updatedLabel.title = stale
      ? "This reading is over an hour old — press R to refresh."
      : "Age of the last successful update.";
  }

  /* ================================ Settings ================================ */

  function syncSettingsForm() {
    if (!elements.settingsForm) return;
    elements.settingsTheme.value = state.settings.theme;
    elements.settingsUnits.value = state.settings.units;
    elements.settingsLanguage.value = state.settings.language;
    elements.settingsRefresh.value = String(state.settings.refreshMinutes);
    elements.settingsAnimations.checked = state.settings.animations;
    elements.settingsOneCall.checked = state.settings.oneCallAlerts;
    elements.settingsApiKey.value = store.readText(STORAGE_KEYS.apiKey, "");
    elements.apiKeyStatus.textContent = `Key in use: ${describeKeySource()}.`;
    elements.apiKeyStatus.dataset.tone = hasApiKey() ? "ok" : "warn";
    const snapshotAge = readSnapshot()?.savedAt;
    elements.settingsMeta.textContent =
      `This browser holds ${readPlaces(STORAGE_KEYS.history).length} recent place(s), ${
        readPlaces(STORAGE_KEYS.favorites).length
      } favorite(s) and ${
        snapshotAge ? `an offline snapshot from ${relativeTime(snapshotAge)}` : "no offline snapshot yet"
      }. Only the API and the US alert service see your requests, and coordinates are rounded to ~11 m.`;
  }

  function openSettings() {
    syncSettingsForm();
    openModal(elements.settingsModal, { focusElement: elements.settingsTheme });
  }

  function commitSettings() {
    let reload = false;

    if (elements.settingsTheme.value !== state.settings.theme) {
      state.settings.theme = elements.settingsTheme.value;
      applyTheme();
    }
    if (elements.settingsUnits.value !== state.settings.units) {
      state.settings.units = elements.settingsUnits.value;
      applyUnitLabels();
      if (state.data) renderAll({ refreshCharts: true }); // units are render-only: no refetch
    }
    if (elements.settingsLanguage.value !== state.settings.language) {
      state.settings.language = elements.settingsLanguage.value;
      store.writeText(STORAGE_KEYS.language, state.settings.language);
      applyLanguage();
      reload = true;
    }
    const minutes = Number(elements.settingsRefresh.value);
    if (minutes !== state.settings.refreshMinutes) {
      state.settings.refreshMinutes = minutes;
      store.writeText(STORAGE_KEYS.autoRefresh, String(minutes));
      scheduleRefresh();
      toast(minutes ? `Auto-refreshing every ${minutes} min.` : "Auto-refresh off.", { tone: "info", timeout: 2400 });
    }
    if (elements.settingsAnimations.checked !== state.settings.animations) {
      state.settings.animations = elements.settingsAnimations.checked;
      store.writeText(STORAGE_KEYS.animations, state.settings.animations ? "on" : "off");
      applyWeatherScene(state.data?.current?.weather?.[0]?.main ?? "");
    }
    if (elements.settingsOneCall.checked !== state.settings.oneCallAlerts) {
      state.settings.oneCallAlerts = elements.settingsOneCall.checked;
      store.writeText(STORAGE_KEYS.oneCallAlerts, state.settings.oneCallAlerts ? "on" : "off");
      reload = true;
    }

    if (reload && state.coords) {
      memo.clear();
      state.lastRequestKey = null;
      loadWeather(state.coords.lat, state.coords.lon, { label: state.label, remember: false, silent: true });
    }
    syncSettingsForm();
    setStatus("Settings saved.", "success");
  }

  async function testApiKey() {
    const candidate = elements.settingsApiKey.value.trim() || apiKey();
    if (!candidate) {
      elements.apiKeyStatus.dataset.tone = "warn";
      elements.apiKeyStatus.textContent = "Paste a key first.";
      return;
    }
    const previous = state.apiKey;
    state.apiKey = candidate;
    elements.apiKeyStatus.textContent = "Testing against London…";
    try {
      const data = await requestJson(buildUrl(`${ENDPOINTS.api}/weather`, { lat: 51.5072, lon: -0.1276, appid: candidate }), {
        retries: 0,
        timeoutMs: 9000,
        label: "Key test",
      });
      elements.apiKeyStatus.dataset.tone = "ok";
      elements.apiKeyStatus.textContent = `Working — London reports ${round((data.main?.temp ?? KELVIN) - KELVIN)}°C right now.`;
      toast("API key verified.", { tone: "success" });
      if (candidate !== store.readText(STORAGE_KEYS.apiKey, "")) {
        setStatus("Key works but is not saved yet — press Save to keep it.", "warn");
      }
    } catch (error) {
      elements.apiKeyStatus.dataset.tone = "bad";
      elements.apiKeyStatus.textContent =
        error?.code === "key"
          ? "Rejected — that key is not valid for the free weather endpoint. New keys can take two hours to activate."
          : error?.code === "rate-limit"
          ? "Valid key, but rate limited right now. Try again in a minute."
          : `Could not verify it: ${error?.message ?? "network error"}`;
    } finally {
      state.apiKey = previous;
    }
  }

  function saveApiKey() {
    const value = elements.settingsApiKey.value.trim();
    if (!value) {
      store.remove(STORAGE_KEYS.apiKey);
      toast("Saved key cleared.", { tone: "info" });
    } else {
      store.writeText(STORAGE_KEYS.apiKey, value);
      toast("API key saved in this browser.", { tone: "success" });
    }
    state.apiKey = null;
    memo.clear();
    state.lastRequestKey = null;
    syncSettingsForm();
    if (state.coords) {
      loadWeather(state.coords.lat, state.coords.lon, { label: state.label, remember: false, silent: true });
    } else {
      loadWeatherByQuery("New York", { remember: false });
    }
  }

  function resetSavedData() {
    Object.values(STORAGE_KEYS)
      .filter((key) => key !== STORAGE_KEYS.apiKey)
      .forEach((key) => store.remove(key));
    state.data = null;
    state.source = "idle";
    state.fetchedAt = 0;
    renderHistory();
    renderFavorites();
    renderFavoriteDashboardCards([]);
    syncSettingsForm();
    closeModal(elements.settingsModal);
    toast("Saved data erased (your API key was kept).", { tone: "success", timeout: 5200 });
    loadWeatherByQuery("New York", { remember: false });
  }

  /* ========================= Search and input handlers ========================= */

  async function handleSearch(event) {
    event.preventDefault();
    const query = elements.input.value.trim();
    if (!query) {
      setError("Type a city, postcode or place name first.");
      elements.input.focus();
      return;
    }
    hideSuggestions();
    const exact = state.suggestions.find((item) => item.label === query && isNumeric(item.lat));
    if (exact) {
      await loadWeather(exact.lat, exact.lon, { label: exact.label, remember: true, force: true });
      return;
    }
    await loadWeatherByQuery(query, { remember: true });
  }

  function handleLocate() {
    if (!navigator.geolocation) {
      setError("This browser does not offer location access.");
      return;
    }
    clearError();
    setStatus("Asking the browser for your location…", "info");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setStatus("Location found.", "success");
        loadWeather(position.coords.latitude, position.coords.longitude, { remember: true, force: true });
      },
      (error) => {
        setStatus("", "");
        setError(
          error.code === 1
            ? "Location permission denied — search by name instead."
            : "No fix on your location right now. Search by name instead.",
          { retry: true }
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    );
  }

  function handleInputKeydown(event) {
    const open = state.suggestions.length > 0 && elements.suggestions.classList.contains("open");
    if (!open) {
      if (event.key === "Escape") elements.input.blur();
      return;
    }
    const last = state.suggestions.length - 1;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      state.activeSuggestionIndex = state.activeSuggestionIndex >= last ? 0 : state.activeSuggestionIndex + 1;
      renderSuggestions();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      state.activeSuggestionIndex = state.activeSuggestionIndex <= 0 ? last : state.activeSuggestionIndex - 1;
      renderSuggestions();
    } else if (event.key === "Enter" && state.activeSuggestionIndex >= 0) {
      event.preventDefault();
      applySuggestion(state.activeSuggestionIndex);
    } else if (event.key === "Escape") {
      hideSuggestions();
    }
  }

  function setupVoice() {
    if (!elements.voiceBtn) return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      elements.voiceBtn.disabled = true;
      elements.voiceBtn.title = "Voice search needs Chrome, Edge or Safari";
      elements.voiceBtn.classList.add("is-unavailable");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.addEventListener("start", () => {
      state.isListening = true;
      elements.voiceBtn.classList.add("is-listening");
      elements.voiceBtn.setAttribute("aria-pressed", "true");
      clearError();
      setStatus("Listening — say a city name…", "info");
    });

    recognition.addEventListener("result", async (event) => {
      const results = event.results;
      if (!results?.length) return;
      const result = results[results.length - 1];
      const transcript = String(result?.[0]?.transcript ?? "").trim();
      if (!transcript) return;

      elements.input.value = transcript;
      updateSearchButtonState();
      if (!result.isFinal) return;

      hideSuggestions();
      try {
        recognition.stop();
      } catch (error) {
        /* already ended */
      }
      await loadWeatherByQuery(transcript, { remember: true });
    });

    recognition.addEventListener("end", () => {
      state.isListening = false;
      elements.voiceBtn.classList.remove("is-listening");
      elements.voiceBtn.setAttribute("aria-pressed", "false");
    });

    recognition.addEventListener("error", (event) => {
      const code = event.error;
      setError(
        code === "not-allowed" || code === "service-not-allowed"
          ? "Microphone access is blocked for this page."
          : code === "no-speech"
          ? "No speech detected — try again."
          : "Voice search did not recognise a city.",
        { retry: false }
      );
      setStatus("", "");
    });

    state.recognition = recognition;
  }

  function handleVoice() {
    if (!state.recognition) return;
    if (state.isListening) {
      state.recognition.stop();
      return;
    }
    try {
      state.recognition.start();
    } catch (error) {
      try {
        state.recognition.abort();
      } catch (inner) {
        /* nothing to abort */
      }
      setStatus("Restarting the voice session…", "info");
    }
  }

  /* ============================ PWA and service worker ============================ */

  function setupPwa() {
    if (window.matchMedia?.("(display-mode: standalone)").matches && elements.installBtn) {
      elements.installBtn.hidden = true;
    }

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      state.installPrompt = event;
      if (elements.installBtn) elements.installBtn.hidden = false;
      toast("You can install this dashboard as an app.", {
        tone: "info",
        timeout: 6000,
        action: {
          label: "Install",
          onClick: () => elements.installBtn?.click(),
        },
      });
    });

    window.addEventListener("appinstalled", () => {
      state.installPrompt = null;
      if (elements.installBtn) elements.installBtn.hidden = true;
      toast("Installed — launch it from your app list.", { tone: "success" });
    });

    elements.installBtn?.addEventListener("click", async () => {
      if (!state.installPrompt) return;
      state.installPrompt.prompt();
      const choice = await state.installPrompt.userChoice.catch(() => ({ outcome: "dismissed" }));
      state.installPrompt = null;
      if (choice?.outcome !== "accepted" && elements.installBtn) elements.installBtn.hidden = false;
    });

    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;

    window.addEventListener("load", async () => {
      try {
        const registration = await navigator.serviceWorker.register("service-worker.js");
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state !== "installed" || !navigator.serviceWorker.controller) return;
            toast("New version of Atmosphere Desk is ready.", {
              tone: "info",
              timeout: 10000,
              action: { label: "Reload", onClick: () => window.location.reload() },
            });
          });
        });
      } catch (error) {
        setStatus("Offline caching is unavailable in this context.", "warn");
      }
    });
  }

  /* ============================== Event wiring ============================== */

  function openDetail(key) {
    const help = DETAIL_HELP[key];
    if (!help) return;
    const [title, body] = help;
    const current = state.data?.current;
    const dewNow = current ? dewPointC(current.main?.temp, current.main?.humidity) : null;
    const dewText = dewNow === null ? "" : `${round(toDisplayCelsius(dewNow), 1)}°${tempUnit()}`;
    const extras = {
      wind: current
        ? `<p class="modal-lede">${round(current.wind?.deg ?? 0)}° — blowing from the ${esc(
            windArrow(current.wind?.deg)
          )}, ${esc(beaufortLabel(current.wind?.speed ?? 0))}.</p>`
        : "",
      dew: dewText ? `<p class="modal-lede">Right now the dew point is about ${dewText} — ${esc(comfortFromDew(dewNow))}.</p>` : "",
      humidity: dewText ? `<p class="modal-lede">A dew point near ${dewText} is what makes this air feel the way it does on skin.</p>` : "",
    };
    showDetailModal(title, `<p>${esc(body)}</p>${extras[key] ?? ""}`);
  }

  function wireEvents() {
    elements.form.addEventListener("submit", handleSearch);

    elements.input.addEventListener("input", () => {
      clearError();
      updateSearchButtonState();
      queueSuggestions(elements.input.value);
    });
    elements.input.addEventListener("focus", () => refreshSuggestions(elements.input.value));
    elements.input.addEventListener("keydown", handleInputKeydown);
    window.addEventListener("pagehide", hideSuggestions);

    elements.suggestions.addEventListener("pointerdown", (event) => {
      const option = event.target.closest("li[data-index]");
      if (!option) return;
      event.preventDefault();
      applySuggestion(Number(option.dataset.index));
    });
    elements.suggestions.addEventListener("mousemove", (event) => {
      const option = event.target.closest("li[data-index]");
      if (!option) return;
      const index = Number(option.dataset.index);
      if (index === state.activeSuggestionIndex) return;
      state.activeSuggestionIndex = index;
      renderSuggestions();
    });

    document.addEventListener("click", (event) => {
      if (!event.target.closest(".search-panel")) hideSuggestions();
    });

    elements.locateBtn.addEventListener("click", handleLocate);
    elements.refreshBtn.addEventListener("click", () => refresh());
    elements.shareBtn?.addEventListener("click", shareLocation);
    elements.favoriteBtn.addEventListener("click", toggleFavorite);
    elements.voiceBtn?.addEventListener("click", handleVoice);
    elements.retryBtn?.addEventListener("click", () => refresh());
    elements.bannerAction?.addEventListener("click", () => bannerAction?.onClick?.());
    elements.bannerDismiss?.addEventListener("click", () => {
      bannerDismissed = elements.bannerText.textContent;
      elements.banner.hidden = true;
      bannerAction = null;
      elements.input.focus();
    });

    elements.themeToggle.addEventListener("click", () => {
      state.settings.theme = resolvedTheme() === "dark" ? "light" : "dark";
      applyTheme();
      toast(`${capitalize(state.settings.theme)} theme selected.`, { tone: "info", timeout: 2000 });
    });

    elements.unitToggle.addEventListener("click", () => {
      state.settings.units = isMetric() ? "imperial" : "metric";
      applyUnitLabels();
      if (state.data) renderAll({ refreshCharts: true });
      toast(`Showing ${isMetric() ? "Celsius" : "Fahrenheit"} — no refetch needed.`, { tone: "info", timeout: 2400 });
    });

    elements.clearHistoryBtn.addEventListener("click", () => {
      store.write(STORAGE_KEYS.history, []);
      renderHistory();
      toast("Recent searches cleared.", { tone: "info" });
    });
    elements.clearFavoritesBtn.addEventListener("click", () => {
      store.write(STORAGE_KEYS.favorites, []);
      renderFavorites();
      renderFavoriteDashboardCards([]);
      toast("Favorites cleared.", { tone: "info" });
    });
    elements.favoriteDashboardRefresh?.addEventListener("click", () => {
      memo.clear();
      renderFavoriteDashboard();
      toast("Favorite cards reloaded.", { tone: "info", timeout: 1800 });
    });

    /* Metric tiles and detail cards open an explainer. */
    document.addEventListener("click", (event) => {
      const target = event.target.closest("[data-detail]");
      if (target) openDetail(target.dataset.detail);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target.closest?.("[data-detail]");
      if (!target || openModals.length) return;
      event.preventDefault();
      openDetail(target.dataset.detail);
    });

    elements.settingsBtn.addEventListener("click", openSettings);
    elements.settingsForm.addEventListener("change", commitSettings);
    elements.saveApiKeyBtn.addEventListener("click", saveApiKey);
    elements.testApiKeyBtn.addEventListener("click", testApiKey);
    elements.clearApiKeyBtn.addEventListener("click", () => {
      elements.settingsApiKey.value = "";
      store.remove(STORAGE_KEYS.apiKey);
      state.apiKey = null;
      memo.clear();
      state.lastRequestKey = null;
      syncSettingsForm();
      toast(BUILT_IN_API_KEY ? "Falling back to the built-in key." : "No key — demo mode.", { tone: "info" });
      if (state.coords) loadWeather(state.coords.lat, state.coords.lon, { label: state.label, remember: false, silent: true });
    });
    elements.resetDataBtn.addEventListener("click", resetSavedData);
    elements.settingsApiKey.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveApiKey();
      }
    });

    wireModal(elements.detailModal, elements.closeDetailModal);
    wireModal(elements.settingsModal, elements.closeSettingsModal);

    document.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;

      if (event.key === "Escape") {
        if (openModals.length) {
          closeModal(openModals[openModals.length - 1]);
          return;
        }
        if (elements.suggestions.classList.contains("open")) {
          hideSuggestions();
          return;
        }
        if (typing) event.target.blur();
        return;
      }

      if (typing || openModals.length) return;

      switch (event.key) {
        case "/":
          event.preventDefault();
          elements.input.focus();
          elements.input.select();
          break;
        case "?":
          event.preventDefault();
          openHelp();
          break;
        case "r":
        case "R":
          event.preventDefault();
          refresh();
          break;
        case "u":
        case "U":
          event.preventDefault();
          elements.unitToggle.click();
          break;
        case "d":
        case "D":
          event.preventDefault();
          elements.themeToggle.click();
          break;
        case "f":
        case "F":
          event.preventDefault();
          toggleFavorite();
          break;
        case "s":
        case "S":
          event.preventDefault();
          openSettings();
          break;
        default:
          break;
      }
    });

    themeMedia?.addEventListener?.("change", () => {
      if (state.settings.theme === "auto") applyTheme({ persist: false });
    });

    document.addEventListener("visibilitychange", () => {
      applyWeatherScene(state.data?.current?.weather?.[0]?.main ?? "");
      if (document.hidden) return;
      tickRelative();
      const minutes = state.settings.refreshMinutes || 10;
      if (state.coords && state.source !== "demo" && Date.now() - state.fetchedAt > minutes * 60000) {
        loadWeather(state.coords.lat, state.coords.lon, { label: state.label, remember: false, silent: true });
      }
    });

    window.addEventListener("online", () => {
      toast("Back online — refreshing.", { tone: "success" });
      if (state.coords) loadWeather(state.coords.lat, state.coords.lon, { label: state.label, remember: false, silent: true });
    });

    window.addEventListener("offline", () => {
      state.source = state.data ? "snapshot" : "idle";
      renderHero(state.data?.current);
      showBanner("You are offline. The dashboard keeps showing the last saved reading.", { tone: "warn" });
      setStatus("Offline mode.", "warn");
    });

    window.addEventListener("resize", () => {
      clearTimeout(state.resizeTimer);
      state.resizeTimer = setTimeout(() => renderCharts(), 220);
    });

    window.addEventListener("unhandledrejection", (event) => {
      console.warn("Atmosphere Desk caught an unhandled rejection:", event.reason);
    });
  }

  /* ================================== Boot ================================== */

  function applyUrlOverrides() {
    let params = new URLSearchParams();
    try {
      params = new URLSearchParams(window.location.search);
      const units = params.get("units");
      if (units === "imperial" || units === "metric") state.settings.units = units;
      const theme = params.get("theme");
      if (["light", "dark", "auto"].includes(theme)) state.settings.theme = theme;
      const language = params.get("lang");
      if (language && elements.settingsLanguage?.querySelector(`option[value="${language.replace(/["\\]/g, "")}"]`)) {
        state.settings.language = language;
      }
      if (params.get("apikey") || params.get("appid")) {
        elements.footerExtra.textContent = " · API key read from the link for this page view only";
      }
    } catch (error) {
      /* URLSearchParams is universally available; ignore odd hosts */
    }
    return params;
  }

  /** Only accept a coordinate that is actually present and inside its range. */
  function parseCoordinate(raw, limit) {
    if (raw === null || raw === undefined || String(raw).trim() === "") return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || Math.abs(value) > limit) return null;
    return value;
  }

  async function resolveInitialTarget(params) {
    const lat = parseCoordinate(params.get("lat"), 90);
    const lon = parseCoordinate(params.get("lon"), 180);
    const city = String(params.get("city") ?? "").trim();
    const last = store.read(STORAGE_KEYS.lastPlace, null);
    const snapshot = readSnapshot();

    if (lat !== null && lon !== null) {
      return { kind: "coords", lat, lon, label: city || null };
    }
    if (city) return { kind: "query", query: city };

    if (snapshot?.data?.current) {
      state.data = snapshot.data;
      state.source = "snapshot";
      state.fetchedAt = snapshot.savedAt ?? Date.now();
      state.label = snapshot.label ?? null;
      state.coords = { lat: snapshot.lat, lon: snapshot.lon };
      state.place = { label: state.label, query: state.label, lat: snapshot.lat, lon: snapshot.lon };
      renderAll({ refreshCharts: true });
      showBanner(`Showing the reading saved ${relativeTime(state.fetchedAt)} while the live fetch runs…`, { tone: "info" });
      return { kind: "coords", lat: snapshot.lat, lon: snapshot.lon, label: state.label, quiet: true };
    }

    if (isNumeric(last?.lat)) return { kind: "coords", lat: last.lat, lon: last.lon, label: last.label ?? null };
    return { kind: "query", query: "New York" };
  }

  async function boot() {
    if (elements.appVersion) elements.appVersion.textContent = APP_VERSION;

    const params = applyUrlOverrides();
    applyUnitLabels();
    applyTheme({ persist: false });
    applyWeatherScene("");
    renderHistory();
    renderFavorites();
    renderFavoriteDashboardCards([]);
    updateSearchButtonState();
    setupVoice();
    setupPwa();
    wireEvents();
    syncSettingsForm();

    state.relativeTimer = setInterval(tickRelative, 30000);

    if (readKeyFromUrl()) {
      toast("API key taken from the link and used for this visit only. Save it in Settings to keep it.", {
        tone: "info",
        timeout: 8000,
      });
    }

    const target = await resolveInitialTarget(params);
    if (target.kind === "coords") {
      await loadWeather(target.lat, target.lon, { label: target.label, remember: false, silent: Boolean(target.quiet) });
    } else {
      await loadWeatherByQuery(target.query, { remember: false });
    }

    // Manifest shortcuts: ?locate=1 and ?focus=search.
    if (params.get("locate") === "1") handleLocate();
    if (params.get("focus") === "search") {
      elements.input.focus();
      elements.input.select();
    }
  }

  const start = () => {
    boot().catch((error) => {
      console.error("Atmosphere Desk failed to start:", error);
      setLoading(false);
      setError("The dashboard hit an unexpected error while starting up.", { retry: true });
    });
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  /* A small surface for debugging and the unit tests, without polluting globals. */
  window.WeatherDesk = {
    state,
    helpers: {
      esc,
      calculateAqi,
      levelFromAqi,
      summarizeAirQuality,
      buildDailyForecast,
      buildDemoDataset,
      dewPointC,
      comfortFromDew,
      feelsLikeNote,
      formatOffset,
      iconSymbolFor,
      themeKeyFor,
      effectFor,
      relativeTime,
      findRainWindow,
      sunTimesFor,
      windArrow,
      beaufortLabel,
      toDisplayTemp,
    },
    reload: () => window.location.reload(),
  };
})();
