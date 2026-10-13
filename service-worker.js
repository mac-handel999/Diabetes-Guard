const CACHE_NAME = 'diashield-v3';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/main.js',
  '/modules.js',
  '/pwa.js',
  '/curriculum.json',
  '/manifest.json',
  '/admin.html',
  '/admin.css',
  '/admin-theme.css',
  '/admin.js',
  '/documentation.html',
  '/documentation.css',
  '/admin-documentation.html',
  '/Images/diabetes-guard-logo-Photoroom.png',
  '/Images/dia-shield-logo.svg',
  '/Images/dia-shield-icon-192.png',
  '/Images/dia-shield-icon-512.png',
  '/Images/week1-day2.png',
  '/Images/week1-day4.png',
  '/Images/week4-day3.png',
  '/Images/week6-day3.png'
];

// Cache the app shell during installation; one unavailable optional asset must not block install.
// 1. Install Event - Cache Core Assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[Service Worker] Caching app shell');
      await Promise.all(ASSETS_TO_CACHE.map(async asset => {
        try {
          await cache.add(asset);
        } catch (error) {
          console.warn('[Service Worker] Could not cache', asset, error.message);
        }
      }));
    })
  );
  self.skipWaiting();
});

// 2. Activate Event - Cleanup Old Caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Fetch Event - Network-first pages, cache-first static assets, and no API caching.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  const requestUrl = new URL(e.request.url);
  if (requestUrl.pathname.startsWith('/api/')) return;

  // Curriculum content changes without a new app version, so always prefer
  // the network for it and keep the last good copy as offline fallback.
  if (requestUrl.pathname.endsWith('/curriculum.json')) {
    e.respondWith(
      fetch(e.request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  if (e.request.mode === 'navigate') {
    const fallbackUrl = ['/admin.html', '/documentation.html', '/admin-documentation.html'].includes(requestUrl.pathname)
      ? requestUrl.pathname
      : '/index.html';
    e.respondWith(
      fetch(e.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(fallbackUrl, copy));
          return response;
        })
        .catch(() => caches.match(fallbackUrl))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(response => {
        if (response.ok && requestUrl.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
