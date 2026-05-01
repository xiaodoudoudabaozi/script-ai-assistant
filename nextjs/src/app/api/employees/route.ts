import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";

export async function GET(request: NextRequest) {
  try {
    // 简化验证：从 header 获取 user JSON（前端 localStorage 存入）
    const userHeader = request.headers.get("x-user-data");
    if (!userHeader) {
      // 尝试从 Authorization 提取 token 并验证
      const authHeader = request.headers.get("Authorization");
      if (!authHeader) {
        return NextResponse.json({ error: "未登录" }, { status: 401 });
      }
    }
    
    // 解析用户角色
    let userData = null;
    if (userHeader) {
      try {
        userData = JSON.parse(userHeader);
      } catch {}
    }
    
    // 员工只能看自己，管理员/组长可以看全部
    if (userData?.role === "admin" || userData?.role === "leader") {
      const result = await pool.query(
        "SELECT id, name, role, phone, position, created_at FROM employees ORDER BY created_at DESC"
      );
      return NextResponse.json({ employees: result.rows });
    } else if (userData?.id) {
      // 员工只能看自己
      const result = await pool.query(
        "SELECT id, name, role, phone, position, created_at FROM employees WHERE id = $1",
        [userData.id]
      );
      return NextResponse.json({ employees: result.rows });
    } else {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
  } catch (error) {
    console.error("查询员工失败:", error);
    return NextResponse.json({ error: "查询失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const userHeader = request.headers.get("x-user-data");
    if (!userHeader) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    
    let userData;
    try {
      userData = JSON.parse(userHeader);
    } catch {
      return NextResponse.json({ error: "无效的用户信息" }, { status: 401 });
    }
    
    // 只有管理员可以创建员工
    if (userData.role !== "admin") {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { name, phone, position, password, role } = await request.json();

    if (!name || !password) {
      return NextResponse.json({ error: "姓名和密码必填" }, { status: 400 });
    }

    // bcrypt 加密存储（规格文档5.3节）
    const bcrypt = await import("bcrypt");
    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO employees (name, role, phone, position, password_hash) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, name, role, phone, position, created_at`,
      [name, role || "staff", phone || "", position || "", passwordHash]
    );

    // 记录操作日志
    await pool.query(
      `INSERT INTO operation_logs (user_id, action, detail, created_at) VALUES (NULL, 'employee_created', $1, NOW())`,
      [`新增员工: ${name}`]
    ).catch(() => {});

    return NextResponse.json({ employee: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error("创建员工失败:", error);
    return NextResponse.json({ error: "创建失败" }, { status: 500 });
  }
}