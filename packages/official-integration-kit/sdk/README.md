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
    "x-account-id": "account-1",
  }),
});
```

这个函数支持返回 `Promise`，所以异步取 token 也没问题。

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
  onSummary(payload) {
    console.log(payload.summaries);
  },
});

console.log(result.floorId);
console.log(result.summaries);
console.log(result.finalState);
```

`respondStream()` 内部已经处理好 SSE 解析，你只管写回调就行。

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

现在这份快照还会额外返回：

- `presetVersion`
- `worldbookVersion`
- `regexProfileVersion`

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

兼容旧调用方时，也仍然可以继续传 `expectedUpdatedAt`，但新的接入应优先使用 `expectedVersion`。

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

// 读取记忆
const memories = await client.memories.list({
  accountId: "account-1",
  factKey: "relationship",
  scope: "chat",
  scopeId: "session-1",
  status: "active",
  type: "fact",
});

console.log(memories[0]?.factKey);
```

`factKey` 只承接 `type: "fact"` 的结构化键，`content` 仍然保留为展示和注入内容。

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

### Tool Calling

```ts
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

`listCallRecords()` 当前仍对应公开兼容查询面 `/tools/call-records`。在后端公开新的 `tool_execution_record` 查询路由前，SDK 不会提前发明新的 execution records 资源方法。

### MCP

```ts
const servers = await client.mcp.listServers({
  limit: 20,
  offset: 0,
});

const status = await client.mcp.getServerStatus({
  serverId: "mcp-1",
});

const tools = await client.mcp.listServerTools({
  serverId: "mcp-1",
});
```

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
- 逐行解析 `start` → `chunk` → `summary` → `done` 事件
- 遇到 `error` 事件时抛出 `TavernApiError`
- 保留 `error` 事件里的后端错误码，例如 `generation_timeout`、`commit_busy`、`generation_queue_timeout`
- 在 `done` 中保留 `branchId`、`generatedText`、`summaries`、`totalUsage`、`finalState`
- 流结束但没收到 `done` 时也会抛出错误

一般场景直接用 `client.sessions.respondStream()` 就够了。如果需要更底层的控制，可以自己调 `readSseStream()`。

需要注意的是，SSE 连接一旦已经建立，运行期错误通常不再切换 HTTP 状态码，因此这类 `TavernApiError` 的 `status` 常常仍是 `200`。接入方应同时看 `error.code`。

默认服务配置仍是单实例内存协调器，且 `queueMode` 为 `reject`。因此同一 `session + branch` 的并发请求通常直接返回 `generation_conflict`。只有服务端显式启用 `queue` 模式时，客户端才可能收到 `generation_queue_timeout`；即便如此，排队范围也只在当前进程内。

## 资源覆盖范围

目前 SDK 已经覆盖这些资源：

| 分类 | 资源 |
| ---- | ---- |
| 会话与内容结构 | `health`、`sessions`、`messages`、`floors`、`pages`、`branches` |
| 角色、资料与配置 | `characters`、`users`、`presets`、`presetEntries`、`worldbooks`、`worldbookEntries`、`regexProfiles` |
| 导入、导出与模型 | `imports`、`exports`、`llmProfiles`、`llmInstances` |
| 账号、变量与记忆 | `accounts`、`variables`、`memories`、`memoryEdges` |
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

已覆盖 Batch 1 到 Batch 4 的主要资源。`apps/web` 中可复用的请求逻辑已在逐步迁入。

后续如果后端继续扩展资源，按同样的方式在这里扩充就好，不需要在各个前端里重复写请求层。
