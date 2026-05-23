# @tavern/sdk

TavernHeadless 官方集成层的基础包。

它把后端的 HTTP API、SSE 事件流、错误处理和资源访问整合成一个稳定的调用层，让接入方不用自己再写一套。

## 先说定位

TavernHeadless 有且只有两个官方公开接入包：

| 包名 | 职责 |
| ---- | ---- |
| `@tavern/sdk` | 请求、SSE、错误、资源访问 |
| `@tavern/client-helpers` | 与框架无关的语义整理 |

另外一个经常出现的 `@tavern/shared` 是内部包，不属于公开接入面。

## 它做什么

- 提供统一客户端 `createTavernClient()`
- 自动处理 transport 和默认请求头
- 按资源分组提供类型化的调用方法
- 统一 HTTP 错误对象（`TavernApiError`）
- 内置 SSE 读取和事件解析
- 保留底层请求能力，需要的时候可以直接用

## 它不做什么

- 不做 Vue / React / Pinia / Zustand / TanStack Query 的绑定
- 不提供组件、页面、hooks、composables
- 不管应用层的状态管理
- 不包含只服务于某个特定界面的临时逻辑

这些事情应该留在应用层。

## 安装

仓库内直接引用：

```json
{
  "dependencies": {
    "@tavern/sdk": "workspace:*"
  }
}
```

## 快速上手

### 创建客户端

```ts
import { createTavernClient } from "@tavern/sdk";

const client = createTavernClient({
  baseUrl: "http://localhost:3000",
});
```

`createTavernClient()` 返回的对象上挂着所有资源方法，同时也保留了底层的通用请求方法。

### 带上认证头

如果后端开启了认证，可以通过 `getHeaders` 注入默认请求头：

```ts
const client = createTavernClient({
  baseUrl: "http://localhost:3000",
  getHeaders: () => ({
    authorization: "Bearer <token>",
  }),
});
```

这个函数支持返回 `Promise`，所以异步取 token 也没有问题。

如果服务端启用了多账号：

- `AUTH_MODE=jwt` 时，应当使用已经带有目标账号 claim 的 JWT；默认 claim 字段名是 `account_id`，可由服务端通过 `AUTH_JWT_ACCOUNT_CLAIM` 改名
- `AUTH_MODE=api_key` 时，应当由服务端通过 `AUTH_API_KEY_ACCOUNTS` 把 API Key 绑定到账号
- SDK 各资源方法里的 `accountId` 参数，以及 `buildAccountHeaders()` 生成的 `x-account-id` 头，都只是兼容头提示，不能替代服务端认证，也不会直接切换账号

另外需要注意：

- `AUTH_MODE=off` 只应用于本地开发；服务端会在 `NODE_ENV=production && AUTH_MODE=off` 时直接拒绝启动
- `/health`、`/version`、`/openapi.json`、`/docs`、`/docs/*` 这些 public path 始终按匿名请求处理，不会继承管理员上下文

## Prompt Runtime 资源补充

Prompt Runtime 资源当前有两条需要特别区分的只读入口：

- `client.promptRuntime.previewText(...)`
- `client.promptRuntime.inspect(...)`

其中：

- `previewText(...)` 仍然对应 `macro_text_preview`
- `inspect(...)` 仍然对应一次真实 prepared turn 的只读检查

### inspect 的新增返回字段

`client.promptRuntime.inspect(...)` 的 `preparedTurn` 现在新增：

- `contributors`
- `preparePhaseTrace`

同时 `client.promptRuntime.getCapabilities()` 的 `observability.inspect` 现在也会明确返回：

- `returnsContributors`
- `returnsPreparePhaseTrace`

这几项字段用来表达：

- inspect 返回的是 prepared turn
- inspect 现在还能返回 pre-response contributor 视图
- inspect 现在还能返回准备阶段的 phase trace

SDK 这里只暴露稳定视图，不暴露 contributor 的内部 raw payload。

## 阶段五新增资源

阶段五新增以下 SDK 入口：

- `client.workspaces.agentTypes.*`
- `client.projects.agentBindings.*`
- `client.projects.settings.*`
- `client.projects.getEffectiveConfig(...)`
- `client.sessions.getEffectiveConfig(...)`

这些资源对应的是 Agentic readiness 的准备面，不代表 Agent 已经有真实执行能力。

### Workspace Agent Types

```ts
const types = await client.workspaces.agentTypes.list("ws_1", { accountId: "acc_1" });

const created = await client.workspaces.agentTypes.create(
  "ws_1",
  {
    key: "world.sim",
    name: "World Sim",
    scopeKind: "project",
    defaults: {
      grants: { allowed_output_targets: ["derived_output"] },
    },
  },
  { accountId: "acc_1" },
);

await client.workspaces.agentTypes.disable("ws_1", created.id, { accountId: "acc_1" });
await client.workspaces.agentTypes.enable("ws_1", created.id, { accountId: "acc_1" });
```

说明：

- 这组接口只允许账号 actor。
- client actor 调用时，服务端返回 `403 agent_type_account_only`。

### Project Agent Bindings

```ts
const binding = await client.projects.agentBindings.create(
  "proj_1",
  {
    agentTypeId: "agt_1",
    scopeKind: "project",
    grants: { allowed_output_targets: ["derived_output"] },
    eventSubscriptions: [{ type: "floor.committed" }],
  },
  { accountId: "acc_1" },
);

const runResult = await client.projects.agentBindings.run(
  "proj_1",
  binding.id,
  {
    dryRun: true,
    triggerReason: "manual-review",
    inputJson: { source: "sdk" },
  },
  { accountId: "acc_1" },
);
```

说明：

- `run(...)` 对应创建 `agent.run` 后台作业。
- 阶段五默认 `dryRun = true`。
- 当前占位 Processor 仍会把作业送入 dead letter。

### Project Settings 与 Effective Config

```ts
await client.projects.settings.updateLlm(
  "proj_1",
  {
    baseProfileId: "llm_alpha",
    overrideJson: { temperature: 0.2 },
  },
  { accountId: "acc_1" },
);

const effective = await client.projects.getEffectiveConfig("proj_1", {
  accountId: "acc_1",
});

const sessionEffective = await client.sessions.getEffectiveConfig({
  sessionId: "sess_1",
  accountId: "acc_1",
});
```

说明：

- `settings.*` 是显式写入口。
- `getEffectiveConfig(...)` 是只读视图。
- 返回对象会标记 `source`，表示值来自 `workspace`、`project` 或 `session`。

## 设计边界

适合放进 SDK 的内容：

- HTTP 请求
- 默认请求头
- 资源分组方法
- SSE 解析
- 错误对象
- 与后端一一对应的高层 API

不适合放进 SDK 的内容：

- Vue / React 绑定
- 状态管理
- timeline 视图整理
- 页面专用数据转换
- UI 层错误文案

## 当前状态

当前 `@tavern/sdk` 已经覆盖会话、内容结构、变量、记忆、Prompt Runtime、导入、导出、备份、LLM、Tools、MCP、Client Data、Project Event、Project Derived Output、Project Inbox，以及阶段五的 Agent Types、Project Agent Bindings、Project Settings 和 Effective Config。
