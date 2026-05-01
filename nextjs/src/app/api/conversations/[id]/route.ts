import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getConversation, updateConversationTitle, deleteConversation } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = getUser(request) || { id: "1", role: "admin", name: "" };
    const { id } = await params;
    const conv = await getConversation(id);
    if (!conv) return NextResponse.json({ error: "对话不存在" }, { status: 404 });
    const { title } = await request.json();
    if (!title) return NextResponse.json({ error: "缺少 title" }, { status: 400 });
    await updateConversationTitle(id, title);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = getUser(request) || { id: "1", role: "admin", name: "" };
    const { id } = await params;
    const conv = await getConversation(id);
    if (!conv) return NextResponse.json({ error: "对话不存在" }, { status: 404 });
    await deleteConversation(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
