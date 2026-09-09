#!/usr/bin/env node
// 一键跑全部测试（含环境自检 + 契约同步检查）。
//
// 用法：node tests-real/run-all.mjs [--sync]
//   --sync  顺便从上游重新拉取契约做漂移检查（需要 codeload.github.com 可达）
//
// 这是日常开发的**主入口**：不需要真机，就能验证绝大多数东西。
import { execSync } from 'node:child_process';
import { ensureEnv } from './ensure-env.mjs';

const args = process.argv.slice(2);
const doSync = args.includes('--sync');

function run(title, cmd, cwd = '/data/workspace') {
  console.log(`\n${'─'.repeat(60)}\n▶ ${title}\n${'─'.repeat(60)}`);
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe' });
    const summary = out
      .split('\n')
      .filter((l) => /^# (tests|pass|fail|skipped)/.test(l))
      .join('  ');
    console.log(summary || '(无汇总输出)');
    const fail = out.match(/^# fail (\d+)/m);
    return { ok: !fail || fail[1] === '0', detail: out };
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    console.log(out.split('\n').filter((l) => /^# (tests|pass|fail)/.test(l)).join('  '));
    // 打印失败项名称
    const failed = out
      .split('\n')
      .filter((l) => l.startsWith('not ok'))
      .map((l) => l.replace(/^not ok \d+ - /, '  ✗ '));
    if (failed.length) console.log(failed.join('\n'));
    return { ok: false, detail: out };
  }
}

console.log('flomo 扩展 · 全量测试');
console.log('这套测试不依赖真机：用官方抓包的真实响应 + 真实源码 + 内存 chrome API');

const env = ensureEnv({ autoInstall: true });
if (!env.ok) {
  console.error('\n环境未就绪，中止。');
  process.exit(1);
}

const results = [];

if (doSync) {
  const r = run('契约漂移检查（对比上游 flomo-cli）', 'node flomo-extension/tools/sync-contract.mjs');
  results.push({ name: '契约同步', ...r, nonBlocking: true });
}

results.push({
  name: '纯函数单测',
  ...run('L1 纯函数（core 层，零依赖）', 'node --test flomo-extension/tests/unit'),
});

results.push({
  name: '契约守卫',
  ...run('L2 契约守卫：实现 vs 官方契约文档', 'node --test tests-real/contract-guard.test.mjs'),
});

results.push({
  name: '契约回放',
  ...run('L3 契约回放：官方真实响应驱动真实源码', 'node --test tests-real/contract-replay.test.mjs'),
});

results.push({
  name: 'API 链路',
  ...run('L4 API 链路（mock fetch）', 'node --test tests-real/p1.test.mjs'),
});

results.push({
  name: '后台与 UI',
  ...run('L5 后台链路 + UI 交互 + 架构守卫', 'node --test tests-real/real-p0.test.mjs tests-real/p1-background.test.mjs tests-real/arch-guard.test.mjs'),
});

console.log(`\n${'═'.repeat(60)}\n汇总\n${'═'.repeat(60)}`);
let allOk = true;
for (const r of results) {
  const mark = r.ok ? '✅' : r.nonBlocking ? '⚠️ ' : '❌';
  console.log(`  ${mark} ${r.name}`);
  if (!r.ok && !r.nonBlocking) allOk = false;
}

if (allOk) {
  console.log('\n✅ 全部通过 —— 无需真机即可确认这些行为正确');
  console.log('   仍需真机的：视觉观感 / SW 真实生命周期 / 浏览器特有交互');
} else {
  console.log('\n❌ 有失败项，见上方 ✗ 标记');
}

process.exit(allOk ? 0 : 1);
