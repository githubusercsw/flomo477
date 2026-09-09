import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { md5 } from '../../src/shared/core/md5.js';
import { buildSignRaw, generateSign, buildSignedParams } from '../../src/shared/core/sign.js';
import { buildFixedParams, resolvePath, buildRequest, ENDPOINTS } from '../../src/shared/api/endpoints.js';
import { isRetryableError, backoffMs, shouldRetry } from '../../src/shared/api/retry.js';
import { handleResponse, extractToken, extractSlug, extractList } from '../../src/shared/api/client.js';
import { SIGN_SECRET, ERROR_CODE, STORAGE_KEYS } from '../../src/shared/core/constants.js';
import { SIGN_VECTOR, CREATE_SUCCESS, LOGIN_SUCCESS, LOGIN_FAILED, SESSION_EXPIRED, NEED_VERIFY, DELETE_SUCCESS } from '../fixtures/api-responses.js';

// ---------- MD5 ----------
test('MD5 与 Node 原生实现逐字节一致（含中文/空串/长文本）', () => {
  const cases = ['', 'a', 'abc', 'message digest', '中文测试#标签', 'a<b&c>d', '🌏emoji', 'x'.repeat(1000)];
  for (const c of cases) {
    assert.equal(md5(c), crypto.createHash('md5').update(c, 'utf8').digest('hex'), `用例失败：${c.slice(0, 20)}`);
  }
});

test('MD5 标准向量', () => {
  assert.equal(md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
});

// ---------- 签名 ----------
test('签名：参数排序后用 & 连接再直接接 SECRET（末尾无多余 &）', () => {
  assert.equal(buildSignRaw({ b: 2, a: 1 }), `a=1&b=2${SIGN_SECRET}`);
});

test('★ 签名：与官方抓包验证的向量一致（真实请求，非本地自算）', () => {
  // 来源：flomo-api-analysis.md §三 + flomo-cli tests/test_signing.py
  // 这是从真实浏览器请求中抓出来的，比任何本地构造的基准都权威
  assert.equal(generateSign(SIGN_VECTOR.params), SIGN_VECTOR.expected);
});

test('签名：与 Node 原生 MD5 实现交叉验证', () => {
  const params = { timestamp: '1700000000', api_key: 'flomo_web', app_version: '4.0', platform: 'web', webp: '1' };
  const expect = crypto.createHash('md5').update(`api_key=flomo_web&app_version=4.0&platform=web&timestamp=1700000000&webp=1${SIGN_SECRET}`).digest('hex');
  assert.equal(generateSign(params), expect);
});

test('签名：跳过 null 与空串，但保留 0 与 false', () => {
  assert.equal(buildSignRaw({ a: 0, b: '', c: null, d: undefined, e: false, f: 'ok' }), `a=0&e=false&f=ok${SIGN_SECRET}`);
});

test('签名：数组用 key[]=item 形式且每项排序', () => {
  assert.equal(buildSignRaw({ tag: ['b', 'a'] }), `tag[]=a&tag[]=b${SIGN_SECRET}`);
});

test('签名：MD5 结果与手工计算一致', () => {
  const params = { api_key: 'flomo_web', tz: '8:0' };
  const expect = crypto.createHash('md5').update(`api_key=flomo_web&tz=8:0${SIGN_SECRET}`).digest('hex');
  assert.equal(generateSign(params), expect);
});

test('签名：固定参数与业务参数一起参与签名（不是只签业务参数）', () => {
  const signed = buildSignedParams({ content: '<p>hi</p>' }, buildFixedParams(1700000000000));
  assert.equal(signed.api_key, 'flomo_web');
  assert.equal(signed.app_version, '4.0');
  assert.equal(signed.content, '<p>hi</p>');
  // 签名由整体参数算出
  const clone = { ...signed };
  delete clone.sign;
  assert.equal(
    signed.sign,
    crypto
      .createHash('md5')
      .update(
        Object.keys(clone)
          .sort()
          .map((k) => `${k}=${clone[k]}`)
          .join('&') + SIGN_SECRET,
      )
      .digest('hex'),
  );
});

// ---------- 端点 ----------
test('端点：路径参数被正确替换与编码', () => {
  assert.equal(resolvePath('/memo/{slug}', { slug: 'abc' }), '/memo/abc');
  assert.equal(resolvePath('/memo/{slug}', { slug: 'a/b c' }), '/memo/a%2Fb%20c');
  assert.throws(() => resolvePath('/memo/{slug}', {}), /missing path param/);
});

test('固定参数：必须含 timestamp（秒级字符串），缺了服务端会报「请传入 timestamp」', () => {
  const f = buildFixedParams(1700000000000);
  assert.equal(f.timestamp, '1700000000', '应为秒级时间戳字符串');
  assert.equal(f.api_key, 'flomo_web');
  assert.equal(f.app_version, '4.0');
  assert.equal(f.platform, 'web');
  assert.equal(f.webp, '1');
  assert.equal(f.tz, undefined, 'tz 不属于公共参数，只在需要时作为业务参数传入');
});

test('固定参数：timestamp 每次重新生成（不写死，否则签名视为过期/重放）', () => {
  const a = buildFixedParams(1700000000000);
  const b = buildFixedParams(1700000005000);
  assert.notEqual(a.timestamp, b.timestamp);
  assert.equal(a.timestamp, '1700000000');
  assert.equal(b.timestamp, '1700000005');
});

test('端点：全部声明了方法与路径', () => {
  for (const [name, ep] of Object.entries(ENDPOINTS)) {
    assert.ok(['GET', 'POST', 'PUT', 'DELETE'].includes(ep.method), `${name} 方法非法`);
    assert.match(ep.path, /^\//, `${name} 路径应以 / 开头`);
  }
});

test('端点：关键端点齐全', () => {
  for (const name of ['login', 'createMemo', 'updatedMemos', 'recommended', 'notifyOfToday', 'deleteMemo']) {
    assert.ok(ENDPOINTS[name], `缺少端点 ${name}`);
  }
});

test('端点：buildRequest 不发起请求，只返回描述', () => {
  const r = buildRequest('getMemo', { pathParams: { slug: 'x' }, params: { a: 1 } });
  assert.equal(r.method, 'GET');
  assert.equal(r.path, '/memo/x');
  assert.deepEqual(r.businessParams, { a: 1 });
});

// ---------- 重试策略 ----------
test('重试：仅网络类可重试，业务错不重试', () => {
  assert.equal(isRetryableError(ERROR_CODE.NETWORK_ERROR), true);
  assert.equal(isRetryableError(ERROR_CODE.TIMEOUT), true);
  assert.equal(isRetryableError(ERROR_CODE.API_ERROR), false);
  assert.equal(isRetryableError(ERROR_CODE.NOT_AUTHENTICATED), false);
});

test('重试：指数退避 2s/4s/8s 且最多 3 次', () => {
  assert.equal(backoffMs(1), 2000);
  assert.equal(backoffMs(2), 4000);
  assert.equal(backoffMs(3), 8000);
  assert.equal(shouldRetry(ERROR_CODE.NETWORK_ERROR, 1), true);
  assert.equal(shouldRetry(ERROR_CODE.NETWORK_ERROR, 3), false);
  assert.equal(shouldRetry(ERROR_CODE.API_ERROR, 1), false);
});

// ---------- 响应解析 ----------
test('响应：成功取 data', () => {
  const r = handleResponse({ code: 0, message: 'success', data: { slug: 'abc' } }, 200);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { slug: 'abc' });
});

test('响应：认证类错误归一', () => {
  assert.equal(handleResponse({ code: -10, message: 'x' }, 200).error, ERROR_CODE.NOT_AUTHENTICATED);
  assert.equal(handleResponse({ code: -20, message: 'x' }, 200).error, ERROR_CODE.NOT_AUTHENTICATED);
});

test('响应：-1 + 没有找到 → not_found', () => {
  assert.equal(handleResponse({ code: -1, message: '没有找到该笔记' }, 200).error, ERROR_CODE.NOT_FOUND);
});

test('响应：429 与其他 HTTP 状态', () => {
  assert.equal(handleResponse({ __raw: 'x' }, 429).error, ERROR_CODE.RATE_LIMITED);
  assert.equal(handleResponse({ __raw: 'x' }, 500).error, ERROR_CODE.API_ERROR);
});

test('响应：结构异常识别为接口可能已变更（不崩）', () => {
  assert.equal(handleResponse({ data: {} }, 200).error, ERROR_CODE.CONTRACT_CHANGED);
  assert.equal(handleResponse(null, 200).error, ERROR_CODE.CONTRACT_CHANGED);
});

test('响应：缺 data 字段时给空对象而非 undefined', () => {
  const r = handleResponse({ code: 0, message: 'ok' }, 200);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, {});
});

// ---------- 字段提取（防御式）----------
test('token 提取：兼容多种字段位置', () => {
  assert.equal(extractToken({ access_token: 'a' }), 'a');
  assert.equal(extractToken({ token: 'b' }), 'b');
  assert.equal(extractToken({ user: { access_token: 'c' } }), 'c');
  assert.equal(extractToken({}), null);
  assert.equal(extractToken(null), null);
});

test('slug 提取：兼容顶层与嵌套，缺失返回 null（供上层走退路）', () => {
  assert.equal(extractSlug({ slug: 's1' }), 's1');
  assert.equal(extractSlug({ memo: { slug: 's2' } }), 's2');
  assert.equal(extractSlug({}), null);
  assert.equal(extractSlug(null), null);
});

test('存储键：token 与 device_id 均已定义', () => {
  assert.equal(STORAGE_KEYS.TOKEN, 'token');
  assert.ok(STORAGE_KEYS.DEVICE_ID);
});


// ---------- 用官方真实响应回放（不是编造的 mock）----------
test('★ 创建笔记：官方真实响应含 slug → 撤销/删除功能成立（审计 L3 已解答）', () => {
  const r = handleResponse(CREATE_SUCCESS, 200);
  assert.equal(r.ok, true);
  assert.equal(r.data.slug, 'MjI2MzY1Mjgx', '官方响应里确实有 slug');
  assert.equal(extractSlug(r.data), 'MjI2MzY1Mjgx');
});

test('★ 登录：官方真实响应结构与 token 提取', () => {
  const r = handleResponse(LOGIN_SUCCESS, 200);
  assert.equal(r.ok, true);
  assert.equal(extractToken(r.data), 'your-access-token');
  assert.equal(r.data.id, 100001);
});

test('官方 fixture 完整性：全部响应都能被正确归类', () => {
  assert.equal(handleResponse(LOGIN_FAILED, 200).error, ERROR_CODE.API_ERROR);
  assert.equal(handleResponse(SESSION_EXPIRED, 200).error, ERROR_CODE.NOT_AUTHENTICATED);
  assert.equal(handleResponse(NEED_VERIFY, 200).error, ERROR_CODE.NOT_AUTHENTICATED);
  assert.equal(handleResponse(DELETE_SUCCESS, 200).ok, true);
});

// ---------- 列表提取（官方响应有两种形态）----------
test('extractList：data 直接是数组（官方记录的形态）', () => {
  assert.deepEqual(extractList([{ slug: 'a' }]), [{ slug: 'a' }]);
});

test('extractList：data 是对象含 memos 字段', () => {
  assert.deepEqual(extractList({ memos: [{ slug: 'a' }] }), [{ slug: 'a' }]);
});

test('extractList：data 是对象含 data 字段', () => {
  assert.deepEqual(extractList({ data: [{ slug: 'a' }] }), [{ slug: 'a' }]);
});

test('extractList：异常输入返回空数组，不抛错', () => {
  assert.deepEqual(extractList(null), []);
  assert.deepEqual(extractList({}), []);
  assert.deepEqual(extractList('x'), []);
  assert.deepEqual(extractList(42), []);
});

test('★ 回归：同步响应若为纯数组，不能返回空列表', async () => {
  // 这个 case 曾导致同步拿到 0 条（真实服务端返回数组，而我们只读 data.memos）
  const r = handleResponse({ code: 0, message: 'success', data: [{ slug: 'a' }, { slug: 'b' }] }, 200);
  assert.equal(r.ok, true);
  assert.equal(extractList(r.data).length, 2, '必须能识别数组形态');
});
