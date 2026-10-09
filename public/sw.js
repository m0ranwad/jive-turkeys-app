// Service worker: lets phones install Jive Turkeys as an app from the Home
// Screen. It deliberately caches nothing, so every visit gets the latest site.
// (Chat notifications will be handled here too, once they're switched on.)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
