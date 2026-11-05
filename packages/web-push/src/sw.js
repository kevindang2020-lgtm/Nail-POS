// sw.js — the ONE browser push service worker for the desktop apps (pos-web, owner-web, admin-web), served at
// /aps-push-sw.js by tooling/vite/web-push-sw.mjs (dev + build) with scope /aps-push/ — it never controls the page.
//
// Plain Web Push, no Firebase SDK here (the developer's copies importScripts'd it from gstatic — blocked by the apps'
// `script-src 'self'` policy, and three copies of one hard-coded config). A push the server sends through FCM v1
// ({ notification: { title, body }, data }) arrives as a standard push event with that JSON:
//   • page in the foreground → posted to it as { type: 'aps-push', title, body, data } — the app shows an in-app toast;
//   • otherwise → an OS notification; a tap focuses (or opens) the app and hands it the push data to route.
// Nothing here reads the payload beyond title / body / data, and nothing is cached or intercepted.
/* eslint-env serviceworker */
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

function parse(event) {
  try {
    const j = event.data ? event.data.json() : null;
    if (!j) return null;
    const n = j.notification || {}; const d = j.data || {};
    const title = String(n.title || d.title || 'AI PowerSalon'); const body = String(n.body || d.body || '');
    const data = {}; for (const k of Object.keys(d)) data[k] = String(d[k]);
    return { title, body, data };
  } catch { return null; }
}

self.addEventListener('push', (event) => {
  const m = parse(event);
  if (!m) return;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const focused = wins.find((w) => w.focused || w.visibilityState === 'visible');
    if (focused) { focused.postMessage({ type: 'aps-push', title: m.title, body: m.body, data: m.data }); return; }
    await self.registration.showNotification(m.title, { body: m.body, data: m.data, icon: '/brand/app-icon-192.png', badge: '/brand/app-icon-192.png', tag: m.data.reference || undefined });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification && event.notification.data) || {};
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins[0];
    if (w) { try { await w.focus(); } catch { /* not focusable */ } w.postMessage({ type: 'aps-push-tap', data }); return; }
    await self.clients.openWindow('/');
  })());
});
