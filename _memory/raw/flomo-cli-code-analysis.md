# flomo-cli 代码详细分析

> 分析对象：https://github.com/dulk-dev/flomo-cli （逆向 Flomo Web API 的命令行工具，Python/Click）
> 分析目的：为「基于该项目构建浏览器扩展」提供可复用的核心知识与风险清单
> 分析日期：2026-03-22

---

## 0. 一句话定位

flomo-cli 是一个**薄客户端 + API 适配层**：它自己不存储数据，所有能力都来自对 `https://flomoapp.com/api/v1` 的逆向调用。浏览器扩展要做的事，本质是把这套「CLI ↔ API」的桥，换成「浏览器 UI ↔ API」的桥——**API 契约不变，变的是传输层、存储层、交互层**。

---

## 1. 架构分层（与构建扩展的映射）

| 层 | flomo-cli 实现 | 浏览器扩展对应物 | 能否复用 |
|----|----------------|------------------|----------|
| 入口/交互 | `cli.py` + Click 命令组 | Popup / Side Panel / 右键菜单 | 重写（UI 范式不同） |
| 命令/业务 | `commands/*.py`（`handle_command` 统一流程） | 各功能模块（capture/list/search...） | **逻辑可复用，载体重写** |
| 客户端/传输 | `client.py`（签名+httpx+重试） | `background` service worker 中的 fetch 封装 | **签名/端点复用，传输重写** |
| 认证 | `auth.py`（Token 优先级链 + 文件缓存） | `chrome.storage.local` + 登录表单 | **流程复用，存储重写** |
| 常量 | `constants.py`（host/key/secret/path） | 同，挪到 `config.ts` | 直接复用 |
| 异常/错误码 | `exceptions.py` + `error_codes.py` | 同，映射为扩展内错误类型 | 直接复用 |
| 格式化输出 | `formatter_*.py`（Rich 表格 / JSON envelope） | 前端状态/组件渲染 | 重写（输出目标不同） |

> **关键洞察**：`client.py` 里的 `_generate_sign` / 端点方法 / 数据清洗（`_format_memo`），以及 `auth.py` 的登录与 Token 优先级，**是跨平台可移植的核心资产**；凡是「文件 I/O」「终端 I/O」「httpx」的部分都要重写。

---

## 2. 核心 API 契约（构建扩展的硬知识）

### 2.1 基础信息
- **API Base**：`https://flomoapp.com/api/v1`
- **认证**：`Authorization: Bearer <access_token>`
- **签名 secret（硬编码常量）**：`SIGN_SECRET = "dbbc3dd73364b4084c3a69346e0ce2b2"`
- **固定参数**：`api_key=flomo_web`、`app_version=4.0`、`platform=web`、`webp=1`
- **时区**：`tz=8:0`（即 UTC+8）

### 2.2 签名算法（MD5，10 行，已验证）
```
1. 收集请求参数（不含 sign）
2. 按 key 字典序排序
3. 跳过 None 和 ""（但保留整数 0）
4. 拼成 key=value& 串；列表用 key[]=item 形式且每项再排序
5. 末尾追加 SIGN_SECRET
6. MD5(raw) → sign
```
- GET：签名参数放 **query string**
- POST/PUT/DELETE：签名参数放 **request body**（与业务参数合并后整体签名）

### 2.3 请求头
```
Authorization: Bearer <token>
platform: web
device-model: web
device-id: <唯一标识>
User-Agent: flomo-cli/<version>   # 扩展可自定义
```

### 2.4 已验证端点清单

| 端点 | 方法 | 用途 | 验证 |
|------|------|------|------|
| `/user/login_by_email` | POST | 账密登录，返回 `access_token` | ✅ |
| `/user/me` | GET | 当前用户信息 | ✅ |
| `/memo` | PUT | 创建笔记 | ✅ |
| `/memo/{slug}` | PUT | 更新笔记 | ✅ |
| `/memo/{slug}` | DELETE | 软删除 | ✅ |
| `/memo/{slug}` | GET | 单条详情 | ✅ |
| `/memo/updated/` | GET | 分页拉取（增量同步） | ✅ |
| `/memo/latest_updated_desc` | GET | 最新更新排序列表 | ✅ |
| `/memo/{slug}/recommended` | GET | 语义相关笔记（带相似度） | ✅ |
| `/memo/notify_of_today/` | GET | 每日回顾的 slug 列表 | ✅ |
| `/tag/tree` | GET | 标签树 | ✅ |
| `/tag/rename` | POST | 重命名标签（服务端原子，同步所有笔记） | ✅ |
| `/memo/{slug}/pin` `/unpin` | POST | 置顶/取消 | 文档列，未在本 CLI 实现 |
| `/memo/{slug}/restore` | POST | 恢复软删 | 文档列 |
| `/memo/{slug}/force_delete/` | POST | 永久删除 | 文档列 |
| `/memo/insight` | GET/POST | AI 洞察 | 文档列 |

