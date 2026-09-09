# flomo 浏览器扩展 · 状态机（每轮必读，压缩后靠本文件秒恢复）

> 更新：2026-09-08 · 本文件只放**状态、硬约束、指针**；口径细节一律去 `decisions-final.md` 查。

## 0. 一句话
基于 flomo-cli（逆向 flomo **网页版** Web API，非付费 Open API）构建 **MV3 原生 JS 扩展**（零构建、不上架自用）。
API 契约不变，换的是传输层 / 存储层 / 交互层。

## 1. 当前状态
| 项 | 状态 |
|---|---|
| 代码分析 | ✅ `raw/flomo-cli-code-analysis.md` |
| 需求调查 | ✅ R1–R19 → 最终口径 `core/decisions-final.md`；全过程 `core/decisions-history.md` |
| 架构审计 | ✅ 4 致命 / 7 严重 已拍板 → `flomo-extension-架构审计报告.md` |
| 测试 | ✅ **145 项全过**（68 纯函数 + 11 契约守卫 + 10 契约回放 + 21 API 链路 + 35 后台/UI/架构） |
| 真机 | ✅ 用户确认：弹 Popup / 侧边栏 / SW ready / 右键「存入 flomo」 |
| **当前阶段** | ✅ **P1 代码完成**（109 项测试全过）→ ⏸ **待真机验证 slug**，然后进 P2（详情见 `wiki/p1-notes.md`） |
| 沙盒能力边界 | ❌ 真实浏览器 E2E（Chromium 无扩展支持）· ❌ flomoapp.com / github.com / raw.githubusercontent（403）· ✅ **codeload.github.com 可达**（可下上游仓库）→ 见 §6
| 验证机制 | ✅ **免真机三层防线**（契约守卫/契约回放/mock 链路）＋ `node tests-real/run-all.mjs` 一键跑 145 项 → 见 §3.1 |

## 2. 硬约束（写代码前过一遍，违反即根源性缺陷）
1. **CORS**：API 请求必须走 SW 代理；content script / UI 禁止直连 fetch
2. **定时**：禁 `setInterval`，周期任务一律 `chrome.alarms`
3. **SW 保活**：事件 handler 必须返回 Promise
4. **Token**：只存 storage，**每次现读**，不进内存
5. **同步**：**软删在本地过滤**（`include_deleted` 是 CLI 的本地开关，**不是**服务端参数）；按 slug upsert
6. **签名**：排序→跳过 None/""→`"&".join(parts)` + SECRET → **MD5**
   - ⚠️ 末尾**无多余 `&`**；⚠️ 必须带 **timestamp**（秒级，每次现取）；⚠️ Web Crypto 无 MD5（自带实现）
7. **请求头**：`Authorization: Bearer` / `platform: web` / `device-model: web` / `device-id` / UA
   ⚠️ **POST/PUT 必须是 JSON body**（`application/json`），form-urlencoded 会被拒；GET/DELETE 走 query
8. **错误**：只用稳定 error 码判断，不解析中文文案；`-10/-20` → 清 token + 引导登录
9. **重试**：仅网络错指数退避 3 次（2/4/8s）；API 业务错不重试
10. **i18n**：自建轻量 i18n（不用 `chrome.i18n`，它运行时不可切）
11. **IDB 事务不可跨 `await fetch`** → 每页独立事务 + 游标落盘
12. **配置传播靠 `chrome.storage.onChanged`**（SW 推消息给 content script 需 tabs 权限，已否决）
13. **依赖方向**：`core` ← `api` ← `background`；UI 禁止直接 import `api`
14. **渲染一律纯文本化**（`html_to_text`），不渲染服务端 HTML
15. **outbox 不清**：清空缓存不得删待发队列

