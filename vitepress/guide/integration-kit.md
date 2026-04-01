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

### `@tavern/shared`

`@tavern/shared` 是内部包，仓库内部可以复用，但不属于公开接入面。

## 建议的使用顺序

1. 用 `@tavern/sdk` 读取或写入资源
2. 用 `@tavern/client-helpers` 整理数据
3. 在应用层接入 store、组件、页面

## 基本示例

### 创建客户端

```ts
import { createTavernClient } from "@tavern/sdk";

const client = createTavernClient({
  baseUrl: "http://localhost:3000",
});
```

如果后端开启了认证，可以通过 `getHeaders` 注入：

```ts
const client = createTavernClient({
  baseUrl: "http://localhost:3000",
  getHeaders: () => ({
    authorization: "Bearer <token>",
  }),
});
```

如果服务端启用了多账号：

- `AUTH_MODE=jwt` 时，应当使用已经带有目标账号 claim 的 JWT；默认 claim 字段名是 `account_id`，可由服务端通过 `AUTH_JWT_ACCOUNT_CLAIM` 改名
- `AUTH_MODE=api_key` 时，应当由服务端通过 `AUTH_API_KEY_ACCOUNTS` 把 API Key 绑定到账号
- SDK 各资源方法里的 `accountId` 参数，以及 `buildAccountHeaders()` 生成的 `x-account-id`，都只是兼容头提示，不能替代服务端认证，也不会直接切换账号

### 调用资源

```ts
// 非流式回复
const result = await client.sessions.respond({
  sessionId: "session-1",
  message: "你好",
});

console.log(result.generatedText);
console.log(result.summaries);
console.log(result.finalState);
```

`finalState === "committed"` 表示公开提交边界已经完成，相关持久化写入已经结束。

### LLM Profiles 与 Instance 运行时

```ts
// 绑定一个 Profile 到 narrator 槽位
await client.llmProfiles.activate({
  profileId: "profile-1",
  scope: "session",
  sessionId: "session-1",
  slot: "narrator",
});

// 如需显式解绑
await client.llmProfiles.unbind({
  scope: "session",
  sessionId: "session-1",
  slot: "narrator",
});

// 查看实例侧 enabled / preset / params 的最终解析
const resolvedSlots = await client.llmInstances.listResolved({ sessionId: "session-1" });
```

如果 narrator 在实例侧被显式禁用，聊天请求会返回固定错误码 `instance_slot_disabled_required`。

```ts
// 流式回复
const result = await client.sessions.respondStream({
  sessionId: "session-1",
  message: "继续",
  onChunk(payload) {
    process.stdout.write(payload.chunk);
  },
});

console.log(result.summaries);
console.log(result.finalState);
```

```ts
// 生成前 dry-run
const preview = await client.sessions.respondDryRun({
  sessionId: "session-1",
  message: "继续",
});

console.log(preview.promptSnapshot.promptMode);
console.log(preview.promptSnapshot.promptDigest);
```

`respondDryRun()` 的 `promptSnapshot` 现在也会带上 `presetVersion`、`worldbookVersion`、`regexProfileVersion`，用来表示本轮真正冻结使用的资源版本。

如果有持久化变量试图占用保留别名，`preview.assembly.reservedVariableCollisions` 会返回被系统别名覆盖的键。目前保留别名是 `char` 和 `user`。

### 运行时工具目录与执行审计

```ts
const catalog = await client.sessions.getRuntimeToolCatalog({
  sessionId: "session-1",
});

for (const tool of catalog.tools) {
  console.log(tool.name, tool.asyncCapability, tool.defaultDeliveryMode, tool.resultVisibility);
}

const executions = await client.tools.listExecutions({
  sessionId: "session-1",
  status: "queued",
});

for (const record of executions.records) {
  console.log(record.toolName, record.deliveryMode, record.runtimeJobId);
}
```

运行时工具目录现在会直接暴露：

- `asyncCapability`
- `defaultDeliveryMode`
- `resultVisibility`

这三个字段可以帮助接入方判断某个工具是否只支持同步调用，还是会返回 deferred receipt。

工具执行审计记录现在也会直接暴露：

- `deliveryMode`
- `runtimeJobId`

如果某次执行走了 `async_job`，可以用 `runtimeJobId` 把工具审计记录和后台 job 状态对应起来。

### 资源更新的版本并发控制

`@tavern/sdk` 读取 preset、worldbook、regex profile 时，会把后端返回的 `version` 一并保留下来。

更新时，优先传 `expectedVersion`：

```ts
const worldbook = await client.worldbooks.getDetail({
  worldbookId: "worldbook-1",
});

await client.worldbooks.update({
  worldbookId: worldbook.id,
  name: worldbook.name,
  data: worldbook.data,
  expectedVersion: worldbook.version,
});
```

兼容旧调用方时，现有主资源 `PUT` 路由仍可继续传 `expectedUpdatedAt`。新的接入建议统一切到 `expectedVersion`。

删除主资源时，`remove(...)` 会把 `expectedVersion` 放到 query string，而不是 `DELETE` body：

```ts
await client.presets.remove({
  presetId: "preset-1",
  expectedVersion: 4,
});

await client.worldbooks.remove({
  worldbookId: "worldbook-1",
  expectedVersion: 7,
});
```

`presetEntries` / `worldbookEntries` 的写方法也支持 `expectedVersion`：

- `create(...)`、`update(...)`、`reorder(...)`、`batchUpdate(...)`、`batchDelete(...)`、`batchReorder(...)` 会通过 body 发送 `expected_version`
- `remove(...)` 会通过 query string 发送 `expected_version`

如果服务端返回：

- `preset_conflict`
- `worldbook_conflict`

说明调用方持有的版本基线已经过期，应先重新拉取最新资源再决定是否重试。

如果服务端返回 `resource_busy`，说明资源写入遇到了 SQLite 忙状态。它是资源写入语义，和聊天提交链路里的 `commit_busy` 是两类不同错误。

```ts
// 读取 Memory V2 摘要
const memories = await client.memories.list({
  scope: "chat",
  scopeId: "session-1",
  type: "summary",
  summaryTier: "macro",
  lifecycleStatus: "active",
});

console.log(memories[0]?.summaryTier);
console.log(memories[0]?.lifecycleStatus);
console.log(memories[0]?.sourceJobId);
console.log(memories[0]?.coverageStartFloorNo);
```

```ts
// 读取后台任务与 scope 状态
const jobs = await client.memoryJobs.list({
  scope: "chat",
  scopeId: "session-1",
  status: "retry_waiting",
});

const scopes = await client.memoryScopes.list({
  scope: "chat",
  scopeId: "session-1",
});

await client.memoryScopes.compact({
  scope: "chat",
  scopeId: "session-1",
  force: true,
});

console.log(jobs.jobs[0]?.jobType);
console.log(scopes.scopes[0]?.revision);
```

`factKey` 只承接 `type: "fact"` 的结构化键，`content` 仍然保留为展示和注入内容。`summaryTier`、`lifecycleStatus`、`sourceJobId` 等字段对应 Memory V2 的公开元数据。

`memoryJobs` 和 `memoryScopes` 对应后台任务与 scope 状态的管理接口。`memoryScopes.rebuild()`、`memoryScopes.compact()` 需要服务端已经启用 background worker。

### 异步聊天导入导出作业

这组接口更适合平台接入、批处理和自动化脚本，不是普通聊天主流程的首选入口。

```ts
const exportJob = await client.exports.chatJob({
  sessionId: "session-1",
  format: "thchat",
});

const job = await client.chatTransferJobs.getDetail({
  jobId: exportJob.jobId,
});

if (job.status === "succeeded") {
  const fileResponse = await client.chatTransferJobs.downloadFile({
    jobId: exportJob.jobId,
  });

  console.log(fileResponse.headers.get("content-disposition"));
}
```

异步聊天导入也可以用同样方式处理：

- 用 `client.imports.chatJob(...)` 创建作业
- 用 `client.chatTransferJobs.getDetail(...)` 轮询状态
- 导入作业成功后，从 `result` 或 `resultSessionId` 读取结果

```ts
// 解析当前上下文可见变量快照
const snapshot = await client.variables.resolveContext({
  sessionId: "session-1",
  floorId: "floor-1",
  pageId: "page-1",
  includeLayers: true,
});

console.log(snapshot.resolved[0]?.key);
console.log(snapshot.resolved[0]?.sourceScope);
```

这个方法对应后端的 `GET /variables/resolve`。它返回当前 `global/chat/floor/page` 四层里最终可见的胜出值，并可选附带各层原始快照。

### 整理数据

```ts
import {
  buildTimelineMessages,
  flattenVariableSnapshot,
  resolveUsage,
  sortVariableInspectorRows,
} from "@tavern/client-helpers";

// 归一化 usage
const usage = resolveUsage(result.totalUsage);
console.log(usage.inputTokens, usage.outputTokens, usage.totalTokens);

// 构建时间线
const messages = buildTimelineMessages(timeline.floors);

// 整理变量 inspector 行
const variableRows = sortVariableInspectorRows(flattenVariableSnapshot(snapshot));
console.log(variableRows[0]?.preview);
```

### 累积流式状态

```ts
import {
  createInitialRespondStreamState,
  reduceRespondStream,
} from "@tavern/client-helpers";

let state = createInitialRespondStreamState();

for (const event of events) {
  state = reduceRespondStream(state, event);
}
// state.status: "idle" → "streaming" → "done"(或 "error")
// state.content: 已累积的生成文本
```

### 错误映射

```ts
import { mapApiErrorToUiState } from "@tavern/client-helpers";

try {
  await client.sessions.respond({ sessionId: "missing", message: "hello" });
} catch (error) {
  const uiError = mapApiErrorToUiState(error);
  // uiError.kind: "not_found" / "validation" / "server" / "network" / ...
  // uiError.retryable: true / false
  // uiError.code: 原始 API 错误码
}
```

`mapApiErrorToUiState()` 默认按 HTTP 状态码分桶，但会对部分已知业务错误码优先做 code-aware 映射：

- `generation_conflict` → `conflict`
- `generation_queue_timeout` → `server`
- `generation_timeout` → `server`
- `commit_busy` → `server`
- `commit_conflict` → `conflict`
- `resource_busy` → `server`
- `preset_conflict` → `conflict`
- `worldbook_conflict` → `conflict`
- `regex_profile_conflict` → `conflict`
- `turn_commit_failed` → `server`

这条规则同样覆盖流式 `respond/stream` 的 SSE `error` 事件。流已经建立后，SDK 抛出的 `TavernApiError.status` 可能仍然是 `200`，但 `code` 会保留下来，因此接入方应优先看 `code`。

默认服务配置仍是单实例内存协调器，且 `GENERATION_QUEUE_MODE=reject`。因此同一 `session + branch` 的并发请求通常直接返回 `generation_conflict`。只有服务端显式启用 `GENERATION_QUEUE_MODE=queue` 时，接入方才可能看到 `generation_queue_timeout`；`GENERATION_QUEUE_TIMEOUT_MS` 用于控制 queue 模式下的等待超时。即便如此，排队范围也只在当前进程内。

### 资源乐观锁与版本快照

`presets`、`worldbooks`、`regexProfiles` 的列表、详情和更新响应都会返回 `version`。更新时应优先回填 `expectedVersion`，避免静默覆盖。

`respondDryRun()` 返回的 `promptSnapshot` 也会带 `presetVersion`、`worldbookVersion`、`regexProfileVersion`，用于说明本轮真正冻结使用的资源版本。

## SDK 资源覆盖范围

目前 `@tavern/sdk` 已覆盖这些资源：

| 分类 | 资源 |
| ---- | ---- |
| 会话与内容结构 | `health`、`sessions`、`messages`、`floors`、`pages`、`branches` |
| 角色、资料与配置 | `characters`、`users`、`presets`、`presetEntries`、`worldbooks`、`worldbookEntries`、`regexProfiles` |
| 导入、导出与模型 | `imports`、`exports`、`chatTransferJobs`、`llmProfiles`、`llmInstances` |
| 账号、变量与记忆 | `accounts`、`variables`、`memories`、`memoryEdges`、`memoryJobs`、`memoryScopes` |
| 工具与运行集成 | `tools`、`mcp` |

### 底层能力

除了资源方法，`@tavern/sdk` 还保留了通用的底层请求方法：

- `request()`、`get()`、`post()`、`put()`、`patch()`、`delete()`
- `TavernApiError` 和 `isTavernApiError()`
- `readSseStream()`

## `@tavern/client-helpers` 当前导出

| 函数 | 用途 |
| ---- | ---- |
| `resolveUsage` | usage 归一化 |
| `buildTimelineMessages` | 楼层数据 → 时间线消息列表 |
| `createInitialRespondStreamState` | 流式状态初始值 |
| `reduceRespondStream` | SSE 事件 → 流式状态累积 |
| `groupToolEventsByExecution` | 工具流式事件 → 执行历史分组 |
| `getActivePage` | 从楼层取当前活动页 |
| `flattenVariableSnapshot` | resolved variable snapshot → inspector 行 |
| `sortVariableInspectorRows` | 变量 inspector 行稳定排序 |
| `formatVariablePreview` | 变量值 → 展示预览字符串 |
| `mapApiErrorToUiState` | API 错误 → 界面错误状态 |
| `summarizeRuntimeToolCatalog` | 会话级运行时工具目录 → 摘要 |

## 导出、Tools、MCP 的处理原则

### 导出资源

`exports` 资源直接返回原始 `Response`。导出本身是文件下载语义，调用方可能需要自己用 `text()`、`blob()` 或其他方式读取。

如果服务端要求异步导出，则先调用 `exports.chatJob()`，再通过 `chatTransferJobs.getDetail()` 轮询状态，最后用 `chatTransferJobs.downloadFile()` 读取产物。

### Tools 资源

`tools` 资源负责：

- 内置工具列表
- 自定义工具定义 CRUD
- 启用和停用
- 兼容调用记录查询

会话级工具权限和运行时工具目录仍保留在 `sessions` 资源下：

- `sessions.getToolPermissions()`
- `sessions.getRuntimeToolCatalog()`

其中运行时工具目录是**会话级**快照，反映某个 session 在当前权限、启用状态和 MCP 连接状态下真正可调用的工具集合。

`tools.listExecutions()` 对应新的主审计模型 `tool_execution_record`。`tools.listCallRecords()` 仍对应公开兼容查询面 `/tools/call-records`，只用于兼容旧读取路径。

如果调用方显式传 `toolMode`，当前运行时只支持 `inline`。`standalone` 和 `both` 还不受支持，服务端会返回结构化配置错误。

### MCP 资源

`mcp` 资源同时覆盖：

- 服务器配置 CRUD
- 启用、停用、连接状态
- connect / disconnect / test
- 服务器工具列表

MCP 状态读取还会保留 `reconnectRequired`、`lastTimeoutAt` 这类运行时字段。

`mcp_call_uncertain_timeout` 表示结果不确定并且需要重连，不应当成普通失败来解释。

## 和 `apps/web` 的关系

这两个包首先用于收拢仓库内已经重复出现的接入逻辑。

`apps/web` 已经开始用这两个包：

- 请求层逻辑逐步迁入 `@tavern/sdk`
- 时间线和流式状态整理逻辑逐步迁入 `@tavern/client-helpers`
- live tool inspector、retry replay confirmation、Tool Manager、MCP Manager 也直接建立在这两层之上
- 变量 inspector 现在直接使用 `sdk.variables.resolveContext()` 和 client-helper 的快照整理函数

应用层仍然保留：

- Vue 组件和页面逻辑
- 表单状态
- 菜单交互
- 只在单一界面中用到的局部映射

## 这套文档怎么跟着代码变化

当引擎内部实现、后端路由、SSE 事件、OpenAPI、Tool Calling、MCP 或其他接入方可见的语义发生变化时，不能只改引擎或只改某个前端。

应同时检查并按需要更新：

- `@tavern/sdk`
- `@tavern/client-helpers`
- 包内 README
- 外部接入文档

引擎内部实现一改，官方包自然也要跟着检查。变化已经影响公开接入语义的，就应同步更新。

## 文档入口

包内文档：

- `packages/official-integration-kit/sdk/README.md`
- `packages/official-integration-kit/client-helpers/README.md`

协作规则：

- `docs/contributing.md`
- [协作指南](/development/contributing)

## 版本兼容

| 后端 API | `@tavern/sdk` | `@tavern/client-helpers` |
| ---- | ---- | ---- |
| `v0.2.x-beta` | `0.1.x` | `0.1.x` |

## 继续阅读

如果需要查看 API 本身：

- [API 参考](/reference/api)
- [Sessions（会话）](/reference/api/sessions)
- [Chat（对话生成）](/reference/api/chat)
- [Presets（预设）](/reference/api/presets)
- [Worldbooks（世界书）](/reference/api/worldbooks)
- [Tools](/reference/api/tools)
- [MCP Servers](/reference/api/mcp)
