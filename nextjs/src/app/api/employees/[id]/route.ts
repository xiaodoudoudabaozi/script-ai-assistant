import { getUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = getUser(request);
    if (!user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const { id } = await params;

    // 员工只能看自己，管理员可以看全部
    if (user.role !== "admin" && user.id !== id) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const result = await pool.query(
      "SELECT id, name, role, phone, position, created_at FROM employees WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "员工不存在" }, { status: 404 });
    }

    return NextResponse.json({ employee: result.rows[0] });
  } catch (error) {
    console.error("查询员工失败:", error);
    return NextResponse.json({ error: "查询失败" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = getUser(request);
    if (!user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const { id } = await params;

    // 只有管理员可以修改他人，员工只能修改自己
    if (user.role !== "admin" && user.id !== id) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { name, phone, position, password, role } = await request.json();

    let passwordHash = "";
    if (password) {
      const bcrypt = await import("bcrypt");
      passwordHash = await bcrypt.hash(password, 10);
    }

    let query = "UPDATE employees SET ";
    const values: any[] = [];
    let idx = 1;

    if (name) {
      values.push(name);
      query += `name = $${idx++}, `;
    }
    if (phone !== undefined) {
      values.push(phone);
      query += `phone = $${idx++}, `;
    }
    if (position !== undefined) {
      values.push(position);
      query += `position = $${idx++}, `;
    }
    if (passwordHash) {
      values.push(passwordHash);
      query += `password_hash = $${idx++}, `;
    }
    // 只有管理员可以修改角色
    if (role && user.role === "admin") {
      values.push(role);
      query += `role = $${idx++}, `;
    }

    if (values.length === 0) {
      return NextResponse.json({ error: "没有要更新的内容" }, { status: 400 });
    }

    query = query.slice(0, -2) + ` WHERE id = $${idx} RETURNING id, name, role, phone, position`;
    values.push(id);

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "员工不存在" }, { status: 404 });
    }

    return NextResponse.json({ employee: result.rows[0] });
  } catch (error) {
    console.error("更新员工失败:", error);
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = getUser(request);
    if (!user) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const { id } = await params;

    // 只��管理员可以删除员工
    if (user.role !== "admin") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    // 不能删除自己
    if (user.id === id) {
      return NextResponse.json({ error: "不能删除自己的账号" }, { status: 400 });
    }

    const result = await pool.query(
      "DELETE FROM employees WHERE id = $1 RETURNING id",
      [id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "员工不存在" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("删除员工失败:", error);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}