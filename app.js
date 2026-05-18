// ==================== API & Storage Configuration ====================
const API_KEY = "bac7893eaffd11c1ff3b45e7f7f541ad"; // Replace with your API key
const API_BASE = "https://api.openweathermap.org/data/2.5";
const GEO_BASE = "https://api.openweathermap.org/geo/1.0";
const ONE_CALL_BASE = "https://api.openweathermap.org/data/3.0/onecall";

const STORAGE_KEYS = {
  history: "weather-history-v3",
  favorites: "weather-favorites-v3",
  theme: "weather-theme-v3",
  units: "weather-units-v3",
  lastPlace: "weather-last-place-v3",
};

// ==================== DOM Elements ====================
const elements = {
  app: document.getElementById("app"),
  form: document.getElementById("searchForm"),
  searchBtn: document.getElementById("searchBtn"),
  voiceBtn: document.getElementById("voiceBtn"),
  input: document.getElementById("cityInput"),
  suggestionsList: document.getElementById("suggestionsList"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  clearFavoritesBtn: document.getElementById("clearFavoritesBtn"),
  error: document.getElementById("errorMessage"),
  status: document.getElementById("statusMessage"),
  locateBtn: document.getElementById("locateBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  unitToggle: document.getElementById("unitToggle"),
  themeToggle: document.getElementById("themeToggle"),
  installBtn: document.getElementById("installBtn"),
  themeWeatherLabel: document.getElementById("themeWeatherLabel"),
  coordLabel: document.getElementById("coordLabel"),
  updatedLabel: document.getElementById("updatedLabel"),
  historyList: document.getElementById("historyList"),
  favoritesList: document.getElementById("favoritesList"),
  favoriteBtn: document.getElementById("favoriteBtn"),
  currentCity: document.getElementById("currentCity"),
  currentTime: document.getElementById("currentTime"),
  currentIcon: document.getElementById("currentIcon"),
  currentCondition: document.getElementById("currentCondition"),
  currentTemp: document.getElementById("currentTemp"),
  tempUnitSymbol: document.getElementById("tempUnitSymbol"),
  currentFeels: document.getElementById("currentFeels"),
  feelsUnitSymbol: document.getElementById("feelsUnitSymbol"),
  currentHumidity: document.getElementById("currentHumidity"),
  currentWind: document.getElementById("currentWind"),
  currentHighLow: document.getElementById("currentHighLow"),
  currentRainChance: document.getElementById("currentRainChance"),
  detailPressure: document.getElementById("detailPressure"),
  detailVisibility: document.getElementById("detailVisibility"),
  detailClouds: document.getElementById("detailClouds"),
  detailSunrise: document.getElementById("detailSunrise"),
  detailSunset: document.getElementById("detailSunset"),
  detailTimezone: document.getElementById("detailTimezone"),
  detailWindDirection: document.getElementById("detailWindDirection"),
  detailObserved: document.getElementById("detailObserved"),
  weatherNarrative: document.getElementById("weatherNarrative"),
  aqiValue: document.getElementById("aqiValue"),
  aqiLabel: document.getElementById("aqiLabel"),
  aqiLevel: document.getElementById("aqiLevel"),
  aqiAdvice: document.getElementById("aqiAdvice"),
  aqiHealthGrid: document.getElementById("aqiHealthGrid"),
  aqiChart: document.getElementById("aqiChart"),
  weatherSuggestions: document.getElementById("weatherSuggestions"),
  alertsList: document.getElementById("alertsList"),
  favoriteDashboard: document.getElementById("favoriteDashboard"),
  forecastGrid: document.getElementById("forecastGrid"),
  hourlyStrip: document.getElementById("hourlyStrip"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  tempChart: document.getElementById("tempChart"),
  detailModal: document.getElementById("detailModal"),
  detailModalTitle: document.getElementById("detailModalTitle"),
  detailModalBody: document.getElementById("detailModalBody"),
  closeDetailModal: document.getElementById("closeDetailModal"),
};

// ==================== Application State ====================
const state = {
  units: localStorage.getItem(STORAGE_KEYS.units) || "metric",
  current: null,
  chart: null,
  aqiChart: null,
  weatherLabel: "",
  currentCoords: null,
  suggestions: [],
  activeSuggestionIndex: -1,
  suggestionDebounce: null,
  suggestionToken: 0,
  refreshTimer: null,
  recognition: null,
  isListening: false,
  favoriteDashboardToken: 0,
  deferredInstallPrompt: null,
};

const POPULAR_CITIES = [
  "New York, US",
  "London, GB",
  "Tokyo, JP",
  "Paris, FR",
  "Dubai, AE",
  "Singapore, SG",
  "Sydney, AU",
  "Toronto, CA",
];

const AQI_LEVELS = {
  1: {
    label: "Good",
    advice: "Air quality is healthy for most people.",
    cards: ["Outdoor plans are good", "Open windows if weather allows", "Low risk for sensitive groups"],
  },
  2: {
    label: "Fair",
    advice: "Acceptable air quality. Sensitive groups may be affected.",
    cards: ["Most outdoor plans are fine", "Sensitive groups should pace activity", "Keep water nearby"],
  },
  3: {
    label: "Moderate",
    advice: "Reduce long outdoor activities if you are sensitive.",
    cards: ["Limit hard outdoor workouts", "Watch for coughing or irritation", "Close windows near traffic"],
  },
  4: {
    label: "Poor",
    advice: "Limit outdoor exertion and keep windows closed.",
    cards: ["Avoid intense outdoor activity", "Use a mask if you must go out", "Run indoor air filtration"],
  },
  5: {
    label: "Very Poor",
    advice: "Avoid outdoor activities and wear N95 masks if necessary.",
    cards: ["Stay indoors when possible", "Postpone outdoor exercise", "Protect children and elders"],
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

// ==================== Utility Functions ====================

const unitSymbol = () => (state.units === "metric" ? "°C" : "°F");

const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);

const getStoredList = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return (raw && JSON.parse(raw)) || [];
  } catch {
    return [];
  }
};

const setStoredList = (key, list) => localStorage.setItem(key, JSON.stringify(list));

const formatOffset = (offsetSeconds) => {
  const sign = offsetSeconds >= 0 ? "+" : "-";
  const hours = Math.floor(Math.abs(offsetSeconds) / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((Math.abs(offsetSeconds) % 3600) / 60)
    .toString()
    .padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
};

const formatTime = (unixSeconds, offsetSeconds, options) => {
  const shifted = new Date((unixSeconds + offsetSeconds) * 1000);
  return new Intl.DateTimeFormat(undefined, {
    ...options,
    timeZone: "UTC",
  }).format(shifted);
};

const formatBrowserTime = (unixSeconds, options) =>
  new Intl.DateTimeFormat(undefined, options).format(new Date(unixSeconds * 1000));

const getDateKey = (unixSeconds, offsetSeconds) => {
  const shifted = new Date((unixSeconds + offsetSeconds) * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
};

const getHour = (unixSeconds, offsetSeconds) => {
  const shifted = new Date((unixSeconds + offsetSeconds) * 1000);
  return shifted.getUTCHours();
};

const getWeatherThemeKey = (mainCondition = "") =>
  WEATHER_THEME_KEYS[mainCondition.toLowerCase()] || "default";

const getAnimatedWeatherClass = (mainCondition = "") => {
  const key = getWeatherThemeKey(mainCondition);
  if (key === "drizzle") return "rain";
  if (key === "thunderstorm") return "rain";
  return ["clear", "clouds", "rain", "snow"].includes(key) ? key : "clouds";
};

const windDirection = (degrees) => {
  if (typeof degrees !== "number") return "--";
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(degrees / 45) % directions.length;
  return `${directions[index]} ${degrees}°`;
};

const buildWeatherNarrative = (weather, forecastFirstEntry) => {
  const condition = weather.weather[0];
  const rainChance = Math.round((forecastFirstEntry?.pop || 0) * 100);
  const windUnit = state.units === "metric" ? "m/s" : "mph";
  const visibility =
    state.units === "metric"
      ? `${((weather.visibility || 0) / 1000).toFixed(1)} km`
      : `${((weather.visibility || 0) / 1609.34).toFixed(1)} mi`;

  return `${capitalize(condition.description)} in ${weather.name} with ${weather.main.humidity}% humidity, ${Math.round(
    weather.wind.speed
  )} ${windUnit} wind, ${visibility} visibility, and a ${rainChance}% rain chance in the next forecast window.`;
};

const buildWeatherSuggestions = (weather, forecastFirstEntry, aqiResponse) => {
  const condition = weather.weather[0].main.toLowerCase();
  const temp = weather.main.temp;
  const wind = weather.wind.speed;
  const humidity = weather.main.humidity;
  const rainChance = Math.round((forecastFirstEntry?.pop || 0) * 100);
  const aqiSummary = getAqiSummary(aqiResponse);
  const aqi = aqiSummary?.level;
  const items = [];

  if (condition.includes("rain") || condition.includes("drizzle") || rainChance >= 50) {
    items.push({ title: "Carry Umbrella", text: `${rainChance}% rain chance in the next forecast window.` });
  }

  if (condition.includes("snow")) {
    items.push({ title: "Layer Up", text: "Snow is expected, so keep travel slow and wear warm layers." });
  }

  if (condition.includes("clear") && temp >= (state.units === "metric" ? 30 : 86)) {
    items.push({ title: "Stay Hydrated", text: "Clear skies and higher temperatures can dehydrate you quickly." });
  }

  if (humidity >= 75 && temp >= (state.units === "metric" ? 27 : 81)) {
    items.push({ title: "Take Breaks", text: "High humidity can make outdoor activity feel harder." });
  }

  if (wind >= (state.units === "metric" ? 10 : 22)) {
    items.push({ title: "Secure Loose Items", text: "Wind is strong enough to affect cycling, umbrellas, and light gear." });
  }

  if (aqi >= 4) {
    items.push({ title: "Avoid Outdoor Activity", text: "Air quality is poor, especially for sensitive groups." });
  } else if (aqi === 3) {
    items.push({ title: "Shorten Outdoor Workouts", text: "Air quality is moderate, so keep intense exercise brief." });
  }

  if (!items.length) {
    items.push({ title: "Good To Go", text: "Conditions look comfortable for regular outdoor plans." });
  }

  return items.slice(0, 4);
};

const calculateAqi = (concentration, breakpoints) => {
  if (typeof concentration !== "number") return null;
  const target = Math.max(0, concentration);
  const bracket = breakpoints.find(({ cLow, cHigh }) => target >= cLow && target <= cHigh) ||
    breakpoints[breakpoints.length - 1];

  const { cLow, cHigh, iLow, iHigh } = bracket;
  const value = ((iHigh - iLow) / (cHigh - cLow)) * (target - cLow) + iLow;
  return Math.round(Math.min(500, Math.max(0, value)));
};

const getAqiLevelFromIndex = (aqiValue) => {
  if (typeof aqiValue !== "number") return null;
  if (aqiValue <= 50) return 1;
  if (aqiValue <= 100) return 2;
  if (aqiValue <= 150) return 3;
  if (aqiValue <= 200) return 4;
  return 5;
};

const getAqiSummary = (aqiResponse) => {
  const components = aqiResponse?.list?.[0]?.components;
  if (!components) return null;

  const candidates = [];
  const pm25Aqi = calculateAqi(components.pm2_5, AQI_BREAKPOINTS.pm25);
  const pm10Aqi = calculateAqi(components.pm10, AQI_BREAKPOINTS.pm10);

  if (pm25Aqi !== null) candidates.push(pm25Aqi);
  if (pm10Aqi !== null) candidates.push(pm10Aqi);

  if (!candidates.length) return null;

  const aqiValue = Math.max(...candidates);
  return {
    aqiValue,
    level: getAqiLevelFromIndex(aqiValue),
  };
};

// ==================== UI State Management ====================

const setStatus = (msg) => {
  elements.status.textContent = msg;
};

const setError = (msg) => {
  elements.error.textContent = msg;
};

const clearError = () => {
  elements.error.textContent = "";
};

const setLoading = (loading) => {
  elements.app.classList.toggle("is-loading", loading);
  elements.loadingOverlay?.setAttribute("aria-hidden", String(!loading));
};

const scheduleAutoRefresh = () => {
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => {
    if (!state.currentCoords || document.hidden) return;
    loadWeatherByCoords(state.currentCoords.lat, state.currentCoords.lon, {
      addToHistory: false,
      cityLabel: state.weatherLabel,
      silent: true,
    });
  }, 10 * 60 * 1000);
};

const updateSearchButtonState = () => {
  const hasInput = elements.input.value.trim().length > 0;
  elements.searchBtn.disabled = !hasInput;
};

// ==================== Suggestion Management ====================

const getLocalSuggestions = (query) => {
  const lower = query.toLowerCase();
  const recent = getStoredList(STORAGE_KEYS.history).map((item) => ({
    label: item,
    cityQuery: item,
    source: "Recent search",
  }));
  const favs = getStoredList(STORAGE_KEYS.favorites).map((item) => ({
    label: item,
    cityQuery: item,
    source: "Favorite",
  }));
  const popular = POPULAR_CITIES.map((item) => ({
    label: item,
    cityQuery: item,
    source: "Popular city",
  }));

  const all = [...favs, ...recent, ...popular];
  const seen = new Set();

  return all
    .filter((item) => item.label.toLowerCase().includes(lower))
    .filter((item) => {
      const key = item.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
};

const getRemoteSuggestions = async (query) => {
  if (!API_KEY || query.length < 2) return [];

  try {
    const url = buildUrl(`${GEO_BASE}/direct`, {
      q: query,
      limit: 5,
      appid: API_KEY,
    });

    const data = await fetchJson(url, null);
    if (!data) return [];

    return data.map((item) => ({
      label: [item.name, item.state, item.country].filter(Boolean).join(", "),
      cityQuery: `${item.name}, ${item.country}`,
      cityLabel: `${item.name}, ${item.country}`,
      source: "Live match",
      coords: { lat: item.lat, lon: item.lon },
    }));
  } catch {
    return [];
  }
};

const renderSuggestions = () => {
  const list = elements.suggestionsList;
  list.innerHTML = "";

  if (!state.suggestions.length) {
    list.classList.remove("open");
    elements.input.setAttribute("aria-expanded", "false");
    return;
  }

  state.suggestions.forEach((item, idx) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");

    btn.type = "button";
    btn.className = "suggestion-item";
    btn.setAttribute("role", "option");
    btn.dataset.index = idx;

    if (idx === state.activeSuggestionIndex) btn.classList.add("active");

    btn.innerHTML = `<span class="suggestion-main">${item.label}</span><span class="suggestion-sub">${item.source}</span>`;
    btn.addEventListener("click", () => applySuggestion(idx));

    li.appendChild(btn);
    list.appendChild(li);
  });

  list.classList.add("open");
  elements.input.setAttribute("aria-expanded", "true");
};

const hideSuggestions = () => {
  state.suggestions = [];
  state.activeSuggestionIndex = -1;
  elements.suggestionsList.classList.remove("open");
  elements.input.setAttribute("aria-expanded", "false");
};

const refreshSuggestions = async (query) => {
  const token = ++state.suggestionToken;
  const local = getLocalSuggestions(query);

  if (!query) {
    state.suggestions = local.slice(0, 6);
    state.activeSuggestionIndex = -1;
    renderSuggestions();
    return;
  }

  const remote = await getRemoteSuggestions(query);

  if (token !== state.suggestionToken) return;

  const seen = new Set();
  state.suggestions = [...local, ...remote]
    .filter((item) => {
      const key = item.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);

  state.activeSuggestionIndex = -1;
  renderSuggestions();
};

const scheduleSuggestions = (query) => {
  clearTimeout(state.suggestionDebounce);
  state.suggestionDebounce = setTimeout(() => refreshSuggestions(query), 220);
};

const applySuggestion = async (idx) => {
  const picked = state.suggestions[idx];
  if (!picked) return;

  elements.input.value = picked.label;
  hideSuggestions();
  updateSearchButtonState();

  if (picked.coords) {
    await loadWeatherByCoords(picked.coords.lat, picked.coords.lon, {
      addToHistory: true,
      cityLabel: picked.cityLabel || picked.cityQuery,
    });
  } else {
    await loadWeatherByCity(picked.cityQuery, { addToHistory: true });
  }
};

// ==================== API Calls ====================

const buildUrl = (base, params) => {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
};

const fetchJson = async (url, errorMsg) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(errorMsg || "API Error");
    return response.json();
  } catch (error) {
    if (errorMsg) throw new Error(errorMsg);
    throw error;
  }
};

const getCoordsByCity = async (city) => {
  const url = buildUrl(`${GEO_BASE}/direct`, {
    q: city,
    limit: 1,
    appid: API_KEY,
  });
  const data = await fetchJson(url, "City not found. Try another search.");
  if (!data.length) throw new Error("City not found.");
  return data[0];
};

const getCurrentWeather = (lat, lon) =>
  fetchJson(
    buildUrl(`${API_BASE}/weather`, {
      lat,
      lon,
      units: state.units,
      appid: API_KEY,
    }),
    "Unable to load weather data."
  );

const getForecast = (lat, lon) =>
  fetchJson(
    buildUrl(`${API_BASE}/forecast`, {
      lat,
      lon,
      units: state.units,
      appid: API_KEY,
    }),
    "Unable to load forecast data."
  );

const getAirQuality = (lat, lon) =>
  fetchJson(
    buildUrl(`${API_BASE}/air_pollution`, {
      lat,
      lon,
      appid: API_KEY,
    }),
    null
  );

const getWeatherAlerts = async (lat, lon) => {
  try {
    return await fetchJson(
      buildUrl(ONE_CALL_BASE, {
        lat,
        lon,
        exclude: "current,minutely,hourly,daily",
        appid: API_KEY,
      }),
      null
    );
  } catch {
    return null;
  }
};

// ==================== Weather Display Updates ====================

const setWeatherGradient = (mainCondition) => {
  document.body.dataset.weather = getWeatherThemeKey(mainCondition);
};

// ==================== Weather Effects ====================

const createWeatherEffects = (weatherCondition) => {
  // Remove existing effects
  const existingEffects = document.querySelector(".weather-effects");
  if (existingEffects) {
    existingEffects.remove();
  }

  const effectsContainer = document.createElement("div");
  effectsContainer.className = "weather-effects";

  const condition = weatherCondition.toLowerCase();

  // Clear all weather classes
  document.body.classList.remove("windy-weather", "storm-weather");

  if (condition.includes("snow")) {
    createSnowEffect(effectsContainer);
  } else if (condition.includes("rain")) {
    createRainEffect(effectsContainer);
  } else if (condition.includes("thunderstorm") || condition.includes("thunder")) {
    createStormEffect(effectsContainer);
  } else if (condition.includes("wind")) {
    createWindEffect(effectsContainer);
  } else if (condition.includes("clear") || condition.includes("sunny")) {
    createSunEffect(effectsContainer);
  } else if (condition.includes("cloud")) {
    createCloudEffect(effectsContainer);
  }

  document.body.appendChild(effectsContainer);
};

const createSnowEffect = (container) => {
  // Create 30 snowflakes
  for (let i = 0; i < 30; i++) {
    const snowflake = document.createElement("div");
    snowflake.className = "snowflake";
    snowflake.textContent = "❄";
    snowflake.style.left = Math.random() * 100 + "%";
    snowflake.style.animationDuration = (5 + Math.random() * 5) + "s";
    snowflake.style.animationDelay = Math.random() * 2 + "s";
    snowflake.style.fontSize = (0.5 + Math.random() * 1.5) + "em";
    snowflake.style.opacity = 0.6 + Math.random() * 0.4;
    container.appendChild(snowflake);
  }
};

const createRainEffect = (container) => {
  // Create 60 raindrops
  for (let i = 0; i < 60; i++) {
    const raindrop = document.createElement("div");
    raindrop.className = "raindrop";
    raindrop.style.left = Math.random() * 100 + "%";
    raindrop.style.animationDuration = (0.5 + Math.random() * 0.5) + "s";
    raindrop.style.animationDelay = Math.random() * 2 + "s";
    raindrop.style.opacity = 0.6 + Math.random() * 0.4;
    container.appendChild(raindrop);
  }
};

const createStormEffect = (container) => {
  // Add lightning flash effect
  document.body.classList.add("storm-weather");

  // Create rain with storm intensity
  for (let i = 0; i < 100; i++) {
    const raindrop = document.createElement("div");
    raindrop.className = "raindrop";
    raindrop.style.left = Math.random() * 100 + "%";
    raindrop.style.animationDuration = (0.3 + Math.random() * 0.3) + "s";
    raindrop.style.animationDelay = Math.random() * 1 + "s";
    raindrop.style.opacity = 0.8;
    container.appendChild(raindrop);
  }
};

const createWindEffect = (container) => {
  // Add wind sway effect
  document.body.classList.add("windy-weather");

  // Create a few cloud elements that sway
  const cloudSvg = `<svg style="position: fixed; top: 100px; left: -200px; width: 300px; height: 80px; fill: rgba(255,255,255,0.3); pointer-events: none; z-index: -1;" viewBox="0 0 300 80">
    <path d="M 150 50 Q 80 20 40 40 Q 20 50 30 70 L 270 70 Q 280 50 250 40 Q 210 10 150 50" />
  </svg>`;

  for (let i = 0; i < 3; i++) {
    const cloudDiv = document.createElement("div");
    cloudDiv.innerHTML = cloudSvg;
    cloudDiv.style.animation = `cloud-movement ${15 + i * 5}s linear infinite`;
    cloudDiv.style.top = (50 + i * 60) + "px";
    container.appendChild(cloudDiv);
  }
};

const createSunEffect = (container) => {
  // Create sun circle
  const sunCircle = document.createElement("div");
  sunCircle.className = "sun-circle";
  container.appendChild(sunCircle);

  // Create sun rays
  const rayAngles = [-30, -15, 0, 15, 30];
  for (let i = 0; i < 5; i++) {
    const ray = document.createElement("div");
    ray.className = "sun-ray";
    ray.style.transform = `translateX(-50%) rotate(${rayAngles[i]}deg)`;
    container.appendChild(ray);
  }
};

const createCloudEffect = (container) => {
  // Create moving cloud elements
  const cloudSvg = `<svg style="position: fixed; top: 80px; width: 300px; height: 80px; fill: rgba(255,255,255,0.4); pointer-events: none; z-index: -1;" viewBox="0 0 300 80">
    <path d="M 150 50 Q 80 20 40 40 Q 20 50 30 70 L 270 70 Q 280 50 250 40 Q 210 10 150 50" />
  </svg>`;

  for (let i = 0; i < 2; i++) {
    const cloudDiv = document.createElement("div");
    cloudDiv.innerHTML = cloudSvg;
    cloudDiv.style.animation = `cloud-movement ${20 + i * 10}s linear infinite`;
    cloudDiv.style.top = (60 + i * 100) + "px";
    cloudDiv.style.left = (i * 50) + "%";
    container.appendChild(cloudDiv);
  }

  // Keep default cloudy background
};

const updateCurrentWeather = (weather, forecastFirstEntry) => {
  const condition = weather.weather[0];
  const rainChance = Math.round((forecastFirstEntry?.pop || 0) * 100);
  const observedTime = formatTime(weather.dt, weather.timezone, {
    hour: "numeric",
    minute: "2-digit",
  });

  elements.currentCity.textContent = `${weather.name}, ${weather.sys.country}`;
  elements.currentCondition.textContent = capitalize(condition.description);
  elements.currentTemp.textContent = Math.round(weather.main.temp);
  elements.currentFeels.textContent = Math.round(weather.main.feels_like);
  elements.currentHumidity.textContent = `${weather.main.humidity}%`;
  elements.currentHighLow.textContent = `${Math.round(weather.main.temp_max)}° / ${Math.round(weather.main.temp_min)}°`;

  const windUnit = state.units === "metric" ? "m/s" : "mph";
  elements.currentWind.textContent = `${Math.round(weather.wind.speed)} ${windUnit}`;
  elements.currentRainChance.textContent = `${rainChance}%`;

  elements.currentIcon.src = `https://openweathermap.org/img/wn/${condition.icon}@2x.png`;
  elements.currentIcon.alt = condition.main;

  elements.currentTime.textContent = `Local time: ${formatTime(weather.dt, weather.timezone, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} (${formatOffset(weather.timezone)})`;

  elements.detailPressure.textContent = `${weather.main.pressure} hPa`;
  elements.detailClouds.textContent = `${weather.clouds.all}%`;
  elements.detailSunrise.textContent = formatTime(weather.sys.sunrise, weather.timezone, {
    hour: "numeric",
    minute: "2-digit",
  });
  elements.detailSunset.textContent = formatTime(weather.sys.sunset, weather.timezone, {
    hour: "numeric",
    minute: "2-digit",
  });
  elements.detailTimezone.textContent = formatOffset(weather.timezone);
  elements.detailWindDirection.textContent = windDirection(weather.wind.deg);
  elements.detailObserved.textContent = observedTime;
  elements.themeWeatherLabel.textContent = capitalize(condition.description);
  elements.coordLabel.textContent = `${weather.coord.lat.toFixed(2)}, ${weather.coord.lon.toFixed(2)}`;
  elements.updatedLabel.textContent = observedTime;
  elements.weatherNarrative.textContent = buildWeatherNarrative(weather, forecastFirstEntry);

  const visibility = weather.visibility || 0;
  elements.detailVisibility.textContent =
    state.units === "metric"
      ? `${(visibility / 1000).toFixed(1)} km`
      : `${(visibility / 1609.34).toFixed(1)} mi`;

  setWeatherGradient(condition.main);
  createWeatherEffects(condition.main);
};

const buildDailyForecast = (forecastList, offset) => {
  const grouped = new Map();

  forecastList.forEach((entry) => {
    const date = getDateKey(entry.dt, offset);

    if (!grouped.has(date)) {
      grouped.set(date, {
        date,
        min: entry.main.temp_min,
        max: entry.main.temp_max,
        best: entry,
        pop: entry.pop || 0,
        timeDiff: Infinity,
      });
    }

    const day = grouped.get(date);
    day.min = Math.min(day.min, entry.main.temp_min);
    day.max = Math.max(day.max, entry.main.temp_max);
    day.pop = Math.max(day.pop, entry.pop || 0);

    const diff = Math.abs(getHour(entry.dt, offset) - 12);
    if (diff < day.timeDiff) {
      day.best = entry;
      day.timeDiff = diff;
    }
  });

  return [...grouped.values()].slice(0, 5);
};

const updateForecast = (forecast, offset) => {
  const daily = buildDailyForecast(forecast.list, offset);
  elements.forecastGrid.innerHTML = "";

  daily.forEach((day) => {
    const card = document.createElement("article");
    card.className = "forecast-card";

    const date = new Date(`${day.date}T00:00:00`);
    const label = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date);

    const cond = day.best.weather[0];
    const animatedClass = getAnimatedWeatherClass(cond.main);

    card.innerHTML = `
      <p class="forecast-date">${label}</p>
      <div class="animated-weather-icon ${animatedClass}" aria-hidden="true"></div>
      <img src="https://openweathermap.org/img/wn/${cond.icon}@2x.png" alt="${cond.main}" />
      <p class="forecast-temp">${Math.round(day.max)}° / ${Math.round(day.min)}°</p>
      <p class="forecast-meta">${capitalize(cond.description)}</p>
      <p class="forecast-meta">Rain ${Math.round(day.pop * 100)}%</p>
    `;

    elements.forecastGrid.appendChild(card);
  });
};

const updateHourly = (forecast, offset) => {
  const entries = forecast.list.slice(0, 8);
  elements.hourlyStrip.innerHTML = "";

  entries.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "hour-card";

    const timeStr = formatTime(entry.dt, offset, {
      hour: "numeric",
      minute: "2-digit",
    });
    const animatedClass = getAnimatedWeatherClass(entry.weather[0].main);

    card.innerHTML = `
      <p class="hour-time">${timeStr}</p>
      <div class="animated-weather-icon small ${animatedClass}" aria-hidden="true"></div>
      <img src="https://openweathermap.org/img/wn/${entry.weather[0].icon}.png" alt="${entry.weather[0].main}" />
      <p class="hour-temp">${Math.round(entry.main.temp)}${unitSymbol()}</p>
      <p class="hour-rain">Rain ${Math.round((entry.pop || 0) * 100)}%</p>
    `;

    elements.hourlyStrip.appendChild(card);
  });
};

