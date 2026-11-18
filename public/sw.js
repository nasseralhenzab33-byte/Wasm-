// وسم — Service Worker: صفحة احتياطية بدون إنترنت + تخزين الملفات الثابتة. لا يخزّن بيانات /api أبداً.
const CACHE = 'wasm-v1';
const SHELL = ['/', '/offline.html', '/css/app.css', '/js/icons.js', '/js/app.js', '/js/market.js', '/js/auctions.js', '/js/services.js', '/js/admin.js', '/img/logo.svg', '/img/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }
  // الشبكة أولاً ثم النسخة المخزنة
  e.respondWith(fetch(req).then(res => { if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); } return res; }).catch(() => caches.match(req)));
});
