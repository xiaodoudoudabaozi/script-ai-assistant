import { getUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";


// GET /api/schedules?month=2026-04&employee_id=xxx
export async function GET(request: NextRequest) {
  try {
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month"); // 格式: 2026-04
    const employeeId = searchParams.get("employee_id");

    let query = `
      SELECT s.id, s.date, s.shift, s.role_in_shift, s.note, s.created_at,
             e.name as employee_name, e.position, s.employee_id
      FROM schedules s
      JOIN employees e ON s.employee_id = e.id
      WHERE 1=1
    `;
    const values: any[] = [];
    let idx = 1;

    if (month) {
      query += ` AND TO_CHAR(s.date, 'YYYY-MM') = $${idx++}`;
      values.push(month);
    }

    // 员工只能看自己的排班
    if (user.role !== "admin") {
      query += ` AND s.employee_id = $${idx++}`;
      values.push(user.id);
    } else if (employeeId) {
      // 管理员可以按员工筛选
      query += ` AND s.employee_id = $${idx++}`;
      values.push(employeeId);
    }

    query += " ORDER BY s.date ASC, s.shift ASC";

    const result = await pool.query(query, values);
    return NextResponse.json({ schedules: result.rows });
  } catch (error) {
    console.error("查询排班失败:", error);
    return NextResponse.json({ error: "查询失败" }, { status: 500 });
  }
}

// POST /api/schedules — 批量创建排班（管理员）
export async function POST(request: NextRequest) {
  try {
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

    const body = await request.json();
    // 支持单条和批量
    const items = Array.isArray(body) ? body : [body];
    const results = [];

    for (const item of items) {
      const { employee_id, date, shift, role_in_shift, note } = item;
      if (!employee_id || !date || !shift) {
        results.push({ error: "员工ID、日期、班次必填", item });
        continue;
      }

      // 检查是否已有排班（同一天同一员工同一班次）
      const existing = await pool.query(
        "SELECT id FROM schedules WHERE employee_id = $1 AND date = $2 AND shift = $3",
        [employee_id, date, shift]
      );
      if (existing.rows.length > 0) {
        // 更新已有排班
        const r = await pool.query(
          `UPDATE schedules SET role_in_shift = $1, note = $2, updated_at = NOW() 
           WHERE employee_id = $3 AND date = $4 AND shift = $5
           RETURNING id, employee_id, date, shift, role_in_shift, note`,
          [role_in_shift || "", note || "", employee_id, date, shift]
        );
        results.push(r.rows[0]);
      } else {
        const r = await pool.query(
          `INSERT INTO schedules (employee_id, date, shift, role_in_shift, note) 
           VALUES ($1, $2, $3, $4, $5) 
           RETURNING id, employee_id, date, shift, role_in_shift, note`,
          [employee_id, date, shift, role_in_shift || "", note || ""]
        );
        results.push(r.rows[0]);
      }
    }

    return NextResponse.json({ schedules: results }, { status: 201 });
  } catch (error) {
    console.error("创建排班失败:", error);
    return NextResponse.json({ error: "创建失败" }, { status: 500 });
  }
}