// Service worker: keeps the app working with no internet.
// Online: always gets the newest files (so updates show up right away) and saves a copy.
// Offline, or if the network is very slow: uses the saved copy.
const CACHE = 'kaizen-v2';
const FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './store.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = async () =>
      (await cache.match(req, { ignoreSearch: true })) ||
      (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    try {
      const res = await withTimeout(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }), 3000);
      if (res && res.ok) {
        event.waitUntil(cache.put(req, res.clone()));
        return res;
      }
      return (await saved()) || res;
    } catch {
      return (await saved()) || new Response('Offline', { status: 503 });
    }
  })());
});
