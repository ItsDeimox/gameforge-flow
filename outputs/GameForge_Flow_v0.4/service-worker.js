const CACHE_NAME = "gameforge-flow-v0.9.0";
const APP_SHELL = [
  "./", "./index.html", "./styles.css?v=0.9.0", "./app.js?v=0.9.0",
  "./manifest.webmanifest", "./src/domain.js", "./src/storage.js",
  "./src/markdown.js", "./src/collaboration.js"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("gameforge-flow-") && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request, { cache: "no-store" }).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  event.respondWith(fetch(event.request, { cache: "no-cache" }).then(response => {
    if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request, { ignoreSearch: true })));
});

self.addEventListener("message", event => {
  if (event.data?.type === "TEAM_API_READY" && event.ports?.[0]) event.ports[0].postMessage({ version: "0.9.0" });
});
