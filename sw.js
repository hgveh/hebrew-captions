// Service worker: עבודה אופליין + קבלת סרטונים ששותפו מהגלריה
const CACHE = 'kt-v4';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/renderer.js', 'js/transcribe.js', 'js/exporter.js', 'js/storage.js', 'js/fontmeta.js', 'js/vendor/mediabunny.min.mjs', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== 'kt-share' && k !== 'kt-fonts').map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      const fd = await e.request.formData();
      const f = fd.get('video');
      if (f) {
        const c = await caches.open('kt-share');
        await c.put('shared-video', new Response(f, { headers: { 'content-type': f.type || 'video/mp4', 'x-name': encodeURIComponent(f.name || 'video.mp4') } }));
      }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET') return;
  // גופני גוגל – שמירה לאופליין
  if (url.host.includes('fonts.g')) {
    e.respondWith(caches.open('kt-fonts').then(async c => { const hit = await c.match(e.request); if (hit) return hit; const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r; }));
    return;
  }
  if (url.origin !== location.origin) return;
  // רשת קודם (כדי לקבל עדכונים), מטמון כגיבוי
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; }).catch(() => caches.match(e.request)));
});
