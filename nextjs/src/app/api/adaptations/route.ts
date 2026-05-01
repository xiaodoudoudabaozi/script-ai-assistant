import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";
import { readCache, readAllFileTexts } from "@/lib/cache";
import { getUser } from "@/lib/auth";

// 改编类型映射（规格文档4.2.2节）
const ADAPT_TYPES: Record<string, string> = {
  element_replacement: "元素替换",
  plot_tweak: "剧情微调",
  perspective_expand: "视角扩展",
  manual_adapt: "手册改编",
};

// 禁止级改编关键词
const PROHIBITED_PATTERNS = [
  /删除.*(关键|核心|主要)\s*角色/,
  /改变.*核心诡计/,
  /删除.*所有线索/,
  /去掉.*推理链/,
];

// 需确认级改编关键词
const CONFIRM_PATTERNS = [
  /增加?\d*幕/,
  /减少?\d*幕/,
  /合并.*幕/,
  /拆分.*幕/,
];

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

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

// GET /api/adaptations — 查询改编日志
export async function GET(request: NextRequest) {
  try {
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const scriptId = searchParams.get("script_id");

    let query = `
      SELECT a.id, a.script_id, a.adaptation_type, a.instruction, a.changes_summary, a.output_file_path, a.created_at,
             s.name as script_name, e.name as operator_name
      FROM adaptation_logs a
      JOIN scripts s ON a.script_id = s.id
      JOIN employees e ON a.operator_id = e.id
      WHERE 1=1
    `;
    const values: any[] = [];
    let idx = 1;

    if (scriptId) {
      query += ` AND a.script_id = $${idx++}`;
      values.push(scriptId);
    }

    query += " ORDER BY a.created_at DESC LIMIT 50";

    const result = await pool.query(query, values);
    return NextResponse.json({ adaptations: result.rows });
  } catch (error) {
    console.error("查询改编日志失败:", error);
    return NextResponse.json({ error: "查询失败" }, { status: 500 });
  }
}

