/* ============================================================================
 * Atmosphere Desk service worker
 * ----------------------------------------------------------------------------
 * Caching policy, and why:
 *   • Shell (HTML/CSS/JS/manifest/icons)   -> network first, cache as fallback.
 *     A cache-first shell is the classic "users stay on the old version after a
 *     deploy" bug; the network is authoritative and the cache only saves an
 *     offline reload.
 *   • Weather API GETs                     -> stale-while-revalidate in their own
 *     cache. The page shows the cached reading instantly and swaps in the fresh
 *     one, so a flaky connection or a spent quota still renders a dashboard.
 *   • Fonts and Chart.js                   -> cache-first (immutable, versioned).
 *   • Anything else cross-origin           -> passthrough, never cached.
 * ========================================================================== */

const CACHE_VERSION = "atmosphere-desk-v2";
const SHELL_CACHE = CACHE_VERSION;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const API_CACHE = `${CACHE_VERSION}-api`;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./favicon.svg",
  "./favicon.ico",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
  "./maskable-512.png",
];

const API_HOSTS = ["api.openweathermap.org", "api.weather.gov"];
const IMMUTABLE_HOSTS = ["fonts.gstatic.com", "cdn.jsdelivr.net", "fonts.googleapis.com"];
const API_CACHE_LIMIT = 48;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // A missing optional asset (an icon during a refactor) must not abort install.
      .then((cache) => Promise.all(SHELL_ASSETS.map((asset) => cache.add(asset).catch(() => undefined))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => ![SHELL_CACHE, RUNTIME_CACHE, API_CACHE].includes(key)).map((key) => caches.delete(key))
      );
      await self.clients.claim();
      const all = await self.clients.matchAll({ type: "window" });
      all.forEach((client) => client.postMessage?.({ type: "SW_READY", version: CACHE_VERSION }));
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") return; // chrome-extension:, data:, …

  if (url.origin === self.location.origin) {
    if (request.mode === "navigate") {
      event.respondWith(navigationHandler(request));
      return;
    }
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  if (API_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
    return;
  }

  if (IMMUTABLE_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // Everything else (analytics beacons, random links): straight to the network.
});

async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    if (response?.ok) await put("./index.html", response.clone(), SHELL_CACHE);
    return response;
  } catch (error) {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(request)) ?? (await cache.match("./index.html")) ?? offlineResponse();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const revalidate = fetch(request)
    .then(async (response) => {
      if (response && response.ok && response.status === 200) {
        await put(request, response.clone(), cacheName);
        if (cacheName === API_CACHE) await trim(cache, API_CACHE_LIMIT);
      }
      return response;
    })
    .catch(() => cached);

  return cached ?? (await revalidate) ?? offlineResponse();
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) await put(request, response.clone(), cacheName);
    return response;
  } catch (error) {
    return offlineResponse();
  }
}

async function put(request, response, cacheName) {
  if (!response || response.status !== 200 || response.type === "opaque") return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
}

/** Drop the oldest entries once a cache grows past `limit`. */
async function trim(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((request) => cache.delete(request)));
}

function offlineResponse() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font:16px/1.6 system-ui;padding:24vh 8vw;background:#0b1220;color:#e2e8f0">' +
      "<h1 style='font-size:1.4rem;margin:0 0 .5rem'>You are offline</h1>" +
      "<p style='margin:0;color:#94a3b8'>Atmosphere Desk could not reach the network, and this page is not in the cache yet. " +
      "Reload once you have a connection — the last reading stays available from the app.</p>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
