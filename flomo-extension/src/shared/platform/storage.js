// chrome.storage 适配层：唯一允许读写的入口。
// 关键：配置变更通过 onChanged 传播（SW 无法主动推消息给 content script，R18）。
import { DEFAULT_CONFIG, STORAGE_KEYS } from '../core/constants.js';

const AREA = () => chrome.storage.local;

export function get(keys) {
  return new Promise((resolve, reject) => {
    AREA().get(keys, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result || {});
    });
  });
}

export function set(obj) {
  return new Promise((resolve, reject) => {
    AREA().set(obj, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

export function remove(key) {
  return new Promise((resolve, reject) => {
    AREA().remove(key, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

export async function getConfig() {
  const { [STORAGE_KEYS.CONFIG]: cfg } = await get([STORAGE_KEYS.CONFIG]);
  return { ...DEFAULT_CONFIG, ...(cfg || {}), captureFields: { ...DEFAULT_CONFIG.captureFields, ...(cfg?.captureFields || {}) } };
}

export async function setConfig(patch) {
  const next = { ...(await getConfig()), ...patch };
  await set({ [STORAGE_KEYS.CONFIG]: next });
  return next;
}

export async function getToken() {
  const { [STORAGE_KEYS.TOKEN]: token } = await get([STORAGE_KEYS.TOKEN]);
  return token || null;
}

export async function setToken(token) {
  if (!token) await remove(STORAGE_KEYS.TOKEN);
  else await set({ [STORAGE_KEYS.TOKEN]: token });
}

/** 订阅变更：所有上下文（含 content script）都能监听，无需额外权限 */
export function onChanged(handler) {
  const listener = (changes, area) => {
    if (area !== 'local') return;
    handler(changes, area);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** device-id：首次生成并持久化，之后一直复用（禁止每次随机，避免风控） */
export async function getDeviceId() {
  const { [STORAGE_KEYS.DEVICE_ID]: id } = await get([STORAGE_KEYS.DEVICE_ID]);
  if (id) return id;
  const fresh =
    (globalThis.crypto && globalThis.crypto.randomUUID && globalThis.crypto.randomUUID()) ||
    `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await set({ [STORAGE_KEYS.DEVICE_ID]: fresh });
  return fresh;
}
