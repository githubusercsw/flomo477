// 签名纯函数（对齐 flomo-cli 的 _generate_sign）。
// 算法：参数按 key 字典序排序 → 跳过 None 与 ""（保留整数 0）→ 拼 "key=value&"
//      → 末尾追加 SIGN_SECRET → MD5
// 关键：固定参数（api_key/app_version/platform/webp/tz）必须与业务参数**一起**参与签名，
//      不能只签业务参数再拼到 URL 上，否则服务端算出的 MD5 不一致。
import { md5 } from './md5.js';
import { SIGN_SECRET } from './constants.js';

/** 单个值序列化：数组用 key[]=item 形式（每项再排序）；其余转字符串 */
function serializeValue(value) {
  if (Array.isArray(value)) return value.map((v) => String(v)).sort();
  return String(value);
}

/** 判断该值是否参与签名：null/undefined/空串跳过，但 0 与 false 保留 */
function isSignable(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value === '') return false;
  return true;
}

/**
 * 生成签名串（不含 MD5），暴露出来便于单测与排查。
 *
 * ⚠️ 拼接格式（对齐 flomo-cli client.py 第 45-67 行）：
 *     raw = "&".join(parts) + SIGN_SECRET
 * 即 **最后一个键值对后面没有 &，直接接密钥**。
 * 早期版本写成 "k=v&k2=v2&" + SECRET（多了个 &），会导致服务端签名校验失败。
 */
export function buildSignRaw(params) {
  const keys = Object.keys(params || {})
    .filter((k) => isSignable(params[k]))
    .sort();

  const parts = [];
  for (const key of keys) {
    const value = params[key];
    if (Array.isArray(value)) {
      for (const item of serializeValue(value)) parts.push(`${key}[]=${item}`);
    } else {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.join('&') + SIGN_SECRET;
}

/** 生成签名（32 位小写 MD5） */
export function generateSign(params) {
  return md5(buildSignRaw(params));
}

/**
 * 把固定参数与业务参数合并，并附上 sign。
 * 返回的对象即为最终要放在 query（GET）或 body（POST/PUT/DELETE）里的完整参数。
 */
export function buildSignedParams(businessParams, fixedParams) {
  const merged = { ...(fixedParams || {}), ...(businessParams || {}) };
  return { ...merged, sign: generateSign(merged) };
}
