/**
 * GET /api/scripts/parse-status?scriptId=X
 * 返回剧本文件的后台解析进度
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const scriptId = searchParams.get("scriptId");
    if (!scriptId) return NextResponse.json({ error: "缺少 scriptId" }, { status: 400 });

    const result = await pool.query(
      `SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN cached_text_path IS NOT NULL AND cached_text_path != '' THEN 1 END)::int AS parsed,
        COUNT(CASE WHEN cached_text_path IS NULL OR cached_text_path = '' THEN 1 END)::int AS pending
       FROM script_files WHERE script_id = $1`,
      [scriptId]
    );

    const row = result.rows[0];
    return NextResponse.json({
      total: row.total,
      parsed: row.parsed,
      pending: row.pending,
      done: row.total > 0 && row.pending === 0,
    });
  } catch (error) {
    console.error("[parse-status] 查询失败:", error);
    return NextResponse.json({ error: "查询失败" }, { status: 500 });
  }
}
