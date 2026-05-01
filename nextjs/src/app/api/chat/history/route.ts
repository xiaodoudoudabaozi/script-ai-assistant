/**
 * GET /api/chat/history?conversationId=X — 返回对话的完整消息历史
 */

import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getHistory, getConversation } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = getUser(request) || { id: "1", role: "admin", name: "" };

    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversationId");
    if (!conversationId) return NextResponse.json({ error: "缺少 conversationId" }, { status: 400 });

    const conv = await getConversation(conversationId);
    if (!conv) return NextResponse.json({ messages: [] });

    const messages = await getHistory(conversationId);
    return NextResponse.json({ messages });
  } catch (error) {
    console.error("查询对话历史失败:", error);
    return NextResponse.json({ error: "查询失败" }, { status: 500 });
  }
}
