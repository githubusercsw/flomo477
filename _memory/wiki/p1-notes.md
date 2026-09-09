# P1 阶段笔记（API 客户端 + 签名 + 登录）

> 只在 P1 阶段读。完成后归档要点进 `core/decisions-final.md` §L。
> 更新：2026-09-08

## 0. 【真机反馈修复】登录报「请传入 timestamp」（2026-09-08）
用户真机登录失败，报「请传入 timestamp」。回查 flomo-cli 源码发现**三处**与 CLI 不一致（CLI 是已验证可工作的实现）：

| # | 我们的错误 | CLI 正确做法 |
|---|---|---|
| 1 | 公共参数**缺 timestamp** | `timestamp: str(int(time.time()))`，秒级、字符串、参与签名 |
| 2 | 签名拼接末尾**多了个 &**（`k=v&k2=v2&`+SECRET） | `"&".join(parts) + SECRET`，末尾无 `&` |
| 3 | POST/PUT 用 form-urlencoded | **JSON body**（`application/json`） |

附带修正：`tz` 不属于公共参数（只在 /memo/updated/ 与创建笔记传）；`include_deleted` 是 CLI 本地过滤开关，不是服务端参数。

均已修 + 补测试（含 Python 基准向量交叉验证）。契约已同步到 `wiki/flomo-api-contract.md`。

## 1. P1 的三个硬发现

### 发现一：Web Crypto 不支持 MD5（已解决）
```js
crypto.subtle.digest('MD5', data)  // ❌ 抛 "Unrecognized algorithm name"
```
Web Crypto 只支持 SHA-1/256/384/512。**flomo 签名必须 MD5** → 只能自己实现纯函数。
已实现于 `src/shared/core/md5.js`，单测用 Node `crypto.createHash('md5')` 交叉验证（测试代码仅限 Node，不进产品）。

### 发现二：沙盒无法访问 flomoapp.com（无法自动验证）
出网代理返回 `{"detail":"No policy rule matched the request"}`（DNS 可解析，请求被网关拒）。
→ **`PUT /memo` 是否返回 slug 这条硬依赖（审计 L3）无法在沙盒验证**，必须真机跑一次。
已交付 `tools/verify-api.mjs`（Node 直连，用户在能联网的机器上跑）。

### 发现三：签名要"整体签名"而非只签业务参数
固定参数（`api_key`/`app_version`/`platform`/`webp`/`tz`）必须**与业务参数一起参与排序签名**，
不能只签业务参数再把固定参数拼在 URL 上 —— 否则服务端算出的 MD5 不一致。

## 2. 已实现模块

| 文件 | 职责 |
|---|---|
| `src/shared/core/md5.js` | MD5 纯函数（浏览器无原生实现） |
| `src/shared/core/sign.js` | 签名：`generateSign(params)` / `buildSignedParams` |
| `src/shared/core/http.js` | 请求参数序列化纯逻辑（query/body 构造） |
| `src/shared/api/endpoints.js` | 端点定义（路径 + 方法 + 基础参数） |
| `src/shared/api/client.js` | 客户端：**注入式 fetch**，签名 → 请求 → 响应解析 |
| `src/shared/api/retry.js` | 退避策略纯函数（不碰网络） |
| `src/shared/core/auth.js` | 登录态纯逻辑（响应解析、token 提取、过期判定） |
| `src/background/api-proxy.js` | 后台挂载：把 API 能力注册到消息总线 |
| `src/background/gatekeeper.js` | 把关中枢（P2 的完整版占位，P1 先做登录态检查） |

## 3. 依赖注入设计（关键，为可测性）
`createClient({ fetchImpl, tokenProvider, deviceIdProvider, now })` —— 全部外部注入：
- 生产：传全局 `fetch` + 从 storage 读 token/deviceId
- 测试：传 mock fetch，无需任何 Node 依赖即可跑通整条链路

## 4. 待验证项 → ✅ **大部分已由官方抓包解答，无需真机**

2026-09-09 通过 codeload 下载上游仓库，拿到 `docs/flomo-api-analysis.md`（真实抓包记录）：

| 原待验证项 | 结论 |
|---|---|
| 1. `PUT /memo` 是否返回 slug | ✅ **返回** `data.slug = "MjI2MzY1Mjgx"` → **撤销/删除成立** |
| 2. 登录字段名与结构 | ✅ `email`/`password`/`wechat_union_id:""`/`wechat_oa_open_id:""`，响应 `data.access_token` |
| 3. 同步游标字段名 | ✅ `limit`/`latest_updated_at`/`latest_slug`/`tz`，**响应 data 直接是数组** |
| 4. 签名是否通过 | ✅ 官方向量 `e8749f38dfc1fcdd1582d34a0c7759f0`，我们实现逐字节一致 |

**顺带修的真 bug**：`updatedMemos` 原先只读 `data.memos`，但官方响应是 `data` 直接为数组 → 同步会拿到 0 条。由契约回放测试发现，已改为 `extractList` 兼容两种形态。

## 4.1 仍需真机（只剩三类）
视觉观感 · SW 真实生命周期（30 秒回收）· 浏览器特有交互（浮层定位/Shadow DOM/右键/侧边栏）

运行方式（需在能联网的机器）：
```bash
node tools/verify-api.mjs --email you@example.com --password 'xxx'
```
脚本会依次打印：登录响应 → 创建笔记**完整响应体** → 增量同步首页字段，供逐项核对。

## 5. 完成标准
- [x] MD5 与 Node 实现逐字节一致（含中文、空串、长文本）
- [x] 签名算法与 CLI 描述一致（排序/跳空/列表/追密钥）
- [x] 客户端可注入 mock fetch 跑通：登录 → 创建 → 同步
- [x] 错误码归一：-10/-20 → not_authenticated；-1+没有找到 → not_found
- [x] 重试仅网络错，业务错不重试
- [x] 登录页真实表单 + 消息接入 + 登录态切换
- [x] 真机脚本 `tools/verify-api.mjs` 已交付 → ⏸ 待用户执行

## 6. 测试统计
109 项全过：56 纯函数（含 md5 交叉验证、签名、端点、重试、响应解析）+ 53 准真机/守卫（登录链路、把关中枢、UI 表单、架构约束）。
抓到的真实 bug：`api-proxy.js` 漏 import `set` 导致登录必失败 —— 由后台链路测试捕获。
