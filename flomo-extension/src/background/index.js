// Service Worker 入口：只做事件注册，不写业务。
// 铁律：所有 handler 必须返回 Promise（否则请求被腰斩）；禁止 setInterval（SW 会被杀）。
import { installMessageListener } from './messaging.js';
import './api-proxy.js'; // 注册 API 相关消息处理器
import { refreshActionBehavior } from './action-behavior.js';
import { ALARM_SYNC, DEFAULT_CONFIG } from '../shared/core/constants.js';
import { getConfig, onChanged, set, getDeviceId } from '../shared/platform/storage.js';
import { STORAGE_KEYS } from '../shared/core/constants.js';
import { logger, currentLevel, invalidateLevelCache } from '../shared/platform/logger.js';

async function ensureDefaults() {
  const cfg = await getConfig();
  await set({ [STORAGE_KEYS.CONFIG]: cfg });
  // device-id 首次生成后持久化复用：每次随机会让服务端认为"不断换设备"，易触发风控
  await getDeviceId();
  logger.debug('sw', 'defaults ensured', { syncIntervalMinutes: cfg.syncIntervalMinutes });
}

async function ensureAlarm() {
  const cfg = await getConfig();
  const existing = await chrome.alarms.get(ALARM_SYNC);
  const period = Math.max(1, cfg.syncIntervalMinutes || DEFAULT_CONFIG.syncIntervalMinutes);
  if (!existing || Math.round(existing.periodInMinutes) !== period) {
    await chrome.alarms.create(ALARM_SYNC, { periodInMinutes: period, delayInMinutes: period });
  }
}

function ensureContextMenu() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'flomo-capture-selection',
      title: '存入 flomo',
      contexts: ['selection'],
    });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await ensureAlarm();
  ensureContextMenu();
  await refreshActionBehavior();
  logger.info('sw', 'installed');
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  ensureContextMenu();
  await refreshActionBehavior();
  logger.info('sw', 'startup');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_SYNC) return;
  // TODO(P3)：抢同步锁 → flush outbox → 增量同步
  logger.debug('sw', 'sync alarm fired');
  return Promise.resolve();
});

chrome.contextMenus?.onClicked.addListener((info) => {
  if (info.menuItemId !== 'flomo-capture-selection') return;
  // TODO(P4)：交由 capture 流程处理
  logger.debug('sw', 'context menu capture', { len: info.selectionText?.length });
});

// 配置变更：清日志级别缓存、重排告警、刷新图标行为
onChanged(async (changes) => {
  if (!changes.config) return;
  invalidateLevelCache();
  await currentLevel();
  await ensureAlarm();
  await refreshActionBehavior();
});

installMessageListener();
currentLevel();
