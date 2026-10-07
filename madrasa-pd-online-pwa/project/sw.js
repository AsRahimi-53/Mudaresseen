/* Madrasa PWA shell cache. Supabase and API traffic deliberately bypasses this worker. */
const CACHE_NAME = 'madrasa-pd-shell-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './js/runtime-config.js',
  './js/app.bundle.js',
  './css/style.css',
  './css/theme-dark.css',
  './css/dashboard.css',
  './css/forms.css',
  './css/tables.css',
  './css/rtl.css',
  './css/print.css',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isCacheableSameOrigin(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return false;
  return true;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (!isCacheableSameOrigin(request)) return;
  const url = new URL(request.url);
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  event.respondWith(
    caches.match(request).then(cached => {
      const refresh = fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});