const updateAQI = (aqiResponse) => {
  const aqiSummary = getAqiSummary(aqiResponse);
  const aqiValue = aqiSummary?.aqiValue;
  const aqiLevel = aqiSummary?.level;
  elements.aqiHealthGrid.innerHTML = "";

  if (!aqiSummary || !aqiLevel || !AQI_LEVELS[aqiLevel]) {
    elements.aqiValue.textContent = "--";
    elements.aqiValue.style.setProperty("--aqi-progress", 0);
    elements.aqiLabel.textContent = "Unavailable";
    elements.aqiLevel.textContent = "Level -- / 5";
    elements.aqiAdvice.textContent = "Air quality data unavailable for this location.";
    renderChipList(elements.aqiHealthGrid, [], "No health guidance", () => {});
    updateAqiChart(null);
    return;
  }

  const level = AQI_LEVELS[aqiLevel];
  elements.aqiValue.textContent = aqiValue;
  elements.aqiValue.style.setProperty("--aqi-progress", aqiLevel * 20);
  elements.aqiLabel.textContent = level.label;
  elements.aqiLevel.textContent = `Level ${aqiLevel} / 5`;
  elements.aqiAdvice.textContent = level.advice;
  updateAqiChart(aqiLevel);

  level.cards.forEach((text) => {
    const card = document.createElement("article");
    card.className = "aqi-health-card";
    card.textContent = text;
    elements.aqiHealthGrid.appendChild(card);
  });
};

