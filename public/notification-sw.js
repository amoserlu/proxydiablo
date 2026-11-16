// Shows Proxy Diablo's request notifications. A click is handled here because browsers only let a
// service worker reliably bring a page to the front from a notification (a page's own onclick is
// often lost, for example on Windows once the toast has moved to the notification centre).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const tabId = event.notification.data?.tabId;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find((item) => new URL(item.url).origin === self.location.origin);
    if (!client) {
      await self.clients.openWindow('/');
      return;
    }
    await client.focus();
    if (typeof tabId === 'string') client.postMessage({ type: 'proxydiablo:open-tab', tabId });
  })());
});
