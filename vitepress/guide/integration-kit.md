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

另外，`@tavern/sdk` 现在会把 Prompt Runtime trace 里的
`generationParamsResolution` 作为稳定字段暴露出来。
如果你需要直接消费这组字段，根导出也提供：

- `PromptRuntimeGenerationParamName`
- `PromptRuntimeGenerationParamFinalState`
- `PromptRuntimeGenerationParamOrigin`
- `PromptRuntimeGenerationParamLayer`
- `PromptRuntimeGenerationParamResolution`

这些类型用于表达每个生成参数最终是被发送、缺省，还是被显式取消，
以及这个结果来自哪一层。

另外，`@tavern/sdk` 现在也会把 Prompt Runtime trace 里的
`toolTransport` 作为稳定字段暴露出来。
如果你需要直接消费这组字段，根导出也提供：

- `PromptRuntimeToolTransportKind`
- `PromptRuntimeToolTransportReasonCode`
- `PromptRuntimeToolTransportSelection`
- `PromptRuntimeToolTransportDiagnosticReason`
- `PromptRuntimeToolTransportDiagnostic`
- `PromptRuntimeToolTransportTrace`

这组字段用于表达：

- 当前请求选择了哪种工具调用 transport
- transport 选择原因
- text protocol 下的 tool list 注入摘要
- text protocol 解析统计与诊断

`@tavern/sdk` 现在还直接覆盖临时对话高级资源：

- `sessions.createTemporaryConversation(...)`
- `projects.createTemporaryConversation(...)`
- `temporaryConversations.getDetail / appendMessage / respond / respondStream / retry / retryStream / retryStep / retryStepStream / getTranscript/ finalize / discard / cancel / exportToPageStagedWrite`

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

## 临时对话资源

临时对话是一个正式的高级资源，用来承载不污染主叙事的短期草稿、多轮辅助推理和候选输出整理。

SDK 入口分成三部分：

- `client.sessions.createTemporaryConversation(...)`
- `client.projects.createTemporaryConversation(...)`
- `client.temporaryConversations.*`

一个最小例子：

```ts
const temp = await client.sessions.createTemporaryConversation({
  sessionId: "sess_1",
  input: {
    purpose: "draft-reply",
    retentionPolicy: "ttl",
    ttlSeconds: 1800,
  },
});

const result = await client.temporaryConversations.respond({
  conversationId: temp.id,
  inputMessage: {
    role: "user",
    content: "请给我三个不同语气的候选回复。",
  },
});

await client.temporaryConversations.exportToPageStagedWrite({
  conversationId: temp.id,
  targetPageId: "page_target_1",
  reason: "候选草稿",
});

await client.temporaryConversations.finalize({
  conversationId: temp.id,
});

console.log(result.generatedText);
```

这组资源的固定边界是：

- 不进入普通 `sessions` 列表和详情
- 生命周期固定为 `active / finalized / discarded / expired / cancelled`
- 默认只返回 inline 结果
- `respond(...)` / `respondStream(...)` 支持可选的 `generationParams` 覆盖本回合生成参数：`reasoningEffort`（预设 `low` / `medium` / `high`，也可传模型支持的更强档位如 `xhigh`）、`temperature`（`[0, 2]`）、`topP`（`[0, 1]`）、`maxOutputTokens`（正整数）、`maxContextTokens`（正整数，用于 prompt 组装阶段的 token 预算）；未设置的字段不下发。`respondStream(...)` 可用 `onReasoning` 接收推理增量，transcript 的每个 floor 带 `reasoningText`；模型不返回 reasoning 时按「无 reasoning」处理。`respondStream(...)` 还可用 `onStepNarration` 接收 native 多步循环的中间叙述（`{ stepIndex, text, createdAt }`），仅当某步触发工具调用且产出可见文本时下发，末步纯结论不触发（目前仅图助手 `purpose=graph-assistant` 会产出）
- `respond(...)` / `respondStream(...)` 支持可选的 `toolTransportPreference`（仅图助手 `purpose=graph-assistant` 会话生效）：`auto`（默认，按模型能力选）/ `native`（强制原生 functioncalling，模型不支持时后端安全回退文本协议）/ `text_protocol`（强制文本协议）；不传或传 `auto` 时不下发该字段
- `retry(...)` / `retryStream(...)` / `retryStep(...)` / `retryStepStream(...)` 在指定 `floorId` 的已提交临时楼层上重试，语义是「开新消息页」：在同一楼层上生成一个新的 output page版本，旧页历史保留。入参支持 `dynamicContext`、`generationParams`、`confirmedExecutionIds`、`confirmedSessionStateMutationIds`；流式变体复用与 `respondStream(...)` 相同的回调集合
- `retryStep(...)` / `retryStepStream(...)` 额外需要 `fromStepIndex`（1-based），从该 LLM 生成步重生成：丢弃该步及其之后的工具往返，保留之前已成功的工具结果。结果额外带 `discardedFromStepIndex` 与 `irreversibleSideEffects`（起点之前已产生、不会回滚的写类副作用脱敏摘要）。起点工具带写副作用时后端拒绝（HTTP 409），`fromStepIndex` 越界返回 HTTP400
- 如果要把结果送回正式页面，必须显式导出到 `page_staged_write`
-公共资源面只返回 `client_visible` 的临时对话

## committed floor 用户人工修订

`@tavern/sdk` 现在直接覆盖 committed floor 用户人工修订的专用入口：

- `messages.getManualRevisions(...)`
- `messages.createManualRevision(...)`
- `pages.getManualRevisions(...)`
- `pages.createManualRevision(...)`

这组入口只处理 committed floor 的当前展示正文。

它们的边界固定为：

- 普通 `messages.update(...)` 与 `pages.update(...)` 不会因此放开 committed floor 写权限
- 人工修订只改 `messages.content` 与 `messages.token_count`
- `floors.getResult(...)` 里的 committed snapshot 不会随之变化
- page 路由只支持能稳定映射到单条可编辑 message 的页
- 并发通过 `expectedLatestRevisionNo` 做乐观锁控制

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

sessionEffective.toolTransport.selected;
sessionEffective.toolTransport.reasonCode;
```

### LLM Instances 的模型名覆盖与能力声明

```ts
await client.llmInstances.upsert({
  slot: "narrator",
  scope: "session",
  sessionId: "sess_1",
  presetId: "llm_alpha",
  modelIdOverride: "gpt-4.1-mini",
  capabilities: {
    supportsFunctionCall: false,
    supportsToolChoice: false,
    supportsStreamingToolCall: false,
    unsupportedGenerationParams: ["stopSequences"],
  },
  params: {
    stop_sequences: ["DONE"],
  },
});
```

### Prompt Runtime 持久注入

```ts
const created = await client.promptRuntime.createSessionInjection({
  sessionId: "sess_1",
  accountId: "acc_1",
  sourceKind: "client_injection",
  title: "History guard",
  content: "Keep the north pass in focus.",
  placement: "before_history",
  modeScope: "native",
});

await client.promptRuntime.patchBranchInjection({
  sessionId: "sess_1",
  branchId: "branch_alt",
  injectionId: created.id,
  accountId: "acc_1",
  enabled: false,
});

// 高级位置：楼层相对位置需要 placementParams
const floorScoped = await client.promptRuntime.createSessionInjection({
  sessionId: "sess_1",
  accountId: "acc_1",
  sourceKind: "client_injection",
  title: "Floor guard",
  content: "Keep floor 12 in focus.",
  placement: "before_floor",
  placementParams: { floorNo: 12 },
});
```

`placement` 除了通用结构位置，还支持高级位置：楼层相对位置（`before_floor` / `after_floor` / `before_floor_from_end` / `after_floor_from_end`）、世界书细分位置（`worldbook_depth` / `worldbook_before` / `worldbook_after` / `worldbook_author_note_top`，仅 `compat_plus` /`native`）、native 专属位置（`before_contributor_block` / `after_contributor_block`，仅 `native`）。需要参数的位置通过 `placementParams`（`floorNo` / `offset` / `depth`）表达。trace 侧的 `placementParamsRequested`、`anchorResolved`、`sourceChain` 可用于回看解析结果与来源链。

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
