// 把关中枢（Gatekeeper）：API 客户端的唯一调用入口。
// 集中三件事，避免每个调用点各写一遍：① 登录态检查 ② 错误归一 ③ 认证失效的统一处理。
// P1 版：只做登录态与认证失效处理；P2 补齐请求串行队列与限流退避。
import { ERROR_CODE } from '../shared/core/constants.js';
import { isLoggedIn, decideAuthAction } from '../shared/core/auth.js';
import { getToken, setToken } from '../shared/platform/storage.js';
import { logger } from '../shared/platform/logger.js';

/** 清 token + 通知用户（通知由注入的 notifier 执行，便于测试） */
async function handleAuthExpired({ notifier } = {}) {
  await setToken(null);
  logger.warn('gatekeeper', 'token expired, cleared');
  try {
    notifier?.({
      title: 'flomo 登录已失效',
      message: '点击重新登录',
      onClick: () => chrome.runtime.openOptionsPage(),
    });
  } catch (e) {
    logger.warn('gatekeeper', 'notify failed', { message: e?.message });
  }
}

/**
 * 包装一次 API 调用：前置登录态检查 → 执行 → 认证失效统一处理。
 * @param {Function} fn (token) => Promise<envelope>
 * @param {object} opts { requireAuth = true, notifier }
 */
export async function guard(fn, { requireAuth = true, notifier } = {}) {
  if (requireAuth) {
    const token = await getToken();
    if (!isLoggedIn(token)) {
      return { ok: false, error: ERROR_CODE.NOT_AUTHENTICATED, message: 'not signed in' };
    }
  }
  const res = await fn();
  if (res && res.ok === false && res.error === ERROR_CODE.NOT_AUTHENTICATED) {
    await handleAuthExpired({ notifier });
  }
  return res;
}

export { decideAuthAction, isLoggedIn };
