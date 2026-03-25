# @tavern/sdk

TavernHeadless Official Integration Kit 的基础层。

这个包面向接入方，负责把后端 HTTP API、SSE 事件流、错误对象和资源访问整理成稳定的第一方调用面。

## 这个包的定位

TavernHeadless 当前只保留两个官方公开接入包：

- `@tavern/sdk`
- `@tavern/client-helpers`

其中：

- `@tavern/sdk` 负责请求、SSE、错误和资源访问。
- `@tavern/client-helpers` 负责与框架无关的语义整理。
- `@tavern/shared` 仍然是内部包，不是公开接入面的一部分。

## 这个包负责什么

- 创建统一客户端：`createTavernClient(...)`
- 处理基础 transport 和默认请求头
- 保留底层类型化请求能力
- 统一 HTTP 错误对象
- 统一 SSE 读取逻辑
- 按资源分组提供第一方方法

## 这个包不负责什么

- Vue / React / Pinia / Zustand / TanStack Query 绑定
- 组件、页面、hooks、composables
- 应用层状态管理
- 只适用于某一个前端界面的临时映射

## 当前资源范围

当前 `@tavern/sdk` 已覆盖这些资源。

### 会话与内容结构

- `health`
- `sessions`
- `messages`
- `floors`
- `pages`
- `branches`

### 角色、资料与配置

- `characters`
- `users`
- `presets`
- `presetEntries`
- `worldbooks`
- `worldbookEntries`
- `regexProfiles`

### 导入、导出与模型配置

- `imports`
- `exports`
- `llmProfiles`
- `llmInstances`

### 账号、变量与记忆

- `accounts`
- `variables`
- `memories`
- `memoryEdges`

### 工具与运行集成

- `tools`
- `mcp`

## 当前基础能力

除了资源方法，这个包还提供：

- `TavernApiError`
- `isTavernApiError(...)`
- `readSseStream(...)`
- usage 归一化相关工具
- OpenAPI 类型导出
- 保留底层 `ApiClient` 方法：
  - `request(...)`
  - `get(...)`
  - `post(...)`
  - `put(...)`
  - `patch(...)`
  - `delete(...)`

## 安装与依赖

当前仓库内使用方式：

```json
{
  "dependencies": {
    "@tavern/sdk": "workspace:*"
  }
}
```

## 基本用法

### 创建客户端

```ts
import { createTavernClient } from "@tavern/sdk";

const client = createTavernClient({
  baseUrl: "http://localhost:3000",
});
```

### 注入默认请求头

```ts
import { createTavernClient } from "@tavern/sdk";

const client = createTavernClient({
  baseUrl: "http://localhost:3000",
  getHeaders: () => ({
    authorization: "Bearer <token>",
    "x-account-id": "account-1",
  }),
});
```

### 保留底层请求能力

```ts
const rawHealth = await client.get("/health");
const rawSession = await client.request("GET", "/sessions/{id}", {
  params: {
    path: {
      id: "session-1",
    },
  },
});
```

## 资源调用示例

### 读取会话并生成一次回复

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

console.log(sessions.length);
console.log(result.generatedText);
console.log(result.totalTokens);
```

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
```

### 变量与记忆

```ts
await client.variables.upsert({
  accountId: "account-1",
  key: "mood",
  scope: "chat",
  scopeId: "session-1",
  value: { score: 20 },
});

const memories = await client.memories.list({
  accountId: "account-1",
  scope: "chat",
  scopeId: "session-1",
  status: "active",
});

console.log(memories.length);
```

### 页面、分支与条目资源

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

console.log(pages.length);
console.log(presetEntries.entries.length);
console.log(worldbookEntries.length);
```

### 导出资源

`exports` 资源直接返回原始 `Response`，以保留后端导出行为。

```ts
const response = await client.exports.chat({
  accountId: "account-1",
  sessionId: "session-1",
  format: "thchat",
});

console.log(response.status);
console.log(response.headers.get("content-disposition"));
```

### Tool Calling 相关资源

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

console.log(builtinTools.length);
console.log(definitions.meta.total);
console.log(records.records.length);
```

### MCP 相关资源

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

console.log(servers.meta.total);
console.log(status.state);
console.log(tools.length);
```

## 错误处理

HTTP 非 2xx 响应会归一化为 `TavernApiError`。

```ts
import { isTavernApiError } from "@tavern/sdk";

try {
  await client.sessions.getDetail({
    sessionId: "missing",
  });
} catch (error) {
  if (isTavernApiError(error)) {
    console.log(error.status);
    console.log(error.code);
    console.log(error.message);
  }
}
```

## SSE 能力

对于 `respond/stream` 这类接口，SDK 已经负责：

- 发起 `text/event-stream` 请求
- 解析 `start` / `chunk` / `summary` / `error` / `done`
- 在缺少最终 `done` 事件时抛出一致错误

如果只关心业务结果，直接使用 `client.sessions.respondStream()` 即可。

如果需要更底层的流解析，也可以直接使用 `readSseStream()`。

## 与 `@tavern/client-helpers` 的关系

- `@tavern/sdk` 负责 API 调用
- `@tavern/client-helpers` 负责语义整理

建议顺序：

1. 先用 `@tavern/sdk` 获取或写入数据
2. 再用 `@tavern/client-helpers` 整理时间线、流式状态和错误展示状态
3. 最后在应用层接入 store、组件和页面逻辑

## 设计边界

适合放进本包的内容：

- 资源调用
- Header 注入
- 错误对象
- SSE 事件解析
- API 输入输出映射
- 保留后端语义的轻量资源包装

不适合放进本包的内容：

- timeline 视图构建
- active page 选择
- store 操作
- UI 状态机
- Vue / React hooks
- 应用层缓存策略

## 与后端变更的关系

这个包是第一方官方接入层，不是随意堆放工具函数的目录。

当后端路由、SSE 事件、OpenAPI 契约、资源返回形态、Tool Calling、MCP、导入导出行为发生变化时，应优先检查 `@tavern/sdk` 是否需要同步更新。

如果这些变化已经影响到接入方可见的行为，就应同时更新：

- `@tavern/sdk` 实现
- `@tavern/sdk` 文档
- 外部接入文档

不能只改后端或只改 `apps/web` 的局部适配，而让官方包继续停留在旧语义上。

## 版本兼容

当前建议按下面的关系理解兼容范围：

| 后端 API | `@tavern/sdk` |
| ---- | ---- |
| `v0.2.x-beta` | `0.1.x` |

OpenAPI 生成仍然沿用仓库根目录工作流：

- `pnpm sdk:generate`
- `pnpm sdk:check`

## 当前状态

当前包已经覆盖 Batch 1 到 Batch 4 的主要第一方资源接入面。

`apps/web` 已经开始把可复用的请求逻辑迁入这个包。后续如果后端继续扩展资源，仍按同样原则扩充，而不是在各个前端中重复写一套新的请求层。
