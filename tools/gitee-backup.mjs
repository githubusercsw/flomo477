#!/usr/bin/env node
// Gitee 备份脚本：测试连通性 → 创建同名仓库 → 把 zip 上传到 Release。
//
// 用法（在本机运行，沙盒内 gitee.com 被拦截）：
//   node tools/gitee-backup.mjs
//   node tools/gitee-backup.mjs --repo flomo477 --file flomo-extension-P1.zip
//   node tools/gitee-backup.mjs --token <你的token> --private=false
//
// 流程：
//   1. GET  /v5/user                      测试连通性 + 拿到用户名（owner）
//   2. POST /v5/user/repos                创建仓库（auto_init 让它有默认分支，Release 必须有提交）
//   3. 轮询等待仓库初始化完成（刚创建的仓库不能立刻建 Release）
//   4. POST /v5/repos/{o}/{r}/releases    创建 Release
//   5. POST .../releases/{id}/attach_files 上传附件（multipart）
//
// 幂等：仓库或 Release 已存在时跳过创建，直接复用。

import fs from 'node:fs';
import path from 'node:path';

// ─── 参数 ────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const TOKEN = arg('token') || process.env.GITEE_TOKEN;
if (!TOKEN) {
  console.error('缺少 Gitee 令牌：用 --token <值> 或设置环境变量 GITEE_TOKEN');
  process.exit(1);
}
const REPO = arg('repo', 'flomo477');
const FILE = path.resolve(arg('file', '/data/workspace/flomo-extension-P1.zip'));
const TAG = arg('tag', 'v0.1.0');
const DESCRIPTION = arg('desc', 'flomo 浏览器扩展（MV3）P1 阶段备份：API 客户端 + 签名 + 登录');
const PRIVATE = arg('private', 'true') !== 'false';
const DRY_RUN = flag('dry-run');

const API = process.env.GITEE_API_OVERRIDE || 'https://gitee.com/api/v5';

// ─── 工具 ────────────────────────────────────────────────
const log = (...a) => console.log(...a);
const step = (n, msg) => log(`\n${'─'.repeat(56)}\n▶ ${n}  ${msg}\n${'─'.repeat(56)}`);

/** 统一请求：自动带 access_token，统一错误处理 */
async function api(method, urlPath, { body, isForm } = {}) {
  const url = new URL(API + urlPath);
  const init = { method };

  if (isForm) {
    // multipart：token 放表单字段（Gitee 附件上传不接受 query 里的 token）
    body.append('access_token', TOKEN);
    init.body = body;
  } else if (body) {
    init.headers = { 'Content-Type': 'application/json;charset=UTF-8' };
    init.body = JSON.stringify({ access_token: TOKEN, ...body });
    url.searchParams.set('access_token', TOKEN);
  } else {
    url.searchParams.set('access_token', TOKEN);
  }

  let res;
  try {
    res = await fetch(url.toString(), init);
  } catch (e) {
    return { __networkError: e.message };
  }
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { __raw: text.slice(0, 300) };
  }
  return { __status: res.status, ...(Array.isArray(json) ? { __list: json } : json) };
}

function fail(msg, detail) {
  log(`\n❌ ${msg}`);
  if (detail) log('   服务端返回:', JSON.stringify(detail).slice(0, 600));
  process.exit(1);
}

// ─── 1. 连通性 ────────────────────────────────────────────
step(1, '测试连通性：获取当前用户');
const me = await api('GET', '/user');
if (me.__networkError) fail('网络不可达（本机是否被墙/代理拦截？）', me.__networkError);
if (me.__status !== 200 || !me.login) fail('认证失败 —— token 无效或已过期', me);
log(`✅ 连通正常`);
log(`   用户：${me.name || me.login}（login = ${me.login}）`);
log(`   邮箱：${me.email || '(未公开)'}`);
const OWNER = me.login;

if (DRY_RUN) {
  log('\n--dry-run：只测连通性，不创建仓库。去掉该参数即执行完整流程。');
  process.exit(0);
}

// ─── 2. 创建仓库 ──────────────────────────────────────────
step(2, `创建仓库 ${OWNER}/${REPO}`);
const repoInfo = await api('GET', `/repos/${OWNER}/${REPO}`);
let repoReady = repoInfo.__status === 200;

