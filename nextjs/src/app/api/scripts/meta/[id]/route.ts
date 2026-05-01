import { getUser } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";
import { deleteCache, deleteAllFileCaches } from "@/lib/cache";


// PUT /api/scripts/meta/[id] — 更新剧本元数据（管理员）
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { id } = await params;
    const body = await request.json();

    const fields = ["name", "author", "genre", "player_count", "act_count", "difficulty", "duration", "is_sensitive", "sensitivity_note"];
    const setClauses: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const f of fields) {
      if (body[f] !== undefined) {
        setClauses.push(`${f} = $${idx++}`);
        values.push(body[f]);
      }
    }

    if (setClauses.length === 0) return NextResponse.json({ error: "没有要更新的内容" }, { status: 400 });

    setClauses.push(`updated_at = NOW()`);
    values.push(id);

    const query = `UPDATE scripts SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING id, name, author, genre, player_count, act_count, difficulty, duration, is_sensitive, sensitivity_note`;
    const result = await pool.query(query, values);

    if (result.rows.length === 0) return NextResponse.json({ error: "剧本不存在" }, { status: 404 });
    return NextResponse.json({ script: result.rows[0] });
  } catch (error) {
    console.error("更新剧本元数据失败:", error);
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}

// DELETE /api/scripts/meta/[id] — 删除剧本（管理员）
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    getUser(request); // v1 调试：记日志但不拦截

    const { id } = await params;
    const result = await pool.query("DELETE FROM scripts WHERE id = $1 RETURNING id", [id]);

    if (result.rows.length === 0) return NextResponse.json({ error: "剧本不存在" }, { status: 404 });
    // 同步清理磁盘缓存（单文件 + 多文件）
    deleteCache(id).catch((e) => console.error("缓存清理失败:", e));
    deleteAllFileCaches(id).catch((e) => console.error("多文件缓存清理失败:", e));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("删除剧本失败:", error);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}