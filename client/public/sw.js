/**
 * IliaGPT Service Worker
 *
 * This worker is intentionally "push-only".
 * We do not intercept fetch/navigation requests because stale document caches
 * can pin the app to JSON error payloads or maintenance pages after recovery.
 */

const LEGACY_CACHE_PREFIXES = [
  "iliagpt-",
  "precache-",
];

function isLegacyCacheName(name) {
  return LEGACY_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => isLegacyCacheName(name))
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

// Push notifications
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "ILIAGPT";
  const options = {
    body: data.body || "",
    icon: data.icon || "/pwa-192x192.png",
    badge: data.badge || "/pwa-192x192.png",
    data: data.data || {},
    actions: Array.isArray(data.actions) ? data.actions : [],
    requireInteraction: !!data.requireInteraction,
    silent: !!data.silent,
    vibrate: Array.isArray(data.vibrate) ? data.vibrate : undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};

  let urlToOpen = data.url || "/";
  if (event.action && data.actionUrls && data.actionUrls[event.action]) {
    urlToOpen = data.actionUrls[event.action];
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === urlToOpen && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(urlToOpen);
    }),
  );
});

self.addEventListener("sync", (event) => {
  if (event.tag === "send-message") {
    event.waitUntil(sendPendingMessages());
  }
});

async function sendPendingMessages() {
  console.log("[SW] Syncing pending messages...");
}
