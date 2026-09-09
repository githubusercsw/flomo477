// 日志的纯逻辑：级别比较 + 脱敏。平台绑定（console / storage）在 platform/logger.js。
// 硬规则：token、密码、笔记正文永不入日志（R8-5）。

export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function shouldLog(current, target) {
  const a = LEVELS[current] ?? LEVELS.info;
  const b = LEVELS[target] ?? LEVELS.info;
  return b >= a;
}

const SENSITIVE_KEYS = [
  'token',
  'access_token',
  'password',
  'email',
  'content',
  'content_text',
  'authorization',
  'sign',
];

const SENSITIVE_RE = /^(?:.*(?:token|password|secret|sign)).*$/i;

export function redactKey(key) {
  const k = String(key).toLowerCase();
  return SENSITIVE_KEYS.includes(k) || SENSITIVE_RE.test(k);
}

/** 递归脱敏：对象/数组深拷贝后替换敏感值为 '***' */
export function redact(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    // 疑似长正文（笔记正文/超长文本）一律折叠，避免正文入日志
    return value.length > 120 ? `<${value.length} chars>` : value;
  }
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = redactKey(k) ? '***' : redact(v, seen);
  }
  return out;
}

export function formatEntry(level, scope, message, detail) {
  const base = { level, scope, message };
  if (detail === undefined) return base;
  return { ...base, detail: redact(detail) };
}
