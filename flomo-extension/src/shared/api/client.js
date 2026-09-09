// API 客户端：签名 → 请求 → 响应解析 → 错误归一。
// 严格对齐 flomo-cli client.py（已验证可工作的实现）。
//
// 三个最容易错、且错了必然 401/签名失败 的点：
//   1. 每个请求必须带 **timestamp**（秒级时间戳，参与签名）
//   2. 签名串拼接是 "&".join(parts) + SECRET —— 末尾**没有**多余的 &
//   3. POST/PUT 用 **JSON body**（不是 form-urlencoded）；GET/DELETE 用 query
//
// fetch / token / deviceId / now / sleep 全部外部注入，生产与测试共用同一份代码。
import { buildFixedParams, buildRequest, buildUrl } from './endpoints.js';
import { buildSignedParams } from '../core/sign.js';
import { mapApiCode, isContractBroken, toEnvelopeError, toEnvelopeOk } from '../core/errors.js';
import {
  ERROR_CODE,
  REQUEST_TIMEOUT_MS,
  FAKE_USER_AGENT,
  HEADER_PLATFORM,
  HEADER_DEVICE_MODEL,
  TZ,
} from '../core/constants.js';
import { withRetry } from './retry.js';

/**
 * @param {object} deps
 * @param {Function} deps.fetchImpl 注入的 fetch（默认 globalThis.fetch）
 * @param {Function} deps.tokenProvider () => Promise<string|null> 每次现读，不缓存
 * @param {Function} deps.deviceIdProvider () => Promise<string>
 * @param {Function} deps.now () => number 当前毫秒（测试可固定，便于断言签名）
 * @param {Function} deps.sleep (ms) => Promise
 * @param {Function} deps.onLog (level, scope, message, detail) => void
 */
export function createClient(deps = {}) {
  const {
    fetchImpl = (...a) => globalThis.fetch(...a),
    tokenProvider = async () => null,
    deviceIdProvider = async () => '',
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    onLog = () => {},
    baseUrl,
  } = deps;

  async function buildHeaders({ withAuth, hasBody }) {
    const headers = {
      platform: HEADER_PLATFORM,
      'device-model': HEADER_DEVICE_MODEL,
      'User-Agent': FAKE_USER_AGENT,
    };
    if (hasBody) headers['Content-Type'] = 'application/json';
    // device-id 必须持久化复用：每次随机会让服务端认为"不断换设备"，易触发风控
    const deviceId = await deviceIdProvider();
    if (deviceId) headers['device-id'] = deviceId;
    if (withAuth) {
      const token = await tokenProvider();
      headers['Authorization'] = token ? `Bearer ${token}` : 'Bearer ';
    }
    return headers;
  }

  /** 单次尝试：构造 → 请求 → 解析 */
  async function attempt(endpointName, options = {}) {
    const { pathParams, params, withAuth = true, timeoutMs = REQUEST_TIMEOUT_MS } = options;
    const req = buildRequest(endpointName, { pathParams, params });
    // timestamp 每次重新生成（参与签名，写死会失败）
    const signed = buildSignedParams(req.businessParams, buildFixedParams(now()));
    const url = buildUrl(req.path, baseUrl);

    // 对齐 CLI：PUT/POST 走 JSON body；GET/DELETE 走 query
    const useBody = req.method === 'POST' || req.method === 'PUT';

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      let finalUrl = url;
      const init = { method: req.method, headers: await buildHeaders({ withAuth, hasBody: useBody }) };
      if (controller) init.signal = controller.signal;

      if (useBody) {
        init.body = JSON.stringify(signed);
      } else {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(signed)) qs.append(k, String(v));
        finalUrl = `${url}?${qs.toString()}`;
      }

      onLog('debug', 'api', `${req.method} ${req.path}`, { endpoint: endpointName });
      const res = await fetchImpl(finalUrl, init);
      const payload = await parseBody(res);
      return handleResponse(payload, res.status);
    } catch (e) {
      const aborted = e?.name === 'AbortError';
      const code = aborted ? ERROR_CODE.TIMEOUT : ERROR_CODE.NETWORK_ERROR;
      onLog('warn', 'api', `request failed: ${req.path}`, { error: code, message: e?.message });
      return toEnvelopeError(code, e?.message || '');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 统一调用入口：带重试 */
  async function call(endpointName, options = {}) {
    return withRetry(() => attempt(endpointName, options), {
      sleep,
      onRetry: ({ attempt: n, delayMs, error }) =>
        onLog('warn', 'api', `retry #${n} in ${delayMs}ms`, { endpoint: endpointName, error }),
    });
  }

  // ---- 业务方法（参数严格对齐 CLI）----

  async function login(email, password) {
    const res = await call('login', {
      params: { email, password, wechat_union_id: '', wechat_oa_open_id: '' },
      withAuth: false,
    });
    if (!res.ok) return res;
    const token = extractToken(res.data);
    if (!token) {
      onLog('error', 'api', 'login response has no token', { keys: Object.keys(res.data || {}) });
      return toEnvelopeError(ERROR_CODE.CONTRACT_CHANGED, 'login response missing token');
    }
    return toEnvelopeOk({ token, user: res.data?.user ?? null, raw: res.data });
  }

  async function me() {
    return call('me', { params: {} });
  }

  /**
   * 创建笔记。content 需为 HTML（纯文本先转义再包 <p>）。
   * ⚠️ 审计 L3：响应是否含 slug 尚未真机验证；此处防御式提取，缺失返回 slugResolved=false。
   */
  async function createMemo(content, { createdAt } = {}) {
    const params = { content, source: 'web', tz: TZ };
    if (createdAt) params.created_at = createdAt;
    const res = await call('createMemo', { params });
    if (!res.ok) return res;
    const slug = extractSlug(res.data);
    return toEnvelopeOk({ slug, memo: res.data?.memo ?? null, raw: res.data, slugResolved: Boolean(slug) });
  }

  async function deleteMemo(slug) {
    return call('deleteMemo', { pathParams: { slug }, params: {} });
  }

  async function getMemo(slug) {
    return call('getMemo', { pathParams: { slug }, params: {} });
  }

  /**
   * 增量同步分页（对齐 CLI list_memos_ascending）。
   * 注：CLI 的 include_deleted 是**本地过滤**，不是服务端参数 —— 软删笔记在 P3 本地过滤。
   */
  async function updatedMemos(cursor = {}, limit = 200) {
    const params = {
      limit: String(limit),
      latest_updated_at: String(cursor.latest_updated_at ?? 0),
      tz: TZ,
    };
    if (cursor.latest_slug) params.latest_slug = cursor.latest_slug;
    const res = await call('updatedMemos', { params });
    if (!res.ok) return res;
    const list = extractList(res.data, ['memos', 'data']);
    return toEnvelopeOk({ memos: list, hasMore: list.length >= limit, raw: res.data });
  }

  async function latestUpdated() {
    return call('latestUpdated', { params: {} });
  }

  async function notifyOfToday() {
    return call('notifyOfToday', { params: {} });
  }

  async function recommended(slug, type = '1') {
    return call('recommended', { pathParams: { slug }, params: { type } });
  }

  async function tagTree() {
    return call('tagTree', { params: {} });
  }

  return { call, login, me, createMemo, deleteMemo, getMemo, updatedMemos, latestUpdated, notifyOfToday, recommended, tagTree };
}

