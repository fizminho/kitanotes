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
  const v2 = data && data.v === 2;
  const titleLimit = v2 ? 60 : 80;
  const bodyLimit = v2 ? 120 : 160;
  const title = typeof data.title === "string" && data.title.trim() ? data.title.slice(0, titleLimit) : "KitaNotes";
  const body = typeof data.body === "string" ? data.body.slice(0, bodyLimit) : "You have a new notification.";
  let target = "/";
  if (typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//")) {
    try { const parsed = new URL(data.url, self.location.origin); if (parsed.origin === self.location.origin) target = parsed.pathname + parsed.search + parsed.hash; } catch {}
  }
  const tag = v2 && typeof data.tag === "string" && /^[a-z0-9:_-]{1,64}$/.test(data.tag)
    ? data.tag
    : (typeof data.tag === "string" ? data.tag.slice(0, 64) : "kitanotes");
  const notificationData = v2 && data.data && typeof data.data === "object"
    ? { ...data.data, url: target }
    : { url: target };
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: "/icons/icon-192.png", badge: "/icons/favicon-48.png",
    tag, data: notificationData, renotify: v2 ? data.renotify === true : false
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  let target = "/";
  const rawTarget = event.notification.data && typeof event.notification.data.url === "string"
    ? event.notification.data.url : "/";
  try {
    const parsed = new URL(rawTarget, self.location.origin);
    if (parsed.origin === self.location.origin) target = parsed.pathname + parsed.search + parsed.hash;
  } catch {}
  const notificationData = event.notification.data || {};
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(async list => {
    for (const client of list) {
      try {
        if (new URL(client.url).origin !== self.location.origin) continue;
        client.postMessage({ type: "KITANOTES_NOTIFICATION_CLICK", url: target, data: notificationData });
        await client.navigate(new URL(target, self.location.origin).href);
        return client.focus();
      } catch { /* Try the next same-origin client, then open a new window. */ }
    }
    return clients.openWindow(new URL(target, self.location.origin).href);
  }));
});