# flomo 扩展设计文档（**历史参考**）

> ⚠️⚠️ **本文件是早期设计稿，多处已被 R18 架构审计与 R19 补充扫描推翻。**
> **请勿作为实现依据**，实现口径一律查 `core/decisions-final.md`；架构查 `flomo-extension-架构说明.md`。
> 用户明示："设计文档仅作参考，按照更优化的方案落地"。
>
> 已知被推翻处（非完整清单）：悬浮球（已砍）· 详情渲染 HTML（改全纯文本）· 撤销 5 分钟落盘（改跟 toast 同寿）· 整批事务（改每页独立事务）· Agent 接口（已取消）· 目录结构（按可测性重排）。

---

# flomo 浏览器扩展 · 设计方案（Design Spec）

> 来源：`_memory/raw/flomo-cli-code-analysis.md`（代码分析） + 6 轮用户需求调查
> 目标：基于开源 flomo-cli（逆向 Flomo 网页版 Web API 的 Python CLI）构建 MV3 浏览器扩展
> 状态：调查完成，本方案待用户确认后进入实现

---

## 一、决策总览（6 轮调查结论）

| # | 维度 | 决策 |
|---|------|------|
| R1 | 构建框架 / 目标 | **原生 MV3**，Chrome/Edge 优先 |
| R1 | 功能范围 | **全功能**：快速记录 / 划词保存 / 浏览与搜索 / 每日回顾+相关推荐 |
| R1 | 录入形态 | **全形态**：Popup 弹窗 / 侧边栏 / 右键菜单+划词 / 页面悬浮球 |
| R2 | Agent 接口 | **保留**（浏览器内 messaging 协议，返回与 CLI 一致的 JSON envelope） |
| R2 | 认证 | **网页账密登录 `login_by_email`**（免费网页账号），`access_token` 存 `chrome.storage.local` |
| R2 | 缓存 | **IndexedDB 增量同步**（首次全量，之后 `memo/updated/` 游标增量） |
| R3 | 内容形态 | **用户每次选择**是否附加来源（标题+链接） |
| R3 | 主入口 | **右键划词优先**（MVP 先打磨「看到即存」） |
| R3 | 状态把关 | **统一把关中枢**（操作前校验登录态；-10/-20 自动弹登录；网络错指数退避重试；离线读缓存并提示） |
| R4 | 设置页 | **全项**：Token 状态与登出 / 手动同步·清空缓存 / 来源附加默认行为 / 回顾·推荐开关 |
| R4 | 快捷键 | **可自定义**（默认建议 `Ctrl/Cmd+Shift+F` 唤起速记） |
| R5 | 同步时机 | **启动+定时增量+手动**（后台定时轮询 + 手动按钮，离线可读缓存） |
| R5 | 笔记渲染 | **列表纯文本摘要 + 详情渲染原始 HTML**（图片/音频可见） |
| R5 | 划词交互 | **弹小框编辑后存**（承载「每次选择是否附加来源」） |
| R6 | 标签管理 | **首版不做**（仅展示自动提取的标签；`tag/rename` 接口已逆向，留作后续） |
| R6 | 界面语言 | **双语 i18n**（中/英随浏览器语言切换） |
| R6 | 分发方式 | **本地加载调试**（chrome://extensions 开发者模式），暂不上架 |

---

## 二、核心认知（来自代码分析，驱动设计）

1. **flomo-cli 是薄客户端 + API 适配层**：不自存数据，全部能力来自 `https://flomoapp.com/api/v1` 的逆向调用。
2. **项目逆向的是免费网页版 Web API**，非付费 Open API：`constants.py` 写死 `api_key=flomo_web`/`platform=web`；唯一登录入口 `login_by_email`（邮箱+密码）→ `access_token`；**全程无 `api_token` 调用**。
3. **致命约束 — CORS**：Flomo 服务端未开放跨域，浏览器页面 `fetch` 会被拦 → **所有 API 请求必须走 background service worker 代理**（页面脚本/内容脚本不可直接调）。
4. **无服务端搜索**：需客户端全量拉取 + 内存/缓存过滤 → 扩展引入 IndexedDB 缓存实为体验升级点。
5. **可移植核心资产**（1:1 转 TS）：`_generate_sign` 算法、`client.py` 端点方法、`_format_memo` 清洗、`auth.py` 登录+Token 优先级、`error_codes.py` 映射。

