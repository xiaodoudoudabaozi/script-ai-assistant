/**
 * Service Worker — 网络优先策略
 * v2.2 PWA 重写
 */

const CACHE_STATIC = "scriptkill-static-v1";
const CACHE_PAGES = "scriptkill-pages-v1";

// 安装时预缓存离线页
self.addEventListener("install", (event) => {
    event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      return cache.addAll(["/offline.html"]);
    })
  );
  self.skipWaiting();
});

// 激活时清理旧缓存
self.addEventListener("activate", (event) => {
  console.log("[SW] activate");
  event.waitUntil(
    caches.keys().then((keys) => {
      console.log("[SW] activate: existing caches:", keys);
      return Promise.all(
        keys
          .filter((k) => k !== CACHE_STATIC && k !== CACHE_PAGES)
          .map((k) => {
            console.log("[SW] activate: deleting old cache", k);
            return caches.delete(k);
          })
      );
    })
  );
  self.clients.claim();
  console.log("[SW] activate: claimed clients");
});

// 请求拦截
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理同源请求
  if (url.origin !== self.location.origin) return;

  const isStatic =
    url.pathname.startsWith("/_next/static") ||
    url.pathname.startsWith("/fonts/");

  // 静态资源: Cache-First（资源名带hash，永久有效）
  if (isStatic) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_STATIC).then((cache) => {
              cache.put(request, clone).catch((e) =>
                console.warn("[SW] cache put error:", e.message)
              );
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // 导航请求: Network-First，失败时回退离线页
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_PAGES).then((cache) => {
              cache.put(request, clone).catch(() => {});
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then(
            (cached) => cached || caches.match("/offline.html")
          );
        })
    );
    return;
  }

  // API等: 只走网络
  event.respondWith(fetch(request));
});

