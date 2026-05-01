/**
 * cache.ts - 本地缓存读写 + MD5 校验
 * 缓存路径: /data/scripts/{id}/parsed.txt
 */

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

export const DATA_ROOT = path.join(process.cwd(), "data", "scripts");

interface CacheEntry {
  text: string;
  md5: string;
  cachedAt: string; // ISO 时间戳
}

/**
 * 计算字符串的 MD5（小写 hex）
 */
export function md5(str: string): string {
  return crypto.createHash("md5").update(str).digest("hex");
}

/**
 * 计算字节内容的 MD5
 */
export function md5Bytes(buf: Buffer): string {
  return crypto.createHash("md5").update(buf).digest("hex");
}

/**
 * 获取剧本缓存目录路径
 */
function cacheDir(id: string): string {
  return path.join(DATA_ROOT, id);
}

/**
 * 读取解析后的纯文本（来自本地缓存）
 * @param id 剧本 ID
 * @param expectedMd5 期望的 MD5（用于校验文件是否损坏，可选）
 * @returns 纯文本内容，或 null（文件不存在或校验失败）
 */
export async function readCache(
  id: string,
  expectedMd5?: string
): Promise<string | null> {
  const filePath = path.join(cacheDir(id), "parsed.txt");
  try {
    const content = await fs.readFile(filePath, "utf-8");

    // 检测损坏：非空文件内容为空串或全是不可见字符
    if (!content || !content.trim()) {
      return null;
    }

    // MD5 校验
    if (expectedMd5) {
      const actualMd5 = md5(content);
      if (actualMd5 !== expectedMd5.toLowerCase()) {
        console.warn(`[cache] MD5 不匹配，已损坏，跳过缓存: ${id}`);
        return null;
      }
    }

    return content;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return null; // 文件不存在，正常情况
    }
    throw err; // 其他错误（权限等）抛出
  }
}

/**
 * 写入解析后的纯文本到本地缓存
 * @param id       剧本 ID
 * @param text     纯文本内容
 * @param fileMd5  文件原始 MD5（存入 meta.json）
 */
