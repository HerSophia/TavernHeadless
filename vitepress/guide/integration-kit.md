---
outline: [2, 3]
---

# 官方集成层

TavernHeadless 提供了一套官方维护的第一方接入层，用来统一前端、桌面客户端、脚本和其他消费方的接入方式。

当前只有两个包：

- `@tavern/sdk` —— 基础层，负责和后端打交道
- `@tavern/client-helpers` —— 语义层，负责把数据整理成前端好用的形态

合在一起就是 TavernHeadless Official Integration Kit。

## 为什么要有这层

后端 API 可以直接调，但接入方通常会重复写这些东西：

- 请求封装和账号头注入
- SSE 解析
- 错误处理
- 时间线整理
- usage 归一化
- 流式生成的中间状态累积
- Tool Calling 和 MCP 的接入包装
- Client Data 的 owner / key-path / collection 分组语义
- Project Event 的读取、SSE 订阅、cursor 和去重处理
- Project Derived Output 与 Project Inbox 的资源包装
- 阶段五 Agent Type、Project Agent Binding、Project Settings 和 effective-config 的资源包装

如果这些逻辑散落在每个前端里，接入方式会越来越分散，行为也会不一致。

官方集成层把这些已经稳定、已经重复出现、属于接入层的问题收拢住，统一提供。

## 两个包的边界

### `@tavern/sdk`

基础层。

| 负责 | 不负责 |
| ---- | ---- |
| HTTP API 调用 | 时间线视图整理 |
| 默认请求头注入 | active page 选择 |
| 统一错误对象 | store 状态管理 |
| SSE 读取与解析 | hooks、composables、组件 |
| 资源方法 | Vue / React / Pinia 绑定 |
| Project Event、Derived Output、Inbox、Agent Type、Agent Binding、Project Settings 和 effective-config 资源包装 | Project CRUD 管理界面 |
| 保留底层请求能力 | |

### `@tavern/client-helpers`

语义层。

| 负责 | 不负责 |
| ---- | ---- |
| usage 归一化 | 发请求 |
| 时间线构建 | 依赖 `fetch` |
| 流式状态 reducer | 依赖 Vue / React / Pinia |
| active page 选择 | |
| API 错误到界面状态的映射 | |
| client-data owner / map / 路径读取辅助 | |
| Project Event cursor 与去重辅助 | |

### `@tavern/shared`

`@tavern/shared` 是内部包，仓库内部可以复用，但不属于公开接入面。

## 阶段五新增接入面

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
```

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
  { dryRun: true },
  { accountId: "acc_1" },
);
```

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

### Tools 与会话运行时目录

```ts
const catalog = await client.sessions.getRuntimeToolCatalog({
  sessionId: "sess_1",
  accountId: "acc_1",
});

const executions = await client.tools.listExecutions({
  sessionId: "sess_1",
  accountId: "acc_1",
  status: "uncertain",
});
```

- `getRuntimeToolCatalog(...)` 返回会话级工具目录，并保留 `catalogSource`、`metadataBasisDetail`、`exposure` 等字段。
- `listExecutions(...)` 返回原执行记录字段，并附带 `executionId`、`replaySafety`、`runtimeJob`、`policy`、`provenance`、`roundtrip` 等 trace 字段。

## 阶段五边界说明

需要特别注意：

- 这是一组准备面，不是完整 Agent 执行面。
- `agent.run` 当前仍是占位 Processor。
- 当前即使创建了 runtime job，也会进入 dead letter。
- Agent 在阶段五不能写主叙事正史。
- effective-config 是只读视图，不能代替写接口。

## 文档同步规则

如果改动影响以下任意一项，应同步检查官方包与文档：

- 后端 API 资源契约
- SSE 事件结构
- OpenAPI 输出
- SDK 资源覆盖范围
- helper 导出范围
- Client Data 的 owner / grant / audit 语义
- Project Event、Derived Output、Project Inbox 的契约
- 阶段五 Agent Types、Project Agent Bindings、Project Settings 和 effective-config 的契约

至少同步更新：

- `packages/official-integration-kit/sdk/README.md`
- `packages/official-integration-kit/client-helpers/README.md`
- `vitepress/guide/integration-kit.md`
- `vitepress/reference/api.md`
- 对应资源参考页
