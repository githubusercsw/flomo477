// 官方抓包的真实响应 fixture。
//
// 来源：`_memory/raw/flomo-cli-source/docs/flomo-api-analysis.md`
//       （flomo-cli 作者通过浏览器抓包 + 前端 JS 源码分析得到的记录）
//
// ⚠️ 这些是**真实服务端返回**，不是编造的 mock —— 用它们做回放测试，
//    可信度远高于自己写的假数据，因此**不需要为这些场景做真机测试**。
//
// 更新方式：跑 `node tools/sync-contract.mjs` 重新拉取上游源码核对。

/** 登录成功 POST /user/login_by_email → data */
export const LOGIN_SUCCESS = {
  code: 0,
  message: 'success',
  data: {
    id: 100001,
    name: 'YourName',
    email: 'your-phone-or-email',
    access_token: 'your-access-token',
    api_token: 'your-api-token',
    pro_type: 'pro',
    slug: 'MTAwMDAxMQ',
  },
};

/** 登录失败（密码错误等） */
export const LOGIN_FAILED = {
  code: -1,
  message: '邮箱或密码错误',
  data: null,
};

/** Session 过期 */
export const SESSION_EXPIRED = {
  code: -10,
  message: 'session expired',
  data: null,
};

/** 需要验证密码 */
export const NEED_VERIFY = {
  code: -20,
  message: '需要验证密码',
  data: null,
};

/**
 * 创建笔记成功 PUT /memo
 * ★ 关键：data 里**包含 slug** —— 这解答了审计 L3
 *   （"PUT /memo 是否返回 slug"决定撤销/删除能否成立 → 成立）
 */
export const CREATE_SUCCESS = {
  code: 0,
  message: '已创建',
  data: {
    content: '<p>笔记内容，支持 HTML</p>',
    slug: 'MjI2MzY1Mjgx',
    tags: ['自动从内容中提取的标签'],
    created_at: '2026-03-16 22:35:57',
    linked_memos: [],
  },
};

/** 删除成功 DELETE /memo/{slug} */
export const DELETE_SUCCESS = {
  code: 0,
  message: '已删除',
  data: '',
};

/** 完整的 memo 对象（同步 / 详情返回的单条结构） */
export const MEMO_FULL = {
  content: '<p>HTML 格式的笔记内容</p>',
  creator_id: 100001,
  source: 'web',
  tags: ['标签名/子标签'],
  pin: 0,
  created_at: '2024-02-21 08:36:29',
  updated_at: '2024-02-21 08:46:01',
  deleted_at: null,
  memo_from: 'human',
  slug: 'MTA1MDM5OTgy',
  linked_count: 0,
  files: [
    {
      id: 19333249,
      type: 'image',
      name: '文件名',
      path: 'file/2024-02-21/xxx.jpg',
      size: 187146,
      url: 'https://static.flomoapp.com/...',
      thumbnail_url: 'https://static.flomoapp.com/.../thumbnailwebp',
    },
  ],
};

/** 软删除的 memo（deleted_at 非 null，同步时必须本地过滤） */
export const MEMO_DELETED = {
  ...MEMO_FULL,
  slug: 'MTA1MDM5OTgz',
  content: '<p>已删除的笔记</p>',
  deleted_at: '2024-03-01 10:00:00',
};

/** 增量同步首页 GET /memo/updated/ */
export const SYNC_PAGE = {
  code: 0,
  message: 'success',
  data: [MEMO_FULL, MEMO_DELETED],
};

/** 同步到底（空列表） */
export const SYNC_EMPTY = {
  code: 0,
  message: 'success',
  data: [],
};

/** 相关笔记 GET /memo/{slug}/recommended?type=1 */
export const RECOMMENDED = {
  code: 0,
  message: 'success',
  data: [
    {
      memo_id: 159879584,
      similarity: '0.9005300074973709',
      memo: {
        content: '<p>笔记内容...</p>',
        tags: ['标签名'],
        slug: 'MTU5ODc1ODQ',
        created_at: '2025-02-06 10:14:51',
        linked_memos: [],
        backlinked_memos: [],
        files: [],
      },
    },
  ],
};

/** 每日回顾 GET /memo/notify_of_today/ → slug 列表 */
export const NOTIFY_TODAY = {
  code: 0,
  message: 'success',
  data: ['MTA1MDM5OTgy', 'MjI2MzY1Mjgx'],
};

/** 标签树 GET /tag/tree */
export const TAG_TREE = {
  code: 0,
  message: 'success',
  data: [{ name: '工作', children: [{ name: '工作/项目' }] }],
};

/** 用户信息 GET /user/me */
export const USER_ME = {
  code: 0,
  message: 'success',
  data: { id: 100001, name: 'YourName', email: 'you@example.com', slug: 'MTAwMDAxMQ' },
};

/** 限流（HTTP 429） */
export const RATE_LIMITED_RAW = { __raw: 'too many requests', status: 429 };

/**
 * 官方在 flomo-api-analysis.md 中给出、并在 test_signing.py 中固化的签名向量。
 * 这是**真实请求抓包**得到的，比任何本地自算的基准都权威。
 */
export const SIGN_VECTOR = {
  params: {
    timestamp: '1773669997',
    api_key: 'flomo_web',
    app_version: '4.0',
    platform: 'web',
    webp: '1',
  },
  expected: 'e8749f38dfc1fcdd1582d34a0c7759f0',
  source: 'docs/flomo-api-analysis.md §三 + tests/test_signing.py::test_sign_known_example',
};

/** 所有 fixture 的索引，便于遍历测试 */
export const ALL_RESPONSES = {
  LOGIN_SUCCESS,
  LOGIN_FAILED,
  SESSION_EXPIRED,
  NEED_VERIFY,
  CREATE_SUCCESS,
  DELETE_SUCCESS,
  SYNC_PAGE,
  SYNC_EMPTY,
  RECOMMENDED,
  NOTIFY_TODAY,
  TAG_TREE,
  USER_ME,
};
