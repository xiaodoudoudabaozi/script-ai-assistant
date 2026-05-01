/**
 * GET /api/system/disk
 *
 * 磁盘空间监控（规格文档3.3节 / 7.3节）
 * 80% 告警 / 95% 阻止上传
 * 仅管理员可访问
 */

import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

function getUser(req: NextRequest) {
  const h = req.headers.get("x-user-data");
  if (!h) return null;
  try { return JSON.parse(h); } catch { return null; }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

    let diskInfo: {
      filesystem: string;
      size: string;
      used: string;
      available: string;
      usePercent: number;
      mountedOn: string;
    } | null = null;

    try {
      // Linux / Docker 环境
      const { stdout } = await execAsync("df -h /data", { timeout: 5000 });
      const lines = stdout.trim().split("\n");
      if (lines.length > 1) {
        const parts = lines[1].split(/\s+/);
        diskInfo = {
          filesystem: parts[0],
          size: parts[1],
          used: parts[2],
          available: parts[3],
          usePercent: parseInt(parts[4]),
          mountedOn: parts[5],
        };
      }
    } catch {
      // df 命令不可用（非 Linux 环境），返回 null
    }

    // Fallback: 检查 data/scripts 目录大小
    let scriptsSize = 0;
    try {
      const { stdout: duOutput } = await execAsync(
        'du -sb data/scripts 2>/dev/null || du -sb /data/scripts 2>/dev/null || echo "0"',
        { timeout: 5000 }
      );
      scriptsSize = parseInt(duOutput.split(/\s+/)[0]) || 0;
    } catch {
      // ignore
    }

    const usePercent = diskInfo?.usePercent ?? 0;
    const warning = usePercent >= 95 ? "critical" : usePercent >= 80 ? "warning" : "ok";

    return NextResponse.json({
      disk: diskInfo,
      scriptsSize,
      usePercent,
      warning,
      message:
        warning === "critical"
          ? "磁盘空间严重不足（≥95%），已阻止新剧本上传。请管理员清理空间。"
          : warning === "warning"
            ? "磁盘使用率超过 80%，建议清理空间。"
            : null,
    });
  } catch (error) {
    console.error("磁盘检查失败:", error);
    return NextResponse.json({ error: "检查失败" }, { status: 500 });
  }
}
