/**
 * 并发控制器 — 限制同时执行的LLM请求数
 * 规格文档2.3节：最大5并发，排队超时60秒，429自动重试
 */

const MAX_CONCURRENT = 5;
const QUEUE_TIMEOUT = 60_000; // 60秒
const RETRY_DELAY = 5_000; // 429重试等待5秒

interface QueueItem {
  resolve: () => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let running = 0;
const waitingQueue: QueueItem[] = [];

function release() {
  if (waitingQueue.length > 0 && running < MAX_CONCURRENT) {
    const next = waitingQueue.shift()!;
    clearTimeout(next.timer);
    running++;
    next.resolve();
  }
}

/**
 * 获取执行许可，超过并发上限则排队等待
 */
export function acquire(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (running < MAX_CONCURRENT) {
      running++;
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      const idx = waitingQueue.findIndex(item => item.resolve === releaseSlot);
      if (idx !== -1) waitingQueue.splice(idx, 1);
      reject(new Error("AI 服务繁忙，请稍后重试"));
    }, QUEUE_TIMEOUT);

    const releaseSlot = () => resolve();
    waitingQueue.push({ resolve: releaseSlot, reject, timer });
  });
}

/**
 * 释放执行许可
 */
export function releaseSlot(): void {
  running--;
  release();
}

/**
 * 带并发控制的fetch（自动429重试）
 */
export async function controlledFetch(
  url: string,
  options: RequestInit,
  retries = 1
): Promise<Response> {
  await acquire();
  try {
    const resp = await fetch(url, options);

    // 429限流：等待5秒后重试1次
    if (resp.status === 429 && retries > 0) {
      console.warn("[concurrency] 收到429，5秒后重试...");
      await new Promise(r => setTimeout(r, RETRY_DELAY));
      return controlledFetch(url, options, retries - 1);
    }

    return resp;
  } catch (err) {
    throw err;
  } finally {
    releaseSlot();
  }
}