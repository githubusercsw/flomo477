// 轻量 i18n：字典与 t() 均为纯函数，便于单测拦截缺键（R6-10）。
// 注意：不使用 chrome.i18n —— 它运行时不可切换语言。

export const SUPPORTED_LANGS = ['zh', 'en'];
export const FALLBACK_LANG = 'zh'; // 缺键回落中文

export const DICT = {
  zh: {
    'app.name': 'flomo 速记',
    'common.save': '保存',
    'common.cancel': '取消',
    'common.close': '关闭',
    'common.loading': '加载中…',
    'common.retry': '重试',
    'common.offline': '离线不可用',
    'common.confirm': '确认',

    'nav.compose': '速记',
    'nav.history': '浏览',
    'nav.settings': '设置',

    'status.notLoggedIn': '未登录',
    'status.syncing': '已同步 {count} 条…',
    'status.syncIncomplete': '上次同步未完成，点此继续',
    'status.pendingCount': '{count} 条待同步',
    'status.saved': '已保存',
    'status.undo': '撤销',
    'status.deletedHint': '已删除，可在 flomo 回收站恢复',

    'login.title': '登录 flomo',
    'login.email': '邮箱',
    'login.password': '密码',
'login.submit': '登录',
    'login.emailPlaceholder': '请输入邮箱',
    'login.passwordPlaceholder': '请输入密码',
    'login.emailRequired': '请输入邮箱',
    'login.passwordRequired': '请输入密码',
    'login.loggingIn': '登录中…',
    'login.success': '登录成功',
    'login.hintSafe': '密码仅用于登录，不会保存在本地',
    'login.hint': '若登录失败，请先到 flomo 网页端确认可以正常登录',

    'capture.placeholder': '记点什么…',
    'capture.source': '附加来源（标题 + 链接）',
    'capture.tags': '标签',
    'capture.emptyTip': '内容不能为空',
    'capture.saving': '保存中…',
    'capture.savedToast': '已保存',
    'capture.fromSource': '来自：{title}',
    'capture.closeHint': '按 Esc 关闭',

    'list.empty': '还没有笔记',
    'list.searchEmpty': '没有匹配的笔记',
    'list.sort': '排序',
    'list.updatedDesc': '最近更新',
    'list.updatedAsc': '最早更新',
    'list.createdDesc': '最近创建',
    'list.createdAsc': '最早创建',
    'list.hasImage': '含图片',
    'list.hasAudio': '含音频',
    'list.pending': '待同步',
    'list.loadMore': '加载更多',
    'list.searchPlaceholder': '搜索笔记…',
    'list.allTags': '全部',
    'list.resultCount': '共 {count} 条',
    'list.copy': '复制',
    'list.openInFlomo': '在 flomo 中打开',

    'detail.recommended': '相关笔记',
    'detail.similarity': '相似度',
    'detail.recommendedEmpty': '暂无相关笔记',
    'detail.createdAt': '创建于 {time}',
    'detail.updatedAt': '更新于 {time}',

    'review.title': '每日回顾',
    'review.empty': '今天还没有可回顾的笔记',

    'settings.groupAccount': '账号',
    'settings.groupCapture': '录入',
    'settings.groupSync': '同步',
    'settings.groupBrowse': '浏览',
    'settings.groupAppearance': '外观',
    'settings.language': '语言',
    'settings.theme': '主题',
    'settings.themeSystem': '跟随系统',
    'settings.themeLight': '浅色',
    'settings.themeDark': '深色',
    'settings.syncInterval': '同步频率',
    'settings.clearCache': '清空缓存',
    'settings.clearCacheHint': '将重新同步；仅影响本地，不影响 flomo 云端，也不影响未发送的笔记',
    'settings.siteBlacklist': '站点黑名单',
    'settings.captureTrigger': '划词触发方式',
    'settings.triggerIcon': '浮出小图标',
    'settings.triggerInline': '选中直接弹框',
    'settings.triggerMenu': '仅右键菜单',
    'settings.triggerOff': '关闭划词',
    'settings.debug': '调试日志',
    'settings.selfCheck': '自检',
    'settings.selfCheckPermissions': '权限齐全',
    'settings.selfCheckLogin': '登录有效',
    'settings.selfCheckCache': '缓存 {count} 条',
    'settings.selfCheckLastSync': '上次同步：{time}',
    'settings.selfCheckOutbox': '待发送 {count} 条',
    'settings.logout': '退出登录',
    'settings.account': '当前账号',
    'settings.notLoggedIn': '未登录',
    'settings.pendingNote': '待发送的笔记不会被清空',
    'settings.save': '保存',

    'error.unknown': '出了点问题，请重试',
    'error.notAuthenticated': '登录已失效，请重新登录',
    'error.timeout': '请求超时，请检查网络',
    'error.network': '网络不可用',
    'error.rateLimited': '请求过于频繁，稍后再试',
    'error.contractChanged': 'flomo 接口可能已更新，请检查扩展是否有新版本',
    'error.validation': '内容不合法',
    'error.notFound': '没有找到该内容',
    'error.rateLimitedHint': '已暂停自动同步，稍后恢复',
  },
  en: {
    'app.name': 'flomo Capture',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.loading': 'Loading…',
    'common.retry': 'Retry',
    'common.offline': 'Unavailable offline',
    'common.confirm': 'Confirm',

    'nav.compose': 'Capture',
    'nav.history': 'Browse',
    'nav.settings': 'Settings',

    'status.notLoggedIn': 'Not signed in',
    'status.syncing': 'Synced {count} notes…',
    'status.syncIncomplete': 'Last sync incomplete — tap to continue',
    'status.pendingCount': '{count} pending',
    'status.saved': 'Saved',
    'status.undo': 'Undo',
    'status.deletedHint': 'Deleted — restore it from the flomo recycle bin',

    'login.title': 'Sign in to flomo',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.emailPlaceholder': 'Email',
    'login.passwordPlaceholder': 'Password',
    'login.emailRequired': 'Email is required',
    'login.passwordRequired': 'Password is required',
    'login.loggingIn': 'Signing in…',
    'login.success': 'Signed in',
    'login.hintSafe': 'Your password is used only to sign in and is never stored locally',
    'login.hint': 'If sign-in fails, first confirm you can log in on the flomo website',

    'capture.placeholder': 'What’s on your mind…',
    'capture.source': 'Attach source (title + link)',
    'capture.tags': 'Tags',
    'capture.emptyTip': 'Content cannot be empty',
    'capture.saving': 'Saving…',
    'capture.savedToast': 'Saved',
    'capture.fromSource': 'From: {title}',
    'capture.closeHint': 'Press Esc to close',

    'list.empty': 'No notes yet',
    'list.searchEmpty': 'No matching notes',
    'list.sort': 'Sort',
    'list.updatedDesc': 'Recently updated',
    'list.updatedAsc': 'Least recently updated',
    'list.createdDesc': 'Recently created',
    'list.createdAsc': 'Oldest created',
    'list.hasImage': 'Has image',
    'list.hasAudio': 'Has audio',
    'list.pending': 'Pending',
    'list.loadMore': 'Load more',
    'list.searchPlaceholder': 'Search notes…',
    'list.allTags': 'All',
    'list.resultCount': '{count} notes',
    'list.copy': 'Copy',
    'list.openInFlomo': 'Open in flomo',

    'detail.recommended': 'Related notes',
    'detail.similarity': 'Similarity',
    'detail.recommendedEmpty': 'No related notes yet',
    'detail.createdAt': 'Created {time}',
    'detail.updatedAt': 'Updated {time}',

    'review.title': 'Daily review',
    'review.empty': 'Nothing to review today',

    'settings.groupAccount': 'Account',
    'settings.groupCapture': 'Capture',
    'settings.groupSync': 'Sync',
    'settings.groupBrowse': 'Browse',
    'settings.groupAppearance': 'Appearance',
    'settings.language': 'Language',
    'settings.theme': 'Theme',
    'settings.themeSystem': 'Follow system',
    'settings.themeLight': 'Light',
    'settings.themeDark': 'Dark',
    'settings.syncInterval': 'Sync interval',
    'settings.clearCache': 'Clear cache',
    'settings.clearCacheHint':
      'Will re-sync from scratch. Local only — your flomo cloud data and unsent notes are not affected',
    'settings.siteBlacklist': 'Site blacklist',
    'settings.captureTrigger': 'Selection trigger',
    'settings.triggerIcon': 'Floating icon',
    'settings.triggerInline': 'Pop up on select',
    'settings.triggerMenu': 'Context menu only',
    'settings.triggerOff': 'Disabled',
    'settings.debug': 'Debug logs',
    'settings.selfCheck': 'Self-check',
    'settings.selfCheckPermissions': 'Permissions OK',
    'settings.selfCheckLogin': 'Signed in',
    'settings.selfCheckCache': '{count} cached',
    'settings.selfCheckLastSync': 'Last sync: {time}',
    'settings.selfCheckOutbox': '{count} pending',
    'settings.logout': 'Sign out',
    'settings.account': 'Account',
    'settings.notLoggedIn': 'Not signed in',
    'settings.pendingNote': 'Unsent notes are not cleared',
    'settings.save': 'Save',

    'error.unknown': 'Something went wrong, please retry',
    'error.notAuthenticated': 'Session expired, please sign in again',
    'error.timeout': 'Request timed out, check your network',
    'error.network': 'Network unavailable',
    'error.rateLimited': 'Too many requests, try again later',
    'error.contractChanged': 'The flomo API may have changed — check for an extension update',
    'error.validation': 'Invalid content',
    'error.notFound': 'Not found',
    'error.rateLimitedHint': 'Auto-sync paused, will resume shortly',
  },
};

export function resolveLang(lang) {
  return SUPPORTED_LANGS.includes(lang) ? lang : FALLBACK_LANG;
}

/** 取词：缺键时逐级回落（当前语言 → 中文 → 键名） */
export function lookup(lang, key) {
  const l = resolveLang(lang);
  if (DICT[l] && key in DICT[l]) return DICT[l][key];
  if (DICT[FALLBACK_LANG] && key in DICT[FALLBACK_LANG]) return DICT[FALLBACK_LANG][key];
  return key;
}

/** 占位符替换：{name} → params[name] */
export function interpolate(template, params) {
  if (!params) return template;
  return String(template).replace(/\{(\w+)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m,
  );
}

export function translate(lang, key, params) {
  return interpolate(lookup(lang, key), params);
}

/** 供单测使用：返回两种语言的差异，空数组 = 字典健康 */
export function diffDictionaries() {
  const problems = [];
  const [a, b] = SUPPORTED_LANGS;
  const ka = Object.keys(DICT[a] || {}).sort();
  const kb = Object.keys(DICT[b] || {}).sort();
  for (const k of ka) if (!kb.includes(k)) problems.push(`missing:${b}:${k}`);
  for (const k of kb) if (!ka.includes(k)) problems.push(`missing:${a}:${k}`);
  for (const lang of SUPPORTED_LANGS) {
    for (const [k, v] of Object.entries(DICT[lang] || {})) {
      if (typeof v !== 'string' || v.trim() === '') problems.push(`empty:${lang}:${k}`);
      const pa = (v.match(/\{(\w+)\}/g) || []).sort().join(',');
      const other = lang === a ? b : a;
      const pv = ((DICT[other] || {})[k] || '').match(/\{(\w+)\}/g) || [];
      if (pa !== pv.sort().join(',')) problems.push(`placeholder:${k}`);
    }
  }
  return problems;
}