---

## 三、架构总览（分层解耦，呼应「环境假设 ≠ 业务逻辑」）

```
┌──────────────────────────────────────────────────────────────┐
│  UI 层（ humans 交互，不碰网络）                                │
│  popup / sidepanel / capture-dialog / options / login          │
└───────────────┬──────────────────────────────────────────────┘
                │ chrome.runtime.sendMessage / connect（唯一出口）
┌───────────────▼──────────────────────────────────────────────┐
│  Messaging 代理层（message-bus）                                │
│  · 统一消息协议（Agent 接口同此通道）                           │
│  · 统一把关中枢：校验登录态 → 重试 → 离线降级                   │
└───────────────┬──────────────────────────────────────────────┘
                │ 调用（SW 上下文，不受页面 CORS 限制）
┌───────────────▼──────────────────────────────────────────────┐
│  Background Service Worker（MV3 常驻后台）                      │
│  api-client（签名+端点+响应处理）│ auth（Token 优先级链）       │
│  sync（增量同步调度）│ cache（IndexedDB 读写）                 │
└───────────────┬──────────────────────────────────────────────┘
                │ HTTPS（绕过 CORS）
┌───────────────▼──────────────────────────────────────────────┐
│  Flomo Web API  https://flomoapp.com/api/v1                    │
└──────────────────────────────────────────────────────────────┘

存储：chrome.storage.local（token+userInfo）｜IndexedDB（memos/tags/daily/related/cursor）
```

> **关键解耦**：UI 与业务逻辑只通过 messaging 通信；所有"发请求"归一到 SW。这样"环境假设"（CORS、后台生命周期、登录态）与"业务逻辑"（记录/搜索/回顾）彻底分离，避免根源性耦合。

---

## 四、文件结构（MV3）

```
flomo-extension/
├── manifest.json              # MV3: permissions / background / commands / side_panel / contextMenus
├── background/
│   ├── service-worker.js      # 入口：注册消息总线、定时同步、右键菜单
│   ├── api-client.js          # 移植 client.py：签名+端点+响应处理+重试
│   ├── auth.js                # 移植 auth.py：Token 优先级链 + chrome.storage
│   ├── error-codes.js         # 移植 error_codes.py：异常→稳定错误码
│   ├── sync.js                # 增量同步调度（启动+定时+手动）
│   ├── cache.js               # IndexedDB 读写（memos/tags/daily/related/cursor）
│   └── message-bus.js         # 统一消息中枢 + 把关（校验/重试/离线降级）
├── content/
│   ├── selection-menu.js      # 选中文本浮出「保存到 flomo」+ 划词小框
│   └── floating-ball.js       # 页面悬浮球
├── ui/
│   ├── popup/                 # 工具栏弹窗：速记框（主速记入口）
│   ├── sidepanel/             # 侧边栏：历史列表+搜索+回顾+相关
│   ├── capture-dialog/        # 划词编辑小框（内容+标签+来源开关）
│   ├── options/               # 设置页（全项）
│   └── login/                 # 登录页（login_by_email 表单）
├── shared/
│   ├── sign.js                # 移植 _generate_sign（MD5）
│   ├── format.js              # 移植 _format_memo / html_to_text / text_to_html
│   ├── constants.js           # API_BASE / SIGN_SECRET / API_KEY=flomo_web ...
│   └── i18n/                  # zh / en 文案
└── assets/
```

---

## 五、核心模块设计