const updateAqiChart = (level) => {
  if (typeof Chart === "undefined" || !elements.aqiChart) return;

  const labels = ["Good", "Fair", "Moderate", "Poor", "Very Poor"];
  const colors = ["#22c55e", "#84cc16", "#f59e0b", "#f97316", "#ef4444"];
  const muted = [
    "rgba(34, 197, 94, 0.25)",
    "rgba(132, 204, 22, 0.25)",
    "rgba(245, 158, 11, 0.25)",
    "rgba(249, 115, 22, 0.25)",
    "rgba(239, 68, 68, 0.25)",
  ];

  const backgroundColor = labels.map((_, index) =>
    level && index + 1 === level ? colors[index] : muted[index]
  );

  if (state.aqiChart) state.aqiChart.destroy();

  state.aqiChart = new Chart(elements.aqiChart, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: [1, 1, 1, 1, 1],
          backgroundColor,
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => `Level ${context.dataIndex + 1}: ${context.label}`,
          },
        },
      },
    },
  });
};

const updateWeatherSuggestions = (weather, forecastFirstEntry, aqiResponse) => {
  const suggestions = buildWeatherSuggestions(weather, forecastFirstEntry, aqiResponse);
  elements.weatherSuggestions.innerHTML = "";

  suggestions.forEach((item) => {
    const card = document.createElement("article");
    card.className = "suggestion-card";
    card.innerHTML = `<strong>${item.title}</strong><span>${item.text}</span>`;
    elements.weatherSuggestions.appendChild(card);
  });
};

