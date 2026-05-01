/**
 * POST /api/scripts/upload
 *
 * 多文件剧本上传 → 秒收文件 → 后台异步解析 → 写入缓存 + script_files 表
 */

import { NextRequest, NextResponse } from "next/server";
import { writeFileCache, readAllFileTexts, md5Bytes } from "@/lib/cache";
import { pool } from "@/lib/pg";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const MAX_SIZE = 500 * 1024 * 1024;
const MAX_PARSE_CONCURRENCY = 5;
const ALLOWED_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/pdf",
  "image/png",
  "image/jpeg",
]);
const VALID_FILE_TYPES = ["dm_manual", "character_script", "clue_card", "image_clue", "main_script", "ending", "other"];
const IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isImageFile(file: File): boolean {
  return IMAGE_TYPES.has(file.type) || /\.(png|jpe?g)$/i.test(file.name);
}

/**
 * 后台解析单个文件并更新缓存+DB（纯 fire-and-forget，不阻塞响应）
 */
async function parseOneFile(
  scriptId: string, fileId: string, fileBuffer: Buffer,
  fileName: string, fileType: string, characterName: string, fileMd5: string
) {
  const isImg = isImageFile({ type: "", name: fileName } as any);
  let parsedText: string;

  try {
    const apiFormData = new FormData();
    const blob = new Blob([fileBuffer]);
    apiFormData.append("file", blob, fileName);

    const resp = await fetch(`${API_BASE}/parse`, {
      method: "POST", body: apiFormData,
      signal: AbortSignal.timeout(isImg ? 120_000 : 600_000),
    });

    if (!resp.ok) throw new Error(`FastAPI ${resp.status}`);
    const data = await resp.json();
    if (data.status !== "success") throw new Error("解析失败");
    parsedText = data.text;

    if (!parsedText || !parsedText.trim()) {
      parsedText = isImg
        ? `[线索图片] ${fileName}\nOCR未识别到文字。`
        : `[解析警告] ${fileName}\n未能提取到文字内容。`;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    parsedText = `[解析失败] ${fileName}\n${msg}`;
    console.error(`[upload-bg] 解析失败: ${fileName} - ${msg}`);
  }

  // 图片存原图
  if (isImg) {
    try {
      const imgDir = path.join(process.cwd(), "data", "scripts", scriptId, "images");
      await fs.mkdir(imgDir, { recursive: true });
      await fs.writeFile(path.join(imgDir, `${fileId}_${path.basename(fileName)}`), fileBuffer);
    } catch {}
  }

  // 写入缓存 + 更新DB
  try {
    await writeFileCache(scriptId, fileId, parsedText, fileMd5, { fileName, fileType, characterName });
    await pool.query(
      `UPDATE script_files SET cached_text_path = $1, cache_checksum = $2, cached_at = NOW()
       WHERE id = $3`,
      [`data/scripts/${scriptId}/files/${fileId}.txt`, fileMd5, fileId]
    );
  } catch (err) {
    console.error(`[upload-bg] 缓存写入失败: ${fileId}`, err);
  }
}

export async function POST(req: NextRequest) {
  try {
    // ---------- 1. 解析 FormData ----------
    let formData: FormData;
    try { formData = await req.formData(); } catch {
      return NextResponse.json({ error: "无法解析表单数据" }, { status: 400 });
    }

    const scriptName = (formData.get("scriptName") as string | null)?.trim();
    const scriptId = (formData.get("scriptId") as string | null)?.trim() || crypto.randomUUID();
    const isUpdate = !!formData.get("scriptId");

    const metadata: Record<string, any> = {};
    const metaFields = ["author", "genre", "player_count", "act_count", "difficulty", "duration", "is_sensitive", "sensitivity_note"];
    for (const f of metaFields) {
      const val = formData.get(f);
      if (val !== null) metadata[f] = val.toString().trim();
    }

    const rawFiles = formData.getAll("files") as File[];
    const fileTypes = formData.getAll("fileType") as string[];
    const characterNames = formData.getAll("characterName") as string[];

    const fileEntries: { file: File; fileType: string; characterName: string }[] = [];
    for (let i = 0; i < rawFiles.length; i++) {
      const f = rawFiles[i];
      if (!f || f.size === 0) continue;
      fileEntries.push({
        file: f,
        fileType: VALID_FILE_TYPES.includes(fileTypes[i]) ? fileTypes[i] : "other",
        characterName: (characterNames[i] || "").trim(),
      });
    }

    // ---------- 2. 参数校验 ----------
    if (!scriptName) return NextResponse.json({ error: "请填写剧本名称" }, { status: 400 });
    if (fileEntries.length === 0) return NextResponse.json({ error: "请至少上传一个文件" }, { status: 400 });
    for (const entry of fileEntries) {
      if (entry.file.size > MAX_SIZE)
        return NextResponse.json({ error: `"${entry.file.name}" 超过 500MB 限制` }, { status: 400 });
      if (!ALLOWED_TYPES.has(entry.file.type) && !entry.file.name.match(/\.(docx|doc|pdf|png|jpe?g)$/i))
        return NextResponse.json({ error: `"${entry.file.name}" 格式不支持` }, { status: 400 });
    }

    // ---------- 3. 写入 scripts 表 ----------
    try {
      if (isUpdate) {
        await pool.query(`UPDATE scripts SET name = $1, updated_at = NOW() WHERE id = $2`, [scriptName, scriptId]);
      } else {
        await pool.query(`INSERT INTO scripts (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [scriptId, scriptName]);
      }
      const metaUpdates: string[] = [];
      const metaValues: any[] = [];
      let mi = 1;
      for (const f of metaFields) {
        if (metadata[f]) {
          metaUpdates.push(`${f} = $${mi++}`);
          metaValues.push(f === "is_sensitive" ? metadata[f] === "true" : metadata[f]);
        }
      }
      if (metaUpdates.length > 0) {
        metaUpdates.push(`updated_at = NOW()`);
        metaValues.push(scriptId);
        await pool.query(`UPDATE scripts SET ${metaUpdates.join(", ")} WHERE id = $${mi}`, metaValues);
      }
    } catch (dbErr) {
      console.error("[upload] 数据库写入失败:", dbErr);
      return NextResponse.json({ error: "剧本信息保存失败" }, { status: 500 });
    }

    // ---------- 4. 秒存文件 + 写入DB记录（不等待解析） ----------
    const batchMd5Seen = new Map<string, string>();
    const results: { fileId: string; fileName: string; status: string; deduped?: boolean }[] = [];

    for (const entry of fileEntries) {
      const fileId = crypto.randomUUID();
      const buffer = Buffer.from(await entry.file.arrayBuffer());
      const md5 = md5Bytes(buffer);

      // 去重
      if (batchMd5Seen.has(md5)) {
        const firstId = batchMd5Seen.get(md5)!;
        const existingPath = `data/scripts/${scriptId}/files/${firstId}.txt`;
        await pool.query(
          `INSERT INTO script_files (id, script_id, file_name, file_type, character_name, cached_text_path, cache_checksum, file_size, cached_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [fileId, scriptId, entry.file.name, entry.fileType, entry.characterName || null, existingPath, md5, entry.file.size]
        );
        results.push({ fileId, fileName: entry.file.name, status: "deduped" });
        continue;
      }

      try {
        const dupCheck = await pool.query(
          `SELECT id, cached_text_path FROM script_files WHERE cache_checksum = $1 LIMIT 1`, [md5]
        );
        if (dupCheck.rows.length > 0) {
          await pool.query(
            `INSERT INTO script_files (id, script_id, file_name, file_type, character_name, cached_text_path, cache_checksum, file_size, cached_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
            [fileId, scriptId, entry.file.name, entry.fileType, entry.characterName || null, dupCheck.rows[0].cached_text_path, md5, entry.file.size]
          );
          batchMd5Seen.set(md5, fileId);
          results.push({ fileId, fileName: entry.file.name, status: "deduped" });
          continue;
        }
      } catch {}

      // 插入记录（缓存路径暂空，等后台解析完填充）
      batchMd5Seen.set(md5, fileId);
      await pool.query(
        `INSERT INTO script_files (id, script_id, file_name, file_type, character_name, file_size)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [fileId, scriptId, entry.file.name, entry.fileType, entry.characterName || null, entry.file.size]
      );

      // 后台异步解析（不阻塞响应）
      const validType = VALID_FILE_TYPES.includes(entry.fileType) ? entry.fileType : "other";
      parseOneFile(scriptId, fileId, buffer, entry.file.name, validType, entry.characterName, md5);

      results.push({ fileId, fileName: entry.file.name, status: "parsing" });
    }

    // 清除 QA 缓存
    pool.query("DELETE FROM qa_cache WHERE script_id = $1::uuid", [scriptId]).catch(() => {});

    // ---------- 5. 立即返回（文件已存，后台解析中） ----------
    return NextResponse.json(
      {
        id: scriptId,
        name: scriptName,
        isUpdate,
        files: results,
        summary: `${results.length} 个文件已接收，正在后台解析`,
        stats: { total: results.length, parsing: results.filter(r => r.status === "parsing").length, deduped: results.filter(r => r.status === "deduped").length },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    console.error("[upload] 未知错误:", err);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