export async function writeCache(
  id: string,
  text: string,
  fileMd5?: string
): Promise<void> {
  const dir = cacheDir(id);
  await fs.mkdir(dir, { recursive: true });

  // 写入解析后文本
  const textPath = path.join(dir, "parsed.txt");
  await fs.writeFile(textPath, text, "utf-8");

  // 写入元数据（包含原始文件 MD5，便于后续校验）
  const meta: CacheEntry = {
    text, // 实际不需要存这里，仅做备份
    md5: fileMd5 ?? md5(text),
    cachedAt: new Date().toISOString(),
  };
  const metaPath = path.join(dir, "meta.json");
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

/**
 * 删除剧本缓存目录
 */
export async function deleteCache(id: string): Promise<void> {
  const dir = cacheDir(id);
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * 检查缓存是否存在且有效
 */
export async function cacheExists(id: string): Promise<boolean> {
  const filePath = path.join(cacheDir(id), "parsed.txt");
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ── 多文件缓存（v1.1） ──

function fileCacheDir(scriptId: string): string {
  return path.join(DATA_ROOT, scriptId, "files");
}

interface FileMeta {
  fileName: string;
  fileType: string;
  characterName: string;
  md5: string;
  cachedAt: string;
}

/**
 * 写入单个文件的解析缓存
 * 路径: /data/scripts/{scriptId}/files/{fileId}.txt + .meta
 */
export async function writeFileCache(
  scriptId: string,
  fileId: string,
  text: string,
  fileMd5?: string,
  metaExtra?: { fileName?: string; fileType?: string; characterName?: string }
): Promise<void> {
  const dir = fileCacheDir(scriptId);
  await fs.mkdir(dir, { recursive: true });

  const textPath = path.join(dir, `${fileId}.txt`);
  await fs.writeFile(textPath, text, "utf-8");

  const meta: FileMeta = {
    fileName: metaExtra?.fileName || "",
    fileType: metaExtra?.fileType || "",
    characterName: metaExtra?.characterName || "",
    md5: fileMd5 ?? md5(text),
    cachedAt: new Date().toISOString(),
  };
  const metaPath = path.join(dir, `${fileId}.meta`);
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

/**
 * 读取单个文件的解析缓存
 */
export async function readFileCache(
  scriptId: string,
  fileId: string
): Promise<string | null> {
  const textPath = path.join(fileCacheDir(scriptId), `${fileId}.txt`);
  try {
    const content = await fs.readFile(textPath, "utf-8");
    if (!content || !content.trim()) return null;
    return content;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

/**
 * 读取剧本所有文件的拼接文本（问答用）
 *
 * 拼接格式:
 *   【DM手册 · 文件名】
 *   {文本}
 *   【角色剧本 · 角色名 · 文件名】
 *   {文本}
 *   ...
 *
 * @param scriptId 剧本ID
 * @param characterFilter 可选角色名。指定后只包含该角色的剧本+DM手册+主剧本+线索卡+结局，过滤其他角色剧本
 */
export async function readAllFileTexts(
  scriptId: string,
  characterFilter?: string
): Promise<{ text: string; fileCount: number; filteredCount: number }> {
  const filesDir = fileCacheDir(scriptId);
  let fileIds: string[] = [];
  try {
    const entries = await fs.readdir(filesDir);
    const seen = new Set<string>();
    for (const e of entries) {
      if (e.endsWith(".txt")) {
        const id = e.replace(/\.txt$/, "");
        if (!seen.has(id)) { seen.add(id); fileIds.push(id); }
      }
    }
  } catch { fileIds = []; }

  let filteredCount = 0;

  if (fileIds.length > 0) {
    const parts: string[] = [];
    for (const fid of fileIds) {
      let meta: FileMeta = { fileName: "", fileType: "other", characterName: "", md5: "", cachedAt: "" };
      try {
        const metaRaw = await fs.readFile(path.join(filesDir, `${fid}.meta`), "utf-8");
        meta = JSON.parse(metaRaw);
      } catch { /* meta may not exist */ }

      // 角色过滤：只看该角色剧本 + 公共文件
      if (characterFilter) {
        const ft = meta.fileType;
        const cn = meta.characterName;
        const isPublic = !ft || ft === "dm_manual" || ft === "main_script" || ft === "clue_card" || ft === "image_clue" || ft === "ending" || ft === "other";
        const isMyCharacter = ft === "character_script" && cn === characterFilter;
        if (!isPublic && !isMyCharacter) {
          filteredCount++;
          continue;
        }
      }

      const text = await readFileCache(scriptId, fid);
      if (!text) continue;

      const label = buildFileLabel(meta.fileType, meta.characterName, meta.fileName);
      parts.push(`${label}\n${text}`);
    }
    if (parts.length > 0) {
      return { text: parts.join("\n\n"), fileCount: parts.length, filteredCount };
    }
  }

  // 回退：旧单文件缓存（不支持过滤）
  const legacy = await readCache(scriptId);
  if (legacy) {
    return { text: `【剧本全文】\n${legacy}`, fileCount: 1, filteredCount: 0 };
  }

  return { text: "", fileCount: 0, filteredCount: 0 };
}

function buildFileLabel(fileType: string, characterName: string, fileName: string): string {
  const typeLabel: Record<string, string> = {
    dm_manual: "DM手册",
    character_script: "角色剧本",
    clue_card: "线索卡",
    image_clue: "图片线索",
    main_script: "主剧本",
    ending: "结局/返场",
    other: "其他",
  };
  const type = typeLabel[fileType] || fileType;
  const name = fileName ? ` · ${fileName}` : "";
  if (characterName) {
    return `【${type} · ${characterName}${name}】`;
  }
  return `【${type}${name}】`;
}

/**
 * 删除单个文件的缓存
 */
export async function deleteFileCache(scriptId: string, fileId: string): Promise<void> {
  const dir = fileCacheDir(scriptId);
  await fs.rm(path.join(dir, `${fileId}.txt`), { force: true });
  await fs.rm(path.join(dir, `${fileId}.meta`), { force: true });
}

/**
 * 删除剧本的所有文件缓存
 */
export async function deleteAllFileCaches(scriptId: string): Promise<void> {
  const dir = fileCacheDir(scriptId);
  await fs.rm(dir, { recursive: true, force: true });
  // 同时清理旧的单文件缓存
  await deleteCache(scriptId);
}