const updateAlerts = (alertsResponse) => {
  const alerts = alertsResponse?.alerts || [];
  elements.alertsList.innerHTML = "";

  if (!alerts.length) {
    const empty = document.createElement("article");
    empty.className = "alert-card calm";
    empty.innerHTML = "<strong>No active alerts</strong><span>No official weather alerts are currently available for this location.</span>";
    elements.alertsList.appendChild(empty);
    return;
  }

  alerts.slice(0, 3).forEach((alert) => {
    const card = document.createElement("article");
    card.className = "alert-card severe";
    const starts = alert.start ? formatBrowserTime(alert.start, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Now";
    const ends = alert.end ? formatBrowserTime(alert.end, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Until further notice";
    const description = alert.description || "Check local guidance and stay aware of changing conditions.";

    card.innerHTML = `
      <strong>${alert.event || "Weather Alert"}</strong>
      <span>${starts} - ${ends}</span>
      <p>${description.slice(0, 220)}${description.length > 220 ? "..." : ""}</p>
      <small>${alert.sender_name || "Weather authority"}</small>
    `;
    elements.alertsList.appendChild(card);
  });
};

const updateChart = (forecast, offset) => {
  if (typeof Chart === "undefined") return;

  const entries = forecast.list.slice(0, 8);
  const labels = entries.map((entry) =>
    formatTime(entry.dt, offset, {
      hour: "numeric",
      minute: "2-digit",
    })
  );

  const temps = entries.map((entry) => entry.main.temp);
  const rains = entries.map((entry) => Math.round((entry.pop || 0) * 100));

  const isDark = document.documentElement.dataset.theme === "dark";
  const accentColor = isDark ? "#38bdf8" : "#0369a1";
  const rainColor = isDark ? "#f472b6" : "#ec4899";
  const textColor = isDark ? "#cbd5e1" : "#64748b";
  const gridColor = isDark ? "rgba(71, 85, 105, 0.3)" : "rgba(148, 163, 184, 0.2)";

  if (state.chart) state.chart.destroy();

  state.chart = new Chart(elements.tempChart, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `Temperature (${unitSymbol()})`,
          data: temps,
          borderColor: accentColor,
          backgroundColor: isDark ? "rgba(56, 189, 248, 0.15)" : "rgba(3, 105, 161, 0.1)",
          yAxisID: "y",
          tension: 0.4,
          fill: true,
          pointRadius: 4,
          pointBackgroundColor: accentColor,
          pointBorderColor: "#fff",
          pointBorderWidth: 2,
        },
        {
          label: "Rain Chance (%)",
          data: rains,
          borderColor: rainColor,
          backgroundColor: "transparent",
          yAxisID: "y1",
          tension: 0.4,
          fill: false,
          pointRadius: 3,
          pointBackgroundColor: rainColor,
          borderDash: [5, 5],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: {
          beginAtZero: false,
          ticks: { color: textColor },
          grid: { color: gridColor },
        },
        y1: {
          beginAtZero: true,
          position: "right",
          max: 100,
          ticks: { color: textColor },
          grid: { drawOnChartArea: false },
        },
        x: {
          ticks: { color: textColor },
          grid: { color: gridColor },
        },
      },
      plugins: {
        legend: { labels: { color: textColor, padding: 15 } },
      },
    },
  });
};

