/**
 * GET /api/scripts/list
 *
 * 返回已入库剧本列表（数据库 + 本地缓存合并）
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    // 从数据库查询所有剧本
    const result = await pool.query(
      `SELECT id, name, genre, player_count, difficulty, is_sensitive 
       FROM scripts 
       ORDER BY name ASC`
    );

    const scripts = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      genre: row.genre || undefined,
      player_count: row.player_count || undefined,
      difficulty: row.difficulty || undefined,
      is_sensitive: row.is_sensitive || false,
    }));

    return NextResponse.json({ scripts });
  } catch (err) {
    console.error("[list] 数据库查询失败:", err);
    // 降级：返回空列表
    return NextResponse.json({ scripts: [] });
  }
}