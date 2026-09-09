// 登录态纯逻辑：不碰 storage，便于单测。平台读写在 platform/storage.js。

/** 是否已登录（仅看 token 是否存在且非空） */
export function isLoggedIn(token) {
  return typeof token === 'string' && token.trim().length > 0;
}

/**
 * 收到 API 错误后的登录态处理决策。
 * 口径：-10 / -20 → 清本地 token + 引导登录（发通知由调用方执行）。
 */
export function decideAuthAction(errorCode) {
  if (errorCode === 'not_authenticated') {
    return { clearToken: true, promptLogin: true, notify: true };
  }
  return { clearToken: false, promptLogin: false, notify: false };
}

/** 登录表单校验：邮箱与密码均不能为空（不校验格式，避免误拦） */
export function validateLoginInput(email, password) {
  const e = String(email ?? '').trim();
  const p = String(password ?? '');
  if (!e) return { ok: false, reason: 'email_required' };
  if (!p) return { ok: false, reason: 'password_required' };
  return { ok: true, email: e, password: p };
}

/** 密码强度不校验，但长度上限防止误粘贴巨量文本 */
export function isPasswordSane(password) {
  return String(password ?? '').length <= 512;
}
