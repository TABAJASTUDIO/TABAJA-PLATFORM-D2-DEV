const CACHE_VERSION = 'tabaja-dev-v12.9.3.36.16-premium-import';
const APP_SHELL = [
  './',
  './index.html',
  './style.css?v=12.9.3.14',
  './app.js?v=12.9.3.36.4-refresh-session',
  './cloud.js?v=12.9.3.16-fix5.7-rpc',
  './v8-ui.js?v=12.9.3.36.7-initial-focus-fix',
  './employee-manager.js?v=12.9.3.2',
  './activity-store.js?v=12.9.3.2',
  './command-center.js?v=12.9.3.5',
  './pwa.js?v=12.9.3.16',
  './nfc-studio.js?v=12.9.3-local-pwa-fix2',
  './workforce.html',
  './workforce/workforce.css?v=2.2.0-premium-dashboard',
  './workforce/workforce.js?v=12.9.3.36.13-premium-ui',
  './workforce/workforce-launcher.js?v=2.3.0-initial-focus-fix',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallback) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    return (await caches.match(request)) || (fallback ? await caches.match(fallback) : Response.error());
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  // Never cache or intercept Supabase/CDN/API requests.
  if (!sameOrigin) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }
  if (sameOrigin && /\.(?:html|css|js)$/.test(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response && (response.status === 200 || response.type === 'opaque')) {
      const responseForCache = response.clone();
      caches.open(CACHE_VERSION).then(cache => cache.put(request, responseForCache));
    }
    return response;
  })));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
