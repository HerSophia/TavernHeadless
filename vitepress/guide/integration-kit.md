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
  promptIntent: "continue",
  debugOptions: {
    includeWorldbookMatches: true,
  },
});

// 本轮冻结的资源版本
console.log(preview.promptSnapshot.presetVersion);
console.log(preview.promptSnapshot.worldbookVersion);
console.log(preview.promptSnapshot.regexProfileVersion);

// 如果开启了 debugOptions.includeWorldbookMatches，可以直接查看命中的世界书条目和首个命中位置
console.log(preview.assembly.worldbookMatches?.[0]?.source.worldbookName);
console.log(preview.assembly.worldbookMatches?.[0]?.activation.firstMatch?.sourceKind);

// 提示词组装模式和摘要
console.log(preview.promptSnapshot.promptMode);   // compat_strict / compat_plus / native
console.log(preview.promptSnapshot.promptDigest);  // 组装后的消息摘要
```

#### promptSnapshot：本轮冻结的资源版本

`promptSnapshot` 记录了本次 dry-run 实际使用的预设、世界书、正则配置的版本号（`presetVersion`、`worldbookVersion`、`regexProfileVersion`）。如果你在两次 dry-run 之间修改过预设，对比版本号就能确认修改是否生效。

如果有持久化变量占用了保留别名（目前是 `char` 和 `user`），`preview.assembly.reservedVariableCollisions` 会列出被系统覆盖的键。

#### assembly：提示词组装的运行结果

`assembly` 告诉你这次提示词组装过程中，各项功能是否真正生效。主要字段如下：

| 字段 | 说明 |
| ---- | ---- |
| `promptIntent` | 本轮的生成意图，如 `normal`（正常对话）或 `continue`（续写） |
| `assistantPrefillApplied` | 是否应用了 assistant 预填充（让 AI 从指定文本开始续写） |
| `continueNudgeApplied` | 是否应用了续写引导文本 |
| `namesBehaviorApplied` | 是否将角色名注入到消息的 `name` 字段 |
| `triggerFilteredEntryIds` | 被 trigger 条件过滤掉的世界书条目 ID 列表 |
| `inChatInsertedEntryIds` | 在聊天历史中间插入的世界书条目 ID 列表 |
| `selectedPromptOrderCharacterId` | 当预设有多条排序轨道时，实际选中的角色轨道 |
| `unsupportedPresetFields` | 当前模式下不支持的预设字段列表 |
| `presetWarnings` | 预设兼容性警告 |
| `worldbookMatches` | 仅在 `debugOptions.includeWorldbookMatches = true` 时返回。列出命中的世界书条目、来源、注入位置和首个命中位置 |

完整字段参考见 [Chat dry-run 响应](/reference/api/chat)。

如果你要做“为什么这条世界书命中了”的调试界面，优先读取 `worldbookMatches`。其中 `source` 表示条目来自哪本世界书，`insertion` 表示它最终插入到 Prompt 的哪里，`activation.firstMatch` 表示它第一次是在哪段扫描源里命中的。

```ts
const session = await client.sessions.create({
  title: "黎明前的酒馆",
  promptMode: "native",
  presetId: "preset-1",
});

const importedCharacter = await client.imports.character({
  payload: cardJson,
  createSession: false,
});

await client.pages.activate({ pageId: "page-2" });
console.log(importedCharacter.characterVersionId);
```

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

运行时工具目录中每个工具会包含以下字段，用来判断该工具的执行方式：

| 字段 | 说明 |
| ---- | ---- |
| `asyncCapability` | 该工具是否支持异步执行。`inline_only` 表示只能在当前 inline 回合内完成，`deferred_ok` 表示可以返回 deferred receipt 并交给后台继续执行 |
| `defaultDeliveryMode` | 默认的交付方式。`inline` 表示同步返回结果，`async_job` 表示提交后台任务并返回受理回执 |
| `resultVisibility` | 结果何时可见。`immediate` 表示立即返回，`deferred_receipt` 表示先返回回执、结果稍后可查 |

执行审计记录中也会包含：

| 字段 | 说明 |
| ---- | ---- |
| `deliveryMode` | 本次执行实际使用的交付方式（`inline` 或 `async_job`） |
| `runtimeJobId` | 如果走了 `async_job`，这个 ID 可以用来查询后台任务状态 |

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

`mapApiErrorToUiState()` 默认按 HTTP 状态码分类，同时会识别以下常见业务错误码，把它们映射到更准确的界面状态：

**并发冲突（映射为 `conflict`）**— 同一资源被多方同时修改时触发，通常需要重新拉取最新数据再操作：

| 错误码 | 常见场景 |
| ---- | ---- |
| `generation_conflict` | 同一会话分支已有生成在进行，不能同时发起第二次 |
| `commit_conflict` | 楼层提交时状态已被改变（如被其他请求抢先提交） |
| `preset_conflict` / `worldbook_conflict` / `regex_profile_conflict` | 更新资源时版本号不匹配，说明有人在你之前改过 |

**服务端繁忙或失败（映射为 `server`）**— 通常可以稍后重试：

| 错误码 | 常见场景 |
| ---- | ---- |
| `generation_timeout` | LLM 生成超时 |
| `generation_queue_timeout` | 生成排队等待超时（仅在服务端启用排队模式时出现） |
| `commit_busy` | 楼层提交时遇到数据库忙 |
| `resource_busy` | 资源写入时遇到数据库忙 |
| `turn_commit_failed` | 生成成功但提交阶段失败 |

这些映射同样覆盖流式 `respond/stream` 的 SSE `error` 事件。流建立后的错误不会改变 HTTP 状态码，因此接入方应优先检查 `error.code` 而不是 `status`。

### 资源乐观锁与版本快照

`presets`、`worldbooks`、`regexProfiles` 的列表、详情和更新响应都会返回 `version`。更新时应优先回填 `expectedVersion`，避免静默覆盖。`regexProfiles.update()` 的 `data` 应直接传规则对象数组；删除主资源时也可以传 `expectedVersion`。

dry-run 返回的 `promptSnapshot` 同样包含 `presetVersion`、`worldbookVersion`、`regexProfileVersion`，用来确认本轮生成冻结的资源版本。

`assembly` 中则包含了本轮提示词组装的运行结果（如生成意图、预填充状态、世界书命中情况等），详见上方 [assembly 字段说明](#assembly提示词组装的运行结果)。

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
| `getDisplayPage` | 优先使用运行中的候选输出，否则回退到 active page |
| `groupToolEventsByExecution` | 工具流式事件 → 执行历史分组 |
| `getActivePage` | 从楼层取真实持久化 active page |
| `flattenVariableSnapshot` | resolved variable snapshot → inspector 行 |
| `sortVariableInspectorRows` | 变量 inspector 行稳定排序 |
| `formatVariablePreview` | 变量值 → 展示预览字符串 |
| `mapApiErrorToUiState` | API 错误 → 界面错误状态 |
| `summarizeRuntimeToolCatalog` | 会话级运行时工具目录 → 摘要 |

## 楼层运行快照与候选输出

如果接入方需要区分：

- 已提交的 `activePage`
- 运行中的候选输出 `pendingOutput`

可以直接结合两组官方能力：

- `client.floors.getRun()` / `client.sessions.getActiveRun()`
- `getDisplayPage()` / `reduceRespondStream()`

这样前端就不需要自己重复写 `pendingOutput ?? activePage` 的分支判断。

## committed 结果快照

当界面需要读取已经提交完成的结构化结果时，可以直接使用：

```ts
const committedResult = await client.floors.getResult({
  floorId: "floor-1",
});

console.log(committedResult.generatedText);
console.log(committedResult.outputPageId);
console.log(committedResult.assistantMessageId);
```

这条接口的目标，是避免接入方长期从 `timeline.activePage`、消息页和其他零散返回体反向拼接最终结果。

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

如果调用方显式传 `toolMode`，当前公开配置仍只有 `inline`。`standalone` 和 `both` 还不受支持，服务端会返回结构化配置错误；但在 `inline` 回合内部，部分 allowlisted 工具仍可能先返回 deferred receipt，再通过 `runtimeJobId` 对应的后台任务继续执行。

### MCP 资源

`mcp` 资源同时覆盖：

- 服务器配置 CRUD
- 启用、停用、连接状态
- connect / disconnect / test
- 服务器工具列表

`listServers()` 和 `getServer()` 现在还会回显可选的 `liveStatus`。它直接对应服务端的 `live_status`，可以让接入方判断数据库配置是否已经进入 live runtime manager。

MCP 状态读取还会保留 `reconnectRequired`、`lastTimeoutAt`，并在新服务端上额外给出可选的 `attached`、`reason` 字段，用来区分：

- 配置被禁用
- runtime manager 未启用
- 数据库里是 enabled，但 runtime 尚未挂载

MCP 管理接口的 secret 字段也已经和请求字段分开：

- `createServer()` / `updateServer()` 仍然写入 `stdio.env`、`http.headers`
- `listServers()`、`getServer()` 以及创建、更新、toggle 的返回记录只会给出 `stdio.envMasked`、`http.headersMasked`

这意味着接入方不能再依赖管理接口回显原始 secret。编辑已有配置时，应把 secret 视为“留空保持原值，重新填写则整体替换”的字段。

当 `ENABLE_MCP=true` 时，create / update / enable / disable / delete 这些配置变更会直接同步 live `McpConnectionManager`，因此 session runtime catalog 与 `/mcp/servers` 的 live 状态会一起变化。

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
