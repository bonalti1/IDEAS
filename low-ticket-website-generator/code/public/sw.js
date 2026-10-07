/* ALTO Pro service worker — push notifications only (no offline caching, so it
 * never serves a stale app). Shows a notification when a new lead arrives and
 * focuses/opens the app when the contractor taps it. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = data.title || "ALTO Pro";
  const options = {
    body: data.body || "Tienes un nuevo lead.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "lead",
    data: { url: data.url || "/" },
    vibrate: [200, 100, 200],
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) { if ("focus" in client) return client.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
