import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";

function getUser(req: NextRequest) {
  const h = req.headers.get("x-user-data");
  if (!h) return null;
  try { return JSON.parse(h); } catch { return null; }
}

const VALID_MODELS = ["deepseek-v4-pro", "deepseek-v4-flash"];

// GET /api/settings/model — 获取当前激活模型
export async function GET(request: NextRequest) {
  try {
    const result = await pool.query(
      "SELECT active_llm_model, updated_at FROM app_settings WHERE id = 'default'"
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ model: "deepseek-v4-pro" });
    }
    return NextResponse.json({
      model: result.rows[0].active_llm_model,
      updated_at: result.rows[0].updated_at,
      available_models: VALID_MODELS,
    });
  } catch (error) {
    console.error("查询模型设置失败:", error);
    return NextResponse.json({ model: "deepseek-v4-pro", available_models: VALID_MODELS });
  }
}

// PUT /api/settings/model — 切换模型（管理员）
export async function PUT(request: NextRequest) {
  try {
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { model } = await request.json();
    if (!model || !VALID_MODELS.includes(model)) {
      return NextResponse.json({ error: `无效模型，可选: ${VALID_MODELS.join(", ")}` }, { status: 400 });
    }

    await pool.query(
      "UPDATE app_settings SET active_llm_model = $1, updated_at = NOW() WHERE id = 'default'",
      [model]
    );

    // 记录操作日志
    await pool.query(
      `INSERT INTO operation_logs (user_id, action, detail, created_at) VALUES ($1, 'model_switch', $2, NOW())`,
      [user.id, `切换模型为: ${model}`]
    );

    return NextResponse.json({ model, message: "模型切换成功" });
  } catch (error) {
    console.error("切换模型失败:", error);
    return NextResponse.json({ error: "切换失败" }, { status: 500 });
  }
}