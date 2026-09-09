// 契约守卫：把「我们的实现」与「官方契约文档」做静态比对。
//
// 目的：flomo 是逆向接口，契约一旦漂移，真机才会报错。
//      与其等真机反馈，不如开工前先自动核对一次 —— 这是把真机测试从"每次"降到"按需"的关键。
//
// 契约源：`_memory/raw/flomo-cli-source/`（上游 GitHub 仓库的本地副本）
//         由 `node tools/sync-contract.mjs` 同步；沙盒内 codeload.github.com 可达。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const CONTRACT_DIR = '/data/workspace/_memory/raw/flomo-cli-source';
const SRC = '/data/workspace/flomo-extension/src';

const readIfExists = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const clientPy = readIfExists(path.join(CONTRACT_DIR, 'flomo_cli/client.py'));
const constantsPy = readIfExists(path.join(CONTRACT_DIR, 'flomo_cli/constants.py'));
const analysisMd = readIfExists(path.join(CONTRACT_DIR, 'docs/flomo-api-analysis.md'));
const signingTest = readIfExists(path.join(CONTRACT_DIR, 'tests/test_signing.py'));

test('前置：契约源已固化（否则本组测试失去意义）', () => {
  assert.ok(clientPy, '缺少 flomo_cli/client.py —— 跑 node tools/sync-contract.mjs');
  assert.ok(analysisMd, '缺少 docs/flomo-api-analysis.md');
  assert.ok(signingTest, '缺少 tests/test_signing.py');
});

test('★ 签名常量：SIGN_SECRET 与上游一致', () => {
  const m = constantsPy.match(/SIGN_SECRET\s*=\s*"([a-f0-9]{32})"/);
  assert.ok(m, '上游未找到 SIGN_SECRET');
  const ours = readIfExists(path.join(SRC, 'shared/core/constants.js'));
  assert.ok(ours.includes(m[1]), `我们的 SIGN_SECRET 与上游不一致（上游 ${m[1]}）`);
});

test('★ 签名向量：实现结果与官方文档记录完全一致', async () => {
  const m = signingTest.match(/_generate_sign\(params\)\s*==\s*"([a-f0-9]{32})"/);
  assert.ok(m, '上游签名测试里未找到向量');
  const { generateSign } = await import('/data/workspace/flomo-extension/src/shared/core/sign.js');
  // 文档中的向量对应的参数（见 test_signing.py::test_sign_known_example）
  const params = {
    timestamp: '1773669997',
    api_key: 'flomo_web',
    app_version: '4.0',
    platform: 'web',
    webp: '1',
  };
  assert.equal(generateSign(params), m[1], `签名与官方抓包向量不符（应为 ${m[1]}）`);
});

test('★ 公共参数：上游有的我们一个都不能少（timestamp 是踩过坑的那个）', () => {
  const block = clientPy.match(/def _base_params\(self\)[^}]*?\}/s);
  assert.ok(block, '未找到 _base_params');
  for (const key of ['timestamp', 'api_key', 'app_version', 'platform', 'webp']) {
    assert.ok(block[0].includes(key), `上游公共参数含 ${key}，我们必须带上`);
  }
  const ours = readIfExists(path.join(SRC, 'shared/api/endpoints.js'));
  for (const key of ['timestamp', 'api_key', 'app_version', 'platform', 'webp']) {
    assert.ok(ours.includes(key), `我们的 buildFixedParams 缺少 ${key}`);
  }
});

test('★ 请求格式：上游 POST/PUT 用 json=，我们必须用 JSON body', () => {
  // CLI: self._http.request(method, url, params=query, json=body)
  assert.ok(/json=body/.test(clientPy), '上游用 json= 发送 body');
  const ours = readIfExists(path.join(SRC, 'shared/api/client.js'));
  assert.ok(/Content-Type/.test(ours) && /application\/json/.test(ours), '我们必须设置 JSON Content-Type');
  assert.ok(/JSON\.stringify\(signed\)/.test(ours), 'body 必须是 JSON.stringify');
});

