/**
 * POST /api/chat
 *
 * DeepSeek API 流式对话（规格文档完整实现）
 *
 * 修复项：
 * - #8: 动态模型切换（从app_settings读取）
 * - #9: API并发控制（最大5并发+429重试）
 * - #10: 对话历史压缩（>10轮摘要压缩）
 * - #16: 操作日志记录
 */

import { NextRequest, NextResponse } from "next/server";
import { readAllFileTexts, readCache } from "@/lib/cache";
import { buildMessages } from "@/lib/prompt";
import { getHistory, appendMessage, compressHistory, getConversation, updateConversationTitle } from "@/lib/session";
import { pool } from "@/lib/pg";
import { controlledFetch } from "@/lib/concurrency";
import { getUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? "";

// 获取当前激活模型
async function getActiveModel(): Promise<string> {
  try {
    const result = await pool.query(
      "SELECT active_llm_model FROM app_settings WHERE id = 'default'"
    );
    return result.rows[0]?.active_llm_model || "deepseek-v4-pro";
  } catch {
    return "deepseek-v4-pro";
  }
}

export async function POST(req: NextRequest) {
  // ---------- 1. 鉴权（v1：内网弱鉴权，无用户时默认 admin） ----------
  const user = getUser(req) || { id: "1", role: "admin", name: "" };

  // ---------- 2. 解析请求 ----------
  let body: { scriptId?: string; message?: string; conversationId?: string; characterName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  const { scriptId, message, conversationId, characterName } = body;

  if (!scriptId) return NextResponse.json({ error: "缺少 scriptId" }, { status: 400 });
  if (!conversationId) return NextResponse.json({ error: "缺少 conversationId" }, { status: 400 });
  if (!message?.trim()) return NextResponse.json({ error: "消息不能为空" }, { status: 400 });

  // 校验对话存在
  const conv = await getConversation(conversationId);
  if (!conv) return NextResponse.json({ error: "对话不存在" }, { status: 404 });

  if (!DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: "未配置 DEEPSEEK_API_KEY" }, { status: 500 });
  }

  // ---------- 2. 读取剧本内容（多文件拼接 + 角色过滤，回退单文件缓存） ----------
  const { text: assembledText, fileCount, filteredCount } = await readAllFileTexts(scriptId, characterName || undefined);
  let scriptFullText = assembledText;

  // 多文件缓存未命中 → 回退旧的单文件缓存
  if (!scriptFullText) {
    scriptFullText = await readCache(scriptId) || "";
  }

  // 缓存未命中 → 从 DB 读取路径再尝试文件系统
  if (!scriptFullText) {
    try {
      const dbResult = await pool.query(
        "SELECT cached_text_path FROM scripts WHERE id = $1",
        [scriptId]
      );
      if (dbResult.rows.length > 0 && dbResult.rows[0].cached_text_path) {
        try {
          const fs = await import("fs/promises");
          scriptFullText = await fs.readFile(dbResult.rows[0].cached_text_path, "utf-8");
        } catch { /* 文件不存在 */ }
      }
    } catch (dbErr) {
      console.error("[chat] 数据库查询失败:", dbErr);
    }
  }

  if (!scriptFullText) {
    return new Response(
      JSON.stringify({ error: "剧本不存在或尚未解析，请先上传剧本" }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  // ---------- 4. 对话历史 + 压缩 ----------
  let history = await getHistory(conversationId);

  // 超过10轮时压缩旧历史（规格文档3.3节）
  if (history.length > 20) {
    history = await compressHistory(conversationId, history);
  }

  const messages = buildMessages({
    scriptFullText,
    conversationHistory: history,
    currentQuestion: message.trim(),
  });

  // ---------- 4. 获取当前激活模型（#8修复） ----------
  const activeModel = await getActiveModel();

  // ---------- 5. 调用 DeepSeek API（#9并发控制） ----------
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let fullAssistantMsg = "";

      try {
        const response = await controlledFetch(DEEPSEEK_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          },
          body: JSON.stringify({
            model: activeModel,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            stream: true,
            max_tokens: 8192,
            stream_options: { include_usage: true },
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          let errMsg = `DeepSeek API 错误 (${response.status})`;
          try {
            const errJson = JSON.parse(errText);
            errMsg = errJson.error?.message ?? errMsg;
          } catch { /* ignore */ }

          // 记录LLM错误日志
          try {
            await pool.query(
              `INSERT INTO operation_logs (user_id, action, detail, created_at) VALUES (NULL, 'llm_error', $1, NOW())`,
              [`Chat API错误: ${errMsg}`]
            );
          } catch { /* ignore */ }

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: "AI 服务暂时不可用，管理员已收到通知" })}\n\n`)
          );
          controller.close();
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: "无法读取流式响应" })}\n\n`)
          );
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let finishReason = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;

            const data = trimmed.slice(6);
            if (data === "[DONE]") {
              if (fullAssistantMsg) {
                appendMessage(conversationId, scriptId, message.trim(), fullAssistantMsg);
                // 首次对话自动设置标题
                if (conv.title === "新对话") {
                  const title = message.trim().slice(0, 50);
                  updateConversationTitle(conversationId, title);
                }
              }
              // 截断检测（规格文档4.2.3节）
              if (finishReason === "length") {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ warning: "回答内容可能被截断，建议简化问题或分步提问" })}\n\n`)
                );
              }
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              // 检测 finish_reason
              if (parsed.choices?.[0]?.finish_reason) {
                finishReason = parsed.choices[0].finish_reason;
              }
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullAssistantMsg += delta;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ content: delta })}\n\n`)
                );
              }
            } catch { /* ignore */ }
          }
        }

        if (fullAssistantMsg && !buffer.includes("[DONE]")) {
          appendMessage(conversationId, scriptId, message.trim(), fullAssistantMsg);
          if (conv.title === "新对话") {
            updateConversationTitle(conversationId, message.trim().slice(0, 50));
          }
          if (finishReason === "length") {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ warning: "回答内容可能被截断，建议简化问题或分步提问" })}\n\n`)
            );
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        }

        controller.close();
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : "未知错误";
        console.error("[chat] 流式错误:", err);

        // 规格文档4.4节：错误提示文案
        if (errMsg.includes("繁忙") || errMsg.includes("timeout") || errMsg.includes("超时")) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: "AI 回答超时，请稍后重试" })}\n\n`)
          );
        } else {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: "AI 服务暂时不可用，管理员已收到通知" })}\n\n`)
          );
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}