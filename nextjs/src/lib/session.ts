/**
 * session.ts - 对话历史管理（基于 conversationId，规格文档4.5.6节）
 */
import { pool } from "./pg";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

const MAX_HISTORY = 10; // 保留最近 10 轮

// 内存缓存：key = conversationId
const memoryCache = new Map<string, Message[]>();

async function getActiveModel(): Promise<string> {
  try {
    const result = await pool.query("SELECT active_llm_model FROM app_settings WHERE id = 'default'");
    return result.rows[0]?.active_llm_model || "deepseek-v4-pro";
  } catch {
    return "deepseek-v4-pro";
  }
}

// ── 对话 CRUD ──

export async function createConversation(userId: number, scriptId: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO conversations (user_id, script_id) VALUES ($1, $2) RETURNING id`,
    [userId, scriptId]
  );
  return result.rows[0].id;
}

export async function listConversations(userId: number, scriptId: string) {
  const result = await pool.query(
    `SELECT c.id, c.title, c.script_id, c.created_at, c.updated_at,
            COUNT(ch.id)::int AS message_count
     FROM conversations c
     LEFT JOIN chat_history ch ON ch.conversation_id = c.id
     WHERE c.user_id = $1 AND c.script_id = $2
     GROUP BY c.id
     ORDER BY c.updated_at DESC`,
    [userId, scriptId]
  );
  return result.rows;
}

export async function getConversation(conversationId: string) {
  const result = await pool.query("SELECT * FROM conversations WHERE id = $1", [conversationId]);
  return result.rows[0] || null;
}

export async function updateConversationTitle(conversationId: string, title: string) {
  await pool.query(
    `UPDATE conversations SET title = $1, updated_at = NOW() WHERE id = $2 AND title = '新对话'`,
    [title, conversationId]
  );
}

export async function deleteConversation(conversationId: string) {
  await pool.query("DELETE FROM conversations WHERE id = $1", [conversationId]);
  memoryCache.delete(conversationId);
}

export async function touchConversation(conversationId: string) {
  await pool.query("UPDATE conversations SET updated_at = NOW() WHERE id = $1", [conversationId]).catch(() => {});
}

// ── 对话历史 ──

/** 从数据库加载对话历史（async，修复竞争条件） */
export async function getHistory(conversationId: string): Promise<Message[]> {
  const cached = memoryCache.get(conversationId);
  if (cached && cached.length > 0) return cached;

  try {
    const result = await pool.query(
      `SELECT role, content FROM chat_history WHERE conversation_id = $1 ORDER BY created_at ASC`,
      [conversationId]
    );
    const history: Message[] = result.rows.map((r: any) => ({ role: r.role, content: r.content }));
    if (history.length > 0) {
      memoryCache.set(conversationId, history.slice(-MAX_HISTORY * 2));
    }
    return history;
  } catch {
    return [];
  }
}

/** 追加一轮对话 */
export async function appendMessage(
  conversationId: string,
  scriptId: string,
  userMsg: string,
  assistantMsg: string
): Promise<void> {
  // 内存缓存
  let history = memoryCache.get(conversationId) || [];
  history.push({ role: "user", content: userMsg });
  history.push({ role: "assistant", content: assistantMsg });
  if (history.length > MAX_HISTORY * 2) {
    history = history.slice(-MAX_HISTORY * 2);
  }
  memoryCache.set(conversationId, history);

  // 异步写入数据库
  const sessionId = `conv_${conversationId}`;
  Promise.all([
    pool.query(
      `INSERT INTO chat_history (session_id, conversation_id, script_id, role, content, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [sessionId, conversationId, scriptId, "user", userMsg]
    ),
    pool.query(
      `INSERT INTO chat_history (session_id, conversation_id, script_id, role, content, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [sessionId, conversationId, scriptId, "assistant", assistantMsg]
    ),
  ]).catch((err) => console.error("[session] DB写入失败:", err));

  // 更新 conversation 时间
  touchConversation(conversationId);
}

/** 对话历史压缩（>10轮摘要压缩，规格文档3.3节） */
export async function compressHistory(conversationId: string, history: Message[]): Promise<Message[]> {
  if (history.length <= MAX_HISTORY * 2) return history;

  const recentHistory = history.slice(-MAX_HISTORY * 2);
  const olderHistory = history.slice(0, -MAX_HISTORY * 2);
  const olderText = olderHistory.map(m => `${m.role === "user" ? "员工" : "AI"}: ${m.content}`).join("\n");

  let compressedSummary = "";
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (apiKey) {
      const activeModel = await getActiveModel();
      const resp = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: activeModel,
          messages: [
            { role: "system", content: "将以下对话历史压缩为简洁摘要，保留关键信息和结论，不超过300字。" },
            { role: "user", content: olderText },
          ],
          max_tokens: 300,
          temperature: 0.1,
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        compressedSummary = data.choices?.[0]?.message?.content || "";
      }
    }
  } catch (err) {
    console.error("[session] 压缩失败，保留原历史:", err);
    return history.slice(-MAX_HISTORY * 2);
  }

  if (compressedSummary) {
    const compressed: Message[] = [
      { role: "system", content: `【历史对话摘要】\n${compressedSummary}` },
      ...recentHistory,
    ];
    memoryCache.set(conversationId, recentHistory);
    return compressed;
  }

  return recentHistory;
}

/** 清除对话历史 */
export async function clearHistory(conversationId: string): Promise<void> {
  memoryCache.delete(conversationId);
  await pool.query("DELETE FROM chat_history WHERE conversation_id = $1", [conversationId]).catch(() => {});
}
