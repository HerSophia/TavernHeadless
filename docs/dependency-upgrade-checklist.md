# 依赖升级清单

本文用于记录 TavernHeadless 当前的依赖升级顺序、目标版本、风险点和验证要求。

本文基于 2026-04-07 的仓库状态和上游版本信息整理。上游最新版本会继续变化。实际执行前，应再确认一次 npm registry 和相关发布说明。

---

## 1. 当前基线

当前仓库的基础情况如下：

- 根 `package.json` 的 `engines.node` 为 `>=20.0.0`
- CI 工作流当前固定使用 Node 20
- 后端数据库默认启用 WAL
- `better-sqlite3` 当前版本为 `11.7.0`

关键依赖的当前版本、已确认的最新版本和处理建议如下：

| 依赖 | 当前版本 | 已确认的最新版本 | 建议 |
| ---- | ---- | ---- | ---- |
| Node.js | `>=20.0.0` | 建议目标为 22 LTS 或 24 LTS | 先处理 |
| `better-sqlite3` | `11.7.0` | `12.8.0` | 第一批处理 |
| `fastify` | `5.2.1` | `5.8.4` | 第一批处理 |
| `@fastify/swagger` | `9.5.2` | `9.7.0` | 第一批处理 |
| `@fastify/swagger-ui` | `5.2.3` | `5.2.5` | 第一批处理 |
| `@fastify/sensible` | `6.0.3` | `6.0.4` | 第一批处理 |
| `@fastify/cors` | `10.0.1` | `11.2.0` | 单独一批处理 |
| `@fastify/jwt` | `10.0.0` | `10.0.0` | 暂不处理 |
| `@fastify/websocket` | `11.2.0` | `11.2.0` | 暂不处理 |
| `zod` | `3.24.1` | `4.3.6` | 先升到更高的稳定 3.x |
| `@modelcontextprotocol/sdk` | `1.27.1` | `1.29.0` | 在 Zod 3.x 升级后处理 |
| `ai` | `4.1.18` | `6.0.149` | 单独一批处理 |
| `@ai-sdk/openai` | `1.0.17` | `3.0.51` | 单独一批处理 |
| `drizzle-orm` | `0.36.4` | `0.45.2` | 最后处理 |
| `drizzle-kit` | `0.30.1` | `0.31.10` | 与 Drizzle 一起处理 |

补充说明：

- `zod` 当前稳定 3.x 的已确认目标点可以使用 `3.25.76`
- `ai` 如果需要分两步走，已确认的稳定 5.x 目标点可以使用 `5.0.169`
- `@ai-sdk/openai` 如果需要分两步走，已确认的稳定 2.x 目标点可以使用 `2.0.102`

---

## 2. 总体原则

依赖升级按以下原则执行：

1. 一次只处理一类问题。
2. 一个 PR 只承载一批升级，不混入无关改动。
3. 先处理基础运行时，再处理协议层和 SDK。
4. Node.js 与 `better-sqlite3` 升级后，必须删除旧的 `node_modules` 再重装。
5. 每一批升级都要完成完整验证，再进入下一批。
6. 数据库文件要先备份，尤其是 `*.db`、`*.db-wal`、`*.db-shm`。
7. 不使用 `better-sqlite3@12.7.0` 或 `12.7.1`。

---

## 3. 建议目标线

建议优先采用以下目标线：

### 3.1 推荐目标线

- Node.js 22 LTS
- `better-sqlite3` 12.8.0

这条线的优点是：

- 变更范围较小
- 风险较容易控制
- 适合先稳定数据库和服务层

### 3.2 可选目标线

- Node.js 24 LTS
- `better-sqlite3` 12.8.0

这条线可以使用，但要额外补做一轮真实外部服务联调。重点是：

- LLM provider 的 HTTPS 请求
- MCP 连接
- 证书和 TLS 兼容性

### 3.3 与 `better-sqlite3` 相关的明确结论

- 不建议在 Node 24 上继续停留在 `better-sqlite3@11.7.0`
- `better-sqlite3@12.8.0` 内含 SQLite 3.51.3
- SQLite 3.51.3 修复了 WAL-reset 相关问题
- 当前项目默认开启 WAL，因此升级到 `12.8.0` 对本项目是合适的

### 3.4 与事务相关的结论

`better-sqlite3` 从 11.10.0 起，会拒绝返回 Promise 的事务回调。

仓库中当前没有发现 `transaction(async () => ...)` 这一类用法。因此这个变更对当前项目风险较低。

---

## 4. 推荐批次

## 4.1 批次 0：准备和基线确认

### 目标

建立可对照的基线，防止后续无法判断问题来源。

### 操作

- 备份数据库文件
- 新建升级分支
- 保留当前 lockfile
- 先跑一轮当前基线验证

### 基线验证命令