### 5.1 API 适配层（`api-client.js` ← client.py）
- `_generate_sign(params)`：参数按 key 排序 → 跳过 None/""（保留 0）→ `key=value&` 拼接（列表 `key[]=v`）→ 追加 `SIGN_SECRET` → MD5。**`SIGN_SECRET="dbbc3dd73364b4084c3a69346e0ce2b2"`（已公开常量，非安全边界）**。
- 端点方法（1:1 移植）：`login / getMe / listMemos / listMemosAscending / listAllMemos / getMemo / getRelated / getDailyReview / createMemo / updateMemo / deleteMemo / getTagTree`。
- GET 签名放 query；POST/PUT/DELETE 签名放 body。
- `_handle_response`：`code==0` 取 data；`-10/-20` → `NotAuthenticated`；`-1`+「没有找到」→ `NotFound`；其他 → `ApiError`。**仅网络错指数退避重试 3 次，API 级错误不重试**。

### 5.2 认证（`auth.js` ← auth.py）
- 优先级链（高→低）：`注入 token` > `chrome.storage.local.access_token` > 提示登录。
- `login(email, password)` → `POST /user/login_by_email` → 存 `access_token` + `userInfo`（不持久化密码）。
- 所有网络请求经 SW，password 仅登录瞬间经 HTTPS 发出。

### 5.3 缓存 + 同步（`cache.js` + `sync.js`）
- IndexedDB 表：`memos(slug PK, content, content_text, tags, updated_at, deleted_at, files)`、`tags`、`dailyReview`、`related`、`syncCursor(latest_updated_at, latest_slug)`。
- 同步策略（R5）：扩展启动做一次增量（或首次全量）→ **`chrome.alarms` 周期告警（默认 5min）**触发增量 → 设置页手动触发。
  > **⚠️ 根因约束（状态依赖不可靠）**：**禁止用 `setInterval`/`setTimeout` 做定时同步**——MV3 后台 SW 休眠后定时器随进程一起蒸发，会静默失效。周期性任务必须用 `chrome.alarms`（manifest 已授权），由 `chrome.alarms.onAlarm` 在 SW 唤醒时触发；瞬时任务用 `alarms.create` 一次性告警。
- 增量用 `GET /memo/updated/?limit=200&latest_updated_at=&latest_slug=&tz=8:0`，空列表即到底；更新 `syncCursor`。
- 搜索/回顾/相关推荐**优先读缓存**；缓存缺失或强制刷新时回源。

### 5.4 统一把关中枢（`message-bus.js`）
每次 UI/Agent 请求经此中枢：
1. **校验登录态**：无 token → 返回 `{ok:false, error:"not_authenticated"}` 并触发登录页；响应 `-10/-20` → 清 token + 弹登录。
2. **网络错**：指数退避重试（2s/4s/8s，最多 3 次）。
3. **离线（`navigator.onLine=false`）**：读缓存返回，附 `from_cache:true` 与提示。
4. 错误统一用稳定 `error` 码（`not_authenticated/not_found/validation_error/api_error/unknown_error`），不依赖文案解析。

### 5.5 Agent 接口（`message-bus.js` 暴露的同名协议）
- 通道：`chrome.runtime.sendMessage({type:"flomo:<cmd>", payload})` / `connect` 长连接。
- 命令与 CLI 对齐：`list / get / new / edit / delete / search / related / tags / review`，返回 **`{ok, data, has_more/total, error}`** envelope（与 CLI `--json` 一致）。
- 调用方：同浏览器内的 Agent 内容脚本 / 另一扩展 / 页面内脚本。

### 5.6 录入形态
- **右键划词（主入口 R3）**：选中文本 → 浮出菜单 → 点「保存」弹**划词小框**（capture-dialog）：显示内容 + 标签输入（`#标签` 自动提取）+ **来源开关**（每次询问是否附加「标题+链接」R3）→ 确认调用 `createMemo`。
- **Popup**：工具栏图标 → 速记框（快速记录）。
- **Side Panel**：常驻浏览，历史列表（纯文本摘要）+ 搜索 + 每日回顾 + 相关推荐（详情渲染 HTML，R5）。
- **悬浮球**：页面右下角常驻，点击唤起速记/划词。
- 全局快捷键（可自定义 R4）：`Ctrl/Cmd+Shift+F` 唤起速记。

### 5.7 设置页（R4 全项）
Token 状态与登出 / 手动同步·清空缓存 / 来源附加默认行为（总是/从不/每次询问）/ 回顾·推荐开关 / 快捷键自定义 / 语言切换。

