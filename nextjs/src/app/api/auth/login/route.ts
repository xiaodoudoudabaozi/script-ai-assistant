/**
 * /api/auth/login/route.ts - 登录接口
 * #11修复：Token存HTTPOnly Cookie（规格文档4.5.5节）
 * #16修复：完整操作日志
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";
import { sessions } from "@/lib/auth";
import crypto from "crypto";

const SESSION_EXPIRY_DAYS = 7;
const AUTO_LOGOUT_MINUTES = 30;

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { employeeId, password } = await req.json();

    if (!employeeId || !password) {
      return NextResponse.json({ error: "请输入工号和密码" }, { status: 400 });
    }

    const result = await pool.query(
      `SELECT id, name, role, phone, position, password_hash 
       FROM employees 
       WHERE name = $1 OR phone = $1`,
      [employeeId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "工号或密码错误" }, { status: 401 });
    }

    const user = result.rows[0];

    // bcrypt 密码验证（规格文档5.3节）
    if (!user.password_hash) {
      return NextResponse.json({ error: "账号未设置密码，请联系管理员" }, { status: 401 });
    }
    let validPassword = false;
    try {
      const bcrypt = await import("bcrypt");
      validPassword = await bcrypt.compare(password, user.password_hash);
    } catch (e) {
      console.error("[login] bcrypt error:", e);
    }

    if (!validPassword) {
      // #16修复：记录登录失败
      await pool.query(
        `INSERT INTO operation_logs (user_id, action, detail, created_at) VALUES (NULL, 'login_failed', $1, NOW())`,
        [`登录失败: ${employeeId}`]
      );
      return NextResponse.json({ error: "工号或密码错误" }, { status: 401 });
    }

    // 生成 session token
    const token = crypto.randomUUID();
    sessions.set(token, {
      userId: user.id,
      role: user.role,
      exp: Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
      lastActivity: Date.now(),
    });

    // #16修复：记录登录成功
    await pool.query(
      `INSERT INTO operation_logs (user_id, action, detail, created_at) VALUES ($1, 'login', '员工登录', NOW())`,
      [user.id]
    );

    // #11修复：设置HTTPOnly Cookie
    const response = NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        phone: user.phone,
        position: user.position,
      },
    });

    response.cookies.set("session_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (err) {
    console.error("[login] error:", err);
    return NextResponse.json({ error: "登录失败，请稍后重试" }, { status: 500 });
  }
}

// 验证 token（支持Cookie和Header两种方式）
export async function GET(req: NextRequest) {
  // 优先从Cookie读取，其次从Authorization header
  const token =
    req.cookies.get("session_token")?.value ||
    req.headers.get("Authorization")?.replace("Bearer ", "");

  if (!token || !sessions.has(token)) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const session = sessions.get(token);
  if (!session || session.exp < Date.now()) {
    sessions.delete(token);
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  // #12修复：30分钟无操作自动登出
  const inactiveMs = Date.now() - session.lastActivity;
  if (inactiveMs > AUTO_LOGOUT_MINUTES * 60 * 1000) {
    sessions.delete(token);
    return NextResponse.json({ authenticated: false, reason: "session_expired" }, { status: 401 });
  }

  // 更新最后活动时间
  session.lastActivity = Date.now();

  return NextResponse.json({
    authenticated: true,
    userId: session.userId,
    role: session.role,
  });
}

// 登出
export async function DELETE(req: NextRequest) {
  const token =
    req.cookies.get("session_token")?.value ||
    req.headers.get("Authorization")?.replace("Bearer ", "");

  if (token) {
    const session = sessions.get(token);
    if (session) {
      // 记录登出日志
      await pool.query(
        `INSERT INTO operation_logs (user_id, action, detail, created_at) VALUES ($1, 'logout', '员工登出', NOW())`,
        [session.userId]
      ).catch(() => {});
    }
    sessions.delete(token);
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set("session_token", "", { maxAge: 0, path: "/" });
  return response;
}