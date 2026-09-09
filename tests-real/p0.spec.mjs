// P0 真机走查：沙盒内用 Chromium + --load-extension 验证扩展能否正常加载与交互。
import { launch, getExtensionId, EXT_PATH } from './launch.mjs';

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

const { context } = await launch();
const consoleErrors = [];

try {
  // ---- 1. 扩展是否成功加载（SW 是否起来）----
  await new Promise((r) => setTimeout(r, 2500));
  const extId = await getExtensionId(context);
  check('扩展加载成功，Service Worker 已启动', Boolean(extId), extId ? `id=${extId}` : '未取到扩展 ID');

  // ---- 2. Popup 页面：真实打开并交互 ----
  if (extId) {
    const popup = await context.newPage();
    popup.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`popup: ${m.text()}`);
    });
    popup.on('pageerror', (e) => consoleErrors.push(`popup pageerror: ${e.message}`));

    await popup.goto(`chrome-extension://${extId}/src/ui/popup.html`, { waitUntil: 'load' });
    await popup.waitForTimeout(1200);

    const title = await popup.textContent('h1').catch(() => null);
    check('Popup 打开并渲染标题', title?.includes('flomo'), title || '(空)');

    const statusText = await popup.textContent('.empty').catch(() => '');
    check('Popup 与后台消息往返成功（显示 SW ready）', statusText.includes('SW ready'), statusText);

    const theme = await popup.getAttribute('html', 'data-theme');
    check('主题变量已应用（data-theme）', theme === 'system', `data-theme=${theme}`);

    const bg = await popup.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('设计 token 生效（body 背景取变量）', bg !== 'rgba(0, 0, 0, 0)' && bg !== '', bg);

    // 交互：点设置按钮 → 应触发 openOptionsPage（无头下不实际开窗，只验证不报错）
    const btnCount = await popup.locator('button').count();
    check('Popup 按钮可渲染且可定位', btnCount > 0, `buttons=${btnCount}`);
    await popup.close();

    // ---- 3. Side Panel 页面 ----
    const side = await context.newPage();
    side.on('pageerror', (e) => consoleErrors.push(`sidepanel pageerror: ${e.message}`));
    await side.goto(`chrome-extension://${extId}/src/ui/sidepanel.html`, { waitUntil: 'load' });
    await side.waitForTimeout(1000);
    const sideEmpty = await side.textContent('.empty').catch(() => '');
    check('Side Panel 打开且消息往返成功', sideEmpty.includes('SW ready'), sideEmpty);
    await side.close();

    // ---- 4. Options 页面（英文切换验证 i18n）----
    const opt = await context.newPage();
    opt.on('pageerror', (e) => consoleErrors.push(`options pageerror: ${e.message}`));
    await opt.goto(`chrome-extension://${extId}/src/ui/options.html`, { waitUntil: 'load' });
    await opt.waitForTimeout(1000);
    const optText = await opt.textContent('#app').catch(() => '');
    check('Options 页面渲染（中文默认）', optText.includes('设置'), optText.replace(/\s+/g, ' ').slice(0, 60));

    // 切英文 → 验证 i18n 运行时可切换（不用 chrome.i18n 的核心价值）
    await opt.evaluate(() => chrome.storage.local.set({ config: { language: 'en' } }));
    await opt.waitForTimeout(800);
    await opt.reload({ waitUntil: 'load' });
    await opt.waitForTimeout(1000);
    const optEn = await opt.textContent('#app').catch(() => '');
    check('i18n 切换英文生效（运行时可切）', optEn.includes('Settings'), optEn.replace(/\s+/g, ' ').slice(0, 60));
    await opt.close();

    // ---- 5. 登录页 ----
    const login = await context.newPage();
    login.on('pageerror', (e) => consoleErrors.push(`login pageerror: ${e.message}`));
    await login.goto(`chrome-extension://${extId}/src/ui/login.html`, { waitUntil: 'load' });
    await login.waitForTimeout(800);
    const loginText = await login.textContent('h1').catch(() => '');
    check('登录页渲染', loginText.length > 0, loginText);
    await login.close();

    // ---- 6. content script 注入真实网页 + 黑名单 ----
    const page = await context.newPage();
    page.on('pageerror', (e) => consoleErrors.push(`content pageerror: ${e.message}`));
    await page.setContent('<html><body><p id="t">hello flomo world</p></body></html>');
    await page.goto('https://example.com/').catch(() => {});
    await page.waitForTimeout(1500);

    // 读后台配置，验证 content script 侧能通过 storage 拿到配置（onChanged 已注册）
    const cfg = await page.evaluate(
      () =>
        new Promise((res) => {
          chrome.runtime.sendMessage({ type: 'config_get', payload: {} }, (r) => res(r));
        }),
    );
    check('content script 可与后台通信（config_get）', cfg?.ok === true, JSON.stringify(cfg).slice(0, 90));
    await page.close();
  }

  // ---- 7. 控制台干净度 ----
  const realErrors = consoleErrors.filter((e) => !/favicon|net::ERR/i.test(e));
  check('页面无 JS 运行时错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | ') || '无');
} finally {
  await context.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n通过 ${results.length - failed.length}/${results.length}`);
if (failed.length) {
  console.log('失败项：' + failed.map((f) => f.name).join('、'));
  process.exitCode = 1;
}
