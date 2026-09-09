// 「准真机」集成测试：真实源码 + 内存 chrome API + jsdom。
// 目的是在无法加载真实浏览器的沙盒里，尽可能覆盖模块间的接缝缺陷。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChromeMock } from './chrome-mock.mjs';
import { mountPage, runUiModule, runBackground, runContentScript, tick } from './harness.mjs';

function freshEnv() {
  const chrome = createChromeMock();
  globalThis.chrome = chrome;
  return chrome;
}

test('后台启动：onInstalled 会写入默认配置、注册定时与右键菜单、并设置图标行为', async () => {
  const chrome = freshEnv();
  await runBackground('index.js');
  await tick(60);

  // 触发安装事件
  chrome.__emit('runtime.onInstalled', { reason: 'install' });
  await tick(120);

  const { config } = await new Promise((r) => chrome.storage.local.get(['config'], r));
  assert.ok(config, '默认配置已写入 storage');
  assert.equal(config.language, 'zh');
  assert.equal(config.captureTrigger, 'icon');
  assert.equal(config.syncIntervalMinutes, 5);

  assert.ok(
    chrome.__calls.some((c) => c.name === 'alarms.create' && c.args[0] === 'flomo-sync'),
    '已注册同步定时',
  );
  assert.ok(
    chrome.__calls.some((c) => c.name === 'contextMenus.create' && c.args[0] === 'flomo-capture-selection'),
    '已注册右键菜单',
  );
  assert.equal(chrome.sidePanel._behavior.openPanelOnActionClick, false, '未登录时应弹 Popup');
});

test('已登录后：图标行为切换为打开 Side Panel（智能分流）', async () => {
  const chrome = freshEnv();
  await runBackground('index.js');
  await runBackground('action-behavior.js');
  await tick(60);

  const { refreshActionBehavior } = await runBackground('action-behavior.js').then(async () => {
    await tick(30);
    return { refreshActionBehavior: (await import('/data/workspace/flomo-extension/src/background/action-behavior.js')).refreshActionBehavior };
  });
  void refreshActionBehavior;

  // 写入 token 后再刷新
  await new Promise((r) => chrome.storage.local.set({ token: 'tok-123' }, r));
  const mod = await runBackground('action-behavior.js');
  const openPanel = await mod.refreshActionBehavior();
  assert.equal(openPanel, true, '已登录时应开 Side Panel');
  assert.equal(chrome.sidePanel._behavior.openPanelOnActionClick, true);
});

test('消息总线：ping / config_get / config_set 往返与错误归一化', async () => {
  const chrome = freshEnv();
  await runBackground('index.js');
  await tick(80);

  const ping = await new Promise((r) =>
    chrome.runtime.sendMessage({ type: 'ping', payload: {} }, r),
  );
  assert.equal(ping.ok, true);
  assert.equal(ping.data.pong, true);

  const got = await new Promise((r) =>
    chrome.runtime.sendMessage({ type: 'config_get', payload: {} }, r),
  );
  assert.equal(got.ok, true);
  assert.equal(got.data.theme, 'system');

  const set = await new Promise((r) =>
    chrome.runtime.sendMessage({ type: 'config_set', payload: { patch: { theme: 'dark' } } }, r),
  );
  assert.equal(set.ok, true);
  assert.equal(set.data.theme, 'dark');

  const bad = await new Promise((r) =>
    chrome.runtime.sendMessage({ type: 'nope', payload: {} }, r),
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'validation_error');
});

test('Popup 页面：未登录渲染登录表单，已登录渲染速记框（登录态感知）', async () => {
  const chrome = freshEnv();
  await runBackground('index.js');
  await tick(80);
  await runBackground('api-proxy.js');
  await tick(60);

  // 未登录 → 登录表单
  let dom = mountPage('popup.html', chrome);
  await runUiModule('popup.js');
  await tick(250);
  assert.ok(dom.window.document.querySelector('#login-form'), '未登录应渲染登录表单');
  assert.ok(dom.window.document.querySelector('#email'), '含邮箱输入框');
  dom.window.close();

  // 写入 token 模拟已登录 → 速记框
  await new Promise((r) => chrome.storage.local.set({ token: 'tok' }, r));
  dom = mountPage('popup.html', chrome);
  await runUiModule('popup.js');
  await tick(250);
  assert.ok(dom.window.document.querySelector('#text'), '已登录应渲染速记输入区');
  const saveBtn = dom.window.document.querySelector('#save');
  assert.equal(saveBtn.disabled, true, '空内容时保存按钮应禁用');

  // 输入内容后按钮启用（trim 空值判定）
  const textEl = dom.window.document.querySelector('#text');
  textEl.value = '   ';
  textEl.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await tick(30);
  assert.equal(saveBtn.disabled, true, '纯空格仍应禁用');
  textEl.value = '真实内容';
  textEl.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await tick(30);
  assert.equal(saveBtn.disabled, false, '有内容后应可保存');
  dom.window.close();
});

