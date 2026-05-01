/**
 * GET /api/scripts/cache?id=xxx
 *
 * 返回剧本缓存的纯文本（仅管理员，用于改编对比预览）
 */

import { NextRequest, NextResponse } from "next/server";
import { readCache } from "@/lib/cache";
import { pool } from "@/lib/pg";
import { getUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const scriptId = searchParams.get("id");
    if (!scriptId) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

    // 先读缓存
    let text = await readCache(scriptId);

    // 缓存未命中则查数据库路径
    if (!text) {
      const result = await pool.query(
        "SELECT cached_text_path FROM scripts WHERE id = $1",
        [scriptId]
      );
      if (result.rows.length > 0 && result.rows[0].cached_text_path) {
        try {
          const fs = await import("fs/promises");
          text = await fs.readFile(result.rows[0].cached_text_path, "utf-8");
        } catch { /* ignore */ }
      }
    }

    if (!text) {
      return NextResponse.json({ error: "剧本文本不可用" }, { status: 404 });
    }

    return NextResponse.json({ text });
  } catch (error) {
    console.error("读取剧本缓存失败:", error);
    return NextResponse.json({ error: "读取失败" }, { status: 500 });
  }
}
