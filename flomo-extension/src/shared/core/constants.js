// 纯常量：不依赖任何平台 API，不产生副作用。
// 变更高发区集中在此，避免散落各处。

// ---- API 契约 ----
export const API_BASE = 'https://flomoapp.com/api/v1';
export const API_KEY = 'flomo_web';
export const APP_VERSION = '4.0';
export const PLATFORM = 'web';
export const WEBP = '1'; // 与 CLI 一致，以字符串形式参与签名
export const TZ = '8:0';
export const SIGN_SECRET = 'dbbc3dd73364b4084c3a69346e0ce2b2';

// 接口兼容标记：服务端契约变更时人工递增，便于定位问题版本
export const API_COMPAT_VERSION = 1;

// 请求头（身份伪装为普通网页端，避免暴露"非官方客户端"）
export const HEADER_PLATFORM = 'web';
export const HEADER_DEVICE_MODEL = 'web';
// UA 伪装成普通 Chrome，不带扩展标识
export const FAKE_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ---- 存储键 ----
export const STORAGE_KEYS = {
  TOKEN: 'token',
  USER: 'user',
  CONFIG: 'config',
  DEVICE_ID: 'device_id',
  SYNC_CURSOR: 'sync_cursor',
  SYNC_META: 'sync_meta',
  SYNC_LOCK: 'sync_lock',
  LAST_SIDEPANEL_SLUG: 'last_sidepanel_slug',
};

// ---- 默认配置（与设置页分组一致）----
export const DEFAULT_CONFIG = {
  // 录入组
  captureTrigger: 'icon', // 'icon' | 'inline' | 'contextMenu' | 'off'
  captureFields: { tags: true, source: true },
  siteBlacklist: [],
  // 同步组
  syncIntervalMinutes: 5,
  // 浏览组
  defaultSort: 'updated_desc', // updated_desc|updated_asc|created_desc|created_asc
  // 外观组
  theme: 'system', // system | light | dark
  language: 'zh',
  debug: false,
};

// ---- 数值约束（命名区分两个"分页"，禁止复用）----
export const SYNC_LIMIT = 200; // API 同步每页
export const PAGE_SIZE = 50; // UI 列表每页
export const REQUEST_MIN_INTERVAL_MS = 300; // 串行队列最小间隔
export const REQUEST_TIMEOUT_MS = 10000;
export const RETRY_MAX = 3;
export const RETRY_BASE_MS = 2000; // 指数退避：2s / 4s / 8s
export const RATE_LIMIT_BACKOFF_MS = 5 * 60 * 1000;
export const SYNC_LOCK_TTL_MS = 5 * 60 * 1000; // 超时自动释放，防死锁
export const TOAST_DURATION_MS = 6000; // toast 与撤销同寿
export const SEARCH_DEBOUNCE_MS = 200;

// ---- IndexedDB ----
export const DB_NAME = 'flomo_ext';
export const DB_VERSION = 1;
export const STORES = {
  MEMOS: 'memos', // keyPath: slug
  TAGS: 'tags', // keyPath: name
  OUTBOX: 'outbox', // keyPath: id(autoIncrement)
  META: 'meta', // keyPath: key（游标等）
};

export const ALARM_SYNC = 'flomo-sync';

export const ERROR_CODE = {
  NOT_AUTHENTICATED: 'not_authenticated',
  NOT_FOUND: 'not_found',
  VALIDATION_ERROR: 'validation_error',
  API_ERROR: 'api_error',
  RATE_LIMITED: 'rate_limited',
  TIMEOUT: 'timeout',
  NETWORK_ERROR: 'network_error',
  CONTRACT_CHANGED: 'contract_changed',
  UNKNOWN_ERROR: 'unknown_error',
};

export const API_CODE = {
  SUCCESS: 0,
  SESSION_EXPIRED: -10,
  NEED_VERIFY: -20,
  GENERIC_FAIL: -1,
};
