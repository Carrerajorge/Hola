/**
 * ILIAGPT Service Worker
 *
 * Keep the runtime worker push-only. Navigation/document caching caused stale
 * JSON error responses to get pinned as the app shell for some users.
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const LEGACY_CACHE_PREFIXES = [
  "iliagpt-",
  "precache-",
];

function isLegacyCacheName(name: string): boolean {
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
  if ((event.data as { type?: string } | undefined)?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("push", (event) => {
  let data: Record<string, unknown> = {};
  try {
    data = event.data ? (event.data.json() as Record<string, unknown>) : {};
  } catch {
    data = {};
  }

  const title = String(data.title || "ILIAGPT");
  const options: NotificationOptions = {
    body: String(data.body || ""),
    icon: String(data.icon || "/pwa-192x192.png"),
    badge: String(data.badge || "/pwa-192x192.png"),
    data: (data.data as Record<string, unknown> | undefined) || {},
    actions: Array.isArray(data.actions) ? (data.actions as NotificationAction[]) : [],
    requireInteraction: Boolean(data.requireInteraction),
    silent: Boolean(data.silent),
    vibrate: Array.isArray(data.vibrate) ? (data.vibrate as number[]) : undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = (event.notification.data || {}) as {
    url?: string;
    actionUrls?: Record<string, string>;
  };

  let urlToOpen = data.url || "/";
  if (event.action && data.actionUrls?.[event.action]) {
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

async function sendPendingMessages(): Promise<void> {
  console.log("[SW] Syncing pending messages...");
}
