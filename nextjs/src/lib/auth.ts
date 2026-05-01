/**
 * auth.ts - 统一认证辅助函数
 *
 * v1: 从 x-user-data header 提取用户信息（前端 localStorage 传入）
 *     同时支持 session cookie 校验（HTTPOnly cookie）
 * v2: 迁移为纯 cookie-based session + Redis
 */

import { NextRequest } from "next/server";

export interface AuthUser {
  id: string;
  name: string;
  role: "staff" | "admin";
  phone?: string;
  position?: string;
}

const sessions = new Map<string, { userId: string; role: string; exp: number; lastActivity: number }>();

/** 暴露 session store 供 login route 使用 */
export { sessions };

/**
 * 从请求中提取已认证用户
 * 优先级：x-user-data header > session cookie
 */
export function getUser(req: NextRequest): AuthUser | null {
  // 方式1: x-user-data header（v1 主要方式）
  const header = req.headers.get("x-user-data");
  if (header) {
    try {
      const user = JSON.parse(header);
      if (user?.id && user?.role) return user as AuthUser;
    } catch { /* ignore */ }
  }

  // 方式2: HTTPOnly session cookie（v2 主要方式）
  const token =
    req.cookies.get("session_token")?.value ||
    req.headers.get("Authorization")?.replace("Bearer ", "");

  if (token && sessions.has(token)) {
    const session = sessions.get(token)!;
    if (session.exp > Date.now()) {
      session.lastActivity = Date.now();
      return {
        id: session.userId,
        name: "", // cookie session 不含 name（v2 改进点）
        role: session.role as "staff" | "admin",
      };
    }
    sessions.delete(token);
  }

  return null;
}

/**
 * 要求已认证 — 未认证返回 null（调用方返回 401）
 */
export function requireAuth(req: NextRequest): AuthUser | null {
  return getUser(req);
}

/**
 * 要求管理员 — 非管理员返回 null（调用方返回 403）
 */
export function requireAdmin(req: NextRequest): AuthUser | null {
  const user = getUser(req);
  if (!user || user.role !== "admin") return null;
  return user;
}
