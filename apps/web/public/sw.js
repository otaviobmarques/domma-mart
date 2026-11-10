// PWA do painel (seção 4.2): cache só de estáticos; dados sempre da rede.
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/v1/')) return;
  if (u.pathname.startsWith('/_next/static/')) {
    e.respondWith(caches.open('static-v1').then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { c.put(e.request, r.clone()); return r; })));
  }
});
