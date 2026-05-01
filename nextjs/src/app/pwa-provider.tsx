"use client";

import { useEffect } from "react";

/**
 * PWA 注册 + 网络断连检测 + 30分钟无操作自动登出
 * 规格文档 4.5.1 / 4.4 节
 */
export function PwaProvider() {
  useEffect(() => {
    // ── 清理所有已注册的 SW（v1 稳定性优先，待 v2 重写） ──
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister());
      });
    }

    // ── SW 暂时禁用 ──
    if (false && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          // 检测到新版本 SW 时自动更新
          reg.addEventListener("updatefound", () => {
            const newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  // 新 SW 已安装，通知用户刷新
                  newWorker.postMessage({ type: "SKIP_WAITING" });
                  window.location.reload();
                }
              });
            }
          });
        })
        .catch(() => {
          // 静默失败，SW 是渐进增强
        });
    }

    // ── 网络断连检测（规格文档4.4节） ──
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

    // ── 30分钟无操作自动登出（规格文档4.5.5节） ──
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
        // 清除 cookie
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
