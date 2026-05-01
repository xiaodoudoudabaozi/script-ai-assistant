/**
 * DELETE /api/scripts/files/[fileId] — 删除剧本的单个文件
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";
import { deleteFileCache } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;

    // 查找文件所属剧本
    const fileResult = await pool.query(
      "SELECT id, script_id FROM script_files WHERE id = $1",
      [fileId]
    );
    if (fileResult.rows.length === 0) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    const { script_id } = fileResult.rows[0];

    // 删除 script_files 记录
    await pool.query("DELETE FROM script_files WHERE id = $1", [fileId]);

    // 清理缓存
    deleteFileCache(script_id, fileId).catch((e) =>
      console.error("[files] 缓存清理失败:", e)
    );

    // 更新剧本时间戳
    await pool.query("UPDATE scripts SET updated_at = NOW() WHERE id = $1", [script_id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[files] 删除文件失败:", error);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
