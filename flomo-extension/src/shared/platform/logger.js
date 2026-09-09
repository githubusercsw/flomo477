// 平台绑定层：唯一把日志写进 console 的地方。
import { formatEntry, shouldLog } from '../core/logger.js';
import { DEFAULT_CONFIG } from '../core/constants.js';
import { getConfig } from './storage.js';

let cachedLevel = null;

export async function currentLevel() {
  if (cachedLevel !== null) return cachedLevel;
  try {
    const cfg = await getConfig();
    cachedLevel = cfg?.debug ? 'debug' : 'warn';
  } catch {
    cachedLevel = 'warn';
  }
  return cachedLevel;
}

/** 配置变更后调用，清掉级别缓存（下次 log 时重新读取 debug 开关） */
export function invalidateLevelCache() {
  cachedLevel = null;
}

export function log(level, scope, message, detail) {
  const levelNow = cachedLevel ?? (DEFAULT_CONFIG.debug ? 'debug' : 'warn');
  if (!shouldLog(levelNow, level)) return;
  const entry = formatEntry(level, scope, message, detail);
  const prefix = `[flomo:${entry.scope}]`;
  if (level === 'error') console.error(prefix, entry.message, entry.detail ?? '');
  else if (level === 'warn') console.warn(prefix, entry.message, entry.detail ?? '');
  else console.log(prefix, entry.message, entry.detail ?? '');
}

export const logger = {
  debug: (s, m, d) => log('debug', s, m, d),
  info: (s, m, d) => log('info', s, m, d),
  warn: (s, m, d) => log('warn', s, m, d),
  error: (s, m, d) => log('error', s, m, d),
};
