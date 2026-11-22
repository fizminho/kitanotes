const CACHE_PREFIX = "kitanotes-shell-";
const CACHE_NAME = CACHE_PREFIX + "v3";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icons/kitanotes.svg", "/icons/kitanotes-maskable.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/icons/mark.svg", "/icons/mark-96.png", "/icons/favicon-48.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put("/", response.clone()));
      return response;
    }).catch(async () => (await caches.match(request)) || (await caches.match("/")) || Response.error()));
    return;
  }
  if (url.pathname.startsWith("/assets/") || APP_SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok && response.type === "basic") caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      return response;
    })));
  }
});

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || "" }; }
  const title = typeof data.title === "string" ? data.title.slice(0, 80) : "KitaNotes";
  const body = typeof data.body === "string" ? data.body.slice(0, 160) : "You have a new notification.";
  const target = typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/";
  event.waitUntil(self.registration.showNotification(title, { body, icon: "/icons/icon-192.png", badge: "/icons/favicon-48.png", tag: typeof data.tag === "string" ? data.tag.slice(0, 64) : "kitanotes", data: { url: target }, renotify: false }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data && typeof event.notification.data.url === "string" ? event.notification.data.url : "/";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if (new URL(client.url).origin === self.location.origin) {
        client.navigate(target);
        return client.focus();
      }
    }
    return clients.openWindow(target);
  }));
});