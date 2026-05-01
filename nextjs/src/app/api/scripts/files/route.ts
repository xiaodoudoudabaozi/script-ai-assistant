/**
 * GET  /api/scripts/files?scriptId=X — 列出剧本的所有文件
 * POST /api/scripts/files            — 为已有剧本追加文件 (FormData: scriptId, file, fileType, characterName)
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";
import { writeFileCache, md5Bytes } from "@/lib/cache";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const MAX_SIZE = 500 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/pdf",
  "image/png",
  "image/jpeg",
]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);
const VALID_FILE_TYPES = ["dm_manual", "character_script", "clue_card", "image_clue", "main_script", "ending", "other"];

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET — 列出剧本的所有文件
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const scriptId = searchParams.get("scriptId");
    if (!scriptId) return NextResponse.json({ error: "缺少 scriptId" }, { status: 400 });

    const result = await pool.query(
      `SELECT id, script_id, file_name, file_type, character_name, file_size, cached_at, created_at
       FROM script_files WHERE script_id = $1 ORDER BY created_at ASC`,
      [scriptId]
    );

    return NextResponse.json({ files: result.rows });
  } catch (error) {
    console.error("[files] 查询失败:", error);
    return NextResponse.json({ error: "查询失败" }, { status: 500 });
  }
}

// POST — 追加文件到已有剧本
export async function POST(request: NextRequest) {
  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "无法解析表单数据" }, { status: 400 });
    }

    const scriptId = (formData.get("scriptId") as string | null)?.trim();
    const file = formData.get("file") as File | null;
    const fileType = (formData.get("fileType") as string | null) || "other";
    const characterName = (formData.get("characterName") as string | null)?.trim() || "";

    if (!scriptId) return NextResponse.json({ error: "缺少 scriptId" }, { status: 400 });
    if (!file || file.size === 0) return NextResponse.json({ error: "请上传文件" }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "文件超过 50MB 限制" }, { status: 400 });
    if (!ALLOWED_TYPES.has(file.type) && !file.name.match(/\.(docx|doc|pdf|png|jpe?g)$/i)) {
      return NextResponse.json({ error: "仅支持 DOCX/DOC/PDF/PNG/JPG 格式" }, { status: 400 });
    }

    // 验证剧本存在
    const scriptCheck = await pool.query("SELECT id FROM scripts WHERE id = $1", [scriptId]);
    if (scriptCheck.rows.length === 0) {
      return NextResponse.json({ error: "剧本不存在" }, { status: 404 });
    }

    const fileId = crypto.randomUUID();
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const fileMd5 = md5Bytes(fileBuffer);

    // 统一走 FastAPI 解析（图片用PaddleOCR，PDF/DOCX正常）
    const validType = VALID_FILE_TYPES.includes(fileType) ? fileType : "other";
    const isImg = IMAGE_TYPES.has(file.type) || /\.(png|jpe?g)$/i.test(file.name);

    const apiFormData = new FormData();
    const blob = new Blob([fileBuffer], { type: file.type });
    apiFormData.append("file", blob, file.name);

    let parsedText: string;
    try {
      const resp = await fetch(`${API_BASE}/parse`, {
        method: "POST",
        body: apiFormData,
        signal: AbortSignal.timeout(isImg ? 120_000 : 600_000),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        return NextResponse.json({ error: `解析错误: ${body.detail ?? resp.statusText}` }, { status: 502 });
      }
      const data = await resp.json();
      if (data.status !== "success") {
        return NextResponse.json({ error: `解析失败: ${data.detail ?? "未知错误"}` }, { status: 502 });
      }
      parsedText = data.text;
      if (!parsedText || !parsedText.trim()) {
        parsedText = isImg
          ? `[线索图片] ${file.name}\nPaddleOCR未识别到文字。`
          : `[解析警告] ${file.name}\n⚠️ 此文件未能提取到文字内容。可能为扫描版。`;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `无法连接解析服务: ${msg}` }, { status: 503 });
    }

    // 图片同时保存原图
    if (isImg) {
      const safeName = path.basename(file.name);
      const imgDir = path.join(process.cwd(), "data", "scripts", scriptId, "images");
      await fs.mkdir(imgDir, { recursive: true });
      await fs.writeFile(path.join(imgDir, `${fileId}_${safeName}`), fileBuffer);
    }

    // 写入本地缓存 + script_files 表
    await writeFileCache(scriptId, fileId, parsedText, fileMd5, {
      fileName: file.name,
      fileType: validType,
      characterName: characterName,
    });

    const cachePath = `data/scripts/${scriptId}/files/${fileId}.txt`;
    await pool.query(
      `INSERT INTO script_files (id, script_id, file_name, file_type, character_name, cached_text_path, cache_checksum, file_size, cached_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [fileId, scriptId, file.name, validType, characterName || null, cachePath, fileMd5, file.size]
    );

    // 更新剧本时间戳
    await pool.query("UPDATE scripts SET updated_at = NOW() WHERE id = $1", [scriptId]);

    return NextResponse.json(
      { id: fileId, file_name: file.name, file_type: validType, character_name: characterName || null, status: "success" },
      { status: 201 }
    );
  } catch (error) {
    console.error("[files] 追加文件失败:", error);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
