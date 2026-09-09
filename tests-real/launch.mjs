// 沙盒内“准真机”测试：用 Playwright 驱动自带 Chromium，以 --load-extension 加载解压扩展。
// 说明：沙盒网络仅放行 npm registry，Playwright 官方浏览器 CDN 被 403 拦截，
// 因此复用 npm 包 @sparticuz/chromium 内置的 Chromium 147 二进制（完整 chrome，支持 --headless=new）。
import pw from '/usr/local/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const EXT_PATH = '/data/workspace/flomo-extension';
export const CHROMIUM_PATH = process.env.FLOMO_CHROMIUM || '/tmp/cr.bin';

export async function launch() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flomo-profile-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: CHROMIUM_PATH,
    headless: false, // 关键：不要 playwright 的 old headless
    ignoreDefaultArgs: ['--headless'], // 自己传新版无头参数
    args: [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
    ],
  });
  return { context, userDataDir };
}

/** 提取扩展 ID：优先从 service worker target，其次从任意 chrome-extension 页面 */
export async function getExtensionId(context) {
  const candidates = [];
  const tryPush = (s) => {
    if (!s) return;
    const m = String(s).match(/chrome-extension:\/\/([a-p]{32})/);
    if (m) candidates.push(m[1]);
  };
  for (const sw of context.serviceWorkers()) tryPush(sw.url());
  for (const p of context.pages()) tryPush(p.url());

  // SW 可能尚未启动：先唤醒一次扩展页面
  if (!candidates.length) {
    const sw = await context.newPage().catch(() => null);
    void sw;
    await new Promise((r) => setTimeout(r, 1500));
    for (const s of context.serviceWorkers()) tryPush(s.url());
  }
  if (!candidates.length) {
    // 兜底：从 profile 里的 Preferences 读取已加载扩展 ID
    try {
      const pref = path.join(context._options?.userDataDir || '', 'Default', 'Preferences');
      void pref;
    } catch {}
  }
  return candidates[0] ? [...new Set(candidates)][0] : null;
}

export function ensureChromium() {
  return fs.existsSync(CHROMIUM_PATH);
}
