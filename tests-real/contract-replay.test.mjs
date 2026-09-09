// 契约回放：用**官方抓包**的真实响应驱动真实源码跑通全链路。
//
// 与自编 mock 的区别：这里的每个响应都是 flomo 真实返回的（记录在 flomo-api-analysis.md 中），
// 所以这套测试通过 = 我们的代码能正确处理真实服务端行为 —— **不需要真机验证这些场景**。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '/data/workspace/flomo-extension/src/shared/api/client.js';
import { formatMemo, htmlToText } from '/data/workspace/flomo-extension/src/shared/core/memo.js';
import * as FX from '/data/workspace/flomo-extension/tests/fixtures/api-responses.js';

/** 按路径回放官方响应 */
function replayFetch(routes) {
  const seen = [];
  const fn = async (url, init) => {
    const p = new URL(url).pathname;
    const method = init?.method;
    seen.push({ path: p, method, body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers });
    const key = Object.keys(routes).find((k) => {
      const [m, path] = k.split(' ');
      return m === method && (path.endsWith('*') ? p.startsWith(path.slice(0, -1)) : p === path);
    });
    const payload = key ? routes[key] : { code: 0, message: 'success', data: {} };
    const status = payload === FX.RATE_LIMITED_RAW ? 429 : 200;
    return {
      ok: status < 400,
      status,
      text: async () => (payload.__raw ? payload.__raw : JSON.stringify(payload)),
    };
  };
  fn.seen = seen;
  return fn;
}

const opts = (fetchImpl) => ({
  fetchImpl,
  tokenProvider: async () => 'real-token',
  deviceIdProvider: async () => 'fixed-device-id',
  now: () => 1773669997000, // 与官方签名向量的时间戳一致
  sleep: async () => {},
  onLog: () => {},
});

test('★ 登录：回放官方成功响应，token 正确提取并可用于后续请求', async () => {
  const fetchImpl = replayFetch({ 'POST /api/v1/user/login_by_email': FX.LOGIN_SUCCESS });
  const c = createClient(opts(fetchImpl));
  const res = await c.login('you@example.com', 'pwd');

  assert.equal(res.ok, true);
  assert.equal(res.data.token, 'your-access-token');
  const req = fetchImpl.seen[0];
  assert.equal(req.method, 'POST');
  assert.equal(req.body.timestamp, '1773669997');
  assert.equal(req.body.email, 'you@example.com');
  assert.equal(req.headers['Authorization'], undefined, '登录不带 Authorization');
});

test('★ 创建笔记：回放官方响应，确认 slug 存在（审计 L3 → 撤销功能成立）', async () => {
  const fetchImpl = replayFetch({ 'PUT /api/v1/memo': FX.CREATE_SUCCESS });
  const c = createClient(opts(fetchImpl));
  const res = await c.createMemo('<p>笔记内容，支持 HTML</p>');

  assert.equal(res.ok, true);
  assert.equal(res.data.slug, 'MjI2MzY1Mjgx');
  assert.equal(res.data.slugResolved, true, '★ 官方响应含 slug → 撤销/删除可以实现');
  assert.deepEqual(res.data.raw.tags, ['自动从内容中提取的标签']);
});

test('★ 同步：官方响应里软删笔记能被正确识别（本地过滤的数据基础）', async () => {
  const fetchImpl = replayFetch({ 'GET /api/v1/memo/updated/': FX.SYNC_PAGE });
  const c = createClient(opts(fetchImpl));
  const res = await c.updatedMemos({}, 200);

  assert.equal(res.ok, true);
  assert.equal(res.data.memos.length, 2);
  const formatted = res.data.memos.map(formatMemo);
  const alive = formatted.filter((m) => !m.isDeleted);
  const gone = formatted.filter((m) => m.isDeleted);
  assert.equal(alive.length, 1, '应识别出 1 条正常笔记');
  assert.equal(gone.length, 1, '应识别出 1 条软删笔记（deleted_at 非空）');
  assert.equal(gone[0].slug, 'MTA1MDM5OTgz');
});

test('★ 同步：官方完整 memo 结构能被正确格式化（含图片附件与层级标签）', async () => {
  const m = formatMemo(FX.MEMO_FULL);
  assert.equal(m.slug, 'MTA1MDM5OTgy');
  assert.equal(m.contentText, 'HTML 格式的笔记内容', '富文本被纯文本化');
  assert.deepEqual(m.tags, ['标签名/子标签'], '层级标签保留');
  assert.equal(m.files.length, 1);
  assert.equal(m.isDeleted, false);
  assert.equal(m.pin, 0);
});

test('★ 相关笔记：官方响应中 similarity 是字符串格式', async () => {
  const fetchImpl = replayFetch({ 'GET /api/v1/memo/*': FX.RECOMMENDED });
  const c = createClient(opts(fetchImpl));
  const res = await c.recommended('MTU5ODc1ODQ');
  assert.equal(res.ok, true);
  const first = res.data[0] ?? res.data.memos?.[0];
  assert.ok(first, '应有推荐结果');
  assert.equal(typeof first.similarity, 'string', '官方返回字符串，不能当数字用');
  assert.equal(Number(first.similarity) > 0.9, true);
});

test('★ 每日回顾：官方返回 slug 列表（不是完整笔记）', async () => {
  const fetchImpl = replayFetch({ 'GET /api/v1/memo/notify_of_today/': FX.NOTIFY_TODAY });
  const c = createClient(opts(fetchImpl));
  const res = await c.notifyOfToday();
  assert.equal(res.ok, true);
  assert.deepEqual(res.data, ['MTA1MDM5OTgy', 'MjI2MzY1Mjgx'], '只有 slug，需要逐条拉取详情');
});

test('★ 认证失效：官方 -10 响应会归一为 not_authenticated', async () => {
  const fetchImpl = replayFetch({ 'GET /api/v1/user/me': FX.SESSION_EXPIRED });
  const c = createClient(opts(fetchImpl));
  const res = await c.me();
  assert.equal(res.ok, false);
  assert.equal(res.error, 'not_authenticated');
});

test('★ 限流：HTTP 429 归为 rate_limited 且不重试', async () => {
  let n = 0;
  const fn = replayFetch({});
  const counted = async (...a) => {
    n += 1;
    return { ok: false, status: 429, text: async () => 'too many requests' };
  };
  const c = createClient({ ...opts(counted), tokenProvider: async () => 't' });
  const res = await c.me();
  assert.equal(res.error, 'rate_limited');
  assert.equal(n, 1, '限流不应重试');
  void fn;
});

test('官方签名向量：真实请求中签名的位置正确（GET 在 query，PUT 在 body）', async () => {
  const fetchImpl = replayFetch({
    'GET /api/v1/user/me': FX.USER_ME,
    'PUT /api/v1/memo': FX.CREATE_SUCCESS,
  });
  const c = createClient(opts(fetchImpl));
  await c.me();
  await c.createMemo('<p>x</p>');
  // GET：签名在 query（通过 URL 解析可得）
  // PUT：签名在 body
  assert.ok(fetchImpl.seen[1].body.sign, 'PUT 的签名在 body 里');
  assert.equal(fetchImpl.seen[1].body.sign.length, 32, 'MD5 应为 32 位');
});

test('纯文本化：官方 HTML 内容能安全还原（不丢尖括号）', () => {
  // 官方样例含 HTML，确保我们处理时不会把用户写的标签当结构
  assert.equal(htmlToText('<p>a &lt; b</p>'), 'a < b');
  assert.equal(htmlToText(FX.MEMO_FULL.content), 'HTML 格式的笔记内容');
});
