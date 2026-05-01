/**
 * parse.ts - 解析逻辑（调用 FastAPI + 回退本地缓存）
 *
 * 流程:
 *   1. 检查本地缓存 → 有 → 直接返回
 *   2. 无 → 调用 /parse 接口 → 写入本地缓存 → 返回
 */

import { readCache, writeCache, md5Bytes } from "./cache";

// FastAPI 服务地址（开发环境）
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface ParseResult {
  text: string;
  source: "cache" | "api";
  md5: string;
  fromCache: boolean;
}

/**
 * 解析剧本文件
 *
 * @param file        原始文件（File 或 Buffer）
 * @param filename    文件名（用于 API 判断类型）
 * @param scriptId    剧本 ID（用于缓存目录命名）
 * @param forceRefresh  强制重新解析，忽略缓存
 */
export async function parseScript(
  file: File | Buffer,
  filename: string,
  scriptId: string,
  forceRefresh = false
): Promise<ParseResult> {
  // ---------- 1. 尝试读缓存 ----------
  if (!forceRefresh) {
    const cached = await readCache(scriptId);
    if (cached !== null) {
      return { text: cached, source: "cache", md5: "", fromCache: true };
    }
  }

  // ---------- 2. 计算 MD5（用于后续校验） ----------
  const contentBuffer = file instanceof File ? Buffer.from(await file.arrayBuffer()) : file;
  const fileMd5 = md5Bytes(contentBuffer);

  // ---------- 3. 调用 FastAPI /parse ----------
  const formData = new FormData();
  const blob = new Blob([contentBuffer]);
  formData.append("file", blob, filename);

  let text: string;
  let apiMd5: string;

  try {
    const resp = await fetch(`${API_BASE}/parse`, {
      method: "POST",
      body: formData,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(`API 错误 ${resp.status}: ${err.detail ?? resp.statusText}`);
    }

    const data = await resp.json();
    if (data.status !== "success") {
      throw new Error(`解析失败: ${data.detail ?? "未知错误"}`);
    }
    text = data.text;
    apiMd5 = data.md5;
  } catch (err: unknown) {
    // 网络错误 / 服务不可用 → 透传，让上层决定如何处理
    throw err;
  }

  // ---------- 4. 写入本地缓存 ----------
  await writeCache(scriptId, text, fileMd5);

  return { text, source: "api", md5: apiMd5, fromCache: false };
}

/**
 * 检查 API 服务是否可用（健康检查）
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const resp = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}
