// P1 集成测试：真实源码 + mock fetch，跑通「登录 → 创建 → 删除 → 同步」整条链路。
// 客户端通过注入式依赖使用 mock，被测代码仍是产品代码本身。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '/data/workspace/flomo-extension/src/shared/api/client.js';
import { generateSign } from '/data/workspace/flomo-extension/src/shared/core/sign.js';
import { buildFixedParams } from '/data/workspace/flomo-extension/src/shared/api/endpoints.js';
import { md5 } from '/data/workspace/flomo-extension/src/shared/core/md5.js';
import { textToHtml, htmlToText } from '/data/workspace/flomo-extension/src/shared/core/memo.js';
import { ERROR_CODE, SIGN_SECRET } from '/data/workspace/flomo-extension/src/shared/core/constants.js';

/** 记录请求并按需回放响应的 mock fetch */
function mockFetch(handler) {
  const seen = [];
  const fn = async (url, init) => {
    const parsed = new URL(url);
    seen.push({
      url,
      path: parsed.pathname,
      method: init?.method,
      query: Object.fromEntries(parsed.searchParams),
      body: init?.body ? parseBodyMaybe(init.body) : null,
      contentType: init?.headers?.['Content-Type'],
      headers: init?.headers,
    });
    return handler(seen[seen.length - 1], seen.length) ?? json({ code: 0, message: 'success', data: {} });
  };
  fn.seen = seen;
  return fn;
}

function parseBodyMaybe(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

function json(obj, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(obj) };
}

const clientOpts = (fetchImpl, token = 'tok-abc') => ({
  fetchImpl,
  tokenProvider: async () => token,
  deviceIdProvider: async () => 'device-fixed-uuid',
  now: () => 1700000000000, // 固定时间戳，便于断言
  sleep: async () => {}, // 测试不等退避
  onLog: () => {},
});

// ---------- 登录 ----------
test('登录：请求带签名、固定参数，且不带 Authorization', async () => {
  const fetchImpl = mockFetch(() => json({ code: 0, message: 'success', data: { access_token: 'tok-123', user: { nickname: 'me' } } }));
  const c = createClient(clientOpts(fetchImpl, null));
  const res = await c.login('a@b.com', 'pwd');

  assert.equal(res.ok, true);
  assert.equal(res.data.token, 'tok-123');
  const req = fetchImpl.seen[0];
  assert.equal(req.method, 'POST');
  assert.equal(req.path, '/api/v1/user/login_by_email');
  assert.equal(req.body.email, 'a@b.com');
  assert.equal(req.body.api_key, 'flomo_web');
  assert.equal(req.body.timestamp, '1700000000', '登录也必须带 timestamp');
  assert.equal(req.contentType, 'application/json', '登录用 JSON body');
  assert.equal(req.body.wechat_union_id, '');
  assert.ok(req.body.sign, 'body 必须带签名');
  assert.equal(req.headers['Authorization'], undefined, '登录请求不应带 Authorization');
  assert.equal(req.headers['device-id'], 'device-fixed-uuid');
  assert.equal(req.headers['platform'], 'web');
});

test('登录：签名可被服务端算法复现（含固定参数整体签名）', async () => {
  const fetchImpl = mockFetch(() => json({ code: 0, data: { access_token: 't' } }));
  const c = createClient(clientOpts(fetchImpl, null));
  await c.login('a@b.com', 'pwd');
  const body = fetchImpl.seen[0].body;
  const { sign, ...rest } = body;
  const expect = generateSign(rest);
  assert.equal(sign, expect, '签名必须由全部参数（含固定参数）算出');
});

test('登录：服务端报错原文透传，不改写', async () => {
  const fetchImpl = mockFetch(() => json({ code: -1, message: '邮箱或密码错误', data: null }));
  const c = createClient(clientOpts(fetchImpl, null));
  const res = await c.login('a@b.com', 'bad');
  assert.equal(res.ok, false);
  assert.equal(res.message, '邮箱或密码错误');
});

test('登录：响应无 token → 判定接口可能已变更（不静默成功）', async () => {
  const fetchImpl = mockFetch(() => json({ code: 0, data: {} }));
  const c = createClient(clientOpts(fetchImpl, null));
  const res = await c.login('a@b.com', 'pwd');
  assert.equal(res.ok, false);
  assert.equal(res.error, ERROR_CODE.CONTRACT_CHANGED);
});

// ---------- 创建笔记 ----------
test('创建：文本先转义再包 <p>，签名放 body', async () => {
  const fetchImpl = mockFetch(() => json({ code: 0, data: { slug: 'MzA3NzA5' } }));
  const c = createClient(clientOpts(fetchImpl));
  const res = await c.createMemo(textToHtml('a < b & c'));

  assert.equal(res.ok, true);
  assert.equal(res.data.slug, 'MzA3NzA5');
  assert.equal(res.data.slugResolved, true);
  const req = fetchImpl.seen[0];
  assert.equal(req.method, 'PUT');
  assert.equal(req.path, '/api/v1/memo');
  assert.equal(req.body.content, '<p>a &lt; b &amp; c</p>', '写入前必须转义');
  assert.equal(req.headers['Authorization'], 'Bearer tok-abc');
});

test('创建：往返不丢内容（转义闭环）', async () => {
  const original = 'a < b & c > d <script>x</script>';
  const html = textToHtml(original);
  assert.equal(htmlToText(html), original);
});

test('创建：响应无 slug 时返回 slugResolved=false（供上层关闭撤销，不崩）', async () => {
  const fetchImpl = mockFetch(() => json({ code: 0, data: { memo: { content: 'x' } } }));
  const c = createClient(clientOpts(fetchImpl));
  const res = await c.createMemo('<p>x</p>');
  assert.equal(res.ok, true);
  assert.equal(res.data.slug, null);
  assert.equal(res.data.slugResolved, false);
});

// ---------- 删除 ----------
test('删除：走 DELETE，带 slug 与签名', async () => {
  const fetchImpl = mockFetch(() => json({ code: 0, data: {} }));
  const c = createClient(clientOpts(fetchImpl));
  const res = await c.deleteMemo('MzA3NzA5');
  assert.equal(res.ok, true);
  const req = fetchImpl.seen[0];
  assert.equal(req.method, 'DELETE');
  assert.equal(req.path, '/api/v1/memo/MzA3NzA5');
  assert.ok(req.query.sign, 'DELETE 的签名放 query');
});

// ---------- 同步 ----------
test('同步：带 tz 与游标，签名放 query（不再发送 include_deleted，它在 CLI 里是本地过滤）', async () => {
  const fetchImpl = mockFetch(() => json({ code: 0, data: { memos: [{ slug: 'a', content: '<p>hi</p>' }] } }));
  const c = createClient(clientOpts(fetchImpl));
  const res = await c.updatedMemos({ latest_updated_at: 1700000000, latest_slug: 'prev' }, 200);

  assert.equal(res.ok, true);
  assert.equal(res.data.memos.length, 1);
  const req = fetchImpl.seen[0];
  assert.equal(req.method, 'GET');
  assert.equal(req.query.tz, '8:0');
  assert.equal(req.query.timestamp, '1700000000');
  assert.equal(req.query.latest_updated_at, '1700000000');
  assert.equal(req.query.latest_slug, 'prev');
  assert.equal(req.query.limit, '200');
  assert.equal(req.query.include_deleted, undefined, 'include_deleted 是本地过滤，不是服务端参数');
  assert.ok(req.query.sign);
});

test('同步：首页无游标时 latest_updated_at=0 且不传 latest_slug', async () => {
  const fetchImpl = mockFetch(() => json({ code: 0, data: { memos: [] } }));
  const c = createClient(clientOpts(fetchImpl));
  const res = await c.updatedMemos({}, 200);
  assert.equal(res.data.memos.length, 0);
  assert.equal(res.data.hasMore, false, '空列表即到底');
  const req = fetchImpl.seen[0];
  assert.equal(req.query.latest_updated_at, '0');
  assert.equal(req.query.latest_slug, undefined);
});

test('请求格式：PUT/POST 用 JSON body（不是 form-urlencoded）', async () => {
  const fetchImpl = mockFetch(() => json({ code: 0, data: { slug: 's' } }));
  const c = createClient(clientOpts(fetchImpl));
  await c.createMemo('<p>hi</p>');
  const req = fetchImpl.seen[0];
  assert.equal(req.method, 'PUT');
  assert.equal(req.contentType, 'application/json');
  assert.equal(typeof req.body, 'object', 'body 应被解析为对象（JSON）');
  assert.equal(req.body.content, '<p>hi</p>');
  assert.equal(req.body.source, 'web');
  assert.equal(req.body.tz, '8:0');
});

