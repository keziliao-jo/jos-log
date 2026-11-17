// jo's log service worker: keeps the app shell available offline.
// Same-origin GETs are answered stale-while-revalidate. Anything cross-origin (the Apps Script API,
// Google Fonts) is never touched: it goes straight to the network and is never cached.
// All paths are relative so the app works under a GitHub Pages project path.
// bump CACHE when any module's exports or the queue/cache storage format change
const CACHE = 'jos-log-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './js/api.js',
  './js/app.js',
  './js/config.js',
  './js/dom.js',
  './js/icon.js',
  './js/keys.js',
  './js/model.js',
  './js/queue.js',
  './js/store.js',
  './js/sweep.js',
  './js/ui-all.js',
  './js/ui-edit.js',
  './js/ui-log.js',
  './js/ui-settings.js',
  './js/ui-week.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))) // skip the HTTP cache
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('jos-log-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // cross-origin: leave to the browser

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
      // no-cache: revalidate with the server instead of taking a possibly stale HTTP-cache copy.
      // A navigate request is not safely re-created with options (older engines throw), so it is
      // fetched by URL with its manual redirect mode, so a redirect still reaches the browser as one.
      const network = (
        request.mode === 'navigate'
          ? fetch(request.url, { cache: 'no-cache', redirect: 'manual' })
          : fetch(request, { cache: 'no-cache' })
      )
        .then((res) => {
          if (!res || !res.ok || res.type !== 'basic') return res;
          const copy = res.clone();
          return cache.put(request, copy).then(
            () => res,
            () => res,
          );
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network); // refresh in the background
        return cached;
      }
      const res = await network;
      if (res) return res;
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return Response.error();
    }),
  );
});
