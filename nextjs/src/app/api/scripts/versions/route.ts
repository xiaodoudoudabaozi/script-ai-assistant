/**
 * GET  /api/scripts/versions?scriptId=X → 版本历史列表
 * POST /api/scripts/versions/restore → 恢复到指定版本
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — 版本历史
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const scriptId = searchParams.get("scriptId");
    if (!scriptId) return NextResponse.json({ error: "缺少 scriptId" }, { status: 400 });

    const result = await pool.query(
      `SELECT id, version_number, label, source, created_at,
              length(content) AS content_length,
              substring(content, 1, 200) AS preview
       FROM script_versions
       WHERE script_id = $1
       ORDER BY version_number DESC
       LIMIT 50`,
      [scriptId]
    );

    return NextResponse.json({ versions: result.rows });
  } catch (error) {
    console.error("[versions] 查询失败:", error);
    return NextResponse.json({ error: "查询失败" }, { status: 500 });
  }
}

// POST — 获取单个版本完整内容（用于预览）
export async function POST(request: NextRequest) {
  try {
    const { versionId } = await request.json();
    if (!versionId) return NextResponse.json({ error: "缺少 versionId" }, { status: 400 });

    const result = await pool.query(
      `SELECT id, version_number, label, content, source, created_at
       FROM script_versions WHERE id = $1`,
      [versionId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "版本不存在" }, { status: 404 });
    }

    return NextResponse.json({ version: result.rows[0] });
  } catch (error) {
    console.error("[versions] 获取版本失败:", error);
    return NextResponse.json({ error: "获取失败" }, { status: 500 });
  }
}
