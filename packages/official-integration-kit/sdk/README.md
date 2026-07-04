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

## 临时对话资源

临时对话是一个正式的高级资源，用来承载不污染主叙事的短期草稿、多轮辅助推理和候选输出整理。

SDK 里有三组对应入口：

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

- 普通 `sessions` 列表和详情不会直接暴露临时对话
- 生命周期只有 `active / finalized / discarded / expired / cancelled`
- `respond(...)` / `respondStream(...)` 默认只返回 inline 结果
- `respond(...)` / `respondStream(...)` 支持可选的 `dynamicContext` 字段：调用方按当前上下文求值生成的本回合动态上下文文本，随本回合注入 prompt 组装，不写入 transcript；空串视为未提供
- `respond(...)` / `respondStream(...)` 支持可选的 `generationParams` 字段，用于覆盖本回合生成参数；未设置的字段不下发，由后端/模型默认值生效。包含：`reasoningEffort`（预设 `low` / `medium` / `high`，也可传模型支持的更强档位如 `xhigh`，是否产出 reasoning 取决于模型本身）、`temperature`（`[0, 2]`）、`topP`（`[0, 1]`）、`maxOutputTokens`（正整数）、`maxContextTokens`（正整数，用于 prompt 组装阶段的 token 预算，不是下发给模型的上下文窗口设置）
- `respond(...)` / `respondStream(...)` 支持可选的 `toolTransportPreference` 字段（仅图助手 purpose=graph-assistant 会话生效），选择工具调用协议：`auto`（默认，按模型能力选）/ `native`（强制原生 function calling，模型不支持时后端安全回退文本协议）/ `text_protocol`（强制文本协议）；不传或传 `auto` 时不下发该字段
- `respondStream(...)` 支持 `onReasoning`回调，按 `reasoning` SSE 事件接收推理增量（`payload.delta`）；模型不返回 reasoning 时不触发
- `respondStream(...)` 支持 `onStepNarration` 回调，按 `step_narration` SSE 事件接收 native 多步循环的中间叙述（`payload` 为 `{ stepIndex, text, createdAt }`，已映射为 camelCase）；仅当某步触发工具调用且产出可见文本时下发，末步纯结论不触发（目前仅图助手 purpose=graph-assistant 临时对话会产出该事件）
- `getTranscript(...)` / `inspect(...)` 返回的每个 floor 带 `reasoningText` 字段；模型未返回 reasoning、楼层未提交或 inspect 被脱敏时为 `null`
- `getTranscript(...)` / `inspect(...)` 返回的每个 floor 的 `toolExecutions[]` 带 `generationStepNo` 字段，表示该工具执行所属的 LLM 生成步号（旧数据为 `null`）；供接入方按生成步精确归并 step 与定位 step 级重试起点
- 如果要把结果送回正式页面，必须显式调用 `exportToPageStagedWrite(...)`
- 公开路由只返回 `client_visible` 的临时对话
- `retry(...)` / `retryStream(...)` / `retryStep(...)` / `retryStepStream(...)` 在指定 `floorId` 的已提交临时楼层上重试，语义是「开新消息页」：在同一楼层上生成一个新的 output page 版本，旧页历史保留。入参支持 `dynamicContext`、`generationParams`、`confirmedExecutionIds`、`confirmedSessionStateMutationIds`；流式变体复用与 `respondStream(...)` 相同的回调集合
- `retryStep(...)` / `retryStepStream(...)` 额外需要 `fromStepIndex`（1-based），从该 LLM 生成步重生成：丢弃该步及其之后的工具往返，保留之前已成功的工具结果。结果额外带 `discardedFromStepIndex` 与 `irreversibleSideEffects`（起点之前已产生、不会回滚的写类副作用脱敏摘要）。起点工具带写副作用时后端拒绝（HTTP 409），`fromStepIndex` 越界返回 HTTP 400

## committed floor 用户人工修订

如果目标正文已经位于 committed floor，普通 `client.messages.update(...)` 和 `client.pages.update(...)` 仍然会受到只读限制。

这时要使用专用入口：

- `client.messages.getManualRevisions(...)`
- `client.messages.createManualRevision(...)`
- `client.pages.getManualRevisions(...)`
- `client.pages.createManualRevision(...)`

最小示例：

```ts
const applied = await client.messages.createManualRevision({
  messageId: "msg_1",
  content: "修订后的正文",
  expectedLatestRevisionNo: 0,
  reason: "人工润色",
});

console.log(applied.currentContent);
console.log(applied.latestRevisionNo);

const history = await client.messages.getManualRevisions({
  messageId: "msg_1",
});

console.log(history.items[0]?.originalContent);
```

这组入口的边界固定为：

- 只修改当前展示正文，也就是 `messages.content` 与 `messages.token_count`
- 不改 `floors.getResult(...)` 返回的 committed snapshot
- 不改 prompt snapshot、memory、session state、tool audit
- page 路由只支持能够稳定映射到单条可编辑 message 的页
- 并发通过 `expectedLatestRevisionNo` 做乐观锁控制