## 3. 分层索引（按需加载）
| 层 | 文件 | 何时读 |
|---|---|---|
| core | `INDEX.md`（本文件） | 每轮必带 |
| core | `decisions-final.md` | **查任何功能口径时**（唯一实现依据） |
| core | `decisions-history.md` | 需溯源"为什么这么定"时 |
| wiki | `p1-notes.md` | **P1 阶段**（API/签名/登录，含待验证项） |
| 文档 | `flomo-extension/docs/P1.1-登录失败修复.md` | **真机报错修复**：timestamp / 签名末尾 & / JSON body |
| `flomo-extension/docs/P1-验收清单.md` | P1 三发现 + 116 项验证 + **真机脚本用法** |
| wiki | `flomo-api-contract.md` | 写端点 / 签名 / 请求头时 |
| wiki | `flomo-extension-design.md` | ⚠️ **历史参考，多处已被推翻，勿作实现依据** |
| raw | `flomo-cli-source/` | **权威契约源**（上游全量源码，含抓包文档与签名向量） |
| raw | `flomo-cli-code-analysis.md` | 早期分析（已被上游源码取代，仅留档） |

## 4. 决策速记（只列最容易记错的，完整版见 decisions-final.md）
- **入口**：点图标智能分流——未登录弹 Popup 登录，已登录开 Side Panel（速记框在侧边栏顶部）
- **划词**：触发四选项，**默认「浮出小图标」**（非直弹）；悬浮球已砍；右键菜单保留
- **保存**：toast 后关闭；撤销**跟 toast 同寿（约 6 秒，不落盘）**，撤销=真删 + 提示回收站
- **同步**：登录/首次全量（显示"已同步 N 条"，不显示假分母）→ 之后增量；alarms 默认 5 分钟可设
- **队列**：离线入 outbox，**三路兜底 flush**（alarms 前 / 打开 UI 时 / 保存成功后）
- **浏览**：每页 50 滚动加载；本地搜索+高亮；**排序/筛选为浏览态控件，列表顶部即时生效**
- **渲染**：全部纯文本化，只留「含图片/音频」标记
- **设置**：底部「保存」统一提交（离开自动保存）；清空缓存点一次执行（outbox 不清）；无恢复默认
- **权限**：host 仅 flomoapp；注入 `<all_urls>`（已接受警告）；零上报；日志脱敏；站点黑名单
- **Agent 接口**：已取消（P7 删除）

## 5. 踩过的坑（已解决，别重蹈）
0. **【真机报错】「请传入 timestamp」** → 每个请求必须带 `timestamp`（秒级字符串）且参与签名。详见 `wiki/flomo-api-contract.md`
1. **Web Crypto 不支持 MD5**（`crypto.subtle.digest('MD5')` 抛错）→ 自带 MD5 纯函数，用 Node `crypto.createHash('md5')` 交叉验证
1b. **签名拼接末尾不能有多余 `&`**，且 MD5 输出是**小端字节序** —— 两处都曾导致结果全错
1c. **POST/PUT 用 JSON body**，不是 form-urlencoded
1d. **`include_deleted` 是本地过滤**，不是服务端参数
2. **文本往返必须转义**：写前 `escapeHtml` → 读后 `htmlToText`，否则用户写的 `<`、`&` 被吞
3. **device-id 必须持久化复用**，每次随机会像"不断换设备"触发风控
4. **日期按 UTC+8 解析**（对齐服务端 `tz=8:0`），不依赖本机时区
5. **快捷键冲突无法运行时改派** → 只注册一组，引导用户去 `chrome://extensions/shortcuts`

## 6. 沙盒能力边界（别再重复尝试）
| 能力 | 结论 |
|---|---|
| 真实浏览器 E2E | ❌ Playwright CDN 403；唯一可用 Chromium(@sparticuz) 被裁：`load-extension` 开关不存在、`chrome://extensions` ERR_INVALID_URL |
| 访问 flomoapp.com / github.com / raw.githubusercontent | ❌ 403 / TIMEOUT |
| **codeload.github.com** | ✅ **可达** → 可下载上游仓库压缩包，拿到权威源码与文档 |
| 替代方案 | ✅ 真实源码 + jsdom + 内存 chrome API（`/data/workspace/tests-real/`） |
| 仍需真机 | **只剩三类**：视觉观感 / SW 真实生命周期 / 浏览器特有交互（浮层定位、Shadow DOM、右键、侧边栏） |

