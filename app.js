// ==================== API & Storage Configuration ====================
const API_KEY = "bac7893eaffd11c1ff3b45e7f7f541ad"; // Replace with your API key
const API_BASE = "https://api.openweathermap.org/data/2.5";
const GEO_BASE = "https://api.openweathermap.org/geo/1.0";

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
  aqiValue: document.getElementById("aqiValue"),
  aqiLabel: document.getElementById("aqiLabel"),
  aqiAdvice: document.getElementById("aqiAdvice"),
  forecastGrid: document.getElementById("forecastGrid"),
  hourlyStrip: document.getElementById("hourlyStrip"),
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
  weatherLabel: "",
  currentCoords: null,
  suggestions: [],
  activeSuggestionIndex: -1,
  suggestionDebounce: null,
  suggestionToken: 0,
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
  1: { label: "Good", advice: "Air quality is healthy for most people." },
  2: { label: "Fair", advice: "Acceptable air quality. Sensitive groups may be affected." },
  3: { label: "Moderate", advice: "Reduce long outdoor activities if you are sensitive." },
  4: { label: "Poor", advice: "Limit outdoor exertion and keep windows closed." },
  5: { label: "Very Poor", advice: "Avoid outdoor activities and wear N95 masks if necessary." },
};

const WEATHER_GRADIENTS = {
  clear: { start: "#f0f7ff", end: "#bfdbfe" },
  clouds: { start: "#f1f5f9", end: "#cbd5e1" },
  rain: { start: "#e0f2fe", end: "#a5f3fc" },
  drizzle: { start: "#eff6ff", end: "#bfdbfe" },
  thunderstorm: { start: "#1e1b4b", end: "#3f3f46" },
  snow: { start: "#f8fafc", end: "#e2e8f0" },
  mist: { start: "#e5e7eb", end: "#d1d5db" },
  default: { start: "#f0f7ff", end: "#dbeafe" },
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

const getDateKey = (unixSeconds, offsetSeconds) => {
  const shifted = new Date((unixSeconds + offsetSeconds) * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
};

const getHour = (unixSeconds, offsetSeconds) => {
  const shifted = new Date((unixSeconds + offsetSeconds) * 1000);
  return shifted.getUTCHours();
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

    btn.innerHTML = `<span class="suggestion-main">${item.label}</span><span class="suggestion-sub">${item.source}</span>`;
    btn.addEventListener("click", () => applySuggestion(idx));

    li.appendChild(btn);
    list.appendChild(li);
  });

  list.classList.add("open");
  elements.input.setAttribute("aria-expanded", "true");
  state.activeSuggestionIndex = -1;
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

// ==================== Weather Display Updates ====================

const setWeatherGradient = (mainCondition) => {
  const condition = mainCondition.toLowerCase();
  const gradient = WEATHER_GRADIENTS[condition] || WEATHER_GRADIENTS.default;
  document.documentElement.style.setProperty("--sky-start", gradient.start);
  document.documentElement.style.setProperty("--sky-end", gradient.end);
};

const updateCurrentWeather = (weather, forecastFirstEntry) => {
  const condition = weather.weather[0];

  elements.currentCity.textContent = `${weather.name}, ${weather.sys.country}`;
  elements.currentCondition.textContent = capitalize(condition.description);
  elements.currentTemp.textContent = Math.round(weather.main.temp);
  elements.currentFeels.textContent = Math.round(weather.main.feels_like);
  elements.currentHumidity.textContent = `${weather.main.humidity}%`;
  elements.currentHighLow.textContent = `${Math.round(weather.main.temp_max)}° / ${Math.round(weather.main.temp_min)}°`;

  const windUnit = state.units === "metric" ? "m/s" : "mph";
  elements.currentWind.textContent = `${Math.round(weather.wind.speed)} ${windUnit}`;
  elements.currentRainChance.textContent = `${Math.round((forecastFirstEntry?.pop || 0) * 100)}%`;

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

  const visibility = weather.visibility || 0;
  elements.detailVisibility.textContent =
    state.units === "metric"
      ? `${(visibility / 1000).toFixed(1)} km`
      : `${(visibility / 1609.34).toFixed(1)} mi`;

  setWeatherGradient(condition.main);
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

    card.innerHTML = `
      <p class="forecast-date">${label}</p>
      <img src="https://openweathermap.org/img/wn/${cond.icon}@2x.png" alt="${cond.main}" />
      <p class="forecast-temp">${Math.round(day.max)}° / ${Math.round(day.min)}°</p>
      <p class="forecast-meta">${capitalize(cond.description)}</p>
      <p class="forecast-meta">💧 ${Math.round(day.pop * 100)}%</p>
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

    const timeStr = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date((entry.dt + offset) * 1000));

    card.innerHTML = `
      <p class="hour-time">${timeStr}</p>
      <img src="https://openweathermap.org/img/wn/${entry.weather[0].icon}.png" alt="${entry.weather[0].main}" />
      <p class="hour-temp">${Math.round(entry.main.temp)}${unitSymbol()}</p>
      <p class="hour-rain">💧 ${Math.round((entry.pop || 0) * 100)}%</p>
    `;

    elements.hourlyStrip.appendChild(card);
  });
};

const updateAQI = (aqiResponse) => {
  const aqi = aqiResponse?.list?.[0]?.main?.aqi;

  if (!aqi || !AQI_LEVELS[aqi]) {
    elements.aqiValue.textContent = "--";
    elements.aqiLabel.textContent = "Unavailable";
    elements.aqiAdvice.textContent = "Air quality data unavailable for this location.";
    return;
  }

  const level = AQI_LEVELS[aqi];
  elements.aqiValue.textContent = aqi;
  elements.aqiLabel.textContent = level.label;
  elements.aqiAdvice.textContent = level.advice;
};

const updateChart = (forecast, offset) => {
  if (typeof Chart === "undefined") return;

  const entries = forecast.list.slice(0, 8);
  const labels = entries.map((entry) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date((entry.dt + offset) * 1000))
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
  const history = getStoredList(STORAGE_KEYS.history);
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
};

const saveHistory = (label) => {
  const history = getStoredList(STORAGE_KEYS.history);
  const next = [label, ...history.filter((c) => c !== label)].slice(0, 10);
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

  const { addToHistory = true, cityLabel = null } = options;

  setLoading(true);
  clearError();
  setStatus("Loading weather data...");

  try {
    const [current, forecast, aqi] = await Promise.all([
      getCurrentWeather(lat, lon),
      getForecast(lat, lon),
      getAirQuality(lat, lon),
    ]);

    state.current = { current, forecast, aqi };
    state.weatherLabel = cityLabel || `${current.name}, ${current.sys.country}`;
    state.currentCoords = { lat, lon };

    updateCurrentWeather(current, forecast.list[0]);
    updateForecast(forecast, current.timezone);
    updateHourly(forecast, current.timezone);
    updateAQI(aqi);
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
    localStorage.setItem(
      STORAGE_KEYS.lastPlace,
      JSON.stringify({ lat, lon, cityLabel: state.weatherLabel })
    );
  } catch (error) {
    setError(error.message || "Weather loading failed.");
    setStatus("");
  } finally {
    setLoading(false);
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
elements.clearHistoryBtn.addEventListener("click", handleClearHistory);
elements.clearFavoritesBtn.addEventListener("click", handleClearFavorites);
elements.themeToggle.addEventListener("click", toggleTheme);
elements.unitToggle.addEventListener("click", toggleUnits);
elements.favoriteBtn.addEventListener("click", toggleFavorite);
document.addEventListener("click", handleDocumentClick);

init();