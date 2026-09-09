// 笔记数据的纯函数层：HTML 转义/还原、文本摘要、标签提取、服务端数据清洗、时间解析。
// 零平台依赖（不许 import chrome.*），可被 Node 直接单测。
//
// ⚠️ 关键闭环（架构审计 L2/E）：写入前必须 escapeHtml，显示时 htmlToText 才能还原原文。
// 否则用户输入的 `a < b`、`<script>`、`&` 会被当成标签，读回来剥标签后内容凭空消失。

const HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' ',
  apos: "'",
};

/** 转义：写入前调用，保证原文不被当成 HTML 结构 */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 还原实体：显示前调用 */
export function unescapeHtml(text) {
  return String(text ?? '').replace(/&(#?\w+);/g, (m, code) => {
    const key = code.toLowerCase();
    return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, key) ? HTML_ENTITIES[key] : m;
  });
}

/**
 * 纯文本 → HTML（对齐 flomo-cli 的 _text_to_html）：每行包 <p>，空行跳过。
 * 先转义再包裹，这是"纯文本化显示"能成立的必要前提。
 */
export function textToHtml(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    out.push(`<p>${escapeHtml(line.trim())}</p>`);
  }
  return out.join('');
}

/** HTML → 纯文本：<p>/<br> 转换行，其余标签剥离，实体还原 */
export function htmlToText(html) {
  const withBreaks = String(html ?? '')
    .replace(/<\s*\/?\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*p\s*>/gi, '\n')
    .replace(/<\s*p[^>]*>/gi, '');
  return unescapeHtml(withBreaks.replace(/<[^>]*>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
}

/** 列表摘要：压平换行为空格并截断（列表与详情一律纯文本化，不渲染富文本） */
export function toSummary(text, max = 120) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max) + '…';
}

/** 从内容提取 #标签（服务端也会自动提取，本地用于标签云与筛选） */
export function extractTags(content) {
  const text = htmlToText(content);
  const found = text.match(/#([^\s#]+)/g) || [];
  return [...new Set(found.map((t) => t.slice(1)).filter(Boolean))];
}

/** 附件标记：只显示"含图片/音频"，不渲染原文件 */
export function attachmentFlags(files) {
  const list = Array.isArray(files) ? files : [];
  return {
    hasImage: list.some((f) => f && f.type === 'image'),
    hasAudio: list.some((f) => f && f.type === 'audio'),
    count: list.length,
  };
}

/**
 * 服务端数据清洗（对齐 flomo-cli 的 _format_memo）。
 * 防御式解析：字段缺失/类型不符一律给默认值，绝不返回 undefined —— 接口变更时不炸链。
 */
export function formatMemo(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  const content = typeof m.content === 'string' ? m.content : '';
  const tags = Array.isArray(m.tags) ? m.tags.filter((t) => typeof t === 'string') : extractTags(content);
  return {
    slug: typeof m.slug === 'string' ? m.slug : '',
    content,
    contentText: htmlToText(content),
    tags,
    pin: Number(m.pin) === 1 ? 1 : 0,
    createdAt: m.created_at ?? null,
    updatedAt: m.updated_at ?? null,
    deletedAt: m.deleted_at ?? null,
    files: Array.isArray(m.files) ? m.files : [],
    isDeleted: m.deleted_at != null,
  };
}

/**
 * 解析服务端时间字符串（"2024-02-21 08:36:29"，无时区标记）。
 * 服务端固定 tz=8:0，因此统一按 UTC+8 解析，不依赖本机时区 —— 保证任何机器上排序与"今日回顾"一致。
 * 无法解析时返回 0（不返回 NaN，避免污染比较与排序）。
 */
export function parseServerDate(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s) - 8 * 60 * 60 * 1000;
}

/** 是否为"同一天"（按 UTC+8 计，与服务端一致） */
export function isSameServerDay(a, b) {
  const offset = 8 * 60 * 60 * 1000;
  const da = new Date(parseServerDate(a) + offset);
  const db = new Date(parseServerDate(b) + offset);
  return (
    da.getUTCFullYear() === db.getUTCFullYear() &&
    da.getUTCMonth() === db.getUTCMonth() &&
    da.getUTCDate() === db.getUTCDate()
  );
}

/** 本地搜索匹配（纯文本 + 标签），返回是否命中；搜索走缓存，无服务端搜索 */
export function matchesKeyword(memo, keyword) {
  const kw = String(keyword ?? '').trim().toLowerCase();
  if (!kw) return true;
  const haystack = `${memo.contentText ?? ''} ${(memo.tags || []).join(' ')}`.toLowerCase();
  return haystack.includes(kw);
}