// ==================== History & Favorites ====================

const renderChipList = (container, items, emptyText, onClick) => {
  container.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("span");
    empty.className = "chip empty";
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = item;
    btn.addEventListener("click", () => onClick(item));
    container.appendChild(btn);
  });
};

const renderHistory = () => {
  const history = getStoredList(STORAGE_KEYS.history).slice(0, 5);
  renderChipList(elements.historyList, history, "No recent searches", (city) => {
    loadWeatherByCity(city, { addToHistory: false });
  });
  elements.clearHistoryBtn.disabled = history.length === 0;
};

const renderFavorites = () => {
  const favs = getStoredList(STORAGE_KEYS.favorites);
  renderChipList(elements.favoritesList, favs, "No favorites yet", (city) => {
    loadWeatherByCity(city, { addToHistory: false });
  });
  elements.clearFavoritesBtn.disabled = favs.length === 0;

  const isFav = favs.includes(state.weatherLabel);
  elements.favoriteBtn.classList.toggle("active", isFav);
  elements.favoriteBtn.textContent = isFav ? "★" : "☆";
  updateFavoriteDashboard(favs);
};

const renderFavoriteDashboardCards = (items) => {
  elements.favoriteDashboard.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("article");
    empty.className = "favorite-weather-card empty";
    empty.textContent = "Save cities with the star button to build your quick dashboard.";
    elements.favoriteDashboard.appendChild(empty);
    return;
  }

  items.forEach(({ label, weather }) => {
    const condition = weather.weather[0];
    const card = document.createElement("button");
    card.type = "button";
    card.className = "favorite-weather-card";
    card.innerHTML = `
      <span class="favorite-city">${label}</span>
      <span class="favorite-temp">${Math.round(weather.main.temp)}${unitSymbol()}</span>
      <span class="favorite-meta">${capitalize(condition.description)}</span>
      <span class="favorite-wind">${Math.round(weather.wind.speed)} ${state.units === "metric" ? "m/s" : "mph"} wind</span>
    `;
    card.addEventListener("click", () => loadWeatherByCity(label, { addToHistory: false }));
    elements.favoriteDashboard.appendChild(card);
  });
};

