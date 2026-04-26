const CACHE_NAME = "cockpit-v1";

const filesToCache = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(filesToCache))
  );
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request)
      .then(response => response || fetch(e.request))
  );
});