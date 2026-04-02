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

这个函数支持返回 `Promise`，所以异步取 token 也没问题。

如果服务端启用了多账号：

- `AUTH_MODE=jwt` 时，应当使用**已经带有目标账号 claim** 的 JWT；默认 claim 字段名是 `account_id`，可由服务端通过 `AUTH_JWT_ACCOUNT_CLAIM` 改名
- `AUTH_MODE=api_key` 时，应当由服务端通过 `AUTH_API_KEY_ACCOUNTS` 把 API Key 绑定到账号
- SDK 各资源方法里的 `accountId` 参数，以及 `buildAccountHeaders()` 生成的 `x-account-id` 头，都只是兼容头提示，不能替代服务端认证，也不会直接切换账号

### 用底层方法直接请求

有些场景下你可能不想走资源方法，想直接发请求：

```ts
const rawHealth = await client.get("/health");

const rawSession = await client.request("GET", "/sessions/{id}", {
  params: {
    path: { id: "session-1" },
  },
});
```

底层方法有 `request()`、`get()`、`post()`、`put()`、`patch()`、`delete()`，都是类型化的。

## 资源调用

下面用几个常见场景展示资源方法的用法。

### 列出会话，然后生成一次回复

```ts
const sessions = await client.sessions.list({
  accountId: "account-1",
  limit: 20,
  offset: 0,
  sortBy: "updated_at",
  sortOrder: "desc",
});

const result = await client.sessions.respond({
  accountId: "account-1",
  sessionId: "session-1",
  message: "你好",
  generationParams: {
    temperature: 0.8,
    topP: 0.95,
  },
});

console.log(result.generatedText);
console.log(result.summaries);
console.log(result.finalState);
console.log(result.totalTokens);
```

Chat 相关方法会保留后端返回的这些字段：

- `generatedText`
- `summaries`
- `finalState`

其中 `finalState === "committed"` 表示生成结果已经越过提交边界，相关持久化写入已经完成。

### 流式回复

```ts
const result = await client.sessions.respondStream({
  accountId: "account-1",
  sessionId: "session-1",
  message: "继续",
  onStart(payload) {
    console.log(payload.floorId, payload.floorNo);
  },
  onChunk(payload) {
    process.stdout.write(payload.chunk);
  },
  onRun(payload) {
    console.log(payload.phase, payload.pendingOutput?.text);
  },
  onSummary(payload) {
    console.log(payload.summaries);
  },
});

console.log(result.floorId);
console.log(result.summaries);
console.log(result.finalState);
```

`respondStream()` 内部已经处理好 SSE 解析，你只管写回调就行。

除了 `start`、`chunk`、`summary`、`tool`、`done`、`error` 这些事件，流里现在还会带 `run` 事件。它表示当前楼层这一轮生成的运行快照，例如：

- 当前阶段 `phase`
- 当前展示阶段 `publicPhase`
- 当前尝试号 `attemptNo`
- 候选输出 `pendingOutput`

这组字段适合前端在流式过程中恢复候选输出，而不是只靠本地拼接 chunk。

### 查询楼层运行快照

```ts
const floorRun = await client.floors.getRun({ floorId: "floor-1" });
const activeRun = await client.sessions.getActiveRun({ sessionId: "session-1" });

console.log(floorRun.run?.phase);
console.log(activeRun.activeRun?.publicPhase);

const committedResult = await client.floors.getResult({ floorId: "floor-1" });

console.log(committedResult.generatedText);
console.log(committedResult.summaries);
console.log(committedResult.outputPageId);
console.log(committedResult.assistantMessageId);
console.log(committedResult.totalTokens);
```

`getRun()` 用于读取运行中的业务进度快照。`getResult()` 用于读取已经 committed 的结构化结果快照。前者解决运行过程恢复，后者解决最终结果读取。

### 生成前 dry-run 与 `promptSnapshot`

```ts
const preview = await client.sessions.respondDryRun({
  accountId: "account-1",
  sessionId: "session-1",
  message: "继续",
});

console.log(preview.messages);
console.log(preview.promptSnapshot.promptMode);
console.log(preview.promptSnapshot.promptDigest);
console.log(preview.promptSnapshot.tokenEstimate);
console.log(preview.promptSnapshot.presetVersion);
```

`respondDryRun()` 返回的 `promptSnapshot` 预览字段与真实提交后的 `prompt_snapshot` 对齐，适合在生成前检查 preset、worldbook、regex 和摘要注入结果。

现在这份 dry-run 结果还会额外返回：

- `presetVersion`
- `worldbookVersion`
- `regexProfileVersion`
- `assembly.reservedVariableCollisions`

它们对应本轮真正冻结使用的资源版本号。

### 资源更新的乐观锁

`presets`、`worldbooks`、`regexProfiles` 这几类资源的列表、详情和更新响应都会返回 `version`。

更新时，优先传入 `expectedVersion`：

```ts
const preset = await client.presets.getEditor({ presetId: "preset-1" });

await client.presets.update({
  presetId: preset.id,
  name: preset.name,
  editor: {
    default_character_id: 100000,
    entries: [
      { identifier: "main", role: "system", content: "Stay in character.", enabled: true },
    ],
    order_contexts: [{ character_id: 100000, order: [{ identifier: "main", enabled: true }] }],
    top_level: { temperature: 0.7 },
  },
  expectedVersion: preset.version,
});
```

对于 `regexProfiles.update()`，`data` 应直接传规则对象数组，不要传 JSON 字符串：

```ts
const regexProfile = await client.regexProfiles.getDetail({ profileId: "regex-1" });

await client.regexProfiles.update({
  profileId: regexProfile.id,
  name: regexProfile.name,
  data: [
    { scriptName: "trim_whitespace", findRegex: "/\\s+$/g", replaceString: "", placement: [2] },
  ],
  expectedVersion: regexProfile.version,
});
```

兼容旧调用方时，现有主资源 `PUT` 路由也仍然可以继续传 `expectedUpdatedAt`，但新的接入应优先使用 `expectedVersion`。

删除主资源时，`remove(...)` 现在也支持 `expectedVersion`，SDK 会自动把它编码到 query string：

```ts
await client.presets.remove({
  presetId: "preset-1",
  expectedVersion: 4,
});

await client.worldbooks.remove({
  worldbookId: "worldbook-1",
  expectedVersion: 7,
});

await client.regexProfiles.remove({
  profileId: "regex-1",
  expectedVersion: 3,
});
```

这遵循服务端约束：删除主资源时使用 query string `expected_version`，不使用 `DELETE` body。

`presetEntries` / `worldbookEntries` 的所有写方法同样支持 `expectedVersion`：

- `create(...)`、`update(...)`、`reorder(...)`、`batchUpdate(...)`、`batchDelete(...)`、`batchReorder(...)` 会通过 body 发送 `expected_version`
- `remove(...)` 会通过 query string 发送 `expected_version`

如果服务端返回 `preset_conflict` 或 `worldbook_conflict`，说明调用方持有的版本基线已经过期，应先重新拉取最新资源再决定是否重试。

如果服务端返回 `resource_busy`，说明资源写入遇到了 SQLite 忙状态。它属于资源写入语义，和聊天提交链路中的 `commit_busy` 是两类不同错误。

### LLM Profiles 绑定与解绑

```ts
await client.llmProfiles.activate({
  profileId: "profile-1",
  scope: "session",
  sessionId: "session-1",
  slot: "narrator",
});

await client.llmProfiles.unbind({
  scope: "session",
  sessionId: "session-1",
  slot: "narrator",
});

const resolvedSlots = await client.llmInstances.listResolved({ sessionId: "session-1" });
```

如果 narrator 在实例侧被显式禁用，聊天接口会返回固定错误码 `instance_slot_disabled_required`。

### 变量和记忆

```ts
// 写入变量
await client.variables.upsert({
  accountId: "account-1",
  key: "mood",
  scope: "chat",
  scopeId: "session-1",
  value: { score: 20 },
});

// 写入 branch 变量
await client.variables.upsert({
  accountId: "account-1",
  key: "route",
  scope: "branch",
  sessionId: "session-1",
  branchId: "alt-1",
  value: "campfire",
});

// 解析当前上下文可见变量快照
const snapshot = await client.variables.resolveContext({
  accountId: "account-1",
  sessionId: "session-1",
  branchId: "alt-1",
  floorId: "floor-1",
  pageId: "page-1",
  includeLayers: true,
});

console.log(snapshot.context.globalScopeId); // "global"
console.log(snapshot.context.branchId); // "alt-1"
console.log(snapshot.resolved[0]?.key);
console.log(snapshot.resolved[0]?.sourceScope);
console.log(snapshot.resolved[0]?.sourceScopeRef);
console.log(snapshot.layers?.page?.items.length ?? 0);
console.log(snapshot.layers?.branch?.scopeRef);

// 读取记忆
const memories = await client.memories.list({
  accountId: "account-1",
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

// 读取记忆任务与 scope 状态
const jobs = await client.memoryJobs.list({
  accountId: "account-1",
  scope: "chat",
  scopeId: "session-1",
  status: "retry_waiting",
});

const scopes = await client.memoryScopes.list({
  accountId: "account-1",
  scope: "chat",
  scopeId: "session-1",
});

await client.memoryScopes.compact({
  accountId: "account-1",
  force: true,
  scope: "chat",
  scopeId: "session-1",
});

console.log(jobs.jobs[0]?.jobType);
console.log(scopes.scopes[0]?.revision);
```

`factKey` 只承接 `type: "fact"` 的结构化键，`content` 仍然保留为展示和注入内容。`summaryTier` 和 `lifecycleStatus` 对应 Memory V2 的公开字段；其中 `status` 仍保留兼容层面的粗粒度状态，而 `lifecycleStatus` 会进一步区分 `compacted`。

`memoryJobs` 和 `memoryScopes` 分别对应后台任务观测面与 scope 状态观测面。`memoryScopes.rebuild()`、`memoryScopes.compact()` 需要服务端已经启用 background worker。

`variables.resolveContext()` 对应后端的 `GET /variables/resolve`，会返回当前 `global/chat/branch/floor/page` 可见变量的最终胜出结果，并可选附带各层原始快照。

### 页面、分支和条目

```ts
const pages = await client.pages.list({
  accountId: "account-1",
  floorId: "floor-1",
});

const presetEntries = await client.presetEntries.list({
  accountId: "account-1",
  presetId: "preset-1",
});

const worldbookEntries = await client.worldbookEntries.list({
  accountId: "account-1",
  worldbookId: "worldbook-1",
});
```

### 导出

`exports` 资源比较特殊——它直接返回原始 `Response`，因为导出本身就是文件下载语义，你可能需要自己决定用 `text()`、`blob()` 还是别的方式读取：

```ts
const response = await client.exports.chat({
  accountId: "account-1",
  sessionId: "session-1",
  format: "thchat",
});

console.log(response.headers.get("content-disposition"));
```

如果服务端要求异步导出，可以先创建作业，再轮询 `chatTransferJobs`：

这组接口更适合平台接入、批处理和自动化脚本，不是普通聊天主流程的首选入口。

```ts
const importJob = await client.imports.chatJob({
  accountId: "account-1",
  data: rawJsonl,
  characterId: "char-1",
  title: "Imported Chat",
});

console.log(importJob.jobId, importJob.status, importJob.format);

const exportJob = await client.exports.chatJob({
  accountId: "account-1",
  sessionId: "session-1",
  format: "thchat",
});

const jobDetail = await client.chatTransferJobs.getDetail({
  accountId: "account-1",
  jobId: exportJob.jobId,
});

if (jobDetail.status === "succeeded") {
  const fileResponse = await client.chatTransferJobs.downloadFile({
    accountId: "account-1",
    jobId: exportJob.jobId,
  });

  console.log(fileResponse.headers.get("content-disposition"));
}
```