// ---- 响应解析（纯逻辑，便于单测）----

async function parseBody(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { __raw: text, status: res.status };
  }
}

export function handleResponse(payload, status) {
  if (!payload || typeof payload !== 'object' || '__raw' in payload) {
    if (status === 429) return toEnvelopeError(ERROR_CODE.RATE_LIMITED, '');
    if (status >= 500) return toEnvelopeError(ERROR_CODE.API_ERROR, '');
    return toEnvelopeError(ERROR_CODE.CONTRACT_CHANGED, `non-json response (status ${status})`);
  }
  if (isContractBroken(payload)) return toEnvelopeError(ERROR_CODE.CONTRACT_CHANGED, 'response missing code');
  if (status === 429) return toEnvelopeError(ERROR_CODE.RATE_LIMITED, payload.message || '');
  const errCode = mapApiCode(payload.code, payload.message);
  if (errCode) return toEnvelopeError(errCode, payload.message || '');
  return toEnvelopeOk(payload.data ?? {});
}

/**
 * 从响应体提取列表。
 * ⚠️ 官方响应有两种形态（CLI 两种都兼容，见 client.py list_memos_ascending）：
 *    - data 直接是数组：`{code:0, data:[...]}`  ← flomo-api-analysis.md 记录的形态
 *    - data 是对象含子字段：`{code:0, data:{memos:[...]}}`
 * 早期实现只认 `data.memos`，遇到真实数组会返回空列表 —— 这个 bug 由契约回放测试发现。
 */
export function extractList(data, keys = ['memos', 'data']) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  for (const k of keys) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

/** 从登录响应提取 token：兼容多种字段位置（防御式） */
export function extractToken(data) {
  if (!data || typeof data !== 'object') return null;
  return data.access_token || data.token || data?.user?.access_token || null;
}

/** 从创建响应提取 slug：多字段兼容 + 退路标记 */
export function extractSlug(data) {
  if (!data || typeof data !== 'object') return null;
  if (typeof data.slug === 'string' && data.slug) return data.slug;
  if (data.memo && typeof data.memo.slug === 'string') return data.memo.slug;
  return null;
}
