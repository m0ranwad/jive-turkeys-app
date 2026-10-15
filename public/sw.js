// Service worker: lets phones install Jive Turkeys as an app from the Home
// Screen, and shows notifications and the unread number on the app icon. It
// deliberately caches nothing, so every visit gets the latest site.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// The number on the app icon (on an iPhone, the Home Screen app). 0 clears it.
// Phones that can't show one skip it.
function setIconBadge(count) {
  const nav = self.navigator;
  if (typeof count !== 'number' || !nav || !('setAppBadge' in nav)) return Promise.resolve();
  return (count > 0 ? nav.setAppBadge(count) : nav.clearAppBadge()).catch(() => {});
}

// A notification from notify-chat: { title, body, url, tag }. Chat messages
// also carry badge: the player's unread chat count, for the app icon.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || 'Jive Turkeys', {
        body: data.body || 'New message',
        icon: '/icon-192.png',
        badge: '/badge-96.png',
        tag: data.tag,
        renotify: !!data.tag,
        data: { url: data.url || '/banter' },
      }),
      setIconBadge(data.badge),
    ]),
  );
});

// Tapping a notification opens that chat room, reusing an open window if there is one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/banter', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (!open) return self.clients.openWindow(url);
      // Bringing the window forward can be refused; open the room regardless.
      await open.focus().catch(() => {});
      try {
        await open.navigate(url);
      } catch {
        // Pages this worker doesn't control yet are asked to go there themselves.
        open.postMessage({ type: 'jt:open', url });
      }
    })(),
  );
});
