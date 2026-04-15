const API_KEY = "bac7893eaffd11c1ff3b45e7f7f541ad";
const API_BASE = "https://api.openweathermap.org/data/2.5";
const GEO_BASE = "https://api.openweathermap.org/geo/1.0";

const STORAGE_KEYS = {
  history: "weather-history-v2",
  favorites: "weather-favorites-v2",
  theme: "weather-theme-v2",
  units: "weather-units-v2",
  lastPlace: "weather-last-place-v2",
};

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
};

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

const BUTTON_TEXT = {
  search: "Search",
  locate: "Use My Location",
  refresh: "Refresh",
};

const POPULAR_CITY_HINTS = [
  "New York, US",
  "London, GB",
  "Tokyo, JP",
  "Delhi, IN",
  "Paris, FR",
  "Dubai, AE",
];

const WEATHER_GRADIENTS = {
  clear: { start: "#061231", end: "#1b3f7a" },
  clouds: { start: "#0a1836", end: "#243f72" },
  rain: { start: "#080f24", end: "#2b2d6f" },
  drizzle: { start: "#0b1430", end: "#254f86" },
  thunderstorm: { start: "#040814", end: "#201f4f" },
  snow: { start: "#0d1f3f", end: "#355d8d" },
  mist: { start: "#0b1732", end: "#2f4b77" },
  default: { start: "#060b1d", end: "#162a58" },
};

const AQI_MAP = {
  1: {
    label: "Good",
    advice: "Air quality is healthy for most people.",
  },
  2: {
    label: "Fair",
    advice: "Acceptable conditions. Sensitive groups should stay aware.",
  },
  3: {
    label: "Moderate",
    advice: "Consider reducing long outdoor activity if you are sensitive.",
  },
  4: {
    label: "Poor",
    advice: "Limit prolonged outdoor exertion and keep windows closed.",
  },
  5: {
    label: "Very Poor",
    advice: "Try to stay indoors and use masks if outside for long periods.",
  },
};

const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);

const unitSymbol = () => (state.units === "metric" ? "\u00B0C" : "\u00B0F");

