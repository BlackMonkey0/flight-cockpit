const CACHE_NAME = "flight-cockpit-v3";
const USER_DATA_CACHE = "flight-cockpit-user-data";
let networkMode = "online";

const STATIC_FILES = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

const OPTIONAL_OFFLINE_FILES = [
  "https://cdn.jsdelivr.net/npm/chart.js",
  "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
];

async function cacheFiles(cacheName, files) {
  const cache = await caches.open(cacheName);
  await Promise.allSettled(
    files.map(async file => {
      const response = await fetch(file, { cache: "reload" });
      if (response && (response.ok || response.type === "opaque")) {
        await cache.put(file, response);
      }
    })
  );
}

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(cacheFiles(CACHE_NAME, STATIC_FILES));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (![CACHE_NAME, USER_DATA_CACHE].includes(key)) {
            return caches.delete(key);
          }
          return undefined;
        })
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("message", event => {
  if (event.data?.type === "CACHE_OFFLINE_ASSETS") {
    event.waitUntil(cacheFiles(CACHE_NAME, [...STATIC_FILES, ...OPTIONAL_OFFLINE_FILES]));
  }

  if (event.data?.type === "SET_NETWORK_MODE") {
    networkMode = event.data.mode === "offline" ? "offline" : "online";
  }
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    (networkMode === "offline" ? cacheFirst(event.request) : networkFirst(event.request))
  );
});

function cacheResponse(request, response) {
  if (!response || (!response.ok && response.type !== "opaque")) {
    return Promise.resolve(response);
  }

  return caches.open(CACHE_NAME).then(cache => {
    cache.put(request, response.clone());
    return response;
  });
}

function fallbackResponse(request) {
  if (request.mode === "navigate") {
    return caches.match("/index.html");
  }

  return caches.match(request).then(match => match || Response.error());
}

function cacheFirst(request) {
  return caches.match(request).then(cached => {
    if (cached) return cached;

    return fetch(request)
      .then(response => cacheResponse(request, response))
      .catch(() => fallbackResponse(request));
  });
}

function networkFirst(request) {
  return fetch(request)
    .then(response => cacheResponse(request, response))
    .catch(() =>
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fallbackResponse(request);
      })
    );
}