### Tool Calling

```ts
const runtimeCatalog = await client.sessions.getRuntimeToolCatalog({
  accountId: "account-1",
  sessionId: "session-1",
});

const builtinTools = await client.tools.listBuiltin({
  accountId: "account-1",
});

const definitions = await client.tools.listDefinitions({
  accountId: "account-1",
  source: "custom",
  limit: 20,
  offset: 0,
});

const records = await client.tools.listCallRecords({
  accountId: "account-1",
  pageId: "page-1",
  limit: 20,
  offset: 0,
});
```

```ts
const executions = await client.tools.listExecutions({
  accountId: "account-1",
  floorId: "floor-1",
  sortBy: "started_at",
  sortOrder: "desc",
});
```

`listExecutions()` 读取新的主执行审计路由。`listCallRecords()` 仍保留为兼容查询面。

运行时工具目录通过 `client.sessions.getRuntimeToolCatalog()` 读取。它是**会话级**快照，对应某个 session 在当前权限、启用状态和 MCP 连接状态下真正可调用的工具集合，不是全局静态目录。

公开审计模型已经是 `tool_execution_record`，因此新的查询应优先使用 `listExecutions()`；`tool_call_record` 和 `listCallRecords()` 只用于兼容旧查询面。

如果你在生成请求里显式传 `toolMode`，当前运行时只支持 `inline`。`standalone` 和 `both` 还不受支持，服务端会返回结构化配置错误，而不是悄悄降级。

### MCP

```ts
const servers = await client.mcp.listServers({
  accountId: "account-1",
  limit: 20,
  offset: 0,
});

const status = await client.mcp.getServerStatus({
  accountId: "account-1",
  serverId: "mcp-1",
});

const tools = await client.mcp.listServerTools({
  accountId: "account-1",
  serverId: "mcp-1",
});
```

多账号模式下，MCP 配置和运行时状态都是账号私有资源。访问其他账号的 MCP 配置会得到 `404`。

MCP 管理接口现在不再回显真实 secret：

- `createServer()` / `updateServer()` 请求仍可写入 `stdio.env`、`http.headers`
- `listServers()`、`getServer()` 以及创建、更新、toggle 的返回记录只会暴露 `stdio.envMasked`、`http.headersMasked`

```ts
const server = await client.mcp.getServer({ accountId: "account-1", serverId: "mcp-1" });

console.log(server.stdio?.envMasked);
console.log(server.http?.headersMasked);
```

如果请求包含 secret 且服务端未配置 `APP_SECRETS_MASTER_KEY`，SDK 会收到后端返回的 `503 secret_unavailable`。

`getServerStatus()` 和 `listStatuses()` 会保留 `reconnectRequired`、`lastTimeoutAt` 这些运行时字段。

当服务端返回 `mcp_call_uncertain_timeout` 时，含义是这次调用结果**不确定**，并且连接需要重建；它不是普通的确定性失败。

## 错误处理

后端返回非 2xx 响应时，SDK 会把它归一化为 `TavernApiError`：

```ts
import { isTavernApiError } from "@tavern/sdk";

try {
  await client.sessions.getDetail({ sessionId: "missing" });
} catch (error) {
  if (isTavernApiError(error)) {
    console.log(error.status);   // HTTP 状态码
    console.log(error.code);     // 后端错误码
    console.log(error.message);  // 错误信息
  }
}
```

`TavernApiError` 上还有可选的 `details` 和 `requestId` 字段，后端返回了就会带上。

## SSE

对于流式接口（比如 `respond/stream`），SDK 内部已经完成了这些事：

- 发起 `text/event-stream` 请求
- 逐行解析 `start` → `chunk` → `tool` → `summary` → `done` 事件
- 遇到 `error` 事件时抛出 `TavernApiError`
- 保留 `error` 事件里的后端错误码，例如 `generation_timeout`、`commit_busy`、`generation_queue_timeout`、`tool_replay_confirmation_required`、`mcp_call_uncertain_timeout`
- 在 `done` 中保留 `branchId`、`generatedText`、`summaries`、`totalUsage`、`finalState`
- 通过 `onTool` 暴露运行时工具事件，包括 `executionId`、`providerId`、`providerType`、`phase`、`replaySafety`、`durationMs`
- 通过 `onEvent` 原样转发每一个已解析事件，其中也包括真实的 `done`
- 流结束但没收到 `done` 时也会抛出错误

一般场景直接用 `client.sessions.respondStream()` 就够了。如果需要更底层的控制，可以自己调 `readSseStream()`。

如果你在应用层自己累积流式状态，应直接消费这条真实 `done` 事件，不要再额外合成第二个 `done`。

需要注意的是，SSE 连接一旦已经建立，运行期错误通常不再切换 HTTP 状态码，因此这类 `TavernApiError` 的 `status` 常常仍是 `200`。接入方应同时看 `error.code`。

默认服务配置仍是单实例内存协调器，且 `queueMode` 为 `reject`。因此同一 `session + branch` 的并发请求通常直接返回 `generation_conflict`。只有服务端显式启用 `queue` 模式时，客户端才可能收到 `generation_queue_timeout`；即便如此，排队范围也只在当前进程内。

## 资源覆盖范围

目前 SDK 已经覆盖这些资源：

| 分类 | 资源 |
| ---- | ---- |
| 会话与内容结构 | `health`、`sessions`、`messages`、`floors`、`pages`、`branches` |
| 角色、资料与配置 | `characters`、`users`、`presets`、`presetEntries`、`worldbooks`、`worldbookEntries`、`regexProfiles` |
| 导入、导出与模型 | `imports`、`exports`、`chatTransferJobs`、`llmProfiles`、`llmInstances` |
| 账号、变量与记忆 | `accounts`、`variables`、`memories`、`memoryEdges`、`memoryJobs`、`memoryScopes` |
| 工具与运行集成 | `tools`、`mcp` |

## 和 `@tavern/client-helpers` 怎么配合

两个包各管各的：

- **SDK** 负责和后端打交道——发请求、收数据、处理错误
- **client-helpers** 负责整理数据给前端用——构建时间线、累积流式状态、归一化 usage、映射错误状态

建议的使用顺序：

1. 先用 SDK 拿到数据
2. 再用 client-helpers 整理成前端需要的形态
3. 最后在应用层接入 store、组件、页面

## 设计边界

**适合放进这个包的：**

- 资源调用方法
- 请求头注入
- 错误对象
- SSE 解析
- API 输入输出映射
- 保留后端语义的轻量包装

**不适合放进这个包的：**

- timeline 视图构建
- active page 选择
- store 操作
- UI 状态机
- Vue / React hooks
- 应用层缓存策略

## 和后端变更的关系

这个包是第一方官方接入层，不是一个随便堆工具函数的地方。

当后端的路由、SSE 事件、OpenAPI 契约、资源返回结构、Tool Calling、MCP、导入导出行为发生变化时，需要优先检查这个包是否需要同步更新。

如果变化已经影响到接入方能感知到的行为，应同时更新：

- SDK 实现
- SDK 文档
- 外部接入文档

不能只改后端或只在 `apps/web` 里补个局部适配，把官方包留在旧语义上。

## 版本兼容

| 后端 API | `@tavern/sdk` |
| ---- | ---- |
| `v0.2.x-beta` | `0.1.x` |

OpenAPI 生成沿用仓库根目录的工作流：

```bash
pnpm sdk:generate
pnpm sdk:check
```

## 当前状态

已覆盖会话、内容结构、变量、记忆条目 / 边 / 作业 / scope 状态、导入导出，以及 Tool Calling / MCP 的主要第一方接入面。`apps/web` 已经直接使用这里的运行时工具目录、执行审计、MCP 状态和 SSE 事件能力。

后续如果后端继续扩展资源，按同样的方式在这里扩充就好，不需要在各个前端里重复写请求层。
