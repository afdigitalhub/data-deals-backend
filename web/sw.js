// Data Deals service worker. Caches ONLY the public app shell (hashed JS/CSS, icons).
// Never caches API responses, account data, payment pages or admin content.
const VERSION = '__VERSION__';
const SHELL = `dd-shell-${VERSION}`;
const ASSETS = __ASSETS__;
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll([...ASSETS, '/icons/icon-192.png', '/manifest.webmanifest'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return; // always network
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
    return;
  }
  if (e.request.mode === 'navigate') {
    // Network first so prices and pages are always fresh; offline fallback message if there is no connection.
    e.respondWith(fetch(e.request).catch(() => new Response('<!doctype html><meta name=viewport content="width=device-width"><body style="font-family:sans-serif;padding:32px;text-align:center"><h2>You are offline</h2><p>Check your internet connection and try again.</p><button onclick="location.reload()" style="padding:12px 20px;border-radius:10px;border:0;background:#FFD400;font-weight:700">Retry</button></body>', { headers: { 'Content-Type': 'text/html' } })));
  }
});
