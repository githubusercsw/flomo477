// 点击工具栏图标的默认行为只有一个（弹 Popup 或开 Side Panel），二者不可兼得。
// 策略（R19-F）：未登录 → 弹 Popup 登录页；已登录 → 开 Side Panel（速记框在侧边栏顶部）。
import { getToken } from '../shared/platform/storage.js';
import { logger } from '../shared/platform/logger.js';

export async function refreshActionBehavior() {
  try {
    if (!chrome.sidePanel?.setPanelBehavior) return false;
    const token = await getToken();
    const openPanel = Boolean(token);
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: openPanel });
    return openPanel;
  } catch (e) {
    logger.warn('action', 'setPanelBehavior failed', { message: e?.message });
    return false;
  }
}