test('请求格式：GET/DELETE 用 query，不带 body', async () => {
  const fetchImpl = mockFetch(() => json({ code: 0, data: {} }));
  const c = createClient(clientOpts(fetchImpl));
  await c.deleteMemo('abc');
  const req = fetchImpl.seen[0];
  assert.equal(req.method, 'DELETE');
  assert.equal(req.body, null, 'DELETE 不应带 body');
  assert.equal(req.query.timestamp, '1700000000');
  assert.ok(req.query.sign);
});

test('每个请求都带 timestamp 且各不相同（参与签名，防重放）', async () => {
  let t = 1700000000000;
  const fetchImpl = mockFetch(() => json({ code: 0, data: {} }));
  const c = createClient({ ...clientOpts(fetchImpl), now: () => (t += 5000) });
  await c.me();
  await c.me();
  assert.equal(fetchImpl.seen[0].query.timestamp, '1700000005');
  assert.equal(fetchImpl.seen[1].query.timestamp, '1700000010');
  assert.notEqual(fetchImpl.seen[0].query.sign, fetchImpl.seen[1].query.sign, 'timestamp 变了签名也应变');
});

// ---------- 错误与重试 ----------
test('错误：-10 归一为 not_authenticated（上层据此清 token 引导登录）', async () => {
  const fetchImpl = mockFetch(() => json({ code: -10, message: 'session expired' }));
  const c = createClient(clientOpts(fetchImpl));
  const res = await c.me();
  assert.equal(res.error, ERROR_CODE.NOT_AUTHENTICATED);
});

test('错误：API 业务错不重试（只发一次请求）', async () => {
  let n = 0;
  const fetchImpl = mockFetch(() => {
    n += 1;
    return json({ code: -1, message: '业务错误' });
  });
  const c = createClient(clientOpts(fetchImpl));
  await c.me();
  assert.equal(n, 1, '业务错误不应重试');
});

test('错误：网络错才重试，最多 3 次', async () => {
  let n = 0;
  const fetchImpl = mockFetch(() => {
    n += 1;
    throw new Error('network down');
  });
  const c = createClient(clientOpts(fetchImpl));
  const res = await c.me();
  assert.equal(n, 3, '网络错应重试至上限 3 次');
  assert.equal(res.error, ERROR_CODE.NETWORK_ERROR);
});

test('错误：限流归为 rate_limited 且不重试', async () => {
  let n = 0;
  const fetchImpl = mockFetch(() => {
    n += 1;
    return json({ code: 0, data: {} }, 429);
  });
  const c = createClient(clientOpts(fetchImpl));
  const res = await c.me();
  assert.equal(res.error, ERROR_CODE.RATE_LIMITED);
  assert.equal(n, 1);
});

test('错误：非 JSON 响应识别为接口可能已变更', async () => {
  const fetchImpl = mockFetch(() => ({ ok: true, status: 200, text: async () => '<html>error</html>' }));
  const c = createClient(clientOpts(fetchImpl));
  const res = await c.me();
  assert.equal(res.error, ERROR_CODE.CONTRACT_CHANGED);
});

// ---------- 安全 ----------
test('安全：device-id 全程复用同一值（不每次随机）', async () => {
  const fetchImpl = mockFetch(() => json({ code: 0, data: {} }));
  const c = createClient(clientOpts(fetchImpl));
  await c.me();
  await c.me();
  assert.equal(fetchImpl.seen[0].headers['device-id'], fetchImpl.seen[1].headers['device-id']);
});

test('安全：日志回调不收到 token（脱敏由 platform/logger 负责，此处确认不传入）', async () => {
  const logs = [];
  const fetchImpl = mockFetch(() => json({ code: 0, data: {} }));
  const c = createClient({ ...clientOpts(fetchImpl), onLog: (l, s, m, d) => logs.push({ m, d }) });
  await c.me();
  const flat = JSON.stringify(logs);
  assert.equal(flat.includes('tok-abc'), false, '日志不得含 token');
});

test('签名固定参数与常量一致（含 timestamp）', () => {
  const f = buildFixedParams(1700000000000);
  assert.equal(f.timestamp, '1700000000', '必须含 timestamp，否则服务端报「请传入 timestamp」');
  assert.equal(f.api_key, 'flomo_web');
  assert.equal(f.app_version, '4.0');
  assert.equal(f.platform, 'web');
  assert.equal(f.webp, '1');
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(SIGN_SECRET.length, 32);
});