// POST /api/adaptations — 执行改编（支持两步：step=preview 生成方案 | step=generate 生成全文）
export async function POST(request: NextRequest) {
  try {
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { script_id, adaptation_type, instruction, step } = await request.json();

    if (!script_id || !adaptation_type || !instruction) {
      return NextResponse.json({ error: "剧本ID、改编类型、改编指令必填" }, { status: 400 });
    }

    // ---- 分级检查（规格文档4.1节改编分级） ----
    for (const pattern of PROHIBITED_PATTERNS) {
      if (pattern.test(instruction)) {
        return NextResponse.json({
          error: "这个改编可能破坏剧本的核心推理逻辑，建议重新调整改编范围。",
          level: "prohibited",
        }, { status: 400 });
      }
    }

    let needConfirm = false;
    let confirmMessage = "";
    for (const pattern of CONFIRM_PATTERNS) {
      if (pattern.test(instruction)) {
        needConfirm = true;
        confirmMessage = "注意：此操作可能影响剧情节奏和角色戏份分布，建议确认改动范围后继续。";
        break;
      }
    }

    // ---- 读取剧本内容（#1修复：读实际内容而非路径） ----
    const scriptResult = await pool.query(
      "SELECT name, cached_text_path, is_sensitive FROM scripts WHERE id = $1",
      [script_id]
    );

    if (scriptResult.rows.length === 0) {
      return NextResponse.json({ error: "剧本不存在" }, { status: 404 });
    }

    const script = scriptResult.rows[0];

    // 敏感本二次确认
    if (script.is_sensitive && step !== "generate") {
      return NextResponse.json({
        warning: "该剧本已标记为敏感本，改编需谨慎。请确认后再继续。",
        need_sensitive_confirm: true,
      });
    }

    // 读取剧本全文（多文件拼接，回退单文件缓存）
    const { text: assembledText } = await readAllFileTexts(script_id);
    let scriptFullText = assembledText;

    if (!scriptFullText) {
      scriptFullText = await readCache(script_id) || "";
    }

    // 再回退：从数据库记录的路径读取
    if (!scriptFullText && script.cached_text_path) {
      try {
        const fs = await import("fs/promises");
        scriptFullText = await fs.readFile(script.cached_text_path, "utf-8");
      } catch { /* ignore */ }
    }

    if (!scriptFullText) {
      return NextResponse.json({ error: "剧本内容未找到，请先上传剧本文件" }, { status: 404 });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "未配置DeepSeek API Key" }, { status: 500 });
    }

    const activeModel = await getActiveModel();

    // ======== Step 1: 改编方案确认（规格文档4.1节） ========
    if (step === "preview" || !step) {
      const previewPrompt = `你是剧本杀改编专家。请根据以下指令，输出改编方案确认（不要输出完整改编内容）。

## 改编类型
${ADAPT_TYPES[adaptation_type] || adaptation_type}

## 改编指令
${instruction}

## 剧本全文
${scriptFullText}

请输出：
1. 改编概要（3-5句话概括改编范围和主要改动）
2. 影响评估（对角色/线索/场景的影响）
${needConfirm ? `3. ⚠️ 风险提示：${confirmMessage}` : ""}

不要输出完整改编版本，只输出方案概要。`;

      const previewResp = await fetch(DEEPSEEK_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: activeModel,
          messages: [
            { role: "system", content: "你是剧本杀改编专家。输出改编方案确认，不要输出完整改编内容。" },
            { role: "user", content: previewPrompt },
          ],
          max_tokens: 2000,
          temperature: 0.3,
        }),
      });

      if (!previewResp.ok) {
        const errText = await previewResp.text();
        console.error("DeepSeek预览失败:", errText);
        return NextResponse.json({ error: "AI服务调用失败" }, { status: 502 });
      }

      const previewData = await previewResp.json();
      const previewContent = previewData.choices?.[0]?.message?.content || "";

      return NextResponse.json({
        step: "preview",
        preview: previewContent,
        need_confirm: needConfirm,
        confirm_message: confirmMessage,
        script_name: script.name,
      });
    }

    // ======== Step 2: 生成全本改编（管理员确认后） ========
    if (step === "generate") {
      const adaptPrompt = `你是剧本杀改编专家。请根据以下指令对剧本进行全本改编。

## 改编类型
${ADAPT_TYPES[adaptation_type] || adaptation_type}

## 改编指令
${instruction}

## 原始剧本内容
${scriptFullText}

请输出改编后的完整内容，保持原有幕数和角色结构。

改编完成后，请在末尾附上自检清单：
- [ ] 角色数量 = 原版
- [ ] 幕数 = 原版（除非指令明确要求增减）
- [ ] 每个角色都有对应的剧本内容（无遗漏）
- [ ] 所有线索卡都有对应内容
- [ ] DM手册与改编后的剧情一致
- [ ] 核心诡计推理链完整
- [ ] 改编后的背景设定与时间线/场景描述一致`;

      const deepseekResp = await fetch(DEEPSEEK_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: activeModel,
          messages: [
            { role: "system", content: "你是剧本杀改编专家，擅长修改剧本的角色、情节、难度等元素。输出完整改编版本。" },
            { role: "user", content: adaptPrompt },
          ],
          // #2修复：max_tokens 从8000改为80000（规格文档4.2.3节）
          max_tokens: 80000,
          temperature: 0.7,
        }),
      });

      if (!deepseekResp.ok) {
        const errText = await deepseekResp.text();
        console.error("DeepSeek改编失败:", errText);
        // #16修复：记录操作日志
        await pool.query(
          `INSERT INTO operation_logs (user_id, action, detail, created_at) VALUES ($1, 'adaptation_failed', $2, NOW())`,
          [user.id, `改编失败: ${script.name} - ${adaptation_type}`]
        );
        return NextResponse.json({ error: "AI改编服务调用失败" }, { status: 502 });
      }

      const deepseekData = await deepseekResp.json();
      const adaptedContent = deepseekData.choices?.[0]?.message?.content || "";

      // #3修复：截断检测（规格文档4.2.3节）
      const finishReason = deepseekData.choices?.[0]?.finish_reason;
      const isTruncated = finishReason === "length";

      // 保存版本（原版→新版本）
      const vResult = await pool.query(
        `SELECT COALESCE(MAX(version_number), 0) AS v FROM script_versions WHERE script_id = $1`,
        [script_id]
      );
      const nextV = parseInt(vResult.rows[0].v) + 1;
      await pool.query(
        `INSERT INTO script_versions (script_id, version_number, label, content, source)
         VALUES ($1, $2, $3, $4, 'original')`,
        [script_id, nextV, `改编前 · 第${nextV}版`, scriptFullText]
      );

      // 保存改编日志
      const changesSummary = adaptedContent.substring(0, 200) + "...";
      const logResult = await pool.query(
        `INSERT INTO adaptation_logs (operator_id, script_id, adaptation_type, instruction, changes_summary, output_file_path)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, adaptation_type, instruction, changes_summary, created_at`,
        [user.id, script_id, adaptation_type, instruction, changesSummary, ""]
      );

      // 保存改编后版本
      const adaptId = logResult.rows[0].id;
      await pool.query(
        `INSERT INTO script_versions (script_id, version_number, label, content, source, adaptation_id)
         VALUES ($1, $2, $3, $4, 'adapted', $5)`,
        [script_id, nextV + 1, `改编后 · 第${nextV + 1}版`, adaptedContent, adaptId]
      );

      // #16修复：记录操作日志
      await pool.query(
        `INSERT INTO operation_logs (user_id, action, detail, created_at) VALUES ($1, 'adaptation', $2, NOW())`,
        [user.id, `改编剧本: ${script.name} - ${ADAPT_TYPES[adaptation_type] || adaptation_type}`]
      );

      return NextResponse.json({
        adaptation: logResult.rows[0],
        content: adaptedContent,
        script_name: script.name,
        // #3修复：截断检测结果
        is_truncated: isTruncated,
        truncation_warning: isTruncated
          ? "⚠️ 改编内容可能被截断，建议分段改编或缩短改编范围"
          : null,
        finish_reason: finishReason,
      }, { status: 201 });
    }

    return NextResponse.json({ error: "无效的step参数，请使用 preview 或 generate" }, { status: 400 });
  } catch (error) {
    console.error("改编失败:", error);
    return NextResponse.json({ error: "改编失败" }, { status: 500 });
  }
}