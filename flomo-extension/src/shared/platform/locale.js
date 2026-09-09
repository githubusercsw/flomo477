// 语言运行时：字典与 t() 来自 core（纯函数，可测），"当前语言"的读写与订阅在平台层。
import { translate } from '../core/i18n.js';
import { getConfig, onChanged } from './storage.js';

let lang = 'zh';

export async function initLocale() {
  const cfg = await getConfig();
  lang = cfg.language || 'zh';
  return lang;
}

export function setLang(next) {
  lang = next || 'zh';
}

export function getLang() {
  return lang;
}

export function t(key, params) {
  return translate(lang, key, params);
}

/** 切换语言不重载页面：监听配置变更热更新（R6-7 的例外由 UI 自行处理） */
export function onLocaleChanged(handler) {
  return onChanged((changes) => {
    if (!changes.config) return;
    const next = changes.config.newValue?.language;
    if (next && next !== lang) {
      setLang(next);
      handler(next);
    }
  });
}