const updateFavoriteDashboard = async (favs = getStoredList(STORAGE_KEYS.favorites)) => {
  const token = ++state.favoriteDashboardToken;

  if (!elements.favoriteDashboard) return;

  if (!favs.length) {
    renderFavoriteDashboardCards([]);
    return;
  }

  elements.favoriteDashboard.innerHTML = "";
  favs.slice(0, 6).forEach(() => {
    const skeleton = document.createElement("article");
    skeleton.className = "favorite-weather-card skeleton-card";
    elements.favoriteDashboard.appendChild(skeleton);
  });

  const results = await Promise.allSettled(
    favs.slice(0, 6).map(async (label) => {
      const coords = await getCoordsByCity(label);
      const weather = await getCurrentWeather(coords.lat, coords.lon);
      return { label, weather };
    })
  );

  if (token !== state.favoriteDashboardToken) return;

  const cards = results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  renderFavoriteDashboardCards(cards);
};

const saveHistory = (label) => {
  const history = getStoredList(STORAGE_KEYS.history);
  const next = [label, ...history.filter((c) => c !== label)].slice(0, 5);
  setStoredList(STORAGE_KEYS.history, next);
  renderHistory();
};

const toggleFavorite = () => {
  if (!state.weatherLabel) return;

  const favs = getStoredList(STORAGE_KEYS.favorites);
  const exists = favs.includes(state.weatherLabel);
  const next = exists
    ? favs.filter((item) => item !== state.weatherLabel)
    : [state.weatherLabel, ...favs].slice(0, 10);

  setStoredList(STORAGE_KEYS.favorites, next);
  renderFavorites();
};

