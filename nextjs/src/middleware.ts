/**
 * middleware.ts — 全局 API 认证中间件
 *
 * 所有 /api/* 请求必须携带有效 session（白名单除外）
 * session 过期自动清理，30分钟无操作自动登出
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 无需认证的 API 路由（登录相关由自身 handler 处理）
const PUBLIC_PATHS = [
  "/api/auth/login",
];

// 内存 session store（与 auth.ts 共享的引用在运行时独立，此处独立维护）
const SESSIONS_KEY = "global_sessions";
declare global { var __sessions: Map<string, any> | undefined; }

function getSessions(): Map<string, any> {
  if (!globalThis.__sessions) {
    globalThis.__sessions = new Map();
  }
  return globalThis.__sessions;
}

const SESSION_EXPIRY_DAYS = 7;
const AUTO_LOGOUT_MINUTES = 30;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 只处理 API 路由
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // 白名单绕过
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // 读取 session token
  const token =
    request.cookies.get("session_token")?.value ||
    request.headers.get("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return new NextResponse(
      JSON.stringify({ error: "未登录" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const sessions = getSessions();
  const session = sessions.get(token);

  if (!session) {
    return new NextResponse(
      JSON.stringify({ error: "会话已过期，请重新登录" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // 检查过期
  if (session.exp < Date.now()) {
    sessions.delete(token);
    return new NextResponse(
      JSON.stringify({ error: "会话已过期，请重新登录" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // 30分钟无操作自动登出
  const inactiveMs = Date.now() - (session.lastActivity || session.exp);
  if (inactiveMs > AUTO_LOGOUT_MINUTES * 60 * 1000) {
    sessions.delete(token);
    const response = new NextResponse(
      JSON.stringify({ error: "长时间未操作，请重新登录" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
    response.cookies.set("session_token", "", { maxAge: 0, path: "/" });
    return response;
  }

  // 更新活跃时间
  session.lastActivity = Date.now();

  // 注入用户信息到 header（供路由处理器使用）
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-user-id", String(session.userId));
  requestHeaders.set("x-user-role", session.role);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ["/api/:path*"],
};
