// P1 后台链路：真实 messaging + 真实 storage + 注入 mock fetch，
// 覆盖「UI 发消息 → 后台 → API」的完整接缝（这是最容易出错的地方）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChromeMock } from './chrome-mock.mjs';
import { mountPage, runUiModule, runBackground, tick } from './harness.mjs';

const SRC = '/data/workspace/flomo-extension/src';

/** 用 mock fetch 顶掉全局 fetch，并安装后台 */
async function setup(handler) {
  const chrome = createChromeMock();
  globalThis.chrome = chrome;

  const seen = [];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    seen.push({
      path: parsed.pathname,
      method: init?.method,
      query: Object.fromEntries(parsed.searchParams),
      body: init?.body ? parseBodyMaybe(init.body) : null,
      headers: init?.headers,
    });
    return handler(seen[seen.length - 1], seen.length);
  };
  globalThis.fetch = fetchImpl;

  await runBackground('index.js');
  await tick(60);
  await runBackground('api-proxy.js');
  await tick(60);
  return { chrome, seen };
}

function parseBodyMaybe(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

const json = (obj, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(obj) });
const send = (chrome, type, payload) =>
  new Promise((r) => chrome.runtime.sendMessage({ type, payload }, r));

test('未登录：memo_create 被把关中枢拦下，返回 not_authenticated 且不发请求', async () => {
  const { chrome, seen } = await setup(() => json({ code: 0, data: {} }));
  const res = await send(chrome, 'memo_create', { text: 'hello' });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'not_authenticated');
  assert.equal(seen.length, 0, '未登录不应发出任何 API 请求');
});

test('登录成功：token 与 user 落盘，后续请求带上 Authorization', async () => {
  const { chrome, seen } = await setup((req) => {
    if (req.path.endsWith('/user/login_by_email')) {
      return json({ code: 0, data: { access_token: 'tok-xyz', user: { nickname: '小明' } } });
    }
    return json({ code: 0, data: { slug: 'MzA3NzA5' } });
  });

  const login = await send(chrome, 'auth_login', { email: 'a@b.com', password: 'pwd' });
  assert.equal(login.ok, true);

  const { token, user } = await new Promise((r) => chrome.storage.local.get(['token', 'user'], r));
  assert.equal(token, 'tok-xyz', 'token 必须落盘');
  assert.equal(user.nickname, '小明', '用户信息应缓存供设置页显示');

  const create = await send(chrome, 'memo_create', { text: 'a < b' });
  assert.equal(create.ok, true);
  assert.equal(create.data.slug, 'MzA3NzA5');
  assert.equal(seen.at(-1).headers['Authorization'], 'Bearer tok-xyz');
});

test('登录：空邮箱/密码前端拦截，不发请求', async () => {
  const { chrome, seen } = await setup(() => json({ code: 0, data: {} }));
  const r1 = await send(chrome, 'auth_login', { email: '', password: 'x' });
  assert.equal(r1.error, 'validation_error');
  const r2 = await send(chrome, 'auth_login', { email: 'a@b.com', password: '' });
  assert.equal(r2.error, 'validation_error');
  assert.equal(seen.length, 0);
});

test('登录失败：服务端原文透传到 UI（不翻译不改写）', async () => {
  const { chrome } = await setup(() => json({ code: -1, message: '邮箱或密码错误', data: null }));
  const res = await send(chrome, 'auth_login', { email: 'a@b.com', password: 'bad' });
  assert.equal(res.ok, false);
  assert.equal(res.message, '邮箱或密码错误');
});

test('token 失效：调用后自动清 token 并发通知', async () => {
  let notified = null;
  const { chrome } = await setup(() => json({ code: -10, message: 'session expired' }));
  chrome.notifications = {
    create: (opts) => {
      notified = opts;
    },
  };
  await new Promise((r) => chrome.storage.local.set({ token: 'old' }, r));

  const res = await send(chrome, 'api_me', {});
  assert.equal(res.error, 'not_authenticated');
  const { token } = await new Promise((r) => chrome.storage.local.get(['token'], r));
  assert.equal(token, undefined, '失效后必须清掉本地 token');
  assert.ok(notified, '应发通知引导重新登录');
});

