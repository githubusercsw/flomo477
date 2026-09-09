# 沙盒测试方案说明（含真实浏览器方案失败记录）

## 一、结论先说

**沙盒内无法做真实浏览器扩展 E2E**。已用替代方案覆盖：**真实源码 + jsdom + 内存 chrome API**，
跑的是 `src/` 下的原文件，不是替身。共 **18 项自动验证全过**（9 准真机 + 9 架构守卫）。

## 二、为什么真实浏览器方案走不通（证据）

按用户给的指令逐步尝试，失败在网络层：

| 步骤 | 结果 |
|---|---|
| `npm i -D playwright` | ✅ 成功（npm registry 走 `mirrors.tencent.com/npm/` 代理，可用） |
| `npx playwright install chromium` | ❌ 下载 403（`cdn.playwright.dev` / `playwright.azureedge.net` / `storage.googleapis.com` 全部被拦） |
| `npm i @playwright/browser-chromium` | ❌ 同样要下载 |
| `apt-get install chromium` | ❌ 源 403 |
| 镜像站探测 | 仅 `mirrors.tencent.com` 可达，但其 48 个同步源中**无任何 chromium / playwright 二进制** |

**唯一能拿到的浏览器二进制**：npm 包 `@sparticuz/chromium`（brotli 内含 Chromium 147，63MB → 解压 196MB）。
它能启动（`--version` 正常、`--dump-dom` 正常），但**被裁剪掉了扩展能力**：

```
grep -c "load-extension" chromium  →  0        # 命令行开关根本不存在
chrome://extensions                →  net::ERR_INVALID_URL   # WebUI 被裁
CDP targets                        →  只有 about:blank，无 chrome-extension://*
```

即：`--load-extension` 传了也不生效，扩展页面无法访问。**结论：这条路在当前沙盒无解**，
不是参数或权限问题（`--no-sandbox --disable-dev-shm-usage` 都试过）。

> 保留 `launch.mjs`（Playwright 持久化上下文 + `--load-extension` 封装）与 `p0.spec.mjs`，
> 若将来网络放开，直接 `node tests-real/p0.spec.mjs` 即可切回真机 E2E，无需重写。

## 三、替代方案：真实源码 + 内存 chrome API

```
真实源码（src/ 原文件）
   ├── 运行在 jsdom 提供的 DOM 上（window / document / location）
   └── 运行在内存版 chrome.* 上（storage / runtime 消息 / alarms / contextMenus / sidePanel）
```

这不是 mock 掉被测对象，而是 mock 掉**宿主环境**，被测代码仍是产品代码本身。

### 文件

| 文件 | 作用 |
|---|---|
| `chrome-mock.mjs` | 内存版 chrome API。`storage.local` 带真实 `onChanged` 广播；`runtime.sendMessage` 真实投递给后台监听器并异步回包 |
| `harness.mjs` | 用 jsdom 装载真实 HTML，注入 chrome，导入真实 UI/后台模块；支持 classic content script 的 eval |
| `real-p0.test.mjs` | 9 项行为验证 |
| `arch-guard.test.mjs` | 9 项架构守卫（静态检查，防止分层被破坏） |
| `launch.mjs` / `p0.spec.mjs` | 真机 E2E 封装（当前环境不可用，备用） |

### 运行

```bash
node --test tests-real/          # 18 项
node --test flomo-extension/tests/unit   # 22 项纯函数单测（在扩展目录内）
```

## 四、已覆盖 vs 仍需真机

**已由沙盒自动验证**（对应 P0 验收清单）：

- 后台 `onInstalled` 初始化链路：默认配置落盘、注册 alarms、注册右键菜单、设置图标行为
- 未登录 → `openPanelOnActionClick=false`（弹 Popup）；已登录 → `true`（开 Side Panel）
- 消息总线往返：`ping` / `config_get` / `config_set`；未知消息归一为 `validation_error`
- Popup 渲染 + 与后台往返成功（对应用户真机看到的 "SW ready"）
- i18n 运行时切换（改语言后页面**热更新**为英文，不重载）
- 配置热更新经 `storage.onChanged` 传播（SW 无法推消息给 content script 的替代路径）
- content script 在黑名单站点与普通站点均不抛错
- 日志脱敏：token / 正文不出现在输出
- 零第三方域名（源码扫描）
- manifest：最小 host 权限、无 tabs、注入 `<all_urls>`、`all_frames:false`、入口文件均存在
- 分层守卫：core 无平台依赖、UI 不直接调 api、background 无 `setInterval`

**仍需真机（沙盒物理上做不到）**：

1. 真实 CORS 与 `flomoapp.com` 网络请求（P1 才有）
2. SW 真实生命周期（30 秒回收、事件保活）
3. 划词浮层在真实网页的定位与 Shadow DOM 表现
4. 右键菜单实际弹出与点击（真机已由用户确认 ✅）
5. 系统通知、Side Panel 真实拖拽与跨标签页行为
6. 视觉观感（配色/动效/间距是否好看）

## 五、用户真机已确认项（2026-09-08）

- ✅ 点击扩展按钮弹出 Popup 正常
- ✅ 从侧边栏打开正常
- ✅ Popup 显示 "SW ready"（消息往返成功）
- ✅ 右键菜单常驻显示「存入 flomo」
- ⏸ 其余因缺少登录无法走查 → 待 P1 完成后补测
