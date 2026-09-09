import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  unescapeHtml,
  textToHtml,
  htmlToText,
  toSummary,
  extractTags,
  attachmentFlags,
  formatMemo,
  parseServerDate,
  isSameServerDay,
  matchesKeyword,
} from '../../src/shared/core/memo.js';

test('写入转义 + 读出还原，构成闭环（尖括号不丢）', () => {
  const original = 'a < b 且 x > y，还有 <script>alert(1)</script>';
  const html = textToHtml(original);
  assert.equal(html, '<p>a &lt; b 且 x &gt; y，还有 &lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(htmlToText(html), original, '往返后必须还原原文');
});

test('& 与引号同样要转义（否则被当成实体）', () => {
  const s = 'Tom & Jerry 说 "hi" it\'s';
  assert.equal(htmlToText(textToHtml(s)), s);
});

test('多行：每行包 <p>，空行跳过', () => {
  const html = textToHtml('第一行\n\n第二行');
  assert.equal(html, '<p>第一行</p><p>第二行</p>');
  assert.equal(htmlToText(html), '第一行\n第二行');
});

test('纯文本化：富文本 HTML 被剥成文本，不渲染（段落转换行）', () => {
  assert.equal(htmlToText('<p>你好</p><img src="x"><strong>粗</strong>'), '你好\n粗');
  assert.equal(htmlToText('<p>a</p><p>b</p>'), 'a\nb');
  assert.equal(toSummary(htmlToText('<p>a</p><p>b</p>')), 'a b', '列表摘要会把换行压平');
});

test('摘要截断且压平换行', () => {
  assert.equal(toSummary('很长的'.repeat(50), 10).length, 11);
  assert.match(toSummary('很长的'.repeat(50), 10), /…$/);
  assert.equal(toSummary('a\nb'), 'a b');
});

test('标签提取：中英文与去重', () => {
  assert.deepEqual(extractTags('#工作 #想法 今天#读书 重复 #工作'), ['工作', '想法', '读书']);
});

test('附件标记：只报类型不渲染文件', () => {
  assert.deepEqual(attachmentFlags([{ type: 'image' }, { type: 'audio' }]), {
    hasImage: true,
    hasAudio: true,
    count: 2,
  });
  assert.deepEqual(attachmentFlags(null), { hasImage: false, hasAudio: false, count: 0 });
});

test('防御式解析：字段缺失/类型错误不产生 undefined（接口变更不炸链）', () => {
  const m = formatMemo({});
  assert.equal(m.slug, '');
  assert.equal(m.content, '');
  assert.deepEqual(m.tags, []);
  assert.deepEqual(m.files, []);
  assert.equal(m.isDeleted, false);
  assert.equal(formatMemo(null).contentText, '');
  assert.equal(formatMemo('bad').updatedAt, null);
});

test('正常数据清洗：contentText 与 soft-delete 标记', () => {
  const m = formatMemo({
    slug: 'abc',
    content: '<p>你好 #工作</p>',
    tags: ['工作'],
    pin: 1,
    deleted_at: '2024-01-01 00:00:00',
    files: [{ type: 'image' }],
  });
  assert.equal(m.contentText, '你好 #工作');
  assert.equal(m.pin, 1);
  assert.equal(m.isDeleted, true);
  assert.equal(m.files.length, 1);
});

test('时间按 UTC+8 解析，不依赖本机时区', () => {
  const ts = parseServerDate('2024-02-21 08:36:29');
  assert.equal(new Date(ts).toISOString(), '2024-02-21T00:36:29.000Z', '应等于 UTC+8 的 08:36');
  assert.equal(parseServerDate(null), 0);
  assert.equal(parseServerDate('garbage'), 0, '非法值返回 0 而非 NaN');
});

test('同一天判定按服务端时区', () => {
  assert.equal(isSameServerDay('2024-02-21 23:00:00', '2024-02-21 01:00:00'), true);
  assert.equal(isSameServerDay('2024-02-21 23:00:00', '2024-02-22 01:00:00'), false);
});

test('关键词匹配覆盖正文与标签，大小写不敏感', () => {
  const memo = { contentText: '今天读了本书', tags: ['读书'] };
  assert.equal(matchesKeyword(memo, '本书'), true);
  assert.equal(matchesKeyword(memo, '读书'), true, '标签也应命中');
  assert.equal(matchesKeyword(memo, '不存在'), false);
  assert.equal(matchesKeyword(memo, ''), true, '空关键词返回全部');
});
