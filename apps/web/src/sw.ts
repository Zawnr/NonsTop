/// <reference lib="webworker" />
// Service worker: caches the app shell for offline use and shows push notifications.
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Offline navigation: any page URL loads the cached app shell. API calls are never cached here.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

interface PushData {
  title?: string;
  body?: string;
  url?: string;
}

self.addEventListener('push', (event) => {
  let data: PushData;
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'NonsTop', {
      body: data.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/';
  event.waitUntil(
    (async () => {
      // navigate() only works on windows this worker controls, so pick one of those.
      const windows = await self.clients.matchAll({ type: 'window' });
      const open = windows[0];
      if (open) {
        try {
          await open.focus();
          await open.navigate(url);
          return;
        } catch {
          // fall through to a new window
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