---

## 六、权限清单（manifest.json）
- `permissions`: `storage`, `contextMenus`, `sidePanel`, `commands`, `alarms`（定时同步）, `notifications`（离线/失效提示）
- `host_permissions`: `https://flomoapp.com/*`
- `background.service_worker`: `background/service-worker.js`
- `commands`: `capture`（全局快捷键，可重映射）
- `side_panel`: 绑定工具栏图标

---

## 七、实现阶段计划（任务隔离，主线/分支管理）

| 阶段 | 内容 | 交付 | 分支 |
|------|------|------|------|
| P0 | 骨架 + manifest + constants + sign + error-codes | 可加载的空扩展 | `main` |
| P1 | API 适配层 + auth（login/storage） | 后台能登录并打通 `list` | `feat/api-auth` |

> **P1 关键约束（避免根源性问题）**
> - **标准请求头必须补齐**：每次请求带 `Authorization: Bearer <token>`、`platform: web`、`device-model: web`、`device-id`（SW 生成并持久化）、`User-Agent: flomo-extension/<ver>`；否则服务端会拒。CORS 已由 SW 代理规避。
> - **SW 异步保活**：所有消息/告警 handler 必须 `return fetch(...)`（返回 Promise），让浏览器在请求进行期间保持 SW 唤醒，否则请求会被腰斩。
> - **Token 不进内存状态**：`access_token` 仅存 `chrome.storage.local`，每次请求从 storage 读取，SW 休眠后不依赖内存残留。
| P2 | 统一把关中枢 + messaging 协议 | 前台可经总线读写 | `feat/message-bus` |
| P3 | IndexedDB 缓存 + 增量同步调度 | 离线可读、定时刷新 | `feat/cache-sync` |
| | **P3 已完成并验证**（db.js 存储层 + sync.js 增量引擎 + 总线缓存优先 + chrome.alarms 周期同步；P0–P3 共 123 项测试全过） | | |
| P4 | 录入形态：划词小框 + Popup + 悬浮球 + 快捷键 | 主入口（右键划词）可用 | `feat/capture` |
| P5 | Side Panel：历史/搜索/回顾/相关 | 浏览与搜索闭环 | `feat/sidepanel` |
| P6 | 设置页 + i18n（中英） | 全项设置 + 双语 | `feat/options-i18n` |
| | **P6 已完成并验证**（options 页 + 自建 i18n 三处 UI 全量走 `t()` + 配置校验与变更广播；P0–P6 共 302 项测试全过） | | |
| P7 | Agent 接口文档 + 示例 | messaging 协议对外可用 | `feat/agent-iface` |

> **P6 补充约定（实现期确立）**
> - 语言切换**不重载任何页面**：设置页改 `locale` → 总线 `config_set` → 后台广播 `flomo:config-changed` → 常驻视图（Side Panel）热更新；content script 在打开小框时重拉配置（避免陈旧状态）。
> - **设置项必须真实生效**：`source_default` 决定来源开关的默认值与可见性；`review_enabled`/`related_enabled` 关闭时对应区块直接不发请求；`locale` 即时重渲染；快捷键如实显示当前值（MV3 无改写快捷键的 API，只能引导到 `chrome://extensions/shortcuts`）。
> - **防漏译自动把关**：测试比对中英字典的键集合/占位符/非空，缺键即失败（双语项目最常见的静默缺陷）。

> 每阶段完成经`验证`（加载/手动走查/控制台无错）才合入主线，避免状态依赖不可靠。

---

## 八、风险与开放问题
- **CORS**：已通过 SW 代理规避，但需注意 SW 生命周期（休眠后首请求可能冷启动延迟）→ 用 `alarms` 保活或 `chrome.runtime` 唤醒。
- **SIGN_SECRET 公开**：已公开常量，无额外风险；真正边界是 `access_token`，存 `chrome.storage.local` 且不进版本库。
- **Flomo 反爬/接口变动**：当前无反爬，但逆向接口可能随前端版本变动 → 集中 `constants.js` + 错误码兜底。
- **PRO 功能**：`tag/rename`、标签图标为 PRO（R6 首版不做标签管理）；其余功能免费网页账号即可。

