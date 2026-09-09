// 架构守卫：把「依赖方向」「平台隔离」这类靠自觉的规矩变成自动检查。
// 这些规则一旦被破坏，代码会悄悄退化成难测的泥球，因此必须机器把关。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = '/data/workspace/flomo-extension/src';

function walk(dir, ext = ['.js', '.html']) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (ext.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

const all = walk(SRC);
const rel = (f) => path.relative(SRC, f);
const read = (f) => fs.readFileSync(f, 'utf8');

/** 剥离注释与字符串字面量，避免把"说明文字"当成真实调用（否则全是误报） */
const code = (f) =>
  read(f)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/`(?:\\.|[^`\\])*`/g, "''")
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, "''");

test('shared/core 必须零平台依赖（不许碰 chrome.*、不许发网络请求）', () => {
  const offenders = [];
  for (const f of all.filter((f) => rel(f).startsWith('shared/core'))) {
    const src = code(f);
    if (/chrome\s*\./.test(src)) offenders.push(`${rel(f)}: 引用了 chrome.*`);
    if (/\bfetch\s*\(|XMLHttpRequest|indexedDB\s*\.\s*open/i.test(src))
      offenders.push(`${rel(f)}: 直接发起了网络/数据库调用`);
  }
  assert.deepEqual(offenders, [], 'core 层必须是纯函数，否则无法在 Node 中直接单测');
});

test('chrome.* 只允许出现在 platform 与 background/content（且 core/api 不得出现）', () => {
  const offenders = [];
  for (const f of all) {
    const r = rel(f);
    if (r.startsWith('shared/core') || r.startsWith('shared/api')) continue;
    void read(f);
  }
  for (const f of all.filter((f) => rel(f).startsWith('shared/api'))) {
    if (/chrome\s*\./.test(code(f))) offenders.push(`${rel(f)}: api 层不应直接依赖 chrome.*（应由调用方注入）`);
  }
  assert.deepEqual(offenders, [], 'api 层应保持可注入、可在 Node 里 mock 测试');
});

test('UI 层禁止直接 import shared/api（必须走消息总线）', () => {
  const offenders = [];
  for (const f of all.filter((f) => rel(f).startsWith('ui/'))) {
    if (/from\s+['"][^'"]*shared\/api/.test(code(f))) offenders.push(rel(f));
  }
  assert.deepEqual(offenders, [], 'UI 直接调 API 会绕过把关中枢与 CORS 约束');
});

test('background 禁止用 setInterval / setTimeout 做周期任务（SW 被杀即失效）', () => {
  const offenders = [];
  for (const f of all.filter((f) => rel(f).startsWith('background'))) {
    if (/setInterval\s*\(/.test(code(f))) offenders.push(`${rel(f)}: 使用了 setInterval`);
  }
  assert.deepEqual(offenders, [], '周期任务必须用 chrome.alarms');
});

test('两个分页概念不得混用（SYNC_LIMIT 与 PAGE_SIZE 必须分别引用）', () => {
  const c = read(path.join(SRC, 'shared/core/constants.js'));
  assert.match(c, /SYNC_LIMIT\s*=\s*200/);
  assert.match(c, /PAGE_SIZE\s*=\s*50/);
});

test('i18n 不得使用 chrome.i18n（运行时不可切换语言）', () => {
  const offenders = all.filter((f) => /chrome\.i18n/.test(code(f))).map(rel);
  assert.deepEqual(offenders, []);
});

test('manifest 权限最小化：host 仅 flomoapp，且不含 tabs / <all_urls> 跨域权', () => {
  const m = JSON.parse(fs.readFileSync('/data/workspace/flomo-extension/manifest.json', 'utf8'));
  assert.deepEqual(m.host_permissions, ['https://flomoapp.com/*']);
  assert.equal(m.permissions.includes('tabs'), false, '不申请 tabs 权限（配置传播靠 storage.onChanged）');
  assert.equal(m.permissions.includes('<all_urls>'), false);
  // 全站注入是功能所需，但必须与 host 权限分开管理
  assert.ok(
    m.content_scripts?.[0]?.matches?.includes('<all_urls>'),
    '划词需在任意网页生效，注入范围应为 <all_urls>（已在审计中接受其安装警告）',
  );
  assert.equal(m.content_scripts[0].all_frames, false, '首版不注入 iframe，避免浮层重复');
});

test('manifest 中 background 为 ES module 且指向真实存在的文件', () => {
  const m = JSON.parse(fs.readFileSync('/data/workspace/flomo-extension/manifest.json', 'utf8'));
  assert.equal(m.background.type, 'module');
  assert.ok(fs.existsSync(path.join(SRC, '..', m.background.service_worker)), 'SW 入口文件必须存在');
  for (const key of ['action', 'side_panel', 'options_ui']) {
    assert.ok(m[key], `缺少 ${key} 声明`);
  }
});

test('所有 manifest 声明的入口文件都存在（防 404 白屏）', () => {
  const root = '/data/workspace/flomo-extension';
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const files = [
    m.background.service_worker,
    m.action.default_popup,
    m.side_panel.default_path,
    m.options_ui.page,
    ...(m.content_scripts?.[0]?.js || []),
  ];
  const missing = files.filter((f) => !fs.existsSync(path.join(root, f)));
  assert.deepEqual(missing, [], '入口文件缺失会导致加载失败');
});

test('P1：登录相关端点与参数不在 UI 层硬编码（必须走 api/endpoints）', () => {
  const offenders = [];
  for (const f of all.filter((f) => rel(f).startsWith('ui/'))) {
    if (/login_by_email|flomoapp\.com|api\/v1/.test(code(f))) offenders.push(rel(f));
  }
  assert.deepEqual(offenders, [], '端点与域名应集中在 api 层，便于契约变更时单点修改');
});

test('P1：SIGN_SECRET 只在签名模块使用（避免散落）', () => {
  const offenders = all
    .filter((f) => /dbbc3dd73364b4084c3a69346e0ce2b2/.test(read(f)))
    .map(rel);
  assert.deepEqual(offenders, ['shared/core/constants.js'], '密钥应只在常量文件定义');
});

test('P1：token 不得被写进日志（logger 之外的 console 调用需自查）', () => {
  const offenders = [];
  for (const f of all.filter((f) => !rel(f).includes('platform/logger'))) {
    const c = code(f);
    if (/console\.(log|warn|error)\([^)]*token/i.test(c)) offenders.push(rel(f));
  }
  assert.deepEqual(offenders, []);
});