test('★ 软删除：include_deleted 是本地过滤，不是服务端参数', () => {
  // 注意：上游函数签名里有 include_deleted（作为本地过滤开关），
  //       但**传给 _get 的 extra 字典里没有它** —— 只检查实际发送的参数
  const extra = clientPy.match(/def list_memos_ascending[\s\S]*?extra:\s*dict\[[^\]]*\]\s*=\s*\{([\s\S]*?)\}/);
  assert.ok(extra, '未找到同步的 extra 参数块');
  assert.equal(
    extra[1].includes('include_deleted'),
    false,
    '上游同步请求不包含 include_deleted（它是本地过滤开关）',
  );
  for (const key of ['limit', 'latest_updated_at', 'tz']) {
    assert.ok(extra[1].includes(key), `上游同步参数含 ${key}`);
  }

  // 只检查真实发送的参数（先剥掉注释，避免注释里提到就误判）
  const ours = readIfExists(path.join(SRC, 'shared/api/client.js'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.equal(/include_deleted/.test(ours), false, '我们不应把 include_deleted 发给服务端');
});

test('★ 创建笔记参数：与上游 create_memo 一致（content/source/tz）', () => {
  const m = clientPy.match(/def create_memo\([\s\S]*?return self\._put\("memo", data\)/);
  assert.ok(m, '未找到 create_memo');
  for (const key of ['content', 'source', 'tz']) {
    assert.ok(m[0].includes(`"${key}"`), `上游创建参数含 ${key}`);
  }
  const ours = readIfExists(path.join(SRC, 'shared/api/client.js'));
  assert.ok(/source:\s*'web'/.test(ours), '我们必须传 source: web');
  assert.ok(/tz:\s*TZ/.test(ours), '我们必须传 tz');
});

test('★ 登录参数：与上游一致（email/password/两个 wechat 空串）', () => {
  const m = clientPy.match(/def login\([\s\S]*?return _handle_response\(resp\)/);
  assert.ok(m, '未找到 login');
  for (const key of ['email', 'password', 'wechat_union_id', 'wechat_oa_open_id']) {
    assert.ok(m[0].includes(key), `上游登录参数含 ${key}`);
  }
  const ours = readIfExists(path.join(SRC, 'shared/api/client.js'));
  for (const key of ['email', 'password', 'wechat_union_id', 'wechat_oa_open_id']) {
    assert.ok(ours.includes(key), `我们登录参数缺少 ${key}`);
  }
});

test('★ 端点覆盖：上游已使用的端点我们都要声明', () => {
  const used = new Set();
  for (const m of clientPy.matchAll(/self\._(?:get|put|post|delete)\(\s*f?"([^"]+)"/g)) {
    used.add(m[1].replace(/\{slug\}/, '{slug}'));
  }
  const ours = readIfExists(path.join(SRC, 'shared/api/endpoints.js'));
  // 已实现的端点（未实现的先跳过）
  const implemented = [
    'user/login_by_email',
    'user/me',
    'memo',
    'memo/{slug}',
    'memo/updated/',
    'memo/latest_updated_desc',
    'memo/{slug}/recommended',
    'memo/notify_of_today/',
    'tag/tree',
  ];
  for (const ep of implemented) {
    // 端点表里写成 '/xxx'，统一去前导斜杠后比对
    assert.ok(ours.includes(`/${ep}`), `端点表缺少 /${ep}`);
  }
});

test('契约漂移告警：-10/-20 必须被识别为认证失效（行为验证，比正则可靠）', async () => {
  const { handleResponse } = await import('/data/workspace/flomo-extension/src/shared/api/client.js');
  assert.equal(handleResponse({ code: -10, message: 'x' }, 200).error, 'not_authenticated');
  assert.equal(handleResponse({ code: -20, message: 'x' }, 200).error, 'not_authenticated');
});

test('fixture 来源可追溯：响应样例必须来自官方抓包，不得手编', () => {
  const fx = readIfExists('/data/workspace/flomo-extension/tests/fixtures/api-responses.js');
  assert.ok(fx.includes('flomo-api-analysis.md'), 'fixture 应注明来源');
  assert.ok(fx.includes('SIGN_VECTOR'), '应包含官方签名向量');
  // 创建响应必须含 slug（这是审计 L3 的答案）
  assert.ok(/slug:\s*'MjI2MzY1Mjgx'/.test(fx), '创建响应 fixture 应含官方记录中的 slug');
});