// ==================== Main Weather Loading ====================

const loadWeatherByCoords = async (lat, lon, options = {}) => {
  if (!API_KEY) {
    setError("Add your OpenWeather API key in app.js");
    return;
  }

  const { addToHistory = true, cityLabel = null, silent = false } = options;

  if (!silent) setLoading(true);
  clearError();
  if (!silent) setStatus("Loading weather data...");

  try {
    const [current, forecast, aqi, alerts] = await Promise.all([
      getCurrentWeather(lat, lon),
      getForecast(lat, lon),
      getAirQuality(lat, lon),
      getWeatherAlerts(lat, lon),
    ]);

    state.current = { current, forecast, aqi, alerts };
    state.weatherLabel = cityLabel || `${current.name}, ${current.sys.country}`;
    state.currentCoords = { lat, lon };

    updateCurrentWeather(current, forecast.list[0]);
    updateForecast(forecast, current.timezone);
    updateHourly(forecast, current.timezone);
    updateAQI(aqi);
    updateWeatherSuggestions(current, forecast.list[0], aqi);
    updateAlerts(alerts);
    updateChart(forecast, current.timezone);

    setStatus(
      `Updated ${formatTime(current.dt, current.timezone, {
        hour: "numeric",
        minute: "2-digit",
        weekday: "short",
      })} (${formatOffset(current.timezone)})`
    );

    if (addToHistory) saveHistory(state.weatherLabel);
    renderFavorites();
    scheduleAutoRefresh();
    localStorage.setItem(
      STORAGE_KEYS.lastPlace,
      JSON.stringify({ lat, lon, cityLabel: state.weatherLabel })
    );
  } catch (error) {
    if (!silent) {
      setError(error.message || "Weather loading failed.");
      setStatus("");
    }
  } finally {
    if (!silent) setLoading(false);
  }
};

const loadWeatherByCity = async (cityInput, options = {}) => {
  try {
    setLoading(true);
    clearError();
    setStatus("Looking up city...");

    const coords = await getCoordsByCity(cityInput);
    const label = `${coords.name}, ${coords.country}`;

    await loadWeatherByCoords(coords.lat, coords.lon, {
      ...options,
      cityLabel: label,
    });
  } catch (error) {
    setError(error.message || "City lookup failed.");
    setStatus("");
    setLoading(false);
  }
};

// ==================== Event Handlers ====================

const handleSearch = async (event) => {
  event.preventDefault();
  const city = elements.input.value.trim();

  if (!city) {
    setError("Please enter a city name.");
    return;
  }

  hideSuggestions();
  await loadWeatherByCity(city, { addToHistory: true });
};

const handleLocate = async () => {
  if (!navigator.geolocation) {
    setError("Geolocation not supported in your browser.");
    return;
  }

  setStatus("Getting your location...");
  clearError();

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      await loadWeatherByCoords(position.coords.latitude, position.coords.longitude, {
        addToHistory: true,
      });
    },
    () => {
      setError("Location access denied. Search by city instead.");
      setStatus("");
    },
    { timeout: 10000 }
  );
};

const handleRefresh = async () => {
  if (!state.currentCoords) {
    setError("Search for a city first.");
    return;
  }

  await loadWeatherByCoords(state.currentCoords.lat, state.currentCoords.lon, {
    addToHistory: false,
    cityLabel: state.weatherLabel,
  });
};

const handleInputChange = () => {
  clearError();
  updateSearchButtonState();
  scheduleSuggestions(elements.input.value.trim());
};

const handleInputFocus = () => {
  scheduleSuggestions(elements.input.value.trim());
};

const handleInputKeydown = (e) => {
  const isSuggestionsOpen = state.suggestions.length > 0 && elements.suggestionsList.classList.contains("open");

  if (!isSuggestionsOpen) {
    if (e.key === "Escape") hideSuggestions();
    return;
  }

  const lastIdx = state.suggestions.length - 1;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    const nextIdx = state.activeSuggestionIndex >= lastIdx ? 0 : state.activeSuggestionIndex + 1;
    state.activeSuggestionIndex = nextIdx;
    renderSuggestions();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    const nextIdx = state.activeSuggestionIndex <= 0 ? lastIdx : state.activeSuggestionIndex - 1;
    state.activeSuggestionIndex = nextIdx;
    renderSuggestions();
  } else if (e.key === "Enter" && state.activeSuggestionIndex >= 0) {
    e.preventDefault();
    applySuggestion(state.activeSuggestionIndex);
  } else if (e.key === "Escape") {
    hideSuggestions();
  }
};

const handleDocumentClick = (e) => {
  if (!elements.form.contains(e.target)) hideSuggestions();
};

const handleClearHistory = () => {
  setStoredList(STORAGE_KEYS.history, []);
  renderHistory();
  setStatus("Recent searches cleared.");
};

const handleClearFavorites = () => {
  setStoredList(STORAGE_KEYS.favorites, []);
  renderFavorites();
  setStatus("Favorites cleared.");
};

const setVoiceListening = (listening) => {
  state.isListening = listening;
  elements.voiceBtn?.classList.toggle("is-listening", listening);
  elements.voiceBtn?.setAttribute("aria-pressed", String(listening));
};

