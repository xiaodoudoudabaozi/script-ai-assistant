/**
 * POST /api/scripts/upload
 *
 * 多文件剧本上传 → FastAPI解析 → 写入本地缓存 + script_files 表
 *
 * 支持：
 * - 一个剧本多个文件（DM手册、角色剧本、线索卡等）
 * - 新建（不传scriptId）和更新（传scriptId追加文件）
 * - 每文件标注类型和角色名
 * - 并发解析（最多3个）
 */

import { NextRequest, NextResponse } from "next/server";
import { writeFileCache, readAllFileTexts, md5Bytes } from "@/lib/cache";
import { pool } from "@/lib/pg";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const MAX_SIZE = 500 * 1024 * 1024; // 500MB per file
const MAX_PARSE_CONCURRENCY = 3;
const ALLOWED_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/pdf",
  "image/png",
  "image/jpeg",
]);
const VALID_FILE_TYPES = ["dm_manual", "character_script", "clue_card", "image_clue", "main_script", "ending", "other"];

// 图片格式：不需要文本解析，直接存
const IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);
function isImage(file: File): boolean {
  return IMAGE_TYPES.has(file.type) || /\.(png|jpe?g)$/i.test(file.name);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    // ---------- 1. 解析 FormData ----------
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: "无法解析表单数据" }, { status: 400 });
    }

    const scriptName = (formData.get("scriptName") as string | null)?.trim();
    const scriptId = (formData.get("scriptId") as string | null)?.trim() || crypto.randomUUID();
    const isUpdate = !!formData.get("scriptId");

    // 元数据字段
    const metadata: Record<string, any> = {};
    const metaFields = ["author", "genre", "player_count", "act_count", "difficulty", "duration", "is_sensitive", "sensitivity_note"];
    for (const f of metaFields) {
      const val = formData.get(f);
      if (val !== null) metadata[f] = val.toString().trim();
    }

    // 提取所有文件及其元数据
    // FormData 中同名 key 多次出现，用 getAll 获取数组
    const rawFiles = formData.getAll("files") as File[];
    const fileTypes = formData.getAll("fileType") as string[];
    const characterNames = formData.getAll("characterName") as string[];

    // 过滤掉空文件
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
    if (!scriptName) {
      return NextResponse.json({ error: "请填写剧本名称" }, { status: 400 });
    }
    if (fileEntries.length === 0) {
      return NextResponse.json({ error: "请至少上传一个文件" }, { status: 400 });
    }
    for (const entry of fileEntries) {
      if (entry.file.size > MAX_SIZE) {
        return NextResponse.json(
          { error: `文件 "${entry.file.name}" 超过 50MB 限制` },
          { status: 400 }
        );
      }
      if (!ALLOWED_TYPES.has(entry.file.type) && !entry.file.name.match(/\.(docx|doc|pdf|png|jpe?g)$/i)) {
        return NextResponse.json(
          { error: `文件 "${entry.file.name}" 格式不支持，仅支持 DOCX/DOC/PDF/PNG/JPG` },
          { status: 400 }
        );
      }
    }

    // ---------- 2.5 磁盘空间检查 ----------
    try {
      const { stdout } = await execAsync("df -h /data", { timeout: 3000 });
      const lines = stdout.trim().split("\n");
      if (lines.length > 1) {
        const parts = lines[1].split(/\s+/);
        const usePercent = parseInt(parts[4]);
        if (usePercent >= 95) {
          return NextResponse.json(
            { error: "磁盘空间不足，无法上传。请联系管理员清理空间。" },
            { status: 507 }
          );
        }
      }
    } catch { /* 非 Linux 环境跳过 */ }

    // ---------- 3. 创建/更新 scripts 表 ----------
    try {
      if (isUpdate) {
        await pool.query(
          `UPDATE scripts SET name = $1, updated_at = NOW() WHERE id = $2`,
          [scriptName, scriptId]
        );
      } else {
        await pool.query(
          `INSERT INTO scripts (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
          [scriptId, scriptName]
        );
      }

      // 写入元数据
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
        await pool.query(
          `UPDATE scripts SET ${metaUpdates.join(", ")} WHERE id = $${mi}`,
          metaValues
        );
      }
    } catch (dbErr) {
      console.error("[upload] 数据库写入失败:", dbErr);
      return NextResponse.json({ error: "剧本信息保存失败" }, { status: 500 });
    }

    // ---------- 4. 并发处理所有文件（MD5去重 + 最大3并发解析） ----------
    const results: {
      fileId: string; fileName: string; fileType: string; characterName: string;
      status: string; deduped?: boolean; error?: string;
    }[] = [];

    // 先计算所有文件的 MD5，检测内部重复和数据库已有重复
    const fileBuffers: { entry: typeof fileEntries[0]; buffer: Buffer; md5: string }[] = [];
    const batchMd5Seen = new Map<string, string>(); // md5 → 第一个 fileId

    for (const entry of fileEntries) {
      const buffer = Buffer.from(await entry.file.arrayBuffer());
      const md5 = md5Bytes(buffer);
      fileBuffers.push({ entry, buffer, md5 });
    }

    // 按批次处理
    for (let batch = 0; batch < fileBuffers.length; batch += MAX_PARSE_CONCURRENCY) {
      const batchItems = fileBuffers.slice(batch, batch + MAX_PARSE_CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batchItems.map(async ({ entry, buffer, md5 }) => {
          const fileId = crypto.randomUUID();

          // 1) 批次内去重：同一上传中已有相同 MD5
          if (batchMd5Seen.has(md5)) {
            const firstId = batchMd5Seen.get(md5)!;
            // 复用第一个文件的缓存路径
            const existingPath = `data/scripts/${scriptId}/files/${firstId}.txt`;
            await pool.query(
              `INSERT INTO script_files (id, script_id, file_name, file_type, character_name, cached_text_path, cache_checksum, file_size, cached_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
              [fileId, scriptId, entry.file.name, entry.fileType, entry.characterName || null, existingPath, md5, entry.file.size]
            );
            return { fileId, fileName: entry.file.name, fileType: entry.fileType, characterName: entry.characterName, status: "success", deduped: true };
          }

          // 2) 数据库去重：检查是否已有相同 MD5 的文件
          try {
            const dupCheck = await pool.query(
              `SELECT id, cached_text_path, script_id FROM script_files WHERE cache_checksum = $1 LIMIT 1`,
              [md5]
            );
            if (dupCheck.rows.length > 0) {
              const existing = dupCheck.rows[0];
              // 复用已存在的缓存
              await pool.query(
                `INSERT INTO script_files (id, script_id, file_name, file_type, character_name, cached_text_path, cache_checksum, file_size, cached_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
                [fileId, scriptId, entry.file.name, entry.fileType, entry.characterName || null, existing.cached_text_path, md5, entry.file.size]
              );
              batchMd5Seen.set(md5, fileId);
              return { fileId, fileName: entry.file.name, fileType: entry.fileType, characterName: entry.characterName, status: "success", deduped: true };
            }
          } catch { /* dedup check failed, continue to parse */ }

          // 3) 所有文件统一走 FastAPI 解析（图片用PaddleOCR，PDF/DOCX正常）
          {
            const apiFormData = new FormData();
            const blob = new Blob([buffer], { type: entry.file.type });
            apiFormData.append("file", blob, entry.file.name);

            const isImageFile = isImage(entry.file);
            // PDF（尤其扫描版OCR）可能很慢，给10分钟超时
            const pdfTimeout = 600_000; // 10分钟
            const imageTimeout = 120_000; // 2分钟
            const timeout = isImageFile ? imageTimeout : pdfTimeout;
            const resp = await fetch(`${API_BASE}/parse`, {
              method: "POST",
              body: apiFormData,
              signal: AbortSignal.timeout(timeout),
            });

            if (!resp.ok) {
              const body = await resp.json().catch(() => ({}));
              throw new Error(`解析错误: ${body.detail ?? resp.statusText}`);
            }

            const data = await resp.json();
            if (data.status !== "success") {
              throw new Error(`解析失败: ${data.detail ?? "未知错误"}`);
            }

            // 空文本 → 替换为警告
            let finalText = data.text;
            if (!finalText || !finalText.trim()) {
              finalText = isImageFile
                ? `[线索图片] ${entry.file.name}\nPaddleOCR未识别到文字，图片可能为纯图或低清晰度。`
                : `[解析警告] ${entry.file.name}\n⚠️ 此文件未能提取到文字内容。可能原因：PDF为扫描版（图片组成），或文件格式异常。`;
            }

            // 图片同时保存原图
            if (isImageFile) {
              const safeName = path.basename(entry.file.name);
              const imgDir = path.join(process.cwd(), "data", "scripts", scriptId, "images");
              await fs.mkdir(imgDir, { recursive: true });
              await fs.writeFile(path.join(imgDir, `${fileId}_${safeName}`), buffer);
            }

            // 写入文件缓存
            await writeFileCache(scriptId, fileId, finalText, md5, {
              fileName: entry.file.name,
              fileType: entry.fileType,
              characterName: entry.characterName,
            });
          }

          // 写入 script_files 表
          const cachePath = `data/scripts/${scriptId}/files/${fileId}.txt`;
          await pool.query(
            `INSERT INTO script_files (id, script_id, file_name, file_type, character_name, cached_text_path, cache_checksum, file_size, cached_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
            [fileId, scriptId, entry.file.name, entry.fileType, entry.characterName || null, cachePath, md5, entry.file.size]
          );

          batchMd5Seen.set(md5, fileId);
          return { fileId, fileName: entry.file.name, fileType: entry.fileType, characterName: entry.characterName, status: "success" };
        })
      );

      for (const r of batchResults) {
        if (r.status === "fulfilled") {
          results.push(r.value);
        } else {
          results.push({
            fileId: "",
            fileName: "",
            fileType: "",
            characterName: "",
            status: "error",
            error: r.reason instanceof Error ? r.reason.message : "解析失败",
          });
        }
      }
    }

    const successCount = results.filter(r => r.status === "success").length;
    const dedupCount = results.filter(r => r.deduped).length;
    const failCount = results.filter(r => r.status === "error").length;

    // 清除 QA 缓存
    if (successCount > 0) {
      pool.query("DELETE FROM qa_cache WHERE script_id = $1::uuid", [scriptId]).catch(() => {});
    }

    // ---------- 5. 返回结果 ----------
    let summary = `${successCount} 个文件上传成功`;
    if (dedupCount > 0) summary += `（${dedupCount} 个内容重复已合并）`;
    if (failCount > 0) summary += `，${failCount} 个失败`;

    return NextResponse.json(
      {
        id: scriptId,
        name: scriptName,
        isUpdate,
        files: results,
        summary,
        stats: { total: fileEntries.length, success: successCount, deduped: dedupCount, failed: failCount },
      },
      { status: successCount > 0 ? 201 : 502 }
    );
  } catch (err: unknown) {
    console.error("[upload] 未知错误:", err);
    return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
  }
}
