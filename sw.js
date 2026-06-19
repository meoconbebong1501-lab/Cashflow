// ============================================================
// SỔ CHI — Service Worker
// Chỉ cache các file tĩnh của chính app (HTML/CSS/JS/icon) để
// cài đặt được như app thật và mở nhanh hơn ở lần sau. KHÔNG
// can thiệp vào request gọi Supabase hoặc CDN font/thư viện —
// những request đó luôn đi thẳng ra mạng để dữ liệu luôn mới.
// ============================================================

const CACHE_NAME = 'so-chi-v3';
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // HTML (index.html, ./): network-first để luôn lấy bản mới nhất khi deploy.
  // CSS/JS/icon: cache-first (nhanh hơn, và version CACHE_NAME đã đổi sẽ tự invalidate).
  const isHTML = url.pathname.endsWith('.html') || url.pathname.endsWith('/') || url.pathname === '/Cashflow/';

  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => cached);
    })
  );
});

// ---------------- Web Push: hiện thông báo cảnh báo chi vượt thu ----------------
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Sổ Chi', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Sổ Chi';
  const options = {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: data.url || './' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
