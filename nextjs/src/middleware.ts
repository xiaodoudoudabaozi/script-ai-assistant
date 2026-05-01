/**
 * middleware.ts — 全局 API JWT 认证中间件
 *
 * 所有 /api/* 请求必须携带有效 JWT（白名单除外）
 * 使用 JWT 避免 Edge/Node.js 运行时不共享内存的问题
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || process.env.DEEPSEEK_API_KEY || "script-kill-local-dev"
);

// 无需认证的 API 路由
const PUBLIC_PATHS = ["/api/auth/login"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 只处理 API 路由
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // 白名单绕过
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // 读取 JWT token
  const token =
    request.cookies.get("session_token")?.value ||
    request.headers.get("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return new NextResponse(
      JSON.stringify({ error: "未登录" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);

    // 注入用户信息到 header
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-id", payload.userId as string);
    requestHeaders.set("x-user-role", payload.role as string);

    return NextResponse.next({
      request: { headers: requestHeaders },
    });
  } catch {
    // JWT 过期或无效
    const response = new NextResponse(
      JSON.stringify({ error: "会话已过期，请重新登录" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
    response.cookies.set("session_token", "", { maxAge: 0, path: "/" });
    return response;
  }
}

export const config = {
  matcher: ["/api/:path*"],
};