test('登出：清除 token 与 user', async () => {
  const { chrome } = await setup(() => json({ code: 0, data: {} }));
  await new Promise((r) => chrome.storage.local.set({ token: 't', user: { nickname: 'x' } }, r));
  await send(chrome, 'auth_logout', {});
  const { token, user } = await new Promise((r) => chrome.storage.local.get(['token', 'user'], r));
  assert.equal(token, undefined);
  assert.equal(user, undefined);
});

test('auth_status：反映真实登录态', async () => {
  const { chrome } = await setup(() => json({ code: 0, data: {} }));
  assert.equal((await send(chrome, 'auth_status', {})).data.loggedIn, false);
  await new Promise((r) => chrome.storage.local.set({ token: 't' }, r));
  assert.equal((await send(chrome, 'auth_status', {})).data.loggedIn, true);
});

test('memo_create：写入前转义，空文本不产生无意义请求', async () => {
  const { chrome, seen } = await setup((req) => {
    if (req.path.endsWith('/user/login_by_email')) return json({ code: 0, data: { access_token: 't' } });
    return json({ code: 0, data: { slug: 's1' } });
  });
  await send(chrome, 'auth_login', { email: 'a@b.com', password: 'p' });
  await send(chrome, 'memo_create', { text: 'a < b & c' });
  const body = seen.at(-1).body;
  assert.equal(body.content, '<p>a &lt; b &amp; c</p>', '必须转义后再包 <p>');
});

test('带来源：标题与链接拼在正文后', async () => {
  const { chrome, seen } = await setup((req) => {
    if (req.path.endsWith('/user/login_by_email')) return json({ code: 0, data: { access_token: 't' } });
    return json({ code: 0, data: { slug: 's1' } });
  });
  await send(chrome, 'auth_login', { email: 'a@b.com', password: 'p' });
  await send(chrome, 'memo_create', {
    text: '摘录内容',
    withSource: true,
    source: { title: '某文章', url: 'https://example.com/post' },
  });
  assert.equal(
    seen.at(-1).body.content,
    '<p>摘录内容</p><p>某文章 https://example.com/post</p>',
  );
});

test('登录页：真实表单渲染，空值提交前端拦截且不发请求', async () => {
  const chrome = createChromeMock();
  globalThis.chrome = chrome;
  let called = 0;
  globalThis.fetch = async () => {
    called += 1;
    return json({ code: 0, data: { access_token: 't' } });
  };
  await runBackground('index.js');
  await tick(60);
  await runBackground('api-proxy.js');
  await tick(60);

  const dom = mountPage('login.html', chrome);
  await runUiModule('login.js');
  await tick(200);

  const form = dom.window.document.querySelector('#login-form');
  assert.ok(form, '应渲染登录表单');
  assert.ok(dom.window.document.querySelector('#email'), '邮箱输入框');
  assert.ok(dom.window.document.querySelector('#password'), '密码输入框');

  // 空值提交：前端拦截，不发请求
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(80);
  assert.equal(called, 0, '空值不应发请求');
  const err = dom.window.document.querySelector('#error');
  assert.equal(err.hidden, false, '应显示错误提示');
  assert.ok(err.textContent.length > 0);
  dom.window.close();
});

test('登录页：填写后提交可登录成功并写入 token', async () => {
  const chrome = createChromeMock();
  globalThis.chrome = chrome;
  globalThis.fetch = async (url, init) => {
    const p = new URL(url).pathname;
    if (p.endsWith('/user/login_by_email')) return json({ code: 0, data: { access_token: 'tok-form', user: { nickname: '表单用户' } } });
    return json({ code: 0, data: {} });
  };
  await runBackground('index.js');
  await tick(60);
  await runBackground('api-proxy.js');
  await tick(60);

  const dom = mountPage('login.html', chrome);
  await runUiModule('login.js');
  await tick(200);

  dom.window.document.querySelector('#email').value = 'me@example.com';
  dom.window.document.querySelector('#password').value = 'secret';
  dom.window.document
    .querySelector('#login-form')
    .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(200);

  const { token } = await new Promise((r) => chrome.storage.local.get(['token'], r));
  assert.equal(token, 'tok-form', '登录成功应写入 token');
  dom.window.close();
});

test('依赖方向：api 层不依赖 chrome.*（可注入、可在 Node 中测试）', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(`${SRC}/shared/api/client.js`, 'utf8');
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
  assert.equal(/chrome\s*\./.test(code), false, 'api 层不得直接依赖 chrome.*');
});
