// Minimal service worker — its ONLY job is to satisfy Chrome's installability
// requirement (Android will not offer "Install app" without a registered service
// worker that has a fetch handler; without it you only get "Add shortcut").
//
// Deliberately NO caching: these pages are authenticated, live admin data. Caching
// them risks serving another business's stale invoice data or a logged-out shell.
// The fetch handler passes everything straight through to the network.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  // Pass-through. Present so the app is installable; never caches admin responses.
  event.respondWith(fetch(event.request));
});