const getStoredList = (key) => {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const setStoredList = (key, list) => {
  localStorage.setItem(key, JSON.stringify(list));
};

const formatOffset = (offsetSeconds) => {
  const sign = offsetSeconds >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetSeconds);
  const hours = String(Math.floor(absolute / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((absolute % 3600) / 60)).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
};

const formatInTimezone = (unixSeconds, offsetSeconds, options) => {
  const shifted = new Date((unixSeconds + offsetSeconds) * 1000);
  return new Intl.DateTimeFormat(undefined, {
    ...options,
    timeZone: "UTC",
  }).format(shifted);
};

const getDateKeyInOffset = (unixSeconds, offsetSeconds) => {
  const shifted = new Date((unixSeconds + offsetSeconds) * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getHourInOffset = (unixSeconds, offsetSeconds) => {
  const shifted = new Date((unixSeconds + offsetSeconds) * 1000);
  return shifted.getUTCHours();
};

const setStatus = (message) => {
  elements.status.textContent = message;
};

const clearError = () => {
  elements.error.textContent = "";
};

const setError = (message) => {
  elements.error.textContent = message;
};

const setLoading = (loading) => {
  elements.app.classList.toggle("is-loading", loading);
};

const setActionButtonBusy = (action, busy) => {
  if (!action || !BUTTON_TEXT[action]) {
    return;
  }

  const actionMap = {
    search: elements.searchBtn,
    locate: elements.locateBtn,
    refresh: elements.refreshBtn,
  };

  const button = actionMap[action];
  if (!button) {
    return;
  }

  button.dataset.busy = busy ? "true" : "false";
  button.textContent = busy ? `${BUTTON_TEXT[action].replace("Use My Location", "Locating").replace("Refresh", "Refreshing").replace("Search", "Searching")}...` : BUTTON_TEXT[action];

  if (action === "search") {
    if (busy) {
      button.disabled = true;
    } else {
      button.disabled = elements.input.value.trim().length === 0;
    }
  } else {
    button.disabled = busy;
  }
};

const runAction = async (action, task) => {
  const actionMap = {
    search: elements.searchBtn,
    locate: elements.locateBtn,
    refresh: elements.refreshBtn,
  };

  const button = actionMap[action];
  if (button?.dataset.busy === "true") {
    return;
  }

  setActionButtonBusy(action, true);
  try {
    await task();
  } finally {
    setActionButtonBusy(action, false);
  }
};

const updateSearchButtonState = () => {
  if (elements.searchBtn.dataset.busy === "true") {
    return;
  }

  elements.searchBtn.disabled = elements.input.value.trim().length === 0;
};

const getLocalSuggestions = (query) => {
  const normalized = query.toLowerCase();
  const recent = getStoredList(STORAGE_KEYS.history).map((item) => ({
    label: item,
    cityQuery: item,
    source: "Recent search",
  }));
  const favorites = getStoredList(STORAGE_KEYS.favorites).map((item) => ({
    label: item,
    cityQuery: item,
    source: "Favorite",
  }));
  const popular = POPULAR_CITY_HINTS.map((item) => ({
    label: item,
    cityQuery: item,
    source: "Popular city",
  }));

  const merged = [...favorites, ...recent, ...popular];
  const seen = new Set();

  return merged
    .filter((item) => item.label.toLowerCase().includes(normalized))
    .filter((item) => {
      const key = item.label.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 8);
};

const getRemoteSuggestions = async (query) => {
  if (!API_KEY || API_KEY === "YOUR_OPENWEATHER_KEY" || query.length < 2) {
    return [];
  }

  const url = buildUrl(`${GEO_BASE}/direct`, {
    q: query,
    limit: 5,
    appid: API_KEY,
  });

  const data = await fetchJson(url, "Unable to load city suggestions.");
  return data.map((item) => {
    const fullLabel = [item.name, item.state, item.country].filter(Boolean).join(", ");
    return {
      label: fullLabel,
      cityQuery: `${item.name}, ${item.country}`,
      cityLabel: `${item.name}, ${item.country}`,
      source: "Live match",
      coords: {
        lat: item.lat,
        lon: item.lon,
      },
    };
  });
};

const renderSuggestionList = () => {
  const list = elements.suggestionsList;
  list.innerHTML = "";

  if (!state.suggestions.length) {
    list.classList.remove("open");
    elements.input.setAttribute("aria-expanded", "false");
    return;
  }

  state.suggestions.forEach((item, index) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    const title = document.createElement("span");
    const source = document.createElement("span");

    button.type = "button";
    button.className = "suggestion-item";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    button.dataset.index = String(index);

    title.className = "suggestion-main";
    title.textContent = item.label;
    source.className = "suggestion-sub";
    source.textContent = item.source;

    button.appendChild(title);
    button.appendChild(source);
    button.addEventListener("click", () => {
      applySuggestion(index);
    });

    li.appendChild(button);
    list.appendChild(li);
  });

  list.classList.add("open");
  elements.input.setAttribute("aria-expanded", "true");
  state.activeSuggestionIndex = -1;
};

const hideSuggestions = () => {
  state.suggestions = [];
  state.activeSuggestionIndex = -1;
  elements.suggestionsList.innerHTML = "";
  elements.suggestionsList.classList.remove("open");
  elements.input.setAttribute("aria-expanded", "false");
};

const setActiveSuggestion = (index) => {
  const buttons = elements.suggestionsList.querySelectorAll(".suggestion-item");
  state.activeSuggestionIndex = index;

  buttons.forEach((button, itemIndex) => {
    const active = itemIndex === index;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));

    if (active) {
      button.scrollIntoView({
        block: "nearest",
      });
    }
  });
};

const applySuggestion = async (index) => {
  const picked = state.suggestions[index];
  if (!picked) {
    return;
  }

  elements.input.value = picked.label;
  hideSuggestions();
  updateSearchButtonState();

  await runAction("search", async () => {
    if (picked.coords) {
      await loadWeatherByCoords(picked.coords.lat, picked.coords.lon, {
        addToHistory: true,
        cityLabel: picked.cityLabel || picked.cityQuery,
      });
    } else {
      await loadWeatherByCity(picked.cityQuery, {
        addToHistory: true,
      });
    }
  });
};

const refreshSuggestions = async (query) => {
  const token = ++state.suggestionToken;
  const local = getLocalSuggestions(query);

  if (!query) {
    state.suggestions = local.slice(0, 6);
    renderSuggestionList();
    return;
  }

  let remote = [];
  try {
    remote = await getRemoteSuggestions(query);
  } catch {
    remote = [];
  }

  if (token !== state.suggestionToken) {
    return;
  }

  const seen = new Set();
  state.suggestions = [...local, ...remote].filter((item) => {
    const key = item.label.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, 8);

  renderSuggestionList();
};

const scheduleSuggestions = (query) => {
  if (state.suggestionDebounce) {
    clearTimeout(state.suggestionDebounce);
  }

  state.suggestionDebounce = setTimeout(() => {
    refreshSuggestions(query);
  }, 220);
};

const buildUrl = (base, params) => {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
};

const fetchJson = async (url, fallbackMessage) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(fallbackMessage);
  }
  return response.json();
};

