/**
 * GET  /api/conversations?scriptId=X  — 列出当前用户在此剧本下的所有对话
 * POST /api/conversations               — 创建新对话 (body: {scriptId})
 */

import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { listConversations, createConversation } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = getUser(request) || { id: "1", role: "admin" as const, name: "" };

    const { searchParams } = new URL(request.url);
    const scriptId = searchParams.get("scriptId");
    if (!scriptId) return NextResponse.json({ error: "缺少 scriptId" }, { status: 400 });

    const conversations = await listConversations(parseInt(user.id), scriptId);
    return NextResponse.json({ conversations });
  } catch (error) {
    console.error("查询对话列表失败:", error);
    return NextResponse.json({ error: "查询失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = getUser(request) || { id: "1", role: "admin", name: "" };

    const { scriptId } = await request.json();
    if (!scriptId) return NextResponse.json({ error: "缺少 scriptId" }, { status: 400 });

    const userId = Number(user.id) || 1;

    const id = await createConversation(userId, scriptId);
    return NextResponse.json({
      conversation: { id, title: "新对话", script_id: scriptId, created_at: new Date().toISOString(), message_count: 0 },
    }, { status: 201 });
  } catch (error) {
    console.error("创建对话失败:", error);
    return NextResponse.json({ error: "创建失败" }, { status: 500 });
  }
}
