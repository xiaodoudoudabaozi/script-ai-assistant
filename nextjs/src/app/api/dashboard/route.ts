/**
 * GET /api/dashboard — 管理仪表盘数据
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);

    // 本月问答量
    const qaResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM chat_history
       WHERE TO_CHAR(created_at, 'YYYY-MM') = $1`,
      [thisMonth]
    );

    // 活跃员工数
    const activeResult = await pool.query(
      `SELECT COUNT(DISTINCT c.user_id)::int AS count
       FROM chat_history ch
       JOIN conversations c ON ch.conversation_id = c.id
       WHERE TO_CHAR(ch.created_at, 'YYYY-MM') = $1`,
      [thisMonth]
    );

    // 剧本数
    const scriptResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM scripts"
    );

    // 员工数
    const empResult = await pool.query(
      "SELECT COUNT(*)::int AS count FROM employees"
    );

    // 热门剧本 Top5
    const topScripts = await pool.query(
      `SELECT s.name, COUNT(*)::int AS count
       FROM chat_history ch
       JOIN scripts s ON ch.script_id = s.id
       WHERE TO_CHAR(ch.created_at, 'YYYY-MM') = $1
       GROUP BY s.name ORDER BY count DESC LIMIT 5`,
      [thisMonth]
    );

    // 每日趋势 (本月)
    const dailyTrend = await pool.query(
      `SELECT TO_CHAR(created_at, 'MM-DD') AS day, COUNT(*)::int AS count
       FROM chat_history
       WHERE TO_CHAR(created_at, 'YYYY-MM') = $1
       GROUP BY day ORDER BY day`,
      [thisMonth]
    );

    // 改编次数
    const adaptResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM adaptation_logs
       WHERE TO_CHAR(created_at, 'YYYY-MM') = $1`,
      [thisMonth]
    );

    // 登录记录 (本月)
    const loginsResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM operation_logs
       WHERE action = 'login' AND TO_CHAR(created_at, 'YYYY-MM') = $1`,
      [thisMonth]
    );

    return NextResponse.json({
      thisMonth,
      stats: {
        monthlyQuestions: qaResult.rows[0].count,
        activeUsers: activeResult.rows[0].count,
        totalScripts: scriptResult.rows[0].count,
        totalEmployees: empResult.rows[0].count,
        monthlyAdaptations: adaptResult.rows[0].count,
        monthlyLogins: loginsResult.rows[0].count,
      },
      topScripts: topScripts.rows,
      dailyTrend: dailyTrend.rows,
    });
  } catch (error) {
    console.error("[dashboard] 查询失败:", error);
    return NextResponse.json({ error: "查询失败" }, { status: 500 });
  }
}
