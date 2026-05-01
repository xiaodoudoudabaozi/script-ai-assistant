/**
 * /api/auth/login/route.ts - 登录接口（JWT 版本）
 * 签发 JWT token，HTTPOnly Cookie + 响应体双通道
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";
import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || process.env.DEEPSEEK_API_KEY || "script-kill-local-dev"
);
const SESSION_EXPIRY_DAYS = 7;

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
      await pool.query(
        `INSERT INTO operation_logs (user_id, action, detail, created_at) VALUES (NULL, 'login_failed', $1, NOW())`,
        [`登录失败: ${employeeId}`]
      );
      return NextResponse.json({ error: "工号或密码错误" }, { status: 401 });
    }

    // 签发 JWT
    const token = await new SignJWT({ userId: String(user.id), role: user.role })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(`${SESSION_EXPIRY_DAYS}d`)
      .sign(JWT_SECRET);

    await pool.query(
      `INSERT INTO operation_logs (user_id, action, detail, created_at) VALUES ($1, 'login', '员工登录', NOW())`,
      [user.id]
    );

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

// 验证 JWT token
export async function GET(req: NextRequest) {
  const token =
    req.cookies.get("session_token")?.value ||
    req.headers.get("Authorization")?.replace("Bearer ", "");

  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return NextResponse.json({
      authenticated: true,
      userId: payload.userId as string,
      role: payload.role as string,
    });
  } catch {
    const response = NextResponse.json({ authenticated: false }, { status: 401 });
    response.cookies.set("session_token", "", { maxAge: 0, path: "/" });
    return response;
  }
}

// 登出（清除 cookie）
export async function DELETE(req: NextRequest) {
  const token =
    req.cookies.get("session_token")?.value ||
    req.headers.get("Authorization")?.replace("Bearer ", "");

  if (token) {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      await pool.query(
        `INSERT INTO operation_logs (user_id, action, detail, created_at) VALUES ($1, 'logout', '员工登出', NOW())`,
        [payload.userId]
      ).catch(() => {});
    } catch {}
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set("session_token", "", { maxAge: 0, path: "/" });
  return response;
}