const getCoordsByCity = async (city) => {
  const url = buildUrl(`${GEO_BASE}/direct`, {
    q: city,
    limit: 1,
    appid: API_KEY,
  });

  const data = await fetchJson(url, "Could not find that city.");
  if (!data.length) {
    throw new Error("City not found. Please try another search.");
  }

  return data[0];
};

const getCurrentWeather = (lat, lon) => {
  const url = buildUrl(`${API_BASE}/weather`, {
    lat,
    lon,
    units: state.units,
    appid: API_KEY,
  });

  return fetchJson(url, "Unable to load current weather.");
};

const getForecast = (lat, lon) => {
  const url = buildUrl(`${API_BASE}/forecast`, {
    lat,
    lon,
    units: state.units,
    appid: API_KEY,
  });

  return fetchJson(url, "Unable to load forecast data.");
};

const getAirQuality = (lat, lon) => {
  const url = buildUrl(`${API_BASE}/air_pollution`, {
    lat,
    lon,
    appid: API_KEY,
  });

  return fetchJson(url, "Unable to load air quality data.");
};

const setWeatherGradient = (mainCondition) => {
  const key = mainCondition.toLowerCase();
  const chosen = WEATHER_GRADIENTS[key] || WEATHER_GRADIENTS.default;
  document.documentElement.style.setProperty("--sky-start", chosen.start);
  document.documentElement.style.setProperty("--sky-end", chosen.end);
};

const setUnitButton = () => {
  const isMetric = state.units === "metric";
  elements.unitToggle.textContent = `Unit: ${isMetric ? "Celsius" : "Fahrenheit"}`;
  elements.unitToggle.setAttribute("aria-pressed", String(!isMetric));
  elements.tempUnitSymbol.textContent = unitSymbol();
  elements.feelsUnitSymbol.textContent = unitSymbol();
};

const setTheme = (theme) => {
  document.documentElement.dataset.theme = theme;
  const dark = theme === "dark";
  elements.themeToggle.textContent = `Theme: ${dark ? "Dark" : "Light"}`;
  elements.themeToggle.setAttribute("aria-pressed", String(dark));
  localStorage.setItem(STORAGE_KEYS.theme, theme);

  if (state.current?.forecast) {
    updateChart(state.current.forecast, state.current.current.timezone);
  }
};

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
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = item;
    button.addEventListener("click", () => onClick(item));
    container.appendChild(button);
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
  const favorites = getStoredList(STORAGE_KEYS.favorites);
  renderChipList(elements.favoritesList, favorites, "No favorites yet", (city) => {
    loadWeatherByCity(city, { addToHistory: false });
  });
  elements.clearFavoritesBtn.disabled = favorites.length === 0;

  const isFav = favorites.includes(state.weatherLabel);
  elements.favoriteBtn.classList.toggle("active", isFav);
  elements.favoriteBtn.textContent = isFav ? "Saved" : "Save";
  elements.favoriteBtn.setAttribute("aria-pressed", String(isFav));
};

const saveHistory = (cityLabel) => {
  const current = getStoredList(STORAGE_KEYS.history);
  const next = [cityLabel, ...current.filter((city) => city !== cityLabel)].slice(0, 8);
  setStoredList(STORAGE_KEYS.history, next);
  renderHistory();
};

const saveLastPlace = (place) => {
  localStorage.setItem(STORAGE_KEYS.lastPlace, JSON.stringify(place));
};