---

## 九、专项补充调查（用户指定）

### 9.1 缓存失效与多端一致性
**代码事实（来自 `client.py`）**
- 增量游标：`GET /memo/updated/?limit=200&latest_updated_at=<epoch>&latest_slug=<slug>&tz=8:0`；游标 =「上一页最后一条的 `updated_at`(epoch) + `slug`」，返回空列表即到底。
- `updated_at` 解析强制按 UTC+8（`_TZ_UTC8`）转 epoch 再回传；`tz` 固定 `8:0`。
- `list_all_memos` 内部用 `include_deleted=True` 全量拉取后再过滤 `deleted_at` → **同步必须含软删，才能感知远端删除**。
- 每日回顾：`GET /memo/notify_of_today/` 返回 slug 列表 → 逐条 `get_memo`（404 静默跳过）。
- 相关推荐：`GET /memo/{slug}/recommended?type=1` → 含 `similarity`（字符串 0~1）。

**风险与决策**
1. **同秒 `updated_at` 边界**：若同一秒多条，仅靠 `(updated_at, slug)` 游标，依赖服务端严格有序。→ 缓存层对 `memos` 以 `slug` 做 **upsert（主键去重）**，天然避免重复；服务端无序的极端风险记为已知边界。
2. **远端删除感知**：同步用 `include_deleted`，命中 `deleted_at` 即本地标记删除并移出列表；若用默认（不含删）会"幽灵复活"。→ **同步务必 `include_deleted`**。
3. **多端编辑冲突**：`PUT /memo/{slug}` 仅传 content，**无版本/ETag** → **last-write-wins，无合并**。本地编辑后乐观更新缓存；若与 flomo App 同时改同一条，后写覆盖先写且无提示。→ MVP 接受 LWW；可选增强：编辑前 `get_memo` 比对 `updated_at`，远端更新则弹确认（额外 1 次请求，列 P 后增强）。
4. **一致性窗口**：远端变更只在「启动/定时/手动」同步时被拉取 → 存在可见延迟窗口。→ Side Panel 顶部显示「上次同步时间 + 手动刷新」，明确窗口。
5. **时区**：游标依赖服务端 UTC+8 约定；非中国用户在同步正确性上仍 OK（按服务端时间），`tz` 仅影响展示。→ 维持 `8:0`，i18n 用户如需可后续参数化。
6. **缓存写时机**：本地 create/edit/delete 立即 upsert 缓存（乐观），再触发一次增量推前 cursor；失败回滚该条并走把关中枢。

### 9.2 i18n 落地方案
**关键约束**：Chrome 原生 `chrome.i18n` 跟随**浏览器 UI 语言**，**无法在设置页运行时切换**（切换需重载且仍绑浏览器语言）。而 R4 设置页含「语言切换」、R6 要求双语 → 必须用**自定义轻量 i18n**，支持运行时切语言。

**方案**
- 目录：`shared/i18n/{zh.js, en.js}` 各导出一个 `{ key: string }` 字典；`shared/i18n/index.js` 提供：
  - `getLocale()`：`chrome.storage.local.locale`（用户覆盖）|| 归一化 `chrome.i18n.getUILanguage()` → `'zh' | 'en'`，默认 `'zh'`。
  - `t(key, vars?)`：查表 + `{var}` 插值；缺失回退中文。
- 使用：所有 UI 文案走 `t('capture.save')`，**组件内不硬编码中/英**。
- 切换：设置页改 `locale` 存 `chrome.storage.local` → 触发当前视图重渲染（popup/options `location.reload()`；sidepanel 重渲染根节点），无需重载扩展。
- manifest：不依赖 `_locales`/`default_locale`（自定义方案）；保留 `chrome.i18n.getUILanguage()` 仅作默认语言探测。
- 复数/占位：用 `{count}` 占位即可，不做复杂复数规则。
- 提取：开发期所有字符串集中进两字典，键名语义化（如 `sidepanel.searchPlaceholder`）。