const setupVoiceSearch = () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition || !elements.voiceBtn) {
    elements.voiceBtn.disabled = true;
    elements.voiceBtn.title = "Voice search is not supported in this browser";
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.addEventListener("start", () => {
    setVoiceListening(true);
    setStatus("Listening for a city name...");
  });

  recognition.addEventListener("result", async (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim();
    if (!transcript) return;

    elements.input.value = transcript;
    updateSearchButtonState();
    setStatus(`Voice search: ${transcript}`);
    hideSuggestions();
    await loadWeatherByCity(transcript, { addToHistory: true });
  });

  recognition.addEventListener("error", (event) => {
    setError(event.error === "not-allowed" ? "Microphone access was blocked." : "Voice search could not hear a city.");
    setStatus("");
  });

  recognition.addEventListener("end", () => setVoiceListening(false));

  state.recognition = recognition;
};

const handleVoiceSearch = () => {
  if (!state.recognition) return;

  if (state.isListening) {
    state.recognition.stop();
    return;
  }

  clearError();
  try {
    state.recognition.start();
  } catch {
    setVoiceListening(false);
  }
};

const setupInstallPrompt = () => {
  if (!elements.installBtn) return;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    elements.installBtn.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    state.deferredInstallPrompt = null;
    elements.installBtn.hidden = true;
    setStatus("App installed successfully.");
  });
};

const handleInstallApp = async () => {
  if (!state.deferredInstallPrompt) return;

  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  elements.installBtn.hidden = true;
};

const registerServiceWorker = () => {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {
      setStatus("Offline support is not available in this browser session.");
    });
  });
};

const toggleTheme = () => {
  const current = document.documentElement.dataset.theme || "light";
  const next = current === "dark" ? "light" : "dark";

  document.documentElement.dataset.theme = next;
  const icon = next === "dark" ? "🌙" : "☀️";
  const text = next === "dark" ? "Dark" : "Light";
  elements.themeToggle.innerHTML = `<span class="icon">${icon}</span><span class="text">${text}</span>`;
  localStorage.setItem(STORAGE_KEYS.theme, next);

  if (state.current?.forecast) {
    updateChart(state.current.forecast, state.current.current.timezone);
  }
};

const toggleUnits = () => {
  state.units = state.units === "metric" ? "imperial" : "metric";
  localStorage.setItem(STORAGE_KEYS.units, state.units);

  elements.unitToggle.innerHTML = `<span class="icon">${state.units === "metric" ? "°C" : "°F"}</span><span class="text">${state.units === "metric" ? "Celsius" : "Fahrenheit"}</span>`;
  elements.tempUnitSymbol.textContent = unitSymbol();
  elements.feelsUnitSymbol.textContent = unitSymbol();

  if (state.currentCoords) {
    loadWeatherByCoords(state.currentCoords.lat, state.currentCoords.lon, {
      addToHistory: false,
      cityLabel: state.weatherLabel,
    });
  }
};

// ==================== Modal Management ====================

const showModal = (title, body) => {
  elements.detailModalTitle.textContent = title;
  elements.detailModalBody.innerHTML = body;
  elements.detailModal.style.display = "flex";
};

const hideModal = () => {
  elements.detailModal.style.display = "none";
};

elements.closeDetailModal.addEventListener("click", hideModal);
elements.detailModal.addEventListener("click", (e) => {
  if (e.target === elements.detailModal) hideModal();
});

// Add modal interaction for cards
document.addEventListener("click", (e) => {
  const summaryItem = e.target.closest(".summary-item");
  if (summaryItem) {
    const label = summaryItem.querySelector(".label")?.textContent?.trim();
    const tooltips = {
      "High / Low": "Highest and lowest temperature today. Helps you prepare for the full range of conditions.",
      "Humidity": "Amount of water vapor in the air. High humidity can feel uncomfortable.",
      "Wind": "Wind speed and direction. Important for outdoor activities.",
      "Rain Chance": "Probability of precipitation. Higher % means more likely rain.",
    };
    if (tooltips[label]) showModal(label, `<p>${tooltips[label]}</p>`);
  }
});

// ==================== Initialization ====================

const init = async () => {
  // Set initial theme
  const theme = localStorage.getItem(STORAGE_KEYS.theme) || "light";
  document.documentElement.dataset.theme = theme;
  const themeIcon = theme === "dark" ? "🌙" : "☀️";
  const themeText = theme === "dark" ? "Dark" : "Light";
  elements.themeToggle.innerHTML = `<span class="icon">${themeIcon}</span><span class="text">${themeText}</span>`;

  // Set unit toggle
  const unitText = state.units === "metric" ? "Celsius" : "Fahrenheit";
  const unitSymb = state.units === "metric" ? "°C" : "°F";
  elements.unitToggle.innerHTML = `<span class="icon">${unitSymb}</span><span class="text">${unitText}</span>`;

  setupInstallPrompt();
  registerServiceWorker();
  setupVoiceSearch();
  updateSearchButtonState();
  renderHistory();
  renderFavorites();

  // Load last place or default
  const lastPlaceRaw = localStorage.getItem(STORAGE_KEYS.lastPlace);
  if (lastPlaceRaw) {
    try {
      const lastPlace = JSON.parse(lastPlaceRaw);
      if (lastPlace?.lat && lastPlace?.lon) {
        await loadWeatherByCoords(lastPlace.lat, lastPlace.lon, {
          addToHistory: false,
          cityLabel: lastPlace.cityLabel || null,
        });
        return;
      }
    } catch {
      // Fall back to default
    }
  }

  // Default city
  await loadWeatherByCity("New York", { addToHistory: false });
};

// ==================== Event Listeners ====================

elements.form.addEventListener("submit", handleSearch);
elements.input.addEventListener("input", handleInputChange);
elements.input.addEventListener("focus", handleInputFocus);
elements.input.addEventListener("keydown", handleInputKeydown);
elements.locateBtn.addEventListener("click", handleLocate);
elements.refreshBtn.addEventListener("click", handleRefresh);
elements.voiceBtn.addEventListener("click", handleVoiceSearch);
elements.installBtn.addEventListener("click", handleInstallApp);
elements.clearHistoryBtn.addEventListener("click", handleClearHistory);
elements.clearFavoritesBtn.addEventListener("click", handleClearFavorites);
elements.themeToggle.addEventListener("click", toggleTheme);
elements.unitToggle.addEventListener("click", toggleUnits);
elements.favoriteBtn.addEventListener("click", toggleFavorite);
document.addEventListener("click", handleDocumentClick);

init();
