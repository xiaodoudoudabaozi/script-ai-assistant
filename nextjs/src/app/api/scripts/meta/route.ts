import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";
import { getUser } from "@/lib/auth";

// GET /api/scripts/meta — 查询剧本元数据
export async function GET(request: NextRequest) {
  try {
    // v1 简化：meta 读操作不做强制鉴权，x-user-data 仅用于日志
    getUser(request);

    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get("keyword");
    const genre = searchParams.get("genre");
    const playerCount = searchParams.get("player_count");

    let query = `
      SELECT id, name, version, author, genre, player_count, act_count, difficulty, duration,
             is_sensitive, sensitivity_note, created_at, updated_at
      FROM scripts WHERE 1=1
    `;
    const values: any[] = [];
    let idx = 1;

    if (keyword) {
      query += ` AND (name ILIKE $${idx} OR author ILIKE $${idx})`;
      values.push(`%${keyword}%`);
      idx++;
    }
    if (genre) {
      query += ` AND genre = $${idx++}`;
      values.push(genre);
    }
    if (playerCount) {
      query += ` AND player_count = $${idx++}`;
      values.push(playerCount);
    }

    query += " ORDER BY name ASC";

    const result = await pool.query(query, values);
    return NextResponse.json({ scripts: result.rows });
  } catch (error) {
    console.error("查询剧本元数据失败:", error);
    return NextResponse.json({ error: "查询失败" }, { status: 500 });
  }
}

// POST /api/scripts/meta — 手动创建剧本元数据（管理员）
export async function POST(request: NextRequest) {
  try {
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

    const {
      name, author, genre, player_count, act_count, difficulty, duration,
      is_sensitive, sensitivity_note,
    } = await request.json();

    if (!name) return NextResponse.json({ error: "剧本名必填" }, { status: 400 });

    const result = await pool.query(
      `INSERT INTO scripts (name, author, genre, player_count, act_count, difficulty, duration, is_sensitive, sensitivity_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, author, genre, player_count, act_count, difficulty, duration, is_sensitive, sensitivity_note, created_at`,
      [name, author || "", genre || "", player_count || "", act_count || 0, difficulty || "", duration || "", is_sensitive || false, sensitivity_note || ""]
    );

    return NextResponse.json({ script: result.rows[0] }, { status: 201 });
  } catch (error) {
    console.error("创建剧本元数据失败:", error);
    return NextResponse.json({ error: "创建失败" }, { status: 500 });
  }
}