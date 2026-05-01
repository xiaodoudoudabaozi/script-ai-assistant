/**
 * auth.ts - 统一认证辅助函数
 *
 * v2: 全局 session store（与 middleware.ts 共享）
 *     所有 API 路由由 middleware 统一校验
 *     路由处理器可从 x-user-id / x-user-role header 获取用户
 */

import { NextRequest } from "next/server";

export interface AuthUser {
  id: string;
  name: string;
  role: "staff" | "admin";
  phone?: string;
  position?: string;
}

// 全局 session store（middleware.ts 和 login route 共享）
function getSessions(): Map<string, any> {
  if (!(globalThis as any).__sessions) {
    (globalThis as any).__sessions = new Map();
  }
  return (globalThis as any).__sessions;
}

export const sessions = getSessions();

/**
 * 从 middleware 注入的 headers 提取用户信息
 * middleware 已验证 session，此处直接读取
 */
export function getUser(req: NextRequest): AuthUser | null {
  const userId = req.headers.get("x-user-id");
  const userRole = req.headers.get("x-user-role");

  if (userId && userRole) {
    return {
      id: userId,
      name: "",
      role: userRole as "staff" | "admin",
    };
  }

  // 回退：兼容旧的 x-user-data header（逐步废弃）
  const header = req.headers.get("x-user-data");
  if (header) {
    try {
      const user = JSON.parse(header);
      if (user?.id && user?.role) return user as AuthUser;
    } catch {}
  }

  return null;
}

/**
 * 要求已认证
 */
export function requireAuth(req: NextRequest): AuthUser | null {
  return getUser(req);
}

/**
 * 要求管理员
 */
export function requireAdmin(req: NextRequest): AuthUser | null {
  const user = getUser(req);
  if (!user || user.role !== "admin") return null;
  return user;
}

/**
 * 管理员或组长
 */
export function isAdminOrLeader(role: string): boolean {
  return role === "admin" || role === "leader";
}