const updateCurrentWeather = (weather, forecastFirstEntry) => {
  const condition = weather.weather[0];

  elements.currentCity.textContent = `${weather.name}, ${weather.sys.country}`;
  elements.currentCondition.textContent = capitalize(condition.description);
  elements.currentTemp.textContent = Math.round(weather.main.temp);
  elements.currentFeels.textContent = Math.round(weather.main.feels_like);
  elements.currentHumidity.textContent = `${weather.main.humidity}%`;
  elements.currentHighLow.textContent = `${Math.round(weather.main.temp_max)} / ${Math.round(weather.main.temp_min)}${unitSymbol()}`;

  const windUnit = state.units === "metric" ? "m/s" : "mph";
  elements.currentWind.textContent = `${Math.round(weather.wind.speed)} ${windUnit}`;
  elements.currentRainChance.textContent = `${Math.round((forecastFirstEntry?.pop || 0) * 100)}%`;

  elements.currentIcon.src = `https://openweathermap.org/img/wn/${condition.icon}@2x.png`;
  elements.currentIcon.alt = condition.main;

  elements.currentTime.textContent = `Local time: ${formatInTimezone(
    weather.dt,
    weather.timezone,
    {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }
  )} (${formatOffset(weather.timezone)})`;

  elements.detailPressure.textContent = `${weather.main.pressure} hPa`;
  elements.detailClouds.textContent = `${weather.clouds.all}%`;
  elements.detailSunrise.textContent = formatInTimezone(weather.sys.sunrise, weather.timezone, {
    hour: "numeric",
    minute: "2-digit",
  });
  elements.detailSunset.textContent = formatInTimezone(weather.sys.sunset, weather.timezone, {
    hour: "numeric",
    minute: "2-digit",
  });
  elements.detailTimezone.textContent = formatOffset(weather.timezone);

  const visibilityValue = weather.visibility || 0;
  if (state.units === "metric") {
    elements.detailVisibility.textContent = `${(visibilityValue / 1000).toFixed(1)} km`;
  } else {
    elements.detailVisibility.textContent = `${(visibilityValue / 1609.34).toFixed(1)} mi`;
  }

  setWeatherGradient(condition.main);
};

const buildDailyForecast = (forecastList, timezoneOffset) => {
  const grouped = new Map();

  forecastList.forEach((entry) => {
    const datePart = getDateKeyInOffset(entry.dt, timezoneOffset);

    if (!grouped.has(datePart)) {
      grouped.set(datePart, {
        date: datePart,
        min: entry.main.temp_min,
        max: entry.main.temp_max,
        best: entry,
        pop: entry.pop || 0,
        timeDiff: Number.POSITIVE_INFINITY,
      });
    }

    const day = grouped.get(datePart);
    day.min = Math.min(day.min, entry.main.temp_min);
    day.max = Math.max(day.max, entry.main.temp_max);
    day.pop = Math.max(day.pop, entry.pop || 0);

    const diff = Math.abs(getHourInOffset(entry.dt, timezoneOffset) - 12);
    if (diff < day.timeDiff) {
      day.best = entry;
      day.timeDiff = diff;
    }
  });

  return [...grouped.values()].slice(0, 5);
};

const updateForecast = (forecast, timezoneOffset) => {
  const daily = buildDailyForecast(forecast.list, timezoneOffset);
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

    const condition = day.best.weather[0];

    card.innerHTML = `
      <p class="forecast-date">${label}</p>
      <img src="https://openweathermap.org/img/wn/${condition.icon}@2x.png" alt="${condition.main}" />
      <p class="forecast-temp">${Math.round(day.max)}&deg; / ${Math.round(day.min)}&deg;</p>
      <p class="forecast-meta">${capitalize(condition.description)}</p>
      <p class="forecast-meta">Rain: ${Math.round(day.pop * 100)}%</p>
    `;

    elements.forecastGrid.appendChild(card);
  });
};

const updateHourly = (forecast, timezoneOffset) => {
  const entries = forecast.list.slice(0, 8);
  elements.hourlyStrip.innerHTML = "";

  entries.forEach((entry) => {
    const hourCard = document.createElement("article");
    hourCard.className = "hour-card";

    hourCard.innerHTML = `
      <p class="hour-time">${new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date((entry.dt + timezoneOffset) * 1000))}</p>
      <img src="https://openweathermap.org/img/wn/${entry.weather[0].icon}.png" alt="${entry.weather[0].main}" />
      <p class="hour-temp">${Math.round(entry.main.temp)}${unitSymbol()}</p>
      <p class="hour-rain">Rain ${Math.round((entry.pop || 0) * 100)}%</p>
    `;

    elements.hourlyStrip.appendChild(hourCard);
  });
};

const updateAQI = (aqiResponse) => {
  const aqi = aqiResponse?.list?.[0]?.main?.aqi;
  if (!aqi || !AQI_MAP[aqi]) {
    elements.aqiValue.textContent = "--";
    elements.aqiLabel.textContent = "Unavailable";
    elements.aqiAdvice.textContent = "Air quality data is not available for this location.";
    return;
  }

  const mapped = AQI_MAP[aqi];
  elements.aqiValue.textContent = String(aqi);
  elements.aqiLabel.textContent = mapped.label;
  elements.aqiAdvice.textContent = mapped.advice;
};

const updateChart = (forecast, timezoneOffset) => {
  if (typeof Chart === "undefined") {
    return;
  }

  const entries = forecast.list.slice(0, 8);
  const labels = entries.map((entry) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date((entry.dt + timezoneOffset) * 1000))
  );

  const tempData = entries.map((entry) => entry.main.temp);
  const rainData = entries.map((entry) => Math.round((entry.pop || 0) * 100));

  const textColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--text-muted")
    .trim();
  const accentColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim() || "#7dd3fc";
  const secondaryColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--secondary")
    .trim() || "#f472b6";

  if (state.chart) {
    state.chart.destroy();
  }

  state.chart = new Chart(elements.tempChart, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `Temperature (${unitSymbol()})`,
          data: tempData,
          borderColor: accentColor,
          backgroundColor: "rgba(125, 211, 252, 0.2)",
          yAxisID: "y",
          tension: 0.35,
          fill: true,
          pointRadius: 3,
        },
        {
          label: "Rain Chance (%)",
          data: rainData,
          borderColor: secondaryColor,
          backgroundColor: "rgba(244, 114, 182, 0.15)",
          yAxisID: "y1",
          tension: 0.35,
          fill: false,
          pointRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      scales: {
        y: {
          beginAtZero: false,
          ticks: {
            color: textColor,
          },
          grid: {
            color: "rgba(148, 163, 184, 0.2)",
          },
        },
        y1: {
          beginAtZero: true,
          position: "right",
          max: 100,
          ticks: {
            color: textColor,
          },
          grid: {
            drawOnChartArea: false,
          },
        },
        x: {
          ticks: {
            color: textColor,
          },
          grid: {
            color: "rgba(148, 163, 184, 0.14)",
          },
        },
      },
      plugins: {
        legend: {
          labels: {
            color: textColor,
          },
        },
      },
    },
  });
};

const updateStatusForSuccess = (weather) => {
  setStatus(
    `Updated ${formatInTimezone(weather.dt, weather.timezone, {
      hour: "numeric",
      minute: "2-digit",
      weekday: "short",
    })} (${formatOffset(weather.timezone)})`
  );
};

const loadWeatherByCoords = async (lat, lon, options = {}) => {
  if (!API_KEY || API_KEY === "YOUR_OPENWEATHER_KEY") {
    setError("Add your OpenWeather API key in app.js to continue.");
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
      getAirQuality(lat, lon).catch(() => null),
    ]);

    state.current = { current, forecast, aqi };
    state.weatherLabel = cityLabel || `${current.name}, ${current.sys.country}`;
    state.currentCoords = { lat, lon };

    updateCurrentWeather(current, forecast.list[0]);
    updateForecast(forecast, current.timezone);
    updateHourly(forecast, current.timezone);
    updateAQI(aqi);
    updateChart(forecast, current.timezone);
    updateStatusForSuccess(current);

    if (addToHistory) {
      saveHistory(state.weatherLabel);
    }

    saveLastPlace({
      lat,
      lon,
      cityLabel: state.weatherLabel,
    });

    renderFavorites();
  } catch (error) {
    setError(error.message || "Something went wrong while loading weather.");
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

const toggleFavorite = () => {
  if (!state.weatherLabel) {
    return;
  }

  const favorites = getStoredList(STORAGE_KEYS.favorites);
  const exists = favorites.includes(state.weatherLabel);

  const next = exists
    ? favorites.filter((item) => item !== state.weatherLabel)
    : [state.weatherLabel, ...favorites].slice(0, 10);

  setStoredList(STORAGE_KEYS.favorites, next);
  renderFavorites();
};

const handleSearch = async (event) => {
  event.preventDefault();
  const city = elements.input.value.trim();

  if (!city) {
    setError("Please enter a city name.");
    return;
  }

  hideSuggestions();
  await runAction("search", async () => {
    await loadWeatherByCity(city, { addToHistory: true });
  });
};

const handleLocate = () => {
  if (!navigator.geolocation) {
    setError("Geolocation is not supported in this browser.");
    return;
  }

  setStatus("Getting your location...");
  clearError();

  runAction("locate", () =>
    new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          await loadWeatherByCoords(position.coords.latitude, position.coords.longitude, {
            addToHistory: true,
          });
          resolve();
        },
        () => {
          setError("Location access was denied. Search by city instead.");
          setStatus("");
          resolve();
        },
        {
          timeout: 10000,
        }
      );
    })
  );
};

