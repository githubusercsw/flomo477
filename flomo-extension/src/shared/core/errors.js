// 错误码：纯函数层。上层永远用稳定码判断，不解析服务端中文文案。
import { API_CODE, ERROR_CODE } from './constants.js';

const NOT_FOUND_TEXT = '没有找到';

/**
 * 把 API 返回码映射为稳定错误码。
 * 未知码一律归为 api_error；响应结构异常（data 字段缺失等）单独识别为 contract_changed。
 */
export function mapApiCode(code, message = '') {
  if (code === API_CODE.SUCCESS) return null;
  if (code === API_CODE.SESSION_EXPIRED || code === API_CODE.NEED_VERIFY) {
    return ERROR_CODE.NOT_AUTHENTICATED;
  }
  if (code === API_CODE.GENERIC_FAIL && String(message).includes(NOT_FOUND_TEXT)) {
    return ERROR_CODE.NOT_FOUND;
  }
  if (code === 429) return ERROR_CODE.RATE_LIMITED;
  if (typeof code === 'number' && code >= 400 && code < 500) return ERROR_CODE.VALIDATION_ERROR;
  if (typeof code === 'number' && code >= 500) return ERROR_CODE.API_ERROR;
  return ERROR_CODE.API_ERROR;
}

/** 判断响应结构是否符合契约（字段缺失/类型不符 → 接口可能已变更） */
export function isContractBroken(payload) {
  if (!payload || typeof payload !== 'object') return true;
  if (!('code' in payload)) return true;
  return false;
}

export function isAuthError(code) {
  return code === ERROR_CODE.NOT_AUTHENTICATED;
}

/** 是否值得重试：仅网络类错误可重试，API 业务错误一律不重试 */
export function isRetryable(code) {
  return code === ERROR_CODE.NETWORK_ERROR || code === ERROR_CODE.TIMEOUT;
}

export function toEnvelopeOk(data, extra = {}) {
  return { ok: true, data, ...extra };
}

export function toEnvelopeError(code, message = '') {
  return { ok: false, error: code, message };
}
