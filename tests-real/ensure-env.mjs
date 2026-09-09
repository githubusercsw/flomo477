// 环境自检与自动修复：确保测试依赖在位。
//
// 背景：沙盒的 npm 装在**全局**（/usr/local/lib/node_modules），但 Node 的裸导入只查
//       ./node_modules 向上各级 —— 直接从 /data/workspace 导入 'jsdom' 会失败。
//       而且全局包可能被其他安装操作清掉（已发生过两次，导致测试突然全红）。
//
// 策略：跑测试前自检；缺依赖就自动重装 + 建软链，而不是让测试以难懂的报错失败。
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const GLOBAL_MODULES = '/usr/local/lib/node_modules';
const LOCAL_MODULES = '/data/workspace/node_modules';

const NEEDED = [{ name: 'jsdom', why: '为 UI 模块提供 DOM 环境（harness.mjs 用）' }];

function globalPath(name) {
  return `${GLOBAL_MODULES}/${name}`;
}
function localPath(name) {
  return `${LOCAL_MODULES}/${name}`;
}

/**
 * 依赖是否可用：**必须以 Node 能否裸导入为准**。
 * ⚠️ 只看全局有没有是不够的 —— Node 裸导入只查 ./node_modules 向上各级，
 *    全局 /usr/local/lib/node_modules 不在查找路径里，所以本地软链/实体必须存在且有效。
 */
function isUsable(name) {
  const lp = localPath(name);
  try {
    // lstat 能穿透坏链判断（existsSync 对坏软链返回 false，这里用它即可）
    if (!fs.existsSync(lp)) return false;
    // 软链还要确认目标真的在（防止链到已被清掉的全局包）
    if (fs.lstatSync(lp).isSymbolicLink()) {
      return fs.existsSync(fs.realpathSync(lp));
    }
    return true;
  } catch {
    return false;
  }
}

/** 让依赖可用：优先建软链（零下载），否则 npm 重装 */
function makeUsable(name) {
  // 1) 全局有 → 建软链即可，不用重新下载
  if (fs.existsSync(globalPath(name))) {
    fs.mkdirSync(LOCAL_MODULES, { recursive: true });
    const lp = localPath(name);
    // 已存在但可能是坏链，先清掉
    if (fs.existsSync(lp) || fs.lstatSync(lp, { throwIfNoEntry: false })) {
      try {
        fs.rmSync(lp, { recursive: true, force: true });
      } catch {}
    }
    fs.symlinkSync(globalPath(name), lp, 'dir');
    return true;
  }
  // 2) 全局也没有 → 真正安装
  try {
    execSync(`npm i ${name} --no-save --no-audit --no-fund`, { cwd: '/data/workspace', stdio: 'pipe' });
  } catch {
    return false;
  }
  return fs.existsSync(globalPath(name)) ? (makeUsable(name), true) : fs.existsSync(localPath(name));
}

/**
 * @param {object} opts
 * @param {boolean} opts.autoFix 缺失时自动修复（默认 true）
 */
export function ensureEnv({ autoFix = true } = {}) {
  const missing = NEEDED.filter((d) => !isUsable(d.name));
  if (missing.length === 0) return { ok: true, missing: [], fixed: [] };

  if (autoFix) {
    const fixed = [];
    for (const d of missing) {
      if (makeUsable(d.name)) fixed.push(d.name);
    }
    const stillMissing = NEEDED.filter((d) => !isUsable(d.name));
    if (stillMissing.length === 0) {
      console.log(`🔧 已自动修复依赖: ${fixed.join(', ')}`);
      return { ok: true, missing: [], fixed };
    }
    console.error('\n❌ 依赖修复失败：');
    for (const m of stillMissing) console.error(`   - ${m.name}：${m.why}`);
    return { ok: false, missing: stillMissing, fixed };
  }

  console.error('\n❌ 缺少测试依赖：');
  for (const m of missing) console.error(`   - ${m.name}：${m.why}`);
  return { ok: false, missing, fixed: [] };
}

// 直接执行：node tests-real/ensure-env.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = ensureEnv();
  console.log(r.ok ? '✅ 测试环境就绪' : '❌ 环境未就绪');
  process.exit(r.ok ? 0 : 1);
}
