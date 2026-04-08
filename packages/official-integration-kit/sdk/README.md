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

另外需要注意：

- `AUTH_MODE=off` 只应用于本地开发；服务端会在 `NODE_ENV=production && AUTH_MODE=off` 时直接拒绝启动
- `/health`、`/version`、`/openapi.json`、`/docs`、`/docs/*` 这些 public path 始终按匿名请求处理，不会继承管理员上下文

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

### 客户端专属数据域

```ts
const domain = await client.clientData.domains.create({
  accountId: "account-1",
  ownerType: "application",
  ownerId: "my-app",
  domainName: "preferences",
  displayName: "Preferences",
});

const item = await client.clientData.items.upsert({
  accountId: "account-1",
  domainId: domain.id,
  collectionName: "settings",
  itemKey: "theme",
  valueJson: { mode: "dark" },
});

const exported = await client.clientData.domains.export({
  accountId: "account-1",
  domainId: domain.id,
});

console.log(item.item.version);
console.log(exported.collections[0]?.items[0]?.valueJson);
```

`clientData` 资源当前覆盖：

- `clientData.domains.create`
- `clientData.domains.list`
- `clientData.domains.getDetail`
- `clientData.domains.update`
- `clientData.domains.remove`
- `clientData.domains.removeByOwner`
- `clientData.domains.export`
- `clientData.collections.create`
- `clientData.collections.list`
- `clientData.collections.getDetail`
- `clientData.collections.update`
- `clientData.collections.remove`
- `clientData.items.list`
- `clientData.items.getDetail`
- `clientData.items.upsert`
- `clientData.items.upsertBatch`
- `clientData.items.remove`
- `clientData.items.removeBatch`

请求协议仍与后端保持一致，使用 `snake_case`。SDK 返回值继续做 `camelCase` 映射。

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
console.log(result.memory);
console.log(result.totalTokens);
```

Chat 相关方法会保留后端返回的这些字段：

- `generatedText`
- `summaries`
- `finalState`
- `memory`

其中 `finalState === "committed"` 表示生成结果已经越过提交边界，相关持久化写入已经完成。

如果服务端在当前 turn 上启用了记忆持久化，`memory` 会额外说明记忆链路是同步完成还是已进入后台队列：

```ts
result.memory;
// { mode: "sync", status: "applied", jobId: null }
// 或
// { mode: "async", status: "queued", jobId: "memory-job:ingest_turn:floor-1" }
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
console.log(result.memory);
```

`respondStream()` 内部已经处理好 SSE 解析，你只管写回调就行。

除了 `start`、`chunk`、`summary`、`tool`、`done`、`error` 这些事件，流里现在还会带 `run` 事件。它表示当前楼层这一轮生成的运行快照，例如：

- 当前阶段 `phase`
- 当前展示阶段`publicPhase`
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
  debugOptions: {
    includeWorldbookMatches: true,
  },
