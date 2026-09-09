// 重试策略：纯函数，不碰网络、不 sleep（sleep 由调用方注入）。
// 口径：仅网络类错误重试（指数退避，最多 3 次：2s/4s/8s）；API 业务错误一律不重试。
import { ERROR_CODE, RETRY_MAX, RETRY_BASE_MS, RATE_LIMIT_BACKOFF_MS } from '../core/constants.js';

export function isRetryableError(code) {
  return code === ERROR_CODE.NETWORK_ERROR || code === ERROR_CODE.TIMEOUT;
}

/** 第 attempt 次（从 1 开始）失败后的等待毫秒数 */
export function backoffMs(attempt) {
  if (attempt < 1) return 0;
  return RETRY_BASE_MS * Math.pow(2, attempt - 1);
}

export function shouldRetry(code, attempt) {
  return isRetryableError(code) && attempt < RETRY_MAX;
}

/** 限流的退避更久，且期间应暂停定时同步 */
export function rateLimitBackoffMs() {
  return RATE_LIMIT_BACKOFF_MS;
}

/**
 * 执行带重试的异步操作。
 * @param fn 每次尝试返回 { ok, error } 形状的 Promise
 * @param opts.sleep 注入的等待函数（测试可传立即返回）
 * @param opts.onRetry 可选回调（记录日志）
 */
export async function withRetry(fn, { sleep, onRetry } = {}) {
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let attempt = 0;
  let last = null;
  while (attempt < RETRY_MAX) {
    attempt += 1;
    last = await fn(attempt);
    if (last?.ok === true) return last;
    if (last?.ok === false && !isRetryableError(last.error)) return last;
    if (attempt >= RETRY_MAX) return last;
    const ms = backoffMs(attempt);
    onRetry?.({ attempt, delayMs: ms, error: last?.error });
    await wait(ms);
  }
  return last;
}
