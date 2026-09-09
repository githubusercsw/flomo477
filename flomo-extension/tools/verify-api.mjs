#!/usr/bin/env node
// 真机验证脚本：在**能联网**的机器上运行，用于确认审计 L3 等沙盒无法验证的硬依赖。
// 沙盒内 flomoapp.com 被代理拦截（"No policy rule matched"），因此必须由用户本地执行。
//
// 用法：
//   node tools/verify-api.mjs --email you@example.com --password 'your-password'
//
// 已按 flomo-cli client.py 校正三处（2026-09-08）：
//   1. 每个请求带 timestamp（秒级）
//   2. 签名拼接末尾无多余 &
//   3. POST/PUT 用 JSON body
//
// 会依次打印：① 登录响应键 ② 创建笔记的**完整响应体** ③ 增量同步首页字段

import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
}

const email = arg('email');
const password = arg('password');
if (!email || !password) {
  console.error('用法: node tools/verify-api.mjs --email <邮箱> --password <密码>');
  process.exit(1);
}

const API_BASE = 'https://flomoapp.com/api/v1';
const SIGN_SECRET = 'dbbc3dd73364b4084c3a69346e0ce2b2';
const TZ = '8:0';

/** 公共参数（对齐 CLI _base_params）：timestamp 必须每次现取 */
function baseParams() {
  return {
    timestamp: String(Math.floor(Date.now() / 1000)),
    api_key: 'flomo_web',
    app_version: '4.0',
    platform: 'web',
    webp: '1',
  };
}

/** 签名：排序 → 跳过 null/空串 → "&" 连接 → 直接接密钥 → MD5（末尾无多余 &） */
function sign(params) {
  const raw =
    Object.keys(params)
      .filter((k) => params[k] !== null && params[k] !== undefined && params[k] !== '')
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&') + SIGN_SECRET;
  return crypto.createHash('md5').update(raw).digest('hex');
}

const deviceId = crypto.randomUUID();
let token = null;

async function req(name, { method, path: p, params = {}, withAuth = true }) {
  const all = { ...baseParams(), ...params };
  all.sign = sign(all);

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    platform: 'web',
    'device-model': 'web',
    'device-id': deviceId,
  };
  if (withAuth && token) headers['Authorization'] = `Bearer ${token}`;

  const useBody = method === 'POST' || method === 'PUT';
  if (useBody) headers['Content-Type'] = 'application/json';

  const url = API_BASE + '/' + p;
  const init = { method, headers };
  let finalUrl = url;
  if (useBody) {
    init.body = JSON.stringify(all);
  } else {
    finalUrl = `${url}?${new URLSearchParams(all).toString()}`;
  }

  const started = Date.now();
  let res;
  let text;
  try {
    res = await fetch(finalUrl, init);
    text = await res.text();
  } catch (e) {
    console.log(`\n──── ${name} ────`);
    console.log('❌ 网络错误:', e.message);
    return {};
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { __raw: text.slice(0, 300) };
  }

  console.log(`\n──── ${name} ────`);
  console.log(`HTTP ${res.status} · ${Date.now() - started}ms`);
  console.log(JSON.stringify(payload, null, 2).slice(0, 2500));
  if (payload?.message && /timestamp/i.test(payload.message)) {
    console.log('⚠️  服务端仍在要 timestamp —— 请检查参数是否真的发出去了');
  }
  if (payload?.code !== 0 && /sign|签名/i.test(String(payload?.message))) {
    console.log('⚠️  签名被拒 —— 请核对拼接格式（末尾不应有多余 &）与 SECRET');
  }
  return payload;
}

console.log('flomo API 验证脚本');
console.log('==================');

// ① 登录
const login = await req('① 登录 POST /user/login_by_email', {
  method: 'POST',
  path: 'user/login_by_email',
  params: { email, password, wechat_union_id: '', wechat_oa_open_id: '' },
  withAuth: false,
});
token = login?.data?.access_token || login?.data?.token || null;
console.log('\n>>> 登录结果:', token ? '✅ 拿到 token' : '❌ 未拿到 token');
console.log('>>> 响应 data 键:', Object.keys(login?.data || {}).join(', ') || '(无 data)');
if (!token) {
  console.log('\n登录失败，后续步骤跳过。message:', login?.message || '(无)');
  process.exit(1);
}

// ② 创建笔记（★ 核心：确认响应里有没有 slug）
const content = `<p>flomo-extension 探针笔记 ${new Date().toISOString()}</p>`;
const created = await req('② 创建笔记 PUT /memo', {
  method: 'PUT',
  path: 'memo',
  params: { content, source: 'web', tz: TZ },
});
const slug = created?.data?.slug || created?.data?.memo?.slug || null;
console.log('\n>>> ★★ 关键结论 ★★');
console.log('>>> PUT /memo 响应是否含 slug:', slug ? `✅ 是 → ${slug}` : '❌ 否');
console.log('>>> 创建响应 data 的键:', Object.keys(created?.data || {}).join(', ') || '(无)');
if (slug) {
  console.log('>>> 结论：撤销/删除功能成立，可按计划实现');
} else {
  console.log('>>> 结论：创建响应无 slug → 撤销功能需砍掉，或改用 /memo/latest_updated_desc 退路');
}

// ③ 增量同步首页
const sync = await req('③ 增量同步 GET /memo/updated/', {
  method: 'GET',
  path: 'memo/updated/',
  params: { limit: '200', latest_updated_at: '0', tz: TZ },
});
const memos = sync?.data?.memos || (Array.isArray(sync?.data) ? sync.data : []);
console.log('\n>>> 同步首页返回条数:', memos.length);
if (memos[0]) {
  console.log('>>> 单条笔记字段:', Object.keys(memos[0]).join(', '));
  console.log('>>> 样例 slug:', memos[0].slug, '| updated_at:', memos[0].updated_at);
}

// ④ 清理：拿到 slug 就删掉探针笔记
if (slug) {
  await req('④ 删除探针笔记 DELETE /memo/{slug}', {
    method: 'DELETE',
    path: `memo/${slug}`,
  });
  console.log('\n>>> 探针笔记已删除（软删，可在 flomo 回收站找回）');
}

console.log('\n==================');
console.log('请把上面的输出（尤其是 ② 的结论）反馈给我，用于推进 P4 的撤销功能设计。');
