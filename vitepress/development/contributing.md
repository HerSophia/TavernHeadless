---
outline: [2, 3]
---

# 协作指南

这份页面是仓库协作规则的文档站版本。

完整规则以 `docs/contributing.md` 为准。本页保留最重要的协作要求，方便在文档站内直接查阅。

## 开发环境

### 必须

- Node.js >= 20
- pnpm >= 9
- Git >= 2.30

### 常用命令

```bash
pnpm install
pnpm dev
pnpm dev:api
pnpm dev:web
pnpm dev:both
pnpm typecheck
pnpm test:ci
pnpm lint
pnpm sdk:generate
pnpm sdk:check
pnpm docs:build
```

## 项目结构与分层

```text
TavernHeadless/
├── apps/
│   ├── api/
│   └── web/
├── packages/
│   ├── core/
│   ├── adapters-sillytavern/
│   ├── shared/
│   └── official-integration-kit/
│       ├── sdk/
│       └── client-helpers/
├── docs/
├── vitepress/
└── README.md
```

### 分层说明

- `packages/core`：核心引擎逻辑
- `packages/adapters-sillytavern`：SillyTavern 兼容适配
- `packages/shared`：内部共享类型、OpenAPI 生成物、类型化 API Client
- `packages/official-integration-kit/sdk`：官方第一方接入基础层
- `packages/official-integration-kit/client-helpers`：官方第一方接入语义层
- `apps/api`：后端服务
- `apps/web`：管理前端

## 依赖方向与公开边界

必须遵守下面的依赖方向：

```text
apps/api  ──→  packages/core  ──→  packages/shared
   │               │
   └──────────→  packages/adapters-sillytavern ──→ packages/shared

apps/web  ──→  packages/official-integration-kit/*
apps/web  ──→  packages/shared
```

### 硬规则

- `packages/core` 不依赖 `apps/api`、`apps/web` 或任何前端框架。
- `packages/shared` 不依赖 `core` 或 `adapters-*`。
- `apps/api` 可以依赖 `core`、`shared`、`adapters-*`。
- `apps/web` 不应长期保留一套重复的可复用请求层或语义层。

### 当前公开接入面

当前只保留两个官方公开接入包：

- `@tavern/sdk`
- `@tavern/client-helpers`

`@tavern/shared` 仍然是内部包，不是公开接入面的组成部分。

### 概念命名边界

- `Runtime` 只用于平台层运行时能力及其既有公开面，例如 `Background Job Runtime`、`Mutation Runtime`、`runtime_job`、`runtime_scope_state`、`/sessions/:id/tools/runtime`。
- `Run` 用于聊天主链路中的一次业务运行快照，例如 `floor run`、`active run`、`runId`、`runType`、`attemptNo`。
- `Execution` 用于运行中的子级执行记录，例如 `tool execution`、`tool_execution_record`。

后续如果新增聊天主链路的进度接口、事件或表结构，应优先使用 `run` 命名，而不是新的 `runtime` 命名。

例如：`/floors/:id/run`、`floor.run.updated`、`floor_run_state`。

## 官方集成层协作规则

### 两个官方包的职责

`@tavern/sdk` 负责：

- HTTP 请求
- 默认请求头
- 错误归一化
- SSE 读取
- 第一方资源包装

`@tavern/client-helpers` 负责：

- usage 归一化
- timeline 构建
- 流式状态 reducer
- active page 选择
- 错误到界面状态的映射

### 这条规则必须明确

如果引擎内部实现、后端路由、OpenAPI、SSE 事件、Tool Calling、MCP 或其他对接入方可见的语义发生变化，就必须同时检查官方包是否需要更新。

也就是说：

- 引擎内部实现一改，官方包自然也要跟着检查。
- 如果变化已经影响接入方可见的行为，就应同时更新官方包和文档。
- 不能只改后端或只改 `apps/web` 的局部适配，而让官方包停留在旧语义上。

### 什么时候优先改官方包

如果一个逻辑满足下面任意一条，应优先进入官方包：

- 会被多个接入方重复使用
- 已直接对应某组后端资源
- 属于请求、SSE、错误、资源读写
- 属于 timeline、usage、流式中间态、错误映射，并且与框架无关

## Git 与 PR 要求

### Commit 格式

使用 Conventional Commits：

```text
<类型>(<范围>): <描述>
```

### 常见范围

- `core`
- `api`
- `web`
- `shared`
- `sdk`
- `client-helpers`
- `integration-kit`
- `docs`
- `tools`
- `mcp`

### PR 说明至少应包含

- 做了什么
- 为什么要做
- 影响了哪些模块
- 如何验证
- 是否更新了文档
- 是否影响官方包边界

如果涉及引擎、后端契约或官方包，还应说明：

- 是否影响 `@tavern/sdk`
- 是否影响 `@tavern/client-helpers`
- 是否影响 `apps/web`
- 是否影响 OpenAPI 生成物

## 文档维护规则

### 更新顺序

只要官方包发生变化，文档更新顺序应保持一致：

1. 先更新包内文档
   - `packages/official-integration-kit/sdk/README.md`
   - `packages/official-integration-kit/client-helpers/README.md`
2. 再更新外部文档
   - `vitepress/guide/integration-kit.md`
   - `vitepress/guide/introduction.md`
   - `vitepress/reference/api.md`
   - `README.md`
3. 如果边界、流程或协作方式也变了，再更新协作文档
   - `docs/contributing.md`
   - `vitepress/development/contributing.md`
   - `.github/CONTRIBUTING.md`

### 必须同 PR 更新文档的情况

下面这些情况，代码与文档必须在同一个 PR 中：

- 新增或删除官方资源方法
- 调整 `@tavern/sdk` 或 `@tavern/client-helpers` 的职责边界
- 后端语义变化导致官方包变化
- `apps/web` 从本地逻辑迁移到官方包

## 验证要求

### 改 `@tavern/sdk`

```bash
pnpm --filter @tavern/sdk typecheck
pnpm --filter @tavern/sdk test
```

如果影响前端接入，再运行：

```bash
pnpm --filter @tavern/web typecheck
```

### 改 OpenAPI 或官方包生成面

```bash
pnpm sdk:generate
pnpm sdk:check
pnpm --filter @tavern/sdk typecheck
pnpm --filter @tavern/sdk test
```

### 只改文档

```bash
pnpm docs:build
```

## 完整文档入口

如需查看完整规则，请继续参考：

- 仓库文档：`docs/contributing.md`
- [官方集成层](/guide/integration-kit)
- [API 参考](/reference/api)
