import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";
import { getUser, isAdminOrLeader } from "@/lib/auth";

export async function GET(request: NextRequest) {
  try {
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

    if (isAdminOrLeader(user.role)) {
      const result = await pool.query(
        "SELECT id, name, role, phone, position, created_at FROM employees ORDER BY created_at DESC"
      );
      return NextResponse.json({ employees: result.rows });
    } else {
      const result = await pool.query(
        "SELECT id, name, role, phone, position, created_at FROM employees WHERE id = $1",
        [user.id]
      );
      return NextResponse.json({ employees: result.rows });
    }
  } catch (error) {
    console.error("查询员工失败:", error);
    return NextResponse.json({ error: "查询失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { name, phone, position, password, role } = await request.json();

    if (!name || !password) {
      return NextResponse.json({ error: "姓名和密码必填" }, { status: 400 });
    }

    const bcrypt = await import("bcrypt");
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO employees (name, role, phone, position, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, role, phone, position, created_at`,
      [name, role || "staff", phone || "", position || "", passwordHash]
    );

    await pool.query(
      `INSERT INTO operation_logs (user_id, action, detail, created_at) VALUES ($1, 'employee_created', $2, NOW())`,
      [user.id, `新增员工: ${name}`]
    ).catch(() => {});

    return NextResponse.json({ employee: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error("创建员工失败:", error);
    return NextResponse.json({ error: "创建失败" }, { status: 500 });
  }
}