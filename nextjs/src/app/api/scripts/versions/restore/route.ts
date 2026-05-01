/**
 * POST /api/scripts/versions/restore
 * 恢复到指定版本：将版本内容写入脚本缓存
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";
import { writeCache } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { versionId, scriptId } = await request.json();
    if (!versionId || !scriptId) {
      return NextResponse.json({ error: "缺少 versionId 或 scriptId" }, { status: 400 });
    }

    // 获取版本内容
    const vResult = await pool.query(
      `SELECT content, label, version_number FROM script_versions WHERE id = $1 AND script_id = $2`,
      [versionId, scriptId]
    );

    if (vResult.rows.length === 0) {
      return NextResponse.json({ error: "版本不存在" }, { status: 404 });
    }

    const { content, label, version_number } = vResult.rows[0];

    // 写入缓存（覆盖当前剧本缓存）
    await writeCache(scriptId, content);

    // 保存为新的恢复版本
    await pool.query(
      `INSERT INTO script_versions (script_id, version_number, label, content, source)
       VALUES ($1, (SELECT COALESCE(MAX(version_number), 0) + 1 FROM script_versions WHERE script_id = $1), $2, $3, 'restored')`,
      [scriptId, `恢复至第${version_number}版 · ${label}`, content]
    );

    return NextResponse.json({
      success: true,
      restored_version: version_number,
      label,
    });
  } catch (error) {
    console.error("[restore] 恢复失败:", error);
    return NextResponse.json({ error: "恢复失败" }, { status: 500 });
  }
}
