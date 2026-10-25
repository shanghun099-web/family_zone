/* Familygram 알림 일꾼 (service worker)
   서버(notify 함수)가 보낸 알림을 폰 알림으로 띄우고, 누르면 그 소식을 연다.
   화면 파일은 저장해 두지 않는다 (늘 새 버전을 받게). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Familygram', body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    if (d.badge && self.navigator.setAppBadge) { try { await self.navigator.setAppBadge(d.badge); } catch (err) {} }
    await self.registration.showNotification(d.title || 'Familygram', {
      body: d.body || '', icon: 'icon-192.png?v=2', badge: 'badge-96.png', image: d.image || undefined,
      tag: d.tag || undefined, renotify: !!d.tag, lang: 'ko', data: { url: d.url || './' }
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { await w.focus(); w.postMessage({ type: 'fz-open', url }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