```bash
pnpm lint
pnpm typecheck
pnpm test:ci
pnpm --filter @tavern/api smoke
pnpm docs:build
```

---

## 4.2 批次 1：基础运行时升级

这是第一批，也是建议最先落地的一批。

### 目标依赖

| 依赖 | 当前版本 | 目标版本 |
| ---- | ---- | ---- |
| Node.js | `>=20.0.0` | 22 LTS 或 24 LTS |
| `better-sqlite3` | `11.7.0` | `12.8.0` |
| `fastify` | `5.2.1` | `5.8.4` |
| `@fastify/swagger` | `9.5.2` | `9.7.0` |
| `@fastify/swagger-ui` | `5.2.3` | `5.2.5` |
| `@fastify/sensible` | `6.0.3` | `6.0.4` |

### 本批次先不要动的依赖

- `@fastify/cors`
- `zod`
- `@modelcontextprotocol/sdk`
- `ai`
- `@ai-sdk/openai`
- `drizzle-orm`
- `drizzle-kit`

### 本批次还需要同步检查的文件

如果 Node.js 主版本需要调整，还要同步检查这些位置：

- `package.json`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-docs.yml`
- `README.md`
- `docs/contributing.md`
- `docs/testing-and-ci.md`
- `vitepress/guide/getting-started.md`
- `vitepress/development/contributing.md`
- `.github/ISSUE_TEMPLATE/bug_report.yml`

### 验证要求

先删除旧依赖，再重新安装：

```bash
rm -rf node_modules
pnpm install
```

然后执行：

```bash
pnpm lint
pnpm typecheck
pnpm test:ci
pnpm --filter @tavern/api smoke
pnpm docs:build
```

### 如果本批次目标是 Node 24

还应额外补做：

- 真实 LLM provider 联调
- 真实 MCP 联调
- HTTPS 外部服务联调

重点观察：

- TLS 握手错误
- 证书兼容性问题
- 弱加密套件不再接受的问题

---

## 4.3 批次 2：先把 Zod 升到更高的稳定 3.x

这一批的目标不是引入 Zod 4，而是补齐前置版本线。

### 目标依赖

| 依赖 | 当前版本 | 目标版本 |
| ---- | ---- | ---- |
| `zod` | `3.24.1` | `3.25.76` 或更高的稳定 3.x |

### 原因

后续两个关键依赖都要求更高的 Zod：

- `@modelcontextprotocol/sdk@1.29.0` 需要 `zod ^3.25 || ^4.0`
- `ai@6` 和 `@ai-sdk/openai@3` 需要 `zod ^3.25.76 || ^4.1.8`

### 为什么此时不进入 Zod 4

当前仓库中 `zod` 使用范围较广，覆盖：

- API 路由校验
- schema 定义
- parser
- runtime job 定义
- shared 类型

直接进入 Zod 4，会扩大本批次的范围。

### 验证要求

```bash
pnpm lint
pnpm typecheck
pnpm test:ci
pnpm --filter @tavern/api smoke
```

重点检查：

- `ZodError` 处理逻辑
- 路由请求体验证
- OpenAPI 相关 schema 行为

---

## 4.4 批次 3：MCP SDK 升级

这是一批范围较小的升级。

### 前置条件

- 先完成批次 2，使 `zod` 至少达到 `3.25.76`

### 目标依赖

| 依赖 | 当前版本 | 目标版本 |
| ---- | ---- | ---- |
| `@modelcontextprotocol/sdk` | `1.27.1` | `1.29.0` |

### 代码影响点

当前直接使用点较集中，主要在：

- `apps/api/src/mcp/mcp-connection.ts`

### 验证要求

```bash
pnpm --filter @tavern/api typecheck
pnpm --filter @tavern/api test
pnpm --filter @tavern/api smoke
```

### 回归重点

- stdio MCP 连接
- HTTP MCP 连接
- tools refresh
- tool call 返回值映射
- timeout 后的 reconnect 行为

---

## 4.5 批次 4：AI SDK 升级

这一批应单独处理，不与其他关键升级混做。

### 目标依赖

| 依赖 | 当前版本 | 直接目标版本 |
| ---- | ---- | ---- |
| `ai` | `4.1.18` | `6.0.149` |
| `@ai-sdk/openai` | `1.0.17` | `3.0.51` |

### 可选的两步路径

如果希望把风险再拆小，可以采用两步路径：

| 依赖 | 当前版本 | 中间版本 | 最终版本 |
| ---- | ---- | ---- | ---- |
| `ai` | `4.1.18` | `5.0.169` | `6.0.149` |
| `@ai-sdk/openai` | `1.0.17` | `2.0.102` | `3.0.51` |

### 建议

- 如果希望减少总次数，可以直接升到最新稳定版，但必须单独一个 PR
- 如果希望更稳，可以先做 `4.x -> 5.x`，验证通过后再做 `5.x -> 6.x`

### 代码影响点

当前 AI SDK 的直接使用较集中，主要在：

- `packages/core/src/llm/provider-registry.ts`
- `packages/core/src/llm/llm-service.ts`

主要使用的能力包括：

- `LanguageModel`
- `generateText`
- `streamText`
- `createOpenAI`
- `textStream`
- `usage`
- `finishReason`
- `steps`
- `toolCalls`

### 验证要求

```bash
pnpm --filter @tavern/core typecheck
pnpm --filter @tavern/api typecheck
pnpm test:ci
```

### 真实回归要求

至少补做以下场景：

1. 非流式文本生成
2. 流式文本生成
3. usage 统计读取
4. finishReason 读取
5. tool calls 提取
6. 多 provider 初始化
7. OpenAI compatible provider 调用

如果项目有真实 provider 回归脚本，应一并执行。

---

## 4.6 批次 5：`@fastify/cors` 单独处理

该依赖跨主版本，建议单独处理。

### 目标依赖

| 依赖 | 当前版本 | 目标版本 |
| ---- | ---- | ---- |
| `@fastify/cors` | `10.0.1` | `11.2.0` |

### 代码影响点

当前主要影响：

- `apps/api/src/plugins/cors.ts`

### 验证要求

```bash
pnpm --filter @tavern/api typecheck
pnpm --filter @tavern/api test
pnpm --filter @tavern/api smoke
```

### 回归重点

- `OPTIONS` 预检请求
- `Access-Control-Allow-Origin`
- `Access-Control-Allow-Credentials`
- 允许头和允许方法
- 前端管理台跨域请求行为

---

## 4.7 批次 6：Drizzle 升级

这一批建议最后处理。

### 目标依赖

| 依赖 | 当前版本 | 目标版本 |
| ---- | ---- | ---- |
| `drizzle-orm` | `0.36.4` | `0.45.2` |
| `drizzle-kit` | `0.30.1` | `0.31.10` |

### 原因

`drizzle-orm` 在仓库中的使用范围很广，覆盖：

- schema
- db client
- routes
- services
- adapters
- tests

这不是局部升级，而是数据库访问层的整体升级。

### 处理原则

- `drizzle-orm` 与 `drizzle-kit` 一起升级
- 不拆开处理
- 不与其他关键链路混做

### 验证要求

```bash
pnpm --filter @tavern/api typecheck
pnpm --filter @tavern/api test
pnpm test:ci
pnpm --filter @tavern/api smoke
```

### 可选检查

可以在单独分支上执行一次：

```bash
pnpm --filter @tavern/api db:generate
```

作用是观察升级后生成的 SQL 和迁移产物是否出现意外变化。

---

## 5. 不要放在同一个 PR 的组合

以下组合不建议出现在同一个 PR 中：

- Node.js / `better-sqlite3` 与 AI SDK 升级
- Node.js / `better-sqlite3` 与 Drizzle 升级
- Zod 4 与 AI SDK 升级
- Drizzle 与其他关键链路升级
- `@fastify/cors` 与第一批基础运行时升级

---

## 6. 各批次统一验证清单

除非某一批次有特殊说明，否则都按以下顺序验证：

```bash
pnpm lint
pnpm typecheck
pnpm test:ci
pnpm --filter @tavern/api smoke
```

如果该批次还涉及文档或构建链路，再补：

```bash
pnpm docs:build
```

如果该批次涉及真实外部依赖，再补：

- 真实 LLM provider 联调
- 真实 MCP 联调
- 真实 HTTPS 外部服务联调

---

## 7. 首个 PR 建议内容

如果现在要开始执行，建议首个 PR 只做以下内容：

| 依赖 | 目标版本 |
| ---- | ---- |
| Node.js | 22 LTS |
| `better-sqlite3` | `12.8.0` |
| `fastify` | `5.8.4` |
| `@fastify/swagger` | `9.7.0` |
| `@fastify/swagger-ui` | `5.2.5` |
| `@fastify/sensible` | `6.0.4` |

首个 PR 中建议保持不变的依赖：

- `@fastify/cors`
- `zod`
- `@modelcontextprotocol/sdk`
- `ai`
- `@ai-sdk/openai`
- `drizzle-orm`
- `drizzle-kit`

这样做的好处是：

- 先稳定服务运行时
- 先完成数据库和原生模块升级
- 把后续较大的迁移留给独立批次

---

## 8. 备注

1. 本文记录的是当前建议顺序，不是必须一次做完的清单。
2. 每一批完成后，应在下一批开始前重新确认一次上游版本。
3. 如果某一批次已经暴露出较多兼容问题，应先停下来处理，不继续叠加新升级。
4. 如果目标是正式发布前的稳定线，优先保证基础运行时、数据库和 API 稳定，再处理 AI SDK 和 Drizzle 这类跨度较大的升级。
