// 把 API 能力挂到消息总线：UI 永远通过消息调用，不直接 import shared/api（依赖方向硬规矩）。
import { createClient } from '../shared/api/client.js';
import { register } from './messaging.js';
import { guard } from './gatekeeper.js';
import { getToken, setToken, getDeviceId, get, set, remove } from '../shared/platform/storage.js';
import { STORAGE_KEYS, ERROR_CODE } from '../shared/core/constants.js';
import { validateLoginInput, isPasswordSane } from '../shared/core/auth.js';
import { textToHtml } from '../shared/core/memo.js';
import { logger } from '../shared/platform/logger.js';

/** 生产环境客户端：注入真实 fetch 与 storage 读取器 */
export function buildClient() {
  return createClient({
    fetchImpl: (...a) => fetch(...a),
    tokenProvider: () => getToken(),
    deviceIdProvider: () => getDeviceId(),
    onLog: (level, scope, message, detail) => logger[level]?.(scope, message, detail),
  });
}

export const client = buildClient();

function notify(opts) {
  try {
    chrome.notifications?.create({ type: 'basic', iconUrl: 'icon-48.png', ...opts });
  } catch (e) {
    logger.warn('api-proxy', 'notify failed', { message: e?.message });
  }
}

register('auth_login', async ({ email, password }) => {
  const v = validateLoginInput(email, password);
  if (!v.ok) return { ok: false, error: ERROR_CODE.VALIDATION_ERROR, message: v.reason };
  if (!isPasswordSane(v.password)) {
    return { ok: false, error: ERROR_CODE.VALIDATION_ERROR, message: 'password_too_long' };
  }
  const res = await client.login(v.email, v.password);
  if (res.ok) {
    await setToken(res.data.token);
    if (res.data.user) await set({ [STORAGE_KEYS.USER]: res.data.user });
    logger.info('api-proxy', 'login ok');
    return { ok: true, data: { user: res.data.user ?? null } };
  }
  // 失败：原文透传服务端提示（R2-1：不翻译、不改写）
  return res;
});

register('auth_logout', async () => {
  await setToken(null);
  await remove(STORAGE_KEYS.USER);
  return { ok: true, data: { loggedOut: true } };
});

register('auth_status', async () => {
  const { [STORAGE_KEYS.TOKEN]: token, [STORAGE_KEYS.USER]: user } = await get([
    STORAGE_KEYS.TOKEN,
    STORAGE_KEYS.USER,
  ]);
  return { ok: true, data: { loggedIn: Boolean(token), user: user ?? null } };
});

register('api_me', async () => guard(() => client.me(), { notifier: notify }));

/**
 * 创建笔记。文本 → HTML（先转义再包 <p>，保证纯文本化显示能还原原文）。
 * ⚠️ 返回的 slugResolved=false 表示创建成功但响应里没有 slug → 上层不应提供撤销（审计 L3）。
 */
register('memo_create', async ({ text, withSource, source }) => {
  const body = withSource && source?.url ? `${text}\n${source.title} ${source.url}` : text;
  return guard(() => client.createMemo(textToHtml(body)), { notifier: notify });
});

register('memo_delete', async ({ slug }) => {
  if (!slug) return { ok: false, error: ERROR_CODE.VALIDATION_ERROR, message: 'slug required' };
  return guard(() => client.deleteMemo(slug), { notifier: notify });
});

register('memo_get', async ({ slug }) => {
  if (!slug) return { ok: false, error: ERROR_CODE.VALIDATION_ERROR, message: 'slug required' };
  return guard(() => client.getMemo(slug), { notifier: notify });
});

/**
 * 同步分页（P3 会接上 IndexedDB 与游标；此处先返回原始数据）。
 */
register('sync_page', async ({ cursor = {}, limit = 200 }) =>
  guard(() => client.updatedMemos(cursor, limit), { notifier: notify }),
);

register('review_today', async () => guard(() => client.notifyOfToday(), { notifier: notify }));

register('memo_recommended', async ({ slug, type = 1 }) => {
  if (!slug) return { ok: false, error: ERROR_CODE.VALIDATION_ERROR, message: 'slug required' };
  return guard(() => client.recommended(slug, type), { notifier: notify });
});

/**
 * 诊断用：登录并打印创建响应的**完整结构**，用于验证审计 L3（PUT /memo 是否返回 slug）。
 * 生产环境不会调用；保留它便于真机排查。
 */
register('debug_probe_create', async ({ email, password, text = 'flomo-extension 探针笔记' }) => {
  const probe = createClient({
    fetchImpl: (...a) => fetch(...a),
    tokenProvider: async () => (await client.login(email, password))?.data?.token ?? null,
    deviceIdProvider: () => getDeviceId(),
  });
  const loginRes = await client.login(email, password);
  if (!loginRes.ok) return loginRes;
  await setToken(loginRes.data.token);
  const createRes = await probe.createMemo(textToHtml(text));
  return {
    ok: createRes.ok,
    data: {
      loginKeys: Object.keys(loginRes.data ?? {}),
      createRaw: createRes.data?.raw ?? null,
      slug: createRes.data?.slug ?? null,
      slugResolved: createRes.data?.slugResolved ?? false,
    },
  };
});
