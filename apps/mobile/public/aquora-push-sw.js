'use strict';

// Push only: this worker deliberately has no fetch listener or page/data cache.
const DB_NAME = 'aquora-web-push';
const STORE = 'state';
function currentBinding() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(STORE, 'readonly');
      const item = tx.objectStore(STORE).get('current');
      item.onsuccess = () => resolve(item.result || null);
      item.onerror = () => reject(item.error);
      tx.oncomplete = tx.onabort = () => db.close();
    };
  });
}
async function closeBinding(binding) {
  for (const notification of await self.registration.getNotifications()) {
    if (notification.data?.binding === binding) notification.close();
  }
}
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let shownBinding = null;
    try {
      const payload = event.data?.json();
      if (!payload || typeof payload.binding !== 'string' || typeof payload.title !== 'string' ||
          typeof payload.body !== 'string' || typeof payload.tag !== 'string') return;
      const state = await currentBinding();
      if (!state?.active || state.binding !== payload.binding) return;
      shownBinding = payload.binding;
      await self.registration.showNotification(payload.title, {
        body: payload.body, tag: payload.tag, requireInteraction: payload.critical === true,
        silent: false, data: { binding: payload.binding },
      });
      // Logout may have committed while the browser was accepting the notification.
      const after = await currentBinding();
      if (!after?.active || after.binding !== payload.binding) await closeBinding(payload.binding);
    } catch {
      // If ownership cannot be revalidated after acceptance, remove the potentially stale banner.
      if (shownBinding) await closeBinding(shownBinding).catch(() => undefined);
    }
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    try {
      const state = await currentBinding();
      if (!state?.active || state.binding !== event.notification.data?.binding) return;
      // Fixed authenticated route. Push data never supplies a navigation URL.
      const url = new URL('/alertas', self.location.origin).href;
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = windows.find(candidate => candidate.url === url);
      if (client) await client.focus(); else await self.clients.openWindow(url);
    } catch { /* No valid binding means no navigation. */ }
  })());
});
