/* Service worker：讓網頁能裝成 App（PWA）。
   網頁本體和素材：先用網路，失敗才用快取（所以更新後馬上看得到新版，斷線時還能開）。
   /api/ 一律走網路，不快取任何資料。 */
const CACHE = 'asa-v1';
const SHELL = ['/', '/static/app.css', '/static/app.js', '/static/i18n.js', '/static/vendor/aurora.js',
  '/static/vendor/borderglow.js', '/static/vendor/borderglow.css', '/static/vendor/theme-toggle.css',
  '/static/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('/'))));
});