const handleRefresh = async () => {
  if (!state.currentCoords) {
    setError("Search for a city first, then refresh.");
    return;
  }

  await runAction("refresh", async () => {
    await loadWeatherByCoords(state.currentCoords.lat, state.currentCoords.lon, {
      addToHistory: false,
      cityLabel: state.weatherLabel,
    });
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

const handleInputKeydown = async (event) => {
  const hasSuggestions = state.suggestions.length > 0 && elements.suggestionsList.classList.contains("open");
  if (!hasSuggestions) {
    if (event.key === "Escape") {
      hideSuggestions();
    }
    return;
  }

  const lastIndex = state.suggestions.length - 1;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    const nextIndex =
      state.activeSuggestionIndex >= lastIndex ? 0 : state.activeSuggestionIndex + 1;
    setActiveSuggestion(nextIndex);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    const nextIndex =
      state.activeSuggestionIndex <= 0 ? lastIndex : state.activeSuggestionIndex - 1;
    setActiveSuggestion(nextIndex);
    return;
  }

  if (event.key === "Enter" && state.activeSuggestionIndex >= 0) {
    event.preventDefault();
    await applySuggestion(state.activeSuggestionIndex);
    return;
  }

  if (event.key === "Escape") {
    hideSuggestions();
  }
};

const handleDocumentClick = (event) => {
  if (!elements.form.contains(event.target)) {
    hideSuggestions();
  }
};

const handleClearHistory = () => {
  setStoredList(STORAGE_KEYS.history, []);
  renderHistory();
  setStatus("Recent searches cleared.");
  scheduleSuggestions(elements.input.value.trim());
};

const handleClearFavorites = () => {
  setStoredList(STORAGE_KEYS.favorites, []);
  renderFavorites();
  setStatus("Favorites cleared.");
  scheduleSuggestions(elements.input.value.trim());
};

const toggleTheme = () => {
  const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  setTheme(current === "dark" ? "light" : "dark");
};

const toggleUnits = () => {
  state.units = state.units === "metric" ? "imperial" : "metric";
  localStorage.setItem(STORAGE_KEYS.units, state.units);
  setUnitButton();

  if (state.currentCoords) {
    loadWeatherByCoords(state.currentCoords.lat, state.currentCoords.lon, {
      addToHistory: false,
      cityLabel: state.weatherLabel,
    });
  }
};

const init = () => {
  setUnitButton();
  updateSearchButtonState();

  const initialTheme = localStorage.getItem(STORAGE_KEYS.theme) || "light";
  setTheme(initialTheme);

  renderHistory();
  renderFavorites();

  const lastPlaceRaw = localStorage.getItem(STORAGE_KEYS.lastPlace);
  if (lastPlaceRaw) {
    try {
      const lastPlace = JSON.parse(lastPlaceRaw);
      if (lastPlace?.lat && lastPlace?.lon) {
        loadWeatherByCoords(lastPlace.lat, lastPlace.lon, {
          addToHistory: false,
          cityLabel: lastPlace.cityLabel || null,
        });
        return;
      }
    } catch {
      // Ignore invalid storage payload.
    }
  }

  loadWeatherByCity("New York", { addToHistory: false });
};

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