## 3.1 免真机验证（日常主入口）
```bash
node tests-real/run-all.mjs          # 一键跑 145 项（含环境自检 + 自动修依赖）
node tests-real/run-all.mjs --sync   # 顺带做契约漂移检查（对比上游 flomo-cli）
node flomo-extension/tools/sync-contract.mjs [--update]   # 单独查契约是否过期
```
三层防线：**契约守卫**（实现 vs 上游源码静态比对，抓"上游有我们没有"这类错误）
→ **契约回放**（官方抓包的真实响应驱动真实源码）→ mock 链路与 UI。
详见 `flomo-extension/docs/免真机验证机制.md`。
⚠️ 环境坑：npm 装全局但 Node 裸导入只查 ./node_modules → `ensure-env.mjs` 自动建软链自愈。

## 3.2 权威事实源（比任何文档描述都可靠）
`_memory/raw/flomo-cli-source/` —— 上游 flomo-cli 全量源码（166KB），由 codeload 下载。
- `docs/flomo-api-analysis.md`：**真实抓包**记录，每个端点标了"已验证"
- `tests/test_signing.py`：真实请求的签名向量 `e8749f38dfc1fcdd1582d34a0c7759f0`
- `flomo_cli/client.py`：已验证可工作的实现（写 API 代码**逐行对齐它**）
⭐ 已由官方响应确认：**PUT /memo 返回体含 slug → 撤销/删除功能成立**（审计 L3 已解答）

## 7. 阶段计划
| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 骨架 + i18n 骨架 + 设计 token + logger | ✅ |
| **P1** | **API 客户端 + 签名(MD5) + 登录 + 端点** | ✅ 完成（待真机验证 slug） |
| P2 | 把关中枢 + 请求串行队列/限流 + 消息总线完善 | ⏸ |
| P3 | IndexedDB + 增量同步（每页事务 + 游标落盘 + 同步锁） | ⏸ |
| P4 | 划词浮层 / Popup 速记 / 快捷键 / 右键 / 黑名单 | ⏸ |
| P5 | Side Panel：列表 / 搜索 / 详情 / 回顾 / 推荐 | ⏸ |
| P6 | 设置页 + 主题 + 自检面板 | ⏸ |
| ~~P7~~ | ~~Agent 接口~~ | ❌ 已取消 |

## 8. 文件指针
| 路径 | 用途 |
|---|---|
| `/data/workspace/flomo-extension/` | 源码根（manifest 在此） |
| `flomo-extension/README.md` | 依赖方向 + 硬约束 + 阶段进度 |
| `flomo-extension/docs/P0-验收清单.md` | 走查项 + P1 前必办 3 项 |
| `flomo-extension/docs/P0-修复与推迟清单.md` | 已修 8 项 / 推迟 22 项（含理由） |
| `flomo-extension/src/shared/core/memo.js` | 转义闭环 / 纯文本化 / 标签 / 时间 / 搜索匹配 |
| `flomo-extension/src/shared/core/md5.js` | **自带 MD5**（Web Crypto 不支持） |
| `flomo-extension/src/shared/api/client.js` | 注入式 API 客户端（fetch/token/deviceId 全注入） |
| `flomo-extension/tools/verify-api.mjs` | **真机验证脚本**（需用户跑，确认 slug） |
| `/data/workspace/tests-real/` | 准真机测试（chrome-mock / harness / 守卫） |
| 测试命令 | `node --test flomo-extension/tests/unit` ＋ `node --test tests-real/` |
| **待用户执行** | `node flomo-extension/tools/verify-api.mjs --email <> --password <>` |
