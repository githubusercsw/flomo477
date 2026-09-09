# flomo 浏览器扩展（MV3，原生 JS 零构建）

基于 [flomo-cli](https://github.com/dulk-dev/flomo-cli) 逆向的 **flomo 网页版 Web API** 构建。
API 契约不变，替换的是传输层 / 存储层 / 交互层。本地加载调试自用，不上架。

## 加载方式

1. Chrome 打开 `chrome://extensions`，开启「开发者模式」
2. 「加载已解压的扩展程序」→ 选择本目录
3. 改完代码点扩展卡片上的刷新按钮即可（零构建，无需打包）

## 依赖方向（写死，违反即架构退化）

```
ui ──┐
     ├──► shared/platform ──► (chrome.* / IndexedDB / console)
content ─┘
background ──► shared/api ──► shared/core
     │             │
     └─────────────┴────────► shared/platform
```

- ✅ `background` → `api` → `core`；任何层 → `platform`
- ❌ `core` 依赖任何层；`api` → `background`；**`ui` 直接 import `shared/api`**
- `core/` 是纯函数：不许碰 `chrome.*`、不许发网络请求 → 可直接在 Node 里单测
- `platform/` 是唯一允许碰 `chrome.*` 与 IndexedDB 的地方 → 可 mock

## 硬约束（写代码前先过一遍）

1. 所有 API 请求走 background SW 代理（content script 直连会被 CORS 拦）
2. 禁 `setInterval` 做周期任务 → `chrome.alarms`
3. SW 的事件 handler 必须返回 Promise
4. token 只存 storage，**每次现读**，不进内存
5. IndexedDB 事务不可跨网络 await → 同步必须每页独立事务 + 游标落盘
6. 配置传播靠 `chrome.storage.onChanged`（SW 推消息给 content script 需要 tabs 权限，已否决）
7. 渲染一律纯文本化（不渲染服务端 HTML）
8. 清空缓存**不得**删除 outbox（待发队列）
9. 日志脱敏：token / 密码 / 正文永不入日志
10. 上层只用稳定错误码判断，不解析服务端中文文案

## 测试

```bash
node --test tests/unit        # 纯函数单测（零依赖）
```

设计约束：`platform/idb` 必须可替换 backend，以便 Node 环境注入内存实现；
DOM 相关逻辑（选区 → 浮层坐标）需抽成纯函数才可被单测覆盖。

## 阶段进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | manifest + 目录 + 消息总线骨架 + i18n 字典骨架 + 设计 token + logger | ✅ |
| P1 | API 客户端 + 签名 + 登录（**须先验证 `PUT /memo` 是否返回 slug**） | ⏸ |
| P2 | 把关中枢 + 消息总线完善 | ⏸ |
| P3 | IndexedDB 缓存 + 增量同步（每页独立事务 + 游标落盘） | ⏸ |
| P4 | 划词浮层 / Popup 速记 / 快捷键 / 右键菜单 | ⏸ |
| P5 | Side Panel：列表 / 搜索 / 详情 / 回顾 / 推荐 | ⏸ |
| P6 | 设置页 + 主题 + 自检面板 | ⏸ |
| ~~P7~~ | ~~Agent 接口~~ | 已取消 |

## 入口分配（重要）

点击工具栏图标的默认行为**只有一个**。本项目按登录态分流：

- 未登录 → 弹 Popup（登录页）
- 已登录 → 开 Side Panel（速记框位于侧边栏顶部）

快捷键 `Ctrl/Cmd+Shift+F` 触发 `_execute_action`，走同一套分流。
若与本机其它快捷键冲突，去 `chrome://extensions/shortcuts` 自行修改。
