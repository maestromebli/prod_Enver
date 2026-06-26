const CACHE = "enver-operator-v12";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isOperatorAppAsset(pathname) {
  return (
    pathname.endsWith(".html") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css") ||
    pathname.startsWith("/assets/") ||
    pathname === "/sw-operator.js"
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;

  // HTML/JS/CSS — завжди з мережі, щоб планшет бачив оновлення після деплою.
  if (isOperatorAppAsset(url.pathname)) {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(() =>
        url.pathname.includes("operator") ? caches.match("/operator.html") : Response.error()
      )
    );
    return;
  }

  event.respondWith(fetch(request));
});
