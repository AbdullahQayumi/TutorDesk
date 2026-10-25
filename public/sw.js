// Minimal service worker: lets browsers treat TutorDesk as an installable app.
// It deliberately caches nothing, so people always get the latest version and live data.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
