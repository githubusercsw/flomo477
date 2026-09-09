// 消息总线：只做分发，不写业务逻辑。所有 handler 返回 envelope。
// 后续模块（gatekeeper / sync / capture）在此注册，不在别处散落 sendMessage 监听。
import { toEnvelopeError, toEnvelopeOk } from '../shared/core/errors.js';
import { ERROR_CODE } from '../shared/core/constants.js';
import { getConfig, setConfig } from '../shared/platform/storage.js';
import { logger } from '../shared/platform/logger.js';
import { refreshActionBehavior } from './action-behavior.js';

const handlers = new Map();

export function register(type, fn) {
  handlers.set(type, fn);
}

register('ping', async () => toEnvelopeOk({ pong: true, ts: Date.now() }));

register('config_get', async () => {
  const cfg = await getConfig();
  return toEnvelopeOk(cfg);
});

register('config_set', async ({ patch }) => {
  if (!patch || typeof patch !== 'object') {
    return toEnvelopeError(ERROR_CODE.VALIDATION_ERROR, 'patch required');
  }
  const cfg = await setConfig(patch);
  await refreshActionBehavior();
  return toEnvelopeOk(cfg);
});

export function installMessageListener() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const { type, payload } = msg || {};
    const fn = handlers.get(type);
    if (!fn) {
      sendResponse(toEnvelopeError(ERROR_CODE.VALIDATION_ERROR, `unknown message: ${type}`));
      return false; // 同步响应，不保持通道
    }
    Promise.resolve()
      .then(() => fn(payload || {}))
      .then((res) => sendResponse(res))
      .catch((e) => {
        logger.error('messaging', `handler failed: ${type}`, { message: e?.message });
        sendResponse(toEnvelopeError(ERROR_CODE.UNKNOWN_ERROR, e?.message || ''));
      });
    return true; // 保持通道：异步响应必需
  });
}
