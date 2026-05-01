/**
 * POST /api/scripts/classify
 *
 * AI 自动分类：根据文件名判断文件类型和角色名
 * 使用简单直接的 prompt，单条 user message，避免系统提示过长导致模型困惑
 */

import { NextRequest, NextResponse } from "next/server";

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? "";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const files: { fileName: string; preview?: string }[] = body.files || [];

    if (files.length === 0) {
      return NextResponse.json({ error: "请提供文件列表" }, { status: 400 });
    }
    if (!DEEPSEEK_API_KEY) {
      return NextResponse.json({ error: "未配置 DEEPSEEK_API_KEY" }, { status: 500 });
    }

    // 构建简洁的文件列表
    const lines = files.map((f, i) => {
      const name = f.fileName;
      const lower = name.toLowerCase();
      // 从文件名提取可能的有用信息
      const ext = name.split(".").pop()?.toLowerCase() || "";
      return `${i + 1}. 文件名: ${name}  格式: ${ext}`;
    }).join("\n");

    const prompt = `以下是${files.length}个剧本相关文件的文件名。请逐个判断每个文件的类型和角色名。

分类标准：
- 文件名含"DM"或"手册"或"组织者"或"主持人" → fileType="dm_manual"
- 文件名含"主剧本"或"上半场"或"下半场"或"故事"且不含具体人名 → fileType="main_script"
- 文件名含明显人名（如米娅、森罗、神念、安德烈、海蒂、弗兰克、洛克兰、星野、长谷川、石田、秋山、梅林、海格等）→ fileType="character_script"，characterName填人名
- 扩展名为png/jpg/jpeg且不含"音频""mp3"等 → fileType="image_clue"（图片线索优先）
- 文件名含"线索"或"证据"且扩展名为pdf/docx → fileType="clue_card"
- 文件名含"照片"或"图片"或"线索"且扩展名为png/jpg/jpeg → fileType="image_clue"
- 文件名含"结局"或"独白"或"返场"或"最后的" → fileType="ending"
- 文件名含"演出"或"曲目"或"歌单"或"海报"或"音频"或"mp3"或"jpg" → fileType="other"
- 无法判断 → fileType="other"，characterName=""

文件列表：
${lines}

请严格返回JSON数组（不要markdown代码块），长度=${files.length}：
[{"fileType":"类型","characterName":"角色名或空"}, ...]`;

    console.log("[classify] sending prompt, files:", files.length);

    const resp = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [
          { role: "user", content: prompt },
        ],
        max_tokens: files.length * 80 + 200,
        temperature: 0,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("[classify] API error:", resp.status, errText.slice(0, 200));
      return NextResponse.json({ error: "AI 服务不可用" }, { status: 502 });
    }

    const data = await resp.json();
    const raw = data.choices?.[0]?.message?.content || "[]";
    console.log("[classify] response:", raw.slice(0, 500));

    // 解析 JSON
    let classifications: any[];
    try {
      const cleaned = raw.replace(/```[a-z]*\s*/gi, "").replace(/```/g, "").trim();
      const match = cleaned.match(/\[[\s\S]*\]/);
      classifications = JSON.parse(match ? match[0] : cleaned);
    } catch {
      console.error("[classify] parse failed:", raw.slice(0, 300));
      return NextResponse.json({ error: "AI 返回格式异常，请重试" }, { status: 500 });
    }

    if (!Array.isArray(classifications)) {
      return NextResponse.json({ error: "AI 返回非数组" }, { status: 500 });
    }

    // 数量对齐
    while (classifications.length < files.length) {
      classifications.push({ fileType: "other", characterName: "" });
    }
    const trimmed = classifications.slice(0, files.length);

    const results = files.map((f, i) => ({
      fileName: f.fileName,
      fileType: trimmed[i]?.fileType || "other",
      characterName: trimmed[i]?.characterName || "",
    }));

    return NextResponse.json({ classifications: results });
  } catch (error) {
    console.error("[classify] error:", error);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