if (repoReady) {
  log(`ℹ️  仓库已存在，直接复用：https://gitee.com/${OWNER}/${REPO}`);
} else {
  const created = await api('POST', '/user/repos', {
    body: {
      name: REPO,
      description: DESCRIPTION,
      private: PRIVATE,
      auto_init: true, // 关键：没有提交就无法创建 Release
      has_issues: true,
      has_wiki: false,
    },
  });
  if (created.__status === 201) {
    log(`✅ 仓库已创建：https://gitee.com/${OWNER}/${REPO}`);
  } else if (created.__status === 400 && /已存在|exist/i.test(JSON.stringify(created))) {
    log(`ℹ️  仓库已存在（首次创建返回已存在），继续`);
  } else {
    fail('创建仓库失败', created);
  }
}

// ─── 3. 等待初始化 ────────────────────────────────────────
step(3, '等待仓库初始化（auto_init 是异步的，Release 需要默认分支有提交）');
let defaultBranch = null;
for (let i = 1; i <= 20; i++) {
  const r = await api('GET', `/repos/${OWNER}/${REPO}`);
  if (r.__status === 200 && r.default_branch) {
    // 确认分支真的有提交
    const commits = await api('GET', `/repos/${OWNER}/${REPO}/commits`, {});
    const list = commits.__list || [];
    if (list.length > 0) {
      defaultBranch = r.default_branch;
      log(`✅ 就绪（第 ${i} 次检查）：默认分支 ${defaultBranch}，已有 ${list.length} 个提交`);
      break;
    }
  }
  process.stdout.write(`   ...第 ${i} 次检查，尚未就绪\r`);
  await new Promise((r) => setTimeout(r, 2000));
}
if (!defaultBranch) fail('仓库初始化超时（20 次检查仍未产生提交），请到网页端确认仓库状态');

// ─── 4. 创建 Release ──────────────────────────────────────
step(4, `创建 Release ${TAG}`);
let releaseId = null;
const existing = await api('GET', `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
if (existing.__status === 200 && existing.id) {
  releaseId = existing.id;
  log(`ℹ️  Release ${TAG} 已存在（id=${releaseId}），复用`);
} else {
  const rel = await api('POST', `/repos/${OWNER}/${REPO}/releases`, {
    body: {
      tag_name: TAG,
      name: `${REPO} ${TAG}`,
      body: DESCRIPTION,
      target_commitish: defaultBranch,
      prerelease: false,
    },
  });
  if (rel.id) {
    releaseId = rel.id;
    log(`✅ Release 创建成功（id=${releaseId}）`);
  } else {
    fail('创建 Release 失败', rel);
  }
}

// ─── 5. 上传附件 ──────────────────────────────────────────
step(5, '上传附件到 Release');
if (!fs.existsSync(FILE)) fail(`文件不存在：${FILE}`);
const stat = fs.statSync(FILE);
const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
log(`   文件：${path.basename(FILE)}（${sizeMB} MB）`);
if (stat.size > 100 * 1024 * 1024) fail('超过 Gitee 单附件上限 100MB');

const form = new FormData();
// Gitee 附件上传：token 与文件都放在 multipart 表单字段里（query 里的 token 不生效）
form.append('access_token', TOKEN);
form.append('file', new Blob([fs.readFileSync(FILE)], { type: 'application/zip' }), path.basename(FILE));

const up = await fetch(`${API}/repos/${OWNER}/${REPO}/releases/${releaseId}/attach_files`, {
  method: 'POST',
  body: form,
});
const upText = await up.text();
let upJson;
try {
  upJson = upText ? JSON.parse(upText) : {};
} catch {
  upJson = { __raw: upText.slice(0, 300) };
}

if (up.status >= 200 && up.status < 300) {
  log(`✅ 上传成功`);
} else {
  fail(`上传失败（HTTP ${up.status}）`, upJson);
}

// ─── 完成 ────────────────────────────────────────────────
log(`\n${'═'.repeat(56)}\n✅ 备份完成\n${'═'.repeat(56)}`);
log(`   仓库：  https://gitee.com/${OWNER}/${REPO}`);
log(`   Release: https://gitee.com/${OWNER}/${REPO}/releases/tag/${TAG}`);
log(`   附件：  ${path.basename(FILE)}（${sizeMB} MB）`);