### 2.5 响应结构
```json
{ "code": 0, "message": "success", "data": { ... } }
```
- `code == 0` → 成功，取 `data`
- `code == -10` → Session 过期（需重新登录）
- `code == -20` → 需验证密码
- 其他非零 / `code == -1` 且 message 含「没有找到」 → 资源不存在

### 2.6 Memo 数据模型（关键字段）
```json
{
  "slug": "MTA1MDM5OTgy",        // Base64 编码的 ID，API 标识
  "content": "<p>HTML 格式内容</p>",  // 注：是 HTML，不是纯文本
  "tags": ["父标签/子标签"],       // 纯字符串数组，层级用 /
  "pin": 0,                       // 0 普通 / 1 置顶
  "created_at": "2024-02-21 08:36:29",
  "updated_at": "2024-02-21 08:46:01",
  "deleted_at": null,             // 非 null = 软删除
  "files": [ { "id":..., "type":"image|audio", "url":..., "thumbnail_url":... } ]
}
```
- **标签自动提取**：从 `content` 中 `#标签名` 语法自动解析，无需单独传参
- **写入时 content 需为 HTML**：纯文本要包成 `<p>行</p>`（见 `_text_to_html`）
- **slug 是 Base64 数字 ID**，非自增整数

### 2.7 分页机制（cursor-based）
```
GET /memo/updated/?limit=200&latest_updated_at=0&latest_slug=<slug>&tz=8:0
```
- 用 `latest_updated_at`（时间戳）+ `latest_slug` 做游标
- 返回空列表 = 到底，停止
- 全量拉取约 3-5 次请求（千条级规模可接受）

---

## 3. 客户端核心机制（cli 行为细节）

1. **重试**：仅对网络错误（`Timeout/NetworkError`）指数退避重试 3 次；API 级错误（认证/404/业务）**不重试，立即抛出**。→ 扩展应保留此策略。
2. **软删除过滤**：`list` 默认过滤 `deleted_at` 非空项；`list_all_memos` 内部全量含软删再过滤。
3. **搜索是纯客户端**：无服务端搜索 API → 先全量拉取 `memo/updated/` 分页，再内存匹配 `content_text` / `tags`。→ 扩展必须有**本地缓存策略**（否则每次搜索都全量拉取）。
4. **相关笔记**：`GET /memo/{slug}/recommended?type=1`，返回 `similarity`（字符串 0~1）+ 完整 memo。
5. **每日回顾**：`GET /memo/notify_of_today/` 返回 slug 列表，再逐条 `get_memo`（404 静默跳过）。
6. **输出双模**：人类 = Rich 彩色表格；Agent = `--json` 标准 envelope `{ok, data, has_more/total}`，且**管道非 TTY 时自动切 JSON**。错误用稳定 `error` 码（`not_authenticated`/`not_found`/`validation_error`/`api_error`/`unknown_error`）而非文案解析。
7. **Token 优先级**：`--token` > `FLOMO_TOKEN` 环境变量 > `~/.flomo-cli/token.json`（chmod 0600）> 提示登录。

---

## 4. 对浏览器扩展的关键风险与决策点

### 4.1 CORS（最致命）
Flomo 服务端**未配置允许浏览器跨域**。浏览器页面里的 `fetch` 会被 CORS 拦截。
- ✅ 解法：**所有 API 请求必须走 `background` service worker（MV3）或 background script（MV2）**，后台上下文不受页面 CORS 限制。
- ❌ 内容脚本（content script）或 popup 直接 fetch 会被拦。
- 这是「环境假设」与「业务逻辑」必须解耦的典型点：业务只关心「发请求拿数据」，但扩展里**请求必须由 background 代理**。架构上应定义 `messaging` 层，UI ↔ background ↔ API。

### 4.2 签名 secret 暴露
`SIGN_SECRET` 已是公开常量（前端 JS 同源逆向可得）。扩展打包后也公开，**无额外风险**，但意味着该签名不能当安全边界——真正的安全边界是 `access_token`，必须存 `chrome.storage.local` 且不进版本库。

### 4.3 Token 存储迁移
- CLI：文件 `~/.flomo-cli/token.json`（0600）。
- 扩展：`chrome.storage.local`（或 `session`，取决于是否要跨重启保留）。需实现等价的「优先级解析 + 安全存储」。

