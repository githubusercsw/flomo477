// 端点定义：路径 + 方法 + 基础参数。纯数据 + 纯函数，不发起请求。
// 所有端点签名时都携带 fixedParams（见 buildFixedParams），此处只声明业务参数。
import { API_BASE, API_KEY, APP_VERSION, PLATFORM, WEBP, TZ } from '../core/constants.js';

/**
 * 固定参数：每个请求都要带，且参与签名（对齐 flomo-cli client.py 的 _base_params）。
 *
 * ⚠️ 必须包含 **timestamp**（秒级 Unix 时间戳，字符串）—— 缺失时服务端直接返回「请传入 timestamp」。
 * ⚠️ 必须**每次请求重新生成**：它参与签名，写死会导致签名过期/重放失败。
 * ⚠️ 这里**不含 tz**：tz 只在 /memo/updated/ 与创建笔记时作为业务参数传入。
 */
export function buildFixedParams(nowMs = Date.now()) {
  return {
    timestamp: String(Math.floor(nowMs / 1000)),
    api_key: API_KEY,
    app_version: APP_VERSION,
    platform: PLATFORM,
    webp: WEBP,
  };
}

export const ENDPOINTS = {
  login: { method: 'POST', path: '/user/login_by_email' },
  me: { method: 'GET', path: '/user/me' },

  createMemo: { method: 'PUT', path: '/memo' },
  updateMemo: { method: 'PUT', path: '/memo/{slug}' },
  deleteMemo: { method: 'DELETE', path: '/memo/{slug}' },
  getMemo: { method: 'GET', path: '/memo/{slug}' },

  updatedMemos: { method: 'GET', path: '/memo/updated/' },
  latestUpdated: { method: 'GET', path: '/memo/latest_updated_desc' },

  recommended: { method: 'GET', path: '/memo/{slug}/recommended' },
  notifyOfToday: { method: 'GET', path: '/memo/notify_of_today/' },

  tagTree: { method: 'GET', path: '/tag/tree' },
};

/** 路径参数替换：{slug} → 实际值（需编码，slug 为 Base64 通常安全） */
export function resolvePath(path, pathParams) {
  return String(path).replace(/\{(\w+)\}/g, (m, name) => {
    const v = pathParams?.[name];
    if (v === undefined || v === null) throw new Error(`missing path param: ${name}`);
    return encodeURIComponent(String(v));
  });
}

export function buildUrl(path, extraBase) {
  return (extraBase || API_BASE) + path;
}

/**
 * 构造完整请求描述（不发起网络调用，便于单测）。
 * GET：签名后参数放 query；POST/PUT/DELETE：签名后参数作为 body（JSON）。
 */
export function buildRequest(name, { pathParams, params } = {}) {
  const ep = ENDPOINTS[name];
  if (!ep) throw new Error(`unknown endpoint: ${name}`);
  const path = resolvePath(ep.path, pathParams);
  return { method: ep.method, path, businessParams: { ...(params || {}) } };
}
