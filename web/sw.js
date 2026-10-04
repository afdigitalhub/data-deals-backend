// Data Glow service worker. Caches ONLY the public app shell (hashed JS/CSS, icons).
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

// ---------- Phone notifications ----------
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Data Glow', body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'Data Glow';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: d.icon || '/icons/icon-192.png',
    badge: d.badge || '/icons/badge-72.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || '/' },
    actions: d.tag === 'daily' || d.tag === 'reminder' ? [{ action: 'open', title: 'Buy now' }, { action: 'settings', title: 'Notification settings' }] : [],
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.action === 'settings' ? '/notifications' : (e.notification.data && e.notification.data.url) || '/';
  const url = new URL(target, self.location.origin);
  if (url.origin !== self.location.origin) return; // only ever open our own site
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.startsWith(self.location.origin) && 'focus' in c) { c.navigate(url.href); return c.focus(); } }
    return self.clients.openWindow(url.href);
  }));
});
