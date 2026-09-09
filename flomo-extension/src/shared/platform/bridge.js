// UI 与 content script 调用后台的唯一封装：统一 envelope 与错误码（R18 依赖方向）。
// UI 禁止直接 import shared/api，一律走这里。

export function call(type, payload = {}) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, payload }, (res) => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve({ ok: false, error: 'unknown_error', message: err.message });
          return;
        }
        resolve(res ?? { ok: false, error: 'unknown_error', message: 'empty response' });
      });
    } catch (e) {
      resolve({ ok: false, error: 'unknown_error', message: String(e && e.message) });
    }
  });
}

export const api = {
  ping: () => call('ping'),
  getConfig: () => call('config_get'),
  setConfig: (patch) => call('config_set', { patch }),
};
