/**
 * GET /api/chat/search?q=keyword&scriptId=X
 * 搜索对话历史，返回匹配的消息及所属对话
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q")?.trim();
    const scriptId = searchParams.get("scriptId")?.trim();

    if (!q || q.length < 2) {
      return NextResponse.json({ results: [] });
    }

    let query = `
      SELECT
        ch.id,
        ch.role,
        ts_headline('simple', ch.content, plainto_tsquery('simple', $1),
          'MaxWords=30, MinWords=10, ShortWord=2, StartSel=<mark>, StopSel=</mark>') AS snippet,
        ch.conversation_id,
        ch.created_at,
        c.title AS conversation_title,
        c.script_id,
        s.name AS script_name
      FROM chat_history ch
      JOIN conversations c ON ch.conversation_id = c.id
      JOIN scripts s ON c.script_id = s.id
      WHERE ch.role = 'user'
        AND to_tsvector('simple', ch.content) @@ plainto_tsquery('simple', $1)
    `;
    const params: any[] = [q];
    let idx = 2;

    if (scriptId) {
      query += ` AND c.script_id = $${idx}::uuid`;
      params.push(scriptId);
      idx++;
    }

    query += ` ORDER BY ch.created_at DESC LIMIT 20`;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return NextResponse.json({ results: [] });
    }

    const results = result.rows.map((row: any) => ({
      id: row.id,
      role: row.role,
      snippet: row.snippet,
      conversationId: row.conversation_id,
      conversationTitle: row.conversation_title,
      scriptId: row.script_id,
      scriptName: row.script_name,
      createdAt: row.created_at,
    }));

    return NextResponse.json({ results });
  } catch (error) {
    console.error("[search] 搜索失败:", error);
    return NextResponse.json({ error: "搜索失败" }, { status: 500 });
  }
}