## Step 级重试（floors.retryStep）

`client.floors.retryStep(...)` 在主会话已提交楼层上，从指定的 LLM 生成步重新生成：丢弃该步及其之后的工具往返，保留之前已成功的工具结果，让模型从该步继续多步生成。

- `floorId`：目标已提交楼层。
- `fromStepIndex`：从第几步重生成（1-based）。该步起点的工具必须是 `sideEffectLevel === "none"`，否则后端返回 `step_retry_blocked_side_effect`（HTTP 409）；`fromStepIndex`越界时返回 `invalid_from_step_index`（HTTP 400）。
- 其余字段与 `floors.retry(...)` 一致（`config` / `generationParams` / `promptRuntimeInjections` / `sessionStateWrites` / 确认类字段）。

返回值在 `floors.retry(...)` 的基础上额外携带：

- `discardedFromStepIndex`：实际被丢弃的起始步号。
- `irreversibleSideEffects`：起点之前已产生、不会回滚的写类副作用清单（脱敏摘要，含 `executionId` / `toolName` / `sideEffectLevel` / `startedAt` / `generationStepNo`）。这些副作用只用于提示用户，后端不会回滚。

最小示例：

```ts
const result = await client.floors.retryStep({
  floorId: "floor_1",
  fromStepIndex: 2,
});

console.log(result.discardedFromStepIndex);
console.log(result.irreversibleSideEffects);
```


## Prompt Runtime 资源补充

Prompt Runtime 资源当前有两条需要特别区分的只读入口：

- `client.promptRuntime.previewText(...)`
- `client.promptRuntime.inspect(...)`

其中：

- `previewText(...)` 仍然对应 `macro_text_preview`
- `inspect(...)` 仍然对应一次真实 prepared turn 的只读检查

### Prompt Runtime Injection

当前 SDK 同时支持两类 Prompt Runtime Injection：

1. 请求级注入：通过 `promptRuntimeInjections` 随 `previewText(...)`、`inspect(...)`、`sessions.respond(...)`、`sessions.respondDryRun(...)`、`sessions.regenerate(...)`、`floors.retry(...)`、`floors.retryStep(...)`、`messages.editAndRegenerate(...)` 一起提交
2. 持久注入：通过 `client.promptRuntime.list/create/patch/deleteSessionInjection(...)` 和 `...BranchInjection(...)` 管理 session / branch 级记录

请求级注入示例：

```ts
const injection = {
  sourceKind: "client_injection" as const,
  title: "Client guide",
  content: "Keep the north pass in focus.",
  placement: "before_history" as const,
  order: 30,
  scope: "request" as const,
};

await client.sessions.respond({
  sessionId: "sess_1",
  message: "继续。",
  promptRuntimeInjections: [injection],
});

const preview = await client.promptRuntime.previewText({
  sessionId: "sess_1",
  text: "{{lastMessage}}",
  promptRuntimeInjections: [injection],
});
```

持久注入示例：

```ts
const created = await client.promptRuntime.createSessionInjection({
  sessionId: "sess_1",
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
  enabled: false,
});
```

公开边界固定为：

- `sourceKind` 只允许 `"client_injection"`
- 请求级 `scope` 仍然使用 `"request"`
- inspection 返回的注入结果里，`scope` 可能为 `request`、`session`、`branch`
- `order` 默认 `100`，只影响同一 placement 内部顺序
- 单次请求最多 32 条 injection；session / branch 持久作用域各最多 128 条
- 单条 `title` 最多 256 字符，单条 `content` 最多 8000 字符
- 单条 `content` 最多 2000 token，本次实际生效 injection `content` 合计最多 4000 token

其中：

- `previewText(...)` 不会把 injection 注入返回的 `text`
- `previewText(...)` 只会在 `runtimeTrace.injection` 中回显解析结果
- `inspect(...)` 会在顶层 `injections` 和 `preparedTurn.runtimeTrace.injection` 中返回同一组结果
- `runtimeTrace.injection` 会包含 `requestedCount`、`appliedCount`、`rejectedCount`、`tokenCount`、`budgetGroup` 汇总字段
- 每条 `PromptRuntimeInjectionResult` 会包含 `tokenCount` 与 `budgetGroup`
- `inspect(...)` 的 `preparePhaseTrace` 会新增 `phase: "injection"`

可见性与裁剪（阶段 6）：

- 每条 `PromptRuntimeInjectionResult` 会包含 `visibility`（`client` / `agent_private` / `debug` / `system`）、`budgetStatus` 与 `restricted`
- 受限来源（`agent_private` / `debug` / `system`）默认裁剪：`title` 返回 `null`、`sourceChain` 省略，并把 `restricted` 置为 `true`；结构性字段（位置、是否生效、原因、预算状态、token）仍完整保留
- `client` 来源永不裁剪
- `inspect(...)` 支持 `includeRestrictedInjectionContent: true`，用于 owner 调试时取回受限来源的完整正文；`previewText(...)` 始终裁剪受限来源

