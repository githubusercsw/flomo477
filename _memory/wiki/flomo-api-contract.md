# Flomo API 契约速查（wiki，按需查询）

> ⚠️ **2026-09-08 已按 flomo-cli client.py 源码逐行校正**（此前版本有 3 处会导致请求必失败的错误）。
> 写任何 API 相关代码前先读本文件。

## 基地址与认证
- Base: `https://flomoapp.com/api/v1`
- Header: `Authorization: Bearer <access_token>`
- 其他请求头：`platform: web`、`device-model: web`、`device-id`、User-Agent

## 公共参数（**每个请求都要带，且参与签名**）
```
timestamp  ⚠️ 秒级 Unix 时间戳（字符串），每次请求现取 —— 缺失则服务端返回「请传入 timestamp」
api_key    flomo_web
app_version 4.0
platform   web
webp       1
```
> **tz 不属于公共参数**，只在 `/memo/updated/` 和创建笔记时作为业务参数传入。

## 签名（MD5）—— 三处易错点
```python
# 对齐 client.py _generate_sign()
parts = [f"{k}={v}" for k in sorted(params) if v is not None and v != ""]
raw   = "&".join(parts) + SIGN_SECRET     # ← 末尾**没有**多余的 &
sign  = md5(raw)
```
- ⚠️ **拼接末尾无 `&`**：写成 `k=v&k2=v2&` + SECRET 会签名校验失败
- ⚠️ `timestamp` 必须参与签名
- 数组：`key[]=item`，且 item 排序
- `SIGN_SECRET = "dbbc3dd73364b4084c3a69346e0ce2b2"`

## 请求格式（按方法分）
| 方法 | 参数位置 | Content-Type |
|---|---|---|
| GET | query string | — |
| DELETE | query string | — |
| **POST / PUT** | **JSON body** | `application/json` |

> ⚠️ 用 `application/x-www-form-urlencoded` 会被拒 —— 必须是 JSON body。

## 端点与业务参数
| 端点 | 方法 | 业务参数 |
|---|---|---|
| /user/login_by_email | POST (JSON) | `email`, `password`, `wechat_union_id:""`, `wechat_oa_open_id:""`，**不带 Authorization** |
| /user/me | GET | — |
| /memo | PUT (JSON) | `content`(HTML), `source:"web"`, `tz:"8:0"` |
| /memo/{slug} | PUT (JSON) | 更新 |
| /memo/{slug} | DELETE | query |
| /memo/{slug} | GET | 详情 |
| /memo/updated/ | GET | `limit`, `latest_updated_at`, `latest_slug`, `tz:"8:0"` |
| /memo/latest_updated_desc | GET | — |
| /memo/{slug}/recommended | GET | `type:"1"` |
| /memo/notify_of_today/ | GET | — |
| /tag/tree | GET | — |
| /tag/rename | POST (JSON) | `old_tag`, `new_tag` |

## 软删除
- ⚠️ **`include_deleted` 是 CLI 的**本地过滤**开关，不是服务端参数** —— 不要发给服务端
- 服务端会返回软删笔记（`deleted_at` 非空），客户端自行过滤

## 响应
- `{code:0, message, data}` 成功；`-10` 过期；`-20` 需验证；`-101` 需绑定其他账号
- ⚠️ **`/memo/updated/` 的 `data` 直接是数组**（`{code:0, data:[...]}`），不是 `{data:{memos:[]}}` —— 两种形态都要兼容
- 创建成功返回 `message:"已创建"`、`data.slug`；删除成功 `message:"已删除"`、`data:""`
- **相关笔记的 `similarity` 是字符串**（如 `"0.9005300074973709"`），不能当数字用
- **每日回顾 `/memo/notify_of_today/` 只返回 slug 列表**，需逐条拉详情
- code≠0 → 业务错误，**不重试**

## 数据模型要点
- `content` 为 HTML；`tags` 字符串数组（层级 `父/子`）；`slug` 是 Base64 ID
- 标签从内容 `#标签` 自动提取
- 分页上限 200/页，空列表即到底

## 扩展强约束
- 必须 background service worker 代理所有请求（绕 CORS）
- 无服务端搜索 → 本地 IndexedDB 缓存后过滤

## 权威事实源
`_memory/raw/flomo-cli-source/docs/flomo-api-analysis.md` —— 上游作者**真实抓包**记录，
每个端点都有「已验证」标记。写 API 代码前优先查它，其次 `flomo_cli/client.py`（可工作实现）。
跑 `node flomo-extension/tools/sync-contract.mjs` 可核对契约是否过期。