### 4.4 登录流程
`POST /user/login_by_email` 账密登录 → 存 token。扩展内可做表单 UI（Popup 或独立登录页）。注意：明文密码只在登录瞬间经 HTTPS 发出，不持久化。

### 4.5 内容 HTML 编解码
- 创建：`_text_to_html` 把纯文本包 `<p>`。扩展输入框拿到的是纯文本，需同样处理。
- 展示：`html_to_text` 剥离标签。扩展渲染历史笔记时需反向剥 HTML（或保留富文本展示）。

### 4.6 搜索/同步的本地缓存
CLI 每次搜索实时全量拉取（千条级 OK）。扩展若频繁搜索/渲染，应引入 **IndexedDB 缓存 + `memo/updated/` 增量同步**，避免每次都打全量。这点是扩展相对 CLI 的体验升级点，也是需要额外设计的「把关」环节（缓存失效/刷新策略）。

### 4.7 状态依赖可靠性
CLI 是「命令即进程」，无跨命令状态。扩展是**常驻长生命周期**：登录态、缓存、网络状态都是跨交互依赖。需避免把「假设已登录/已缓存」当成前提，应在每个操作入口做状态校验（呼应你强调的「状态依赖不可靠」）。

---

## 5. 可复用资产清单（直接搬，改载体）

- ✅ `_generate_sign` 算法（纯函数，可 1:1 转 TS）
- ✅ 端点路径 + 方法 + 参数拼装（`client.py` 各方法）
- ✅ `_format_memo` 数据清洗逻辑（slug/content_text/tags/files 抽取）
- ✅ 登录 + Token 优先级流程（`auth.py`）
- ✅ 错误码映射（`error_codes.py`）
- ✅ 响应 code 判定与异常映射（`_handle_response`）

## 6. 必须重写的部分

- 🔄 传输层：httpx → `fetch`（background）
- 🔄 存储层：文件路径 → `chrome.storage` / IndexedDB
- 🔄 交互层：Click 命令 + Rich → Popup/Side Panel/右键菜单 + 前端组件
- 🔄 输出层：终端表格/JSON envelope → 前端状态管理 + 组件渲染
- ➕ 新增：messaging 代理层（UI↔background↔API）、本地缓存/增量同步

---

## 8. 关键澄清：Web API 逆向 vs 付费 Open API（用户指正后深挖）

> 用户指出：Flomo 的开发者 API 是**付费功能**，本项目是通过逆向**网页版 Web API** 实现的，并非使用付费 Open API。重新核对代码后确认如下。

- `constants.py` 写死 `API_KEY="flomo_web"`、`PLATFORM="web"`、`APP_VERSION="4.0"` → 这是**网页前端**身份，不是开发者 Open API。
- `client.py` 唯一登录入口 `FlomoClient.login()` → `POST /user/login_by_email`（邮箱+密码），返回 `access_token`，存 `token.json`。
- **整个代码库无任何 `api_token` / Open API 调用**。文档提及的 `api_token` 仅出现在 localStorage 结构说明里，项目从未使用。
- **结论**：本项目逆向的是 Flomo **网页版 Web API（免费账号即可用）**，刻意绕开付费 Open API。所谓"签名"也是网页前端那套 `MD5 + 固定 secret`，并非 Open API 鉴权。

### 对认证设计的含义
- 扩展要"对齐开源项目"，唯一自然路子是复用同一套**网页登录 `login_by_email`**。
- "粘贴 api_token" 实为走付费 Open API 的岔路，与项目精神相反（除非用户本身是 PRO 且想用官方接口）。
- 因此认证选项应重排为：① 对齐项目（网页账密登录）/ ② 走官方付费 Open API / ③ 双支持。

## 7. 待用户决策的核心问题（驱动多轮调查）

1. **构建框架**：原生 MV3 / WXT（跨浏览器）/ Plasmo？
2. **目标浏览器**：Chrome/Edge 优先？还是要 Firefox/Safari？
3. **MVP 功能范围**：速记 / 划词保存 / 浏览+搜索 / 每日回顾+相关推荐？
4. **录入交互形态**：Popup 弹窗 / 侧边栏 / 右键菜单 / 页面悬浮球？
5. **认证方式**：复用账密登录表单 / 手动粘贴 Token / 读取本地 CLI 缓存？
6. **本地缓存策略**：是否引入 IndexedDB 增量同步？
7. **是否保留 Agent/JSON 双模**：扩展是否需要对外暴露结构化接口，还是纯人类 UX？

> 详见 `wiki/flomo-api-contract.md`（速查）与 `core/INDEX.md`（状态机）。