如需直接写类型，SDK 根导出现在还提供：

- `PromptRuntimeInjectionInput`
- `PromptRuntimeInjectionResult`
- `PromptRuntimeInjectionPlacement`
- `PromptRuntimeInjectionScope`
- `PromptRuntimeInjectionSourceKind`
- `PromptRuntimeInjectionNotAppliedReason`
- `PromptRuntimePersistedInjectionRecord`
- `PromptRuntimePersistedInjectionWriteInput`
- `PromptRuntimePersistedInjectionPatchInput`

### inspect 的新增返回字段

`client.promptRuntime.inspect(...)` 的 `preparedTurn` 现在新增：

- `memoryInjection`
- `memory`
- `memorySummary`
- `contributors`
- `preparePhaseTrace`
- `runtimeTrace.injection`

同时顶层还新增：

- `injections`

其中：

- `memoryInjection` 是请求期原始 `MemoryInjectionResult` 的结构化真相
- `memory` 是 Prompt Runtime 统一的记忆 trace 视图
- `memorySummary` 继续保留为兼容投影

`client.promptRuntime.previewText(...)` 现在也会同步返回：

- `memoryInjection`
- `memory`
- `runtimeTrace.generationParamsResolution`
- `runtimeTrace.injection`

`client.promptRuntime.previewText(...)` 与 `inspect(...)` 的 runtime trace
现在也可能返回 `toolTransport`。

这组字段用于表达：

- 当前请求选择了哪种工具调用 transport
- 为什么会选中这条 transport 路径
- text protocol 路径下是否注入了 `toolList`
- text protocol 解析时的 block 统计和拒绝诊断

`client.promptRuntime.inspect(...)` 的 `preparedTurn.runtimeTrace` 现在也会把
`generationParamsResolution` 与 `toolTransport` 暴露为稳定字段。

每个 resolution 项会说明：

- 参数名 `name`
- 最终状态 `finalState`
- 最终来源 `origin`
- 如果是显式取消，还会给出 `cancelledAt`
- 如果最终有值，还会给出 `valueFrom`

如需直接写类型，SDK 根导出现在也提供：

- `PromptRuntimeGenerationParamName`
- `PromptRuntimeGenerationParamFinalState`
- `PromptRuntimeGenerationParamOrigin`
- `PromptRuntimeGenerationParamLayer`
- `PromptRuntimeGenerationParamResolution`
- `PromptRuntimeToolTransportKind`
- `PromptRuntimeToolTransportReasonCode`
- `PromptRuntimeToolTransportSelection`
- `PromptRuntimeToolTransportDiagnosticReason`
- `PromptRuntimeToolTransportDiagnostic`
- `PromptRuntimeToolTransportTrace`

`client.sessions.respondDryRun(...)` 现在会返回：

- `memory`
- `memorySummary`
- `runtimeTrace.injection`

同时 `client.promptRuntime.getCapabilities()` 的 `observability.inspect` 现在也会明确返回：

- `returnsContributors`
- `returnsPreparePhaseTrace`

这几项字段用来表达：

- inspect 返回的是 prepared turn
- preview / inspect / dry-run 不再只靠 `memorySummary` 表达记忆真相
- inspect 现在还能返回 pre-response contributor 视图
- inspect 现在还能返回准备阶段的 phase trace

SDK 这里只暴露稳定视图，不暴露 contributor 的内部 raw payload。

## LLM Instances 与 Session Effective Config

`client.llmInstances.upsert(...)` 现在支持：

- `modelIdOverride`：只覆盖模型名，不改 provider / base URL / API Key
- `capabilities`：声明实例是否支持原生 function call、tool choice、streaming tool call
- `params.stop_sequences`

`client.sessions.getEffectiveConfig(...)` 现在会额外返回 `toolTransport`，用于说明当前会话最终选择了哪种工具调用 transport，以及为什么这样选。

## 阶段五新增资源

阶段五新增以下 SDK 入口：

- `client.workspaces.agentTypes.*`
- `client.projects.agentBindings.*`
- `client.projects.settings.*`
- `client.projects.getEffectiveConfig(...)`
- `client.sessions.getEffectiveConfig(...)`

这些资源对应的是 Agentic readiness 的准备面，不代表 Agent 已经有真实执行能力。

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

其中：

- `getRuntimeToolCatalog(...)` 返回会话级工具目录，并保留 `catalogSource`、`metadataBasisDetail`、`exposure` 等字段。
- `listExecutions(...)` 返回原执行记录字段，并附带 `executionId`、`replaySafety`、`runtimeJob`、`policy`、`provenance`、`roundtrip` 等 trace 字段。

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
