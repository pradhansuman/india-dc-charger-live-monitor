/* India EV Charger Map — service worker v2
 * Network-first for the app shell (so updates land immediately after deploy),
 * cache fallback for offline. Cross-origin (CDNs, tiles, APIs) passes through. */
var CACHE = "ev-map-v2";
var APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./data/stations.js",
  "./icon.svg",
  "./manifest.webmanifest"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);
  // Only handle same-origin GET requests; let CDNs/tiles pass through untouched.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  // Network-first: always try fresh, fall back to cache when offline.
  event.respondWith(
    fetch(event.request).then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
      }
      return response;
    }).catch(function () {
      return caches.match(event.request).then(function (cached) {
        if (cached) return cached;
        return caches.match("./index.html");
      });
    })
  );
});
