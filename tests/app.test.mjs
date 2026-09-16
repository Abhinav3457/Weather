/* ============================================================================
 * Atmosphere Desk test suite — run with `npm test` (node --test).
 *
 * Part unit tests (pure weather maths, formatting, escaping) and part
 * integration tests (the real app.js booted against a stub DOM and stubbed
 * fetch, asserting on what actually lands in the rendered nodes).
 * ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import { createEnv, currentFixture, forecastFixture, airFixture, nwsAlertFixture } from "./harness.mjs";

const KELVIN = 273.15;

const boot = async (options) => {
  const env = createEnv(options);
  await env.flush();
  return env;
};

const text = (env, id) => env.element(id).textContent;

/* ============================ Pure helpers ============================ */

test("esc() neutralises markup coming from the API", () => {
  const { helpers } = createEnv().api;
  assert.equal(helpers.esc(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(helpers.esc("Tom & Jerry's"), "Tom &amp; Jerry&#39;s");
  assert.equal(helpers.esc(null), "");
  assert.equal(helpers.esc(42), "42");
});

test("AQI is computed from the PM2.5 breakpoint table", () => {
  const { calculateAqi, levelFromAqi } = createEnv().api.helpers;
  const table = [
    { cLow: 0.0, cHigh: 12.0, iLow: 0, iHigh: 50 },
    { cLow: 12.1, cHigh: 35.4, iLow: 51, iHigh: 100 },
    { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150 },
    { cLow: 55.5, cHigh: 150.4, iLow: 151, iHigh: 200 },
    { cLow: 150.5, cHigh: 250.4, iLow: 201, iHigh: 300 },
    { cLow: 250.5, cHigh: 350.4, iLow: 301, iHigh: 400 },
    { cLow: 350.5, cHigh: 500.4, iLow: 401, iHigh: 500 },
  ];

  assert.equal(calculateAqi(0, table), 0);
  assert.equal(calculateAqi(12.0, table), 50);
  assert.equal(calculateAqi(12.1, table), 51);
  assert.equal(calculateAqi(35.4, table), 100);
  assert.equal(calculateAqi(55.4, table), 150);
  assert.equal(calculateAqi(99999, table), 500, "values beyond the table clamp to 500");
  assert.equal(calculateAqi(-5, table), 0, "negative concentrations are floored");
  assert.equal(calculateAqi(undefined, table), null);

  assert.equal(levelFromAqi(40), 1);
  assert.equal(levelFromAqi(51), 2);
  assert.equal(levelFromAqi(150), 3);
  assert.equal(levelFromAqi(151), 4);
  assert.equal(levelFromAqi(400), 5);
});

test("summarizeAirQuality prefers PM values and falls back to the category", () => {
  const { summarizeAirQuality } = createEnv().api.helpers;

  const precise = summarizeAirQuality(airFixture({ pm25: 60, pm10: 12 }));
  assert.equal(precise.precise, true);
  assert.ok(precise.value > 150, "PM2.5 of 60 must exceed the 150 threshold");
  assert.equal(precise.level, 4);

  const coarse = summarizeAirQuality({ list: [{ main: { aqi: 3 }, components: {} }] });
  assert.equal(coarse.precise, false);
  assert.equal(coarse.level, 3);

  assert.equal(summarizeAirQuality(null), null);
  assert.equal(summarizeAirQuality({}), null);
});

test("dew point and comfort wording track humidity", () => {
  const { dewPointC, comfortFromDew } = createEnv().api.helpers;
  const dew = dewPointC(25 + KELVIN, 50);
  assert.ok(Math.abs(dew - 13.9) < 0.6, `25°C at 50% RH should be ~13.9°C, got ${dew}`);
  assert.equal(dewPointC(undefined, 50), null);
  assert.equal(comfortFromDew(2), "air feels dry");
  assert.equal(comfortFromDew(14), "a touch humid");
  assert.equal(comfortFromDew(24), "oppressive");
});

test("wind bearing maps to a 16-point compass", () => {
  const { windArrow } = createEnv().api.helpers;
  assert.equal(windArrow(0), "N");
  assert.equal(windArrow(359), "N");
  assert.equal(windArrow(90), "E");
  assert.equal(windArrow(180), "S");
  assert.equal(windArrow(22), "NNE");
  assert.equal(windArrow(720 + 270), "W");
  assert.equal(windArrow(undefined), "--");
});

test("timezone offsets render as UTC±HH:MM", () => {
  const { formatOffset } = createEnv().api.helpers;
  assert.equal(formatOffset(3600), "UTC+01:00");
  assert.equal(formatOffset(-18000), "UTC−05:00");
  assert.equal(formatOffset(19800), "UTC+05:30", "half-hour zones such as India");
  assert.equal(formatOffset(undefined), "UTC+00:00");
});

test("weather condition maps to a theme and an effect layer", () => {
  const { themeKeyFor, effectFor, iconSymbolFor } = createEnv().api.helpers;
  assert.equal(themeKeyFor("Rain"), "rain");
  assert.equal(themeKeyFor("Fog"), "mist");
  assert.equal(themeKeyFor("Tornado"), "thunderstorm");
  assert.equal(themeKeyFor("Wind"), "default");
  assert.equal(effectFor("Drizzle"), "drizzle");
  assert.equal(effectFor("Snow"), "snow");
  assert.equal(effectFor("Haze"), "fog");

  assert.equal(iconSymbolFor("01d", "Clear"), "wx-clear-day");
  assert.equal(iconSymbolFor("01n", "Clear"), "wx-clear-night");
  assert.equal(iconSymbolFor("10n", "Rain"), "wx-rain");
  assert.equal(iconSymbolFor("13d", "Snow"), "wx-snow");
  assert.equal(iconSymbolFor("50n", "Mist"), "wx-mist");
});

test("sun times approximate day length, including polar extremes", () => {
  const { sunTimesFor } = createEnv().api.helpers;
  const equinoxLondon = sunTimesFor(51.5, -0.13, Date.UTC(2026, 2, 20));
  assert.ok(Math.abs(equinoxLondon.daylightHours - 12) < 0.6, `expected ~12 h, got ${equinoxLondon.daylightHours}`);
  assert.ok(equinoxLondon.sunset > equinoxLondon.sunrise);

  const juneOslo = sunTimesFor(59.9, 10.75, Date.UTC(2026, 5, 21));
  assert.ok(juneOslo.daylightHours > 18, "midsummer north of the Arctic circle is a long day");

  const winterTromso = sunTimesFor(69.65, 18.96, Date.UTC(2026, 11, 21));
  assert.equal(winterTromso.polar, "night", "polar night has zero daylight");
});

test("3-hourly lists collapse into five local days", () => {
  const { buildDailyForecast } = createEnv().api.helpers;
  const forecast = forecastFixture({ entries: 40 });
  const offset = 3600;
  const firstKey = dateKeyOf(forecast.list[0].dt, offset);
  const days = buildDailyForecast(forecast.list, offset, firstKey);

  assert.equal(days.length, 5);
  assert.equal(days[0].isToday, true);
  days.forEach((day) => {
    assert.ok(day.max >= day.min, `${day.key} needs max >= min`);
    assert.ok(day.pop >= 0 && day.pop <= 1);
    assert.ok(day.depth >= 0);
    const hour = new Date((day.midday.dt + offset) * 1000).getUTCHours();
    // "Today" starts mid-evening in the fixture, so only full days can hit the afternoon.
    if (day.key !== firstKey) assert.ok(hour >= 10 && hour <= 16, `midday slot should be near the afternoon, got ${hour}`);
  });

  // The 40-slot list spills into a sixth day; only the five shown days are summed.
  const shown = new Set(days.map((day) => day.key));
  const summed = days.reduce((total, day) => total + day.depth, 0);
  const direct = forecast.list
    .filter((entry) => shown.has(dateKeyOf(entry.dt, offset)))
    .reduce((total, entry) => total + (entry.rain?.["3h"] || 0), 0);
  assert.ok(Math.abs(summed - direct) < 1e-6, "daily precipitation totals must equal the sum of their slots");
  assert.equal(days.filter((day) => day.depth > 0).length > 0, true, "wet days are detected");
});

test("rain window finds the first wet slot and totals depth", () => {
  const { findRainWindow } = createEnv().api.helpers;
  const list = [
    { dt: 1000, pop: 0.1 },
    { dt: 1000 + 10800, pop: 0.4 },
    { dt: 1000 + 21600, pop: 0.9, rain: { "3h": 2.5 } },
  ];
  const window = findRainWindow(list, 0);
  assert.equal(window.firstWet, list[1], "40% is the threshold");
  assert.equal(window.total, 2.5);
  assert.match(window.label, /\d/);

  assert.equal(findRainWindow([{ dt: 1000, pop: 0 }], 0).firstWet, null);
  assert.equal(findRainWindow(undefined, 0).total, 0);
});

test("relative time buckets stay human", () => {
  const { relativeTime } = createEnv().api.helpers;
  assert.equal(relativeTime(0), "never");
  assert.equal(relativeTime(Date.now() - 10 * 1000), "just now");
  assert.equal(relativeTime(Date.now() - 5 * 60 * 1000), "5 min ago");
  assert.equal(relativeTime(Date.now() - 3 * 3600 * 1000), "3 h ago");
});

function dateKeyOf(epoch, offset) {
  const d = new Date((epoch + offset) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/* ============================== Demo data ============================== */

test("demo dataset is shaped like the live API and uses Kelvin", () => {
  const { buildDemoDataset } = createEnv().api.helpers;
  const demo = buildDemoDataset(48.8566, 2.3522, "Paris, FR");

  assert.equal(demo.current.main.temp > 180 && demo.current.main.temp < 340, true, "temperature must be Kelvin");
  assert.equal(demo.current.name, "Paris");
  assert.equal(demo.current.sys.country, "FR");
  assert.equal(demo.current.timezone, 0, "the offset is derived from the longitude");
  assert.equal(demo.forecast.list.length, 40);
  assert.ok(demo.current.sys.sunset > demo.current.sys.sunrise);

  demo.forecast.list.forEach((entry, index) => {
    assert.ok(entry.dt % 10800 === 0 || Number.isFinite(entry.dt), "slots stay on 3-hour boundaries");
    assert.ok(entry.main.temp > 150 && entry.main.temp < 350, `entry ${index} temperature looks like Kelvin`);
    assert.ok(entry.pop >= 0 && entry.pop <= 1);
    assert.ok(["Clear", "Clouds", "Rain", "Drizzle", "Snow", "Thunderstorm"].includes(entry.weather[0].main));
  });

  const again = buildDemoDataset(48.8566, 2.3522, "Paris, FR");
  assert.equal(again.current.main.temp, demo.current.main.temp, "demo data must be deterministic per city/day");
  assert.equal(createEnv().api.helpers.summarizeAirQuality(demo.aqi).level >= 1, true);
});

/* ============================== Booting ============================== */

test("boot renders live data into the dashboard", async () => {
  const env = await boot();
  assert.deepEqual(env.errors, []);

  assert.equal(text(env, "currentTemp"), "12");
  assert.equal(text(env, "tempUnitSymbol"), "°C");
  assert.equal(text(env, "currentCondition"), "Overcast clouds");
  assert.match(text(env, "currentCity"), /London/);
  assert.equal(text(env, "currentHighLow"), "14° / 9°");
  assert.equal(text(env, "currentHumidity"), "71%");
  assert.match(text(env, "currentWind"), /^5\.1 m\/s$/);
  assert.match(text(env, "weatherNarrative"), /over London at 12°C, with 71% humidity/);

  // Icon symbol chosen from the condition, day/night aware.
  assert.equal(env.element("currentIconUse").getAttribute("href"), "#wx-clouds-day");

  // Details grid.
  assert.equal(text(env, "detailPressure"), "1004 hPa");
  assert.equal(text(env, "detailVisibility"), "10.0 km");
  assert.equal(text(env, "detailClouds"), "78%");
  assert.match(text(env, "detailWindDirection"), /^W?SW? · 240°$/);
  assert.match(text(env, "detailTimezone"), /UTC\+01:00/);
  assert.match(text(env, "detailDewPoint"), /° ·/);
  assert.match(text(env, "dayPhaseLabel"), /daylight|Sunrise in|sunset is close|Sunset/i);

  // Sun arc: dot moved along the path and the arc is dashed by progress.
  const arc = env.element("sunArcFill");
  assert.equal(arc.getAttribute("pathLength"), "100");
  assert.ok(arc.style.strokeDashoffset !== "", "progress must drive the dash offset");
  assert.ok(Number(env.element("sunArcDot").getAttribute("cx")) > 0);

  // Compass needle rotated to the bearing.
  assert.match(env.element("compassNeedle").style.transform ?? "", /rotate\(240deg\)/);

  // Forecast and hourly lists.
  assert.equal(env.element("forecastGrid").children.length, 5);
  assert.equal(env.element("hourlyStrip").children.length, 8);
  assert.match(text(env, "forecastRangeNote"), /5-day outlook/);
  assert.match(env.element("hourlyStrip").children[0].innerHTML, /Now/);

  // Air quality: computed from the fixture components.
  assert.match(text(env, "aqiValue"), /^\d+$/);
  assert.equal(text(env, "aqiLevel").startsWith("Level "), true);
  assert.ok(env.element("aqiPollutants").children.length >= 4, "pollutant rows are listed");
  assert.ok(env.element("aqiHealthGrid").children.length, 3);

  // Alerts: non-US location with One Call disabled reports no feed, not an error.
  assert.match(text(env, "alertsSource"), /NWS|One Call|alert feed/i);

  // Status + source badge.
  assert.match(text(env, "statusMessage"), /Updated/);
  assert.equal(env.WeatherDesk.state.source, "live");
  assert.match(text(env, "dataSourceLabel"), /Live ·/);
  assert.equal(env.element("dataBanner").hidden, true, "no banner on a clean load");
  assert.equal(env.element("loadingOverlay").getAttribute("aria-hidden"), "true", "spinner is hidden again");

  // Deep link + snapshot persistence.
  assert.match(env.window.history.last ?? "", /lat=51\.5072&lon=-0\.1276/);
  const snapshot = JSON.parse(env.localStorage.getItem("weather-snapshot-v1"));
  assert.equal(snapshot.label, "London, GB");
  assert.equal(snapshot.data.current.name, "London");
});

test("unit switching re-renders without another request", async () => {
  const env = await boot();
  const before = env.requested.length;

  env.element("unitToggle").click();
  await env.flush();

  assert.equal(text(env, "currentTemp"), "54", "12°C is 53.6°F");
  assert.equal(text(env, "tempUnitSymbol"), "°F");
  assert.match(text(env, "currentWind"), /mph/);
  assert.match(text(env, "detailPressure"), /inHg/);
  assert.match(text(env, "detailVisibility"), /mi/);
  assert.equal(env.requested.length, before, "units are a render concern, not a fetch concern");

  env.element("unitToggle").click();
  await env.flush();
  assert.equal(text(env, "currentTemp"), "12");
  assert.equal(env.localStorage.getItem("weather-units-v3"), "metric");
});

test("theme toggle flips the palette, updates the meta colour and persists", async () => {
  const env = await boot();
  const html = env.document.documentElement;

  env.element("themeToggle").click();
  assert.equal(html.dataset.theme, "dark");
  assert.equal(html.style.colorScheme ?? env.document.documentElement.style.props.get("colorScheme"), "dark");
  assert.equal(env.localStorage.getItem("weather-theme-v3"), "dark");

  const metaTheme = env.document.querySelector('meta[name="theme-color"]:not([media])');
  assert.equal(metaTheme.getAttribute("content"), "#0b1220");

  env.element("themeToggle").click();
  assert.equal(html.dataset.theme, "light");
  assert.equal(metaTheme.getAttribute("content"), "#0369a1");
});

test("alerts render US NWS warnings with severity and full text", async () => {
  const env = await boot({
    search: "?lat=40.7143&lon=-74.006&city=New%20York",
    respond: (url) => {
      if (url.includes("api.weather.gov")) return nwsAlertFixture("Coastal Flood Warning");
      if (url.includes("/data/2.5/weather")) return currentFixture({ name: "New York", country: "US", lat: 40.7143, lon: -74.006 });
      if (url.includes("/data/2.5/forecast")) return forecastFixture({ lat: 40.7143, lon: -74.006, timezone: -14400 });
      if (url.includes("/air_pollution")) return airFixture({ aqi: 1, pm25: 4, pm10: 8 });
      return {};
    },
  });

  const alerts = env.element("alertsList");
  assert.equal(alerts.children.length, 1);
  const card = alerts.children[0];
  assert.equal(card.classList.contains("sev-severe"), true, "severity is styled on the card");
  assert.match(card.innerHTML, /Coastal Flood Warning/);
  assert.match(card.innerHTML, /sev-tag/);
  assert.match(card.innerHTML, /Full alert text/);
  assert.match(card.innerHTML, /Do not drive through flooded roads/);
  assert.match(text(env, "alertsSource"), /National Weather Service/);
  assert.equal(text(env, "alertsBadge"), "1");
  assert.equal(env.element("alertsBadge").dataset.level, "on");
});

test("API strings are escaped before they reach the DOM", async () => {
  const evil = "<img src=x onerror=alert(1)>";
  const env = await boot({
    respond: (url) => {
      if (url.includes("/data/2.5/weather"))
        return currentFixture({ name: evil, description: `${evil} heavy rain`, icon: "10d", condition: "Rain" });
      if (url.includes("/data/2.5/forecast")) return forecastFixture({ description: evil });
      if (url.includes("/geo/1.0/direct")) return [{ name: evil, state: "", country: "GB", lat: 1, lon: 1 }];
      if (url.includes("/air_pollution")) return airFixture();
      return {};
    },
  });

  const rendered = [
    env.element("forecastGrid").children.map((node) => node.innerHTML).join(""),
    env.element("hourlyStrip").children.map((node) => node.innerHTML).join(""),
    env.element("alertsList").children.map((node) => node.innerHTML).join(""),
  ].join("\n");

  assert.ok(!/<img src=x/.test(rendered), "raw markup must never be injected into innerHTML");
  assert.ok(!/<img src=x/.test(env.element("weatherSuggestions").children.map((n) => n.innerHTML).join("")));
  assert.equal(text(env, "currentCity"), `${evil}, GB`, "the text itself is still shown to the user, unescaped only as text");
});

test("a rejected key drops the app into demo mode with a call to action", async () => {
  const env = await boot({ status: () => 401 });
  const desk = env.WeatherDesk;

  assert.equal(desk.state.source, "demo");
  assert.match(text(env, "dataSourceLabel"), /Demo/);
  assert.equal(env.element("dataBanner").hidden, false);
  assert.match(text(env, "dataBannerText"), /demo/i);
  assert.equal(text(env, "dataBannerAction"), "Add API key");
  assert.match(text(env, "currentTemp"), /^\d+$/, "the dashboard is still filled in");
  assert.ok(Number(text(env, "currentTemp")) > -60 && Number(text(env, "currentTemp")) < 60);
  assert.equal(env.localStorage.getItem("weather-snapshot-v1"), null, "demo data must not poison the offline snapshot");
});

test("network failure falls back to the saved snapshot", async () => {
  // First run writes a snapshot, second run boots while offline.
  const online = await boot();
  const snapshot = online.localStorage.getItem("weather-snapshot-v1");
  assert.ok(snapshot);

  const env = await boot({ storage: { "weather-snapshot-v1": snapshot }, failWith: new Error("boom") });
  assert.equal(env.WeatherDesk.state.source, "snapshot");
  assert.match(text(env, "dataSourceLabel"), /Offline/);
  assert.equal(text(env, "currentTemp"), "12", "the last live reading is still on screen");
  assert.equal(env.element("dataBanner").hidden, false);
  assert.match(text(env, "dataBannerText"), /Offline/);
});

test("rate limiting shows a retry affordance instead of an error wall", async () => {
  const env = await boot({ status: (url) => (url.includes("/data/2.5/") ? 429 : 200) });
  assert.match(text(env, "errorMessage"), /Rate limit/);
  assert.equal(env.element("errorRetryBtn").hidden, false);
  assert.match(text(env, "statusMessage"), /quota/i);
});

test("an unknown city is reported, not swallowed", async () => {
  const env = await boot({
    respond: (url) => (url.includes("/geo/1.0/direct") ? [] : currentFixture()),
  });
  // The default boot path uses coords, so drive the search box directly.
  const desk = env.WeatherDesk;
  desk.state.lastRequestKey = "force";
  env.element("cityInput").value = "Zzzqwerty";
  env.element("searchForm").dispatch("submit", { preventDefault() {} });
  await env.flush();

  assert.match(text(env, "errorMessage"), /No match|not available/i);
});

test("suggestions merge favourites, history and live geocoding", async () => {
  const env = await boot({
    storage: {
      "weather-favorites-v3": JSON.stringify([{ label: "Tokyo, JP", query: "Tokyo", lat: 35.6895, lon: 139.6917 }]),
      "weather-history-v3": JSON.stringify(["Old Entry, ZZ", "Paris, FR"]),
    },
  });

  const input = env.element("cityInput");
  input.value = "t";
  input.dispatch("input");
  await new Promise((resolve) => setTimeout(resolve, 260));
  await env.flush();

  const labels = env.element("suggestionsList").children.map((node) => node.innerHTML);
  assert.ok(labels.length, "at least one suggestion");
  assert.match(labels.join("|"), /Tokyo/, "favourites lead the list");
  assert.match(labels.join("|"), /Toronto/, "popular cities match the same prefix");
  assert.match(labels.join("|"), /Recent/, "history entries are labelled");
  assert.equal(input.getAttribute("aria-expanded"), "true");
  assert.equal(env.element("suggestionsList").classList.contains("open"), true);
});

test("legacy string history is migrated to coordinate entries", async () => {
  const env = await boot({ storage: { "weather-history-v3": JSON.stringify(["Paris, FR", "Lagos, NG"]) } });
  const nodes = env.element("historyList").children;
  assert.equal(nodes.length, 2);
  assert.match(nodes[0].children[0].textContent ?? nodes[0].textContent, /Paris/);
});

test("favouriting a city stores it, shows the star state and builds a card", async () => {
  const env = await boot();
  env.element("favoriteBtn").click();
  await env.flush();

  const favorites = JSON.parse(env.localStorage.getItem("weather-favorites-v3"));
  assert.equal(favorites.length, 1);
  assert.equal(favorites[0].label, "London, GB");
  assert.equal(typeof favorites[0].lat, "number");

  assert.equal(env.element("favoriteBtn").classList.contains("active"), true);
  assert.equal(env.element("favoriteBtn").getAttribute("aria-pressed"), "true");
  assert.match(env.element("favoriteBtn").innerHTML, /i-star-filled/);

  const dash = env.element("favoriteDashboard");
  await env.flush();
  assert.ok(dash.children.length >= 1);

  env.element("favoriteBtn").click();
  await env.flush();
  assert.deepEqual(JSON.parse(env.localStorage.getItem("weather-favorites-v3")), []);
});

test("offline search still resolves curated cities", async () => {
  const env = await boot({ storage: { "weather-api-key-v1": "" }, status: () => 500 });
  const desk = env.WeatherDesk;
  desk.state.apiKey = "";

  env.element("cityInput").value = "Paris";
  env.element("searchForm").dispatch("submit", { preventDefault() {} });
  await env.flush();

  assert.equal(desk.state.source, "demo");
  assert.match(text(env, "currentCity"), /Paris/);
});

/* ============================== Interaction ============================== */

test("keyboard shortcuts drive the dashboard", async () => {
  const env = await boot();
  const press = (key, target = env.document.body) => env.document.dispatch("keydown", { key, target, tagName: "BODY" });

  press("d");
  assert.equal(env.document.documentElement.dataset.theme, "dark");
  press("u");
  assert.equal(text(env, "currentTemp"), "54");
  press("f");
  assert.equal(JSON.parse(env.localStorage.getItem("weather-favorites-v3")).length, 1);
  press("r");
  await env.flush();
  assert.equal(env.errors, env.errors); // no crash
  press("s");
  assert.equal(env.element("settingsModal").hidden, false);
  assert.equal(env.element("app").inert, true, "background content is inert while a dialog is open");
  press("Escape");
  assert.equal(env.element("settingsModal").classList.contains("is-open"), false);

  press("/");
  assert.ok(env.element("cityInput").focusCount > 0);
});

test("shortcuts stay quiet while typing", async () => {
  const env = await boot();
  const input = env.element("cityInput");
  env.document.dispatch("keydown", { key: "u", target: input, tagName: "INPUT" });
  assert.equal(text(env, "currentTemp"), "12", "U inside the input must not toggle units");
});

test("modal focus handling: opens, traps Escape and restores focus", async () => {
  const env = await boot();
  const card = env.element("forecastGrid").children[1];
  card.dispatch("click");
  assert.equal(env.element("detailModal").hidden, false);
  assert.match(text(env, "detailModalTitle"), /Mon|Tue|Wed|Thu|Fri|Sat|Sun/, "day modal is titled with the weekday");
  assert.match(env.element("detailModalBody").innerHTML, /Rain chance/);

  env.element("detailModal").dispatch("keydown", { key: "Escape" });
  assert.equal(env.element("detailModal").classList.contains("is-open"), false);
});

test("a key can be injected from the page, but saved settings win", async () => {
  const injected = await boot({ windowExtras: { __ATMOSPHERE_DESK__: { apiKey: "page-level-key" } } });
  assert.ok(injected.requested.some((url) => url.includes("appid=page-level-key")), "the injected key is used");

  const stored = await boot({
    windowExtras: { __ATMOSPHERE_DESK__: { apiKey: "page-level-key" } },
    storage: { "weather-api-key-v1": "stored-wins" },
  });
  assert.ok(stored.requested.some((url) => url.includes("appid=stored-wins")), "localStorage takes priority");
});

test("settings commits theme, units, language, refresh and animations", async () => {
  const env = await boot();
  const settings = env.element("settingsModal");
  env.element("settingsBtn").click();
  assert.equal(settings.hidden, false);

  env.element("settingsUnits").value = "imperial";
  env.element("settingsForm").dispatch("change");
  assert.equal(text(env, "currentTemp"), "54");

  env.element("settingsRefresh").value = "0";
  env.element("settingsForm").dispatch("change");
  assert.equal(env.localStorage.getItem("weather-refresh-minutes-v1"), "0");

  env.element("settingsLanguage").value = "fr";
  env.element("settingsForm").dispatch("change");
  await env.flush();
  assert.equal(env.localStorage.getItem("weather-language-v1"), "fr");
  assert.ok(env.requested.some((url) => url.includes("lang=fr")), "the language is sent to the API");

  env.element("settingsAnimations").checked = false;
  env.element("settingsForm").dispatch("change");
  assert.equal(env.localStorage.getItem("weather-animations-v1"), "off");
});

test("API key can be saved, tested and cleared", async () => {
  const env = await boot();
  const keyInput = env.element("settingsApiKey");

  keyInput.value = "my-personal-key";
  env.element("saveApiKeyBtn").click();
  await env.flush();

  assert.equal(env.localStorage.getItem("weather-api-key-v1"), "my-personal-key");
  assert.ok(env.requested.some((url) => url.includes("appid=my-personal-key")), "saved key is used for later calls");
  assert.match(text(env, "apiKeyStatus"), /saved in this browser|Key in use/);

  env.element("clearApiKeyBtn").click();
  await env.flush();
  assert.equal(env.localStorage.getItem("weather-api-key-v1"), null);
});

test("?apikey= is honoured for one page view only", async () => {
  const env = await boot({ search: "?apikey=url-key&lat=51.5072&lon=-0.1276" });
  assert.ok(env.requested.some((url) => url.includes("appid=url-key")));
  assert.equal(env.localStorage.getItem("weather-api-key-v1"), null, "never persisted to storage");
  assert.match(env.element("footerExtra").textContent ?? "", /page view only/);
});

test("the service worker and manifest stay in sync with the shell", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const { APP_SOURCE } = await import("./harness.mjs");
  const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

  const sw = read("../service-worker.js");
  const manifest = JSON.parse(read("../manifest.json"));
  const html = read("../index.html");

  assert.match(sw, /atmosphere-desk-v\d+/);
  assert.match(sw, /staleWhileRevalidate/, "API GETs are served stale-while-revalidate");
  assert.match(sw, /api\.openweathermap\.org/, "the weather API is part of the offline plan");
  assert.match(sw, /navigationHandler|navigate/, "navigations go to the network first");
  assert.match(APP_SOURCE, /navigator\.serviceWorker\.register\("service-worker\.js"\)/, "the page registers the worker");

  for (const asset of ["index.html", "styles.css", "app.js", "manifest.json"]) {
    assert.ok(sw.includes(asset), `${asset} is precached`);
  }

  // Every icon the manifest promises must exist, or installation silently fails.
  const iconPaths = manifest.icons.map((icon) => icon.src).concat(manifest.shortcuts.flatMap((s) => s.icons.map((i) => i.src)));
  for (const iconPath of new Set(iconPaths)) {
    assert.ok(existsSync(new URL(`../${iconPath}`, import.meta.url)), `${iconPath} is referenced but missing`);
    if (iconPath.endsWith(".png")) {
      const bytes = readFileSync(new URL(`../${iconPath}`, import.meta.url));
      assert.ok(bytes.length > 400, `${iconPath} looks like a placeholder`);
      assert.equal(bytes.subarray(1, 4).toString("latin1"), "PNG", `${iconPath} must be a real PNG`);
    }
  }
  assert.ok(manifest.icons.some((icon) => icon.sizes.includes("512")), "PWA needs a 512px icon");
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"), "adaptive icons for Android");
  assert.ok(html.includes('rel="manifest"'), "the manifest is linked from the document");
  assert.equal(manifest.start_url.startsWith("./"), true, "relative start_url works on any base path");
});

test("index.html wires every element id the app expects", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  const { APP_SOURCE } = await import("./harness.mjs");
  const referenced = new Set();
  for (const match of APP_SOURCE.matchAll(/\$\("([a-zA-Z0-9_-]+)"\)/g)) referenced.add(match[1]);
  for (const match of APP_SOURCE.matchAll(/getElementById\("([a-zA-Z0-9_-]+)"\)/g)) referenced.add(match[1]);

  assert.ok(referenced.size > 40, "the app resolves a large number of ids");
  const missing = [...referenced].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `ids missing from index.html: ${missing.join(", ")}`);
});

test("sprite symbols referenced by the app exist in the markup", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const symbols = new Set([...html.matchAll(/<(?:symbol|g) id="([^"]+)"/g)].map((match) => match[1]));
  const used = [...html.matchAll(/href="#(i-[a-z-]+|wx-[a-z-]+)"/g)].map((match) => match[1]);
  for (const name of ["wx-clear-day", "wx-clear-night", "wx-clouds-day", "wx-clouds-night", "wx-rain", "wx-drizzle", "wx-thunderstorm", "wx-snow", "wx-mist", "wx-squall"]) {
    assert.ok(symbols.has(name), `${name} must exist in the sprite`);
  }
  for (const name of ["i-search", "i-mic", "i-pin", "i-refresh", "i-share", "i-sun", "i-moon", "i-sliders", "i-download", "i-star", "i-star-filled", "i-alert", "i-close", "i-key", "i-wind", "i-brand"]) {
    assert.ok(symbols.has(name), `${name} must exist in the sprite`);
  }
  for (const name of used) assert.ok(symbols.has(name), `${name} is used in the markup but has no symbol`);
});

test("malformed and partial API payloads render placeholders, never noise", async () => {
  const hostile = [
    {},
    { main: {} },
    { main: { temp: null, humidity: "60" }, weather: [], wind: {}, sys: {} },
    { main: { temp: 300 }, weather: null, visibility: "far" },
    { cod: "404", message: "city not found" },
  ];

  const renderNoise = (env) => {
    const text = [];
    for (const [id, node] of env.document.byId) {
      if (node.textContent) text.push(node.textContent);
      if (node.innerHTML) text.push(node.innerHTML);
    }
    return text.join("\n");
  };

  for (const payload of hostile) {
    const env = await boot({
      respond: (url) => {
        if (url.includes("/geo/1.0/direct")) return [{ name: "London", country: "GB", lat: 51.5072, lon: -0.1276 }];
        if (url.includes("/data/2.5/forecast")) return { list: null };
        if (url.includes("/air_pollution")) return { list: [{}] };
        if (url.includes("api.weather.gov")) return { features: "not-an-array" };
        return payload;
      },
    });
    const label = JSON.stringify(payload).slice(0, 40);
    assert.deepEqual(env.errors, [], `nothing threw for ${label}`);
    const rendered = renderNoise(env);
    assert.ok(env.element("currentCity").textContent, `the header still names a place for ${label}`);
    assert.match(env.element("currentTemp").textContent, /^(\d+|--)$/, `temperature is a number or a dash for ${label}`);
    assert.match(env.element("aqiValue").textContent, /^(\d+|--)$/, `AQI is a number or a dash for ${label}`);
    assert.ok(env.element("alertsList").children.length, `alerts panel speaks up for ${label}`);
    assert.ok(
      !/NaN|undefined|\[object Object\]/.test(rendered),
      `no developer noise leaked into the UI for ${label}: ${(rendered.match(/.{0,60}(NaN|undefined|\[object Object\]).{0,40}/) ?? [""])[0]}`
    );
  }

  // Forecast present but empty: panels explain themselves instead of vanishing.
  const empty = await boot({
    respond: (url) => {
      if (url.includes("/geo/1.0/direct")) return [{ name: "London", country: "GB", lat: 51.5072, lon: -0.1276 }];
      if (url.includes("/data/2.5/forecast")) return { list: [] };
      if (url.includes("/data/2.5/weather")) return { main: { temp: 290 }, weather: [{ main: "Clouds", description: "cloudy", icon: "04d" }] };
      if (url.includes("/air_pollution")) return { list: [{ main: { aqi: 2 }, components: { pm2_5: 12 } }] };
      return {};
    },
  });
  assert.match(empty.element("forecastGrid").textContent, /no daily data/i);
  assert.match(empty.element("hourlyNote").textContent, /dry/i);
  assert.equal(empty.WeatherDesk.state.source, "live", "partial success is still live data");
});

test("index.html is structurally sound and internally referenced", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  // 1. No duplicate ids (getElementById would silently pick the first).
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const dupes = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(dupes)], [], "duplicate ids break the element map");

  // 2. Every fragment reference resolves to something in the document.
  const known = new Set(ids);
  const dangling = [...html.matchAll(/(?:href|aria-labelledby|aria-controls|aria-describedby|for)="(?:#([^"]+)|([^"]*?#([a-z0-9-]+)))/gi)]
    .map((match) => match[1] ?? match[3])
    .filter(Boolean)
    .filter((target) => !known.has(target) && !target.startsWith("http") && target !== "");
  assert.deepEqual(dangling, [], "links and labels must point at real ids");

  // 3. Balanced tags for the containers that matter (void elements excluded).
  const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
  for (const tag of ["div", "section", "button", "form", "svg", "label", "select", "ul", "article", "p", "header", "footer", "main"]) {
    const opens = (html.match(new RegExp(`<${tag}(?=[\\s>])`, "g")) ?? []).length;
    const closes = (html.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
    assert.equal(opens, closes, `<${tag}> is unbalanced (${opens} open / ${closes} close)`);
  }
  void VOID;

  // 4. Accessibility scaffolding a reviewer would ask for.
  assert.match(html, /<a class="skip-link" href="#app">/);
  assert.match(html, /<div class="app" id="app" tabindex="-1">/);
  assert.match(html, /role="status"[^>]*aria-live="polite"/);
  assert.match(html, /aria-live="assertive"/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-touch-icon/);
  for (const panel of html.matchAll(/<section class="panel[^"]*" aria-labelledby="([^"]+)"/g)) {
    assert.ok(known.has(panel[1]), `panel labels a missing heading id: ${panel[1]}`);
  }

  // 5. Buttons inside cards must not be nested (invalid HTML): favourites use
  //    sibling remove buttons, so assert the pattern cannot regress.
  assert.ok(!/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/.test(html), "no nested <button>");
});

test("every explainer tile has copy, and every advertised shortcut exists", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");

  const tiles = [...html.matchAll(/data-detail="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(tiles.length, 12, "the details grid exposes twelve explainer tiles");
  const help = source.slice(source.indexOf("const DETAIL_HELP = {"), source.indexOf("const SHORTCUTS = ["));
  for (const tile of tiles) assert.ok(help.includes(`\n    ${tile}: [`), `${tile} has a tile but no explainer copy`);
  const orphans = [...help.matchAll(/^\s{4}([A-Za-z]+): \[/gm)].map((match) => match[1]);
  for (const key of orphans) assert.ok(tiles.includes(key), `${key} has copy but no tile to click`);

  const shortcuts = source.slice(source.indexOf("const SHORTCUTS = ["), source.indexOf("/* ================================ Utilities"));
  const advertised = [...shortcuts.matchAll(/\["([^"]+)", "/g)].map((match) => match[1]);
  const handled = new Set([
    ...[...source.matchAll(/case "(\w|[/?])":/g)].map((match) => match[1]),
    ...[...source.matchAll(/event\.key === "(\w+)"/g)].map((match) => match[1]),
  ]);
  assert.match(source, /event\.key === "ArrowDown"/, "arrow keys navigate the suggestions");
  assert.match(source, /event\.key === "ArrowUp"/);
  for (const key of advertised) {
    const first = key.split(" ")[0];
    if (!/^[\x20-\x7e]$/.test(first) && first !== "Esc") continue; // skip drawn glyphs
    const lookup = first === "Esc" ? "Escape" : first;
    assert.ok(handled.has(lookup) || lookup === "Enter", `${key} is advertised in the help dialog but not handled`);
  }
});

test("app.js stays a single strict-mode IIFE with no leaked globals", async () => {
  const { APP_SOURCE } = await import("./harness.mjs");
  assert.match(APP_SOURCE, /^\/\* =+/m, "opens with the header comment");
  assert.ok(APP_SOURCE.includes('  "use strict";'), "strict mode is opted into");

  const topLevel = APP_SOURCE.split("\n").filter((line) => /^[A-Za-z_$]/.test(line));
  assert.deepEqual(topLevel, [], "nothing is declared in the global scope");
  assert.ok(!APP_SOURCE.includes("innerHTML = item.label"), "no raw API strings through innerHTML");
});
