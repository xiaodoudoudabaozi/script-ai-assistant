"use client";

import { useEffect } from "react";

/**
 * PWA 注册 + 网络断连检测 + 30分钟无操作自动登出
 * v2.2: 启用 Service Worker（网络优先策略）
 */
export function PwaProvider() {
  useEffect(() => {
    // ── 注册 Service Worker ──
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          console.log("[PWA] SW 已注册:", reg.scope);

          // 检测到新版本时自动更新
          reg.addEventListener("updatefound", () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener("statechange", () => {
              if (
                newWorker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                console.log("[PWA] 新版本已就绪，即将刷新...");
                newWorker.postMessage({ type: "SKIP_WAITING" });
                window.location.reload();
              }
            });
          });
        })
        .catch((err) => {
          console.warn("[PWA] SW 注册失败（非致命）:", err.message);
        });
    }

    // ── 网络断连检测 ──
    let offlineToast: HTMLDivElement | null = null;

    function showOffline() {
      if (offlineToast) return;
      offlineToast = document.createElement("div");
      offlineToast.className =
        "fixed top-0 left-0 right-0 bg-red-600 text-white text-center text-sm py-2 z-50";
      offlineToast.textContent = "网络连接已断开，请检查网络后重试";
      document.body.appendChild(offlineToast);
    }

    function hideOffline() {
      if (offlineToast) {
        offlineToast.remove();
        offlineToast = null;
      }
    }

    window.addEventListener("offline", showOffline);
    window.addEventListener("online", hideOffline);

    if (!navigator.onLine) showOffline();

    // ── 30分钟无操作自动登出 ──
    let lastActivity = Date.now();
    const updateActivity = () => {
      lastActivity = Date.now();
    };
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, updateActivity));

    const interval = setInterval(() => {
      if (Date.now() - lastActivity > 30 * 60 * 1000) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        document.cookie =
          "session_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        window.location.reload();
      }
    }, 60_000);

    return () => {
      window.removeEventListener("offline", showOffline);
      window.removeEventListener("online", hideOffline);
      events.forEach((e) => window.removeEventListener(e, updateActivity));
      clearInterval(interval);
    };
  }, []);

  return null;
}
