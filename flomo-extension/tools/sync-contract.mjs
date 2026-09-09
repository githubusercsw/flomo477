#!/usr/bin/env node
// 契约同步工具：从上游重新拉取权威源码，核对我们本地固化的契约是否已过期。
//
// 为什么需要它：flomo 是逆向接口，随时可能改。与其每次靠真机测试发现"接口变了"，
// 不如定期（或每次开工前）从源头核对一次 —— 这比真机反馈便宜得多。
//
// 用法：
//   node tools/sync-contract.mjs           # 拉取并对比
//   node tools/sync-contract.mjs --update  # 拉取并覆盖本地固化副本
//
// 原理：沙盒内绝大多数站点被拦截（zeroproxy 403），但 **codeload.github.com 可达**，
//       因此可以直接下载 GitHub 仓库 tarball，拿到上游源码做对比。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const REPO = 'dulk-dev/flomo-cli';
const CODELOAD = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/main`;
const LOCAL = '/data/workspace/_memory/raw/flomo-cli-source';

// 我们关心的契约文件
const WATCHED = [
  'flomo_cli/client.py',
  'flomo_cli/constants.py',
  'flomo_cli/auth.py',
  'flomo_cli/error_codes.py',
  'docs/flomo-api-analysis.md',
  'tests/test_signing.py',
  'tests/test_client.py',
];

const args = process.argv.slice(2);
const doUpdate = args.includes('--update');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
}

console.log(`拉取上游 ${REPO} ...`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flomo-contract-'));
const tarball = path.join(tmp, 'src.tar.gz');

try {
  execFileSync('curl', ['-sL', '--max-time', '120', '-o', tarball, CODELOAD], { stdio: 'inherit' });
} catch (e) {
  console.error('❌ 下载失败（网络不可达？）:', e.message);
  process.exit(1);
}

if (!fs.existsSync(tarball) || fs.statSync(tarball).size < 1000) {
  console.error('❌ 下载内容异常，可能网络被拦截');
  process.exit(1);
}

execFileSync('tar', ['xzf', tarball, '-C', tmp]);
const extracted = fs.readdirSync(tmp).find((d) => d.startsWith('flomo-cli-'));
const root = path.join(tmp, extracted);

console.log('\n对比契约文件：\n');
let changed = 0;
for (const rel of WATCHED) {
  const upstream = path.join(root, rel);
  const local = path.join(LOCAL, rel);
  if (!fs.existsSync(upstream)) {
    console.log(`  ⚠️  ${rel} — 上游不存在（可能已重构）`);
    continue;
  }
  const upHash = sha256(upstream);
  const hasLocal = fs.existsSync(local);
  const localHash = hasLocal ? sha256(local) : '(缺失)';
  const same = hasLocal && upHash === localHash;
  if (!same) changed += 1;
  console.log(`  ${same ? '✅' : '⚠️ '} ${rel.padEnd(32)} ${localHash} → ${upHash}`);
  if (!same && doUpdate) {
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.copyFileSync(upstream, local);
    console.log(`      ↳ 已更新本地副本`);
  }
}

console.log(`\n${changed === 0 ? '✅ 本地契约与上游一致' : `⚠️  ${changed} 个文件与上游不同`}`);
if (changed > 0 && !doUpdate) {
  console.log('   如需更新本地副本，加 --update 重跑');
  console.log('   ⚠️  契约变化意味着实现可能要改 —— 请先阅读差异再决定');
}

// 额外：把签名向量单独打印，便于人工核对
const signTest = path.join(root, 'tests/test_signing.py');
if (fs.existsSync(signTest)) {
  const txt = fs.readFileSync(signTest, 'utf8');
  const m = txt.match(/_generate_sign\(params\)\s*==\s*"([a-f0-9]{32})"/);
  if (m) {
    console.log(`\n官方签名向量: ${m[1]}`);
    console.log(`我们固化的:   e8749f38dfc1fcdd1582d34a0c7759f0`);
    console.log(m[1] === 'e8749f38dfc1fcdd1582d34a0c7759f0' ? '✅ 一致' : '❌ 不一致，必须修正 sign.js');
  }
}