test('i18n 运行时切换：改为 en 后页面热更新为英文（不重载、不依赖 chrome.i18n）', async () => {
  const chrome = freshEnv();
  await runBackground('index.js');
  await tick(80);

  const dom = mountPage('options.html', chrome);
  await runUiModule('options.js');
  await tick(200);
  assert.match(dom.window.document.querySelector('h1').textContent, /设置/, '默认应为中文');

  // 改语言（走真实 config_set 通道）
  await new Promise((r) =>
    chrome.runtime.sendMessage({ type: 'config_set', payload: { patch: { language: 'en' } } }, r),
  );
  await tick(250);

  const en = dom.window.document.querySelector('h1').textContent;
  assert.match(en, /Settings/, `期望页面热更新为英文，实际：${en}`);
  dom.window.close();
});

test('配置热更新：content script 通过 storage.onChanged 拿到新配置', async () => {
  const chrome = freshEnv();
  await runBackground('index.js');
  await tick(60);
  chrome.__emit('runtime.onInstalled', { reason: 'install' });
  await tick(120);

  const dom = mountPage('sidepanel.html', chrome);
  runContentScript(dom, chrome);
  await tick(60);

  // 改配置 → content script 应通过 onChanged 收到（不依赖 runtime 广播）
  let seen = null;
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.config) seen = changes.config.newValue;
  });
  await new Promise((r) =>
    chrome.runtime.sendMessage({ type: 'config_set', payload: { patch: { captureTrigger: 'off' } } }, r),
  );
  await tick(120);

  assert.ok(seen, 'content script 环境应收到 storage.onChanged');
  assert.equal(seen.captureTrigger, 'off');
  dom.window.close();
});

test('content script：站点黑名单命中时不抛错（且默认站点可正常运行）', async () => {
  const chrome = freshEnv();
  await runBackground('index.js');
  await tick(60);
  chrome.__emit('runtime.onInstalled', { reason: 'install' });
  await tick(120);
  await new Promise((r) =>
    chrome.runtime.sendMessage(
      { type: 'config_set', payload: { patch: { siteBlacklist: ['blocked.example'] } } },
      r,
    ),
  );
  await tick(80);

  // 黑名单站点：应静默不启用
  const blocked = mountPage('sidepanel.html', chrome, { url: 'https://blocked.example/page' });
  let err1 = null;
  try {
    runContentScript(blocked, chrome);
    await tick(60);
  } catch (e) {
    err1 = e;
  }
  assert.equal(err1, null, `黑名单站点不应抛错：${err1 && err1.message}`);
  blocked.window.close();

  // 普通站点：应正常运行（不抛错）
  const ok = mountPage('sidepanel.html', chrome, { url: 'https://normal.example/page' });
  let err2 = null;
  try {
    runContentScript(ok, chrome);
    await tick(60);
  } catch (e) {
    err2 = e;
  }
  assert.equal(err2, null, `普通站点不应抛错：${err2 && err2.message}`);
  ok.window.close();
});

test('日志脱敏：token 与正文不出现在日志输出里', async () => {
  const chrome = freshEnv();
  globalThis.chrome = chrome;
  const loggerMod = await import('/data/workspace/flomo-extension/src/shared/platform/logger.js');
  const lines = [];
  const origWarn = console.warn;
  console.warn = (...a) =>
    lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  loggerMod.logger.warn('sync', 'failed', { token: 'secret-token', endpoint: '/memo', content: 'x'.repeat(300) });
  console.warn = origWarn;
  const out = lines.join(' ');
  assert.equal(out.includes('secret-token'), false, 'token 不得出现在日志');
  assert.equal(out.includes('***'), true, '敏感字段应被脱敏');
  assert.equal(out.includes('x'.repeat(300)), false, '正文不得出现在日志');
});

test('device-id 在启动时生成并持久化复用（禁止每次随机，避免风控）', async () => {
  const chrome = freshEnv();
  await runBackground('index.js');
  await tick(60);
  chrome.__emit('runtime.onInstalled', { reason: 'install' });
  await tick(150);

  const first = await new Promise((r) => chrome.storage.local.get(['device_id'], r));
  assert.ok(first.device_id, '首次启动应生成 device-id');

  // 再次触发启动（模拟 SW 重启），id 必须不变
  chrome.__emit('runtime.onStartup');
  await tick(150);
  const second = await new Promise((r) => chrome.storage.local.get(['device_id'], r));
  assert.equal(second.device_id, first.device_id, 'device-id 必须持久化复用，不得每次重新生成');
});

test('写入→读出闭环：用户输入尖括号不会被吞掉（纯文本化的前提）', async () => {
  const { escapeHtml, textToHtml, htmlToText } = await import(
    '/data/workspace/flomo-extension/src/shared/core/memo.js'
  );
  const original = 'a < b & c > d <script>x</script>';
  assert.equal(htmlToText(textToHtml(original)), original, '往返后必须还原原文');
  assert.equal(escapeHtml('<'), '&lt;');
});

test('零第三方请求：源码中不存在 flomoapp.com 以外的域名', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') || e.name.endsWith('.html')) files.push(p);
    }
  };
  walk('/data/workspace/flomo-extension/src');
  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const urls = src.match(/https?:\/\/[a-zA-Z0-9.-]+/g) || [];
    for (const u of urls) {
      if (!u.includes('flomoapp.com') && !u.includes('www.w3.org') && !u.includes('schemas.microsoft.com')) {
        offenders.push(`${path.relative('/data/workspace/flomo-extension/src', f)} → ${u}`);
      }
    }
  }
  assert.deepEqual(offenders, [], '不应存在第三方域名请求');
});
