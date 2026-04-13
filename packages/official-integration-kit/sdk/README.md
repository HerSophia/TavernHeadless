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

console.log(domain.version);
console.log(item.item.version);
console.log(exported.collections[0]?.items[0]?.valueJson);
```

`clientData` 资源当前覆盖：

- `clientData.domains.create`
- `clientData.domains.list`
- `clientData.domains.getDetail`
- `clientData.domains.update`
- `clientData.domains.updateQuota`
- `clientData.domains.restore`
- `clientData.domains.import`
- `clientData.domains.importAsNew`
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
- `clientData.items.getByKey`
- `clientData.items.upsert`
- `clientData.items.upsertBatch`
- `clientData.items.remove`
- `clientData.items.removeBatch`

请求协议仍与后端保持一致，使用 `snake_case`。SDK 返回值继续做 `camelCase` 映射。

#### Client Data 第二期新增能力

- domain / collection metadata `version`
- `ifVersion` 并发控制
- `restorableUntil`
- domain quota 更新
- deleted domain restore
- import into existing domain
- import as new domain
- conflict policy:
  - `fail`
  - `overwrite`
  - `skip`
- `items.getByKey(...)`
- `items.list(...)` 结构化过滤参数：
  - `itemKeyPrefix`
  - `updatedAfter`
  - `updatedBefore`
  - `expiresAfter`
  - `expiresBefore`
  - `expired`

#### caller owner 头

第二期 grant 模型要求接入方在需要插件级隔离时显式传递 caller owner：

```ts
const client = createTavernClient({
  baseUrl: "http://localhost:3000",
  getHeaders: () => ({
    authorization: "Bearer <token>",
    "x-client-owner-type": "plugin",
    "x-client-owner-id": "chat-annotator",
  }),
});
```

说明：

- 未传 caller owner 时，服务端保持第一期兼容行为，继续按 `account_id + domain_id` 控制
- 传了非法 caller owner 头时，服务端会返回 `400 client_data_caller_owner_invalid`
- grant / audit 管理接口要求 caller owner 必须是 domain owner；否则返回 `403 client_data_domain_grant_manage_forbidden`

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
  debugOptions: {
    includePromptSnapshot: true,
    includeRuntimeTrace: true,
    includeWorldbookMatches: false,
  },
});

console.log(result.generatedText);
console.log(result.summaries);
console.log(result.finalState);
console.log(result.memory);
console.log(result.totalTokens);
console.log(result.promptSnapshot);
console.log(result.runtimeTrace);
```

Chat 相关方法会保留后端返回的这些字段：

- `generatedText`
- `summaries`
- `finalState`
- `memory`
- `promptSnapshot`（按需）
- `runtimeTrace`（按需）

如果本轮 prompt 组装实际命中了宏系统，`runtimeTrace.macro` 会继续附带宏 warning、used names、mutation preview、staged mutations 和 trace。

其中 `finalState === "committed"` 表示生成结果已经越过提交边界，相关持久化写入已经完成。

如果服务端在当前 turn 上启用了记忆持久化，`memory` 会额外说明记忆链路是同步完成还是已进入后台队列：

```ts
result.memory;
// { mode: "sync", status: "applied", jobId: null }
// 或
// { mode: "async", status: "queued", jobId: "memory-job:ingest_turn:floor-1" }
```

### 记忆 scope 说明

`memories`、`memoryJobs`、`memoryScopes` 三组资源现在都接受四种记忆作用域：

- `global`
- `chat`
- `branch`
- `floor`

其中：

- 主聊天链默认把当前分支的记忆写入 `branch` scope。
- `chat` scope 只表示显式的 session 级共享记忆。
- `branch` scope 的 `scopeId` 不是单独的 `branchId`，而是 `JSON.stringify([sessionId, branchId])`。

```ts
const branchScopeId = JSON.stringify(["session-1", "main"]);
const branchMemories = await client.memories.list({ scope: "branch", scopeId: branchScopeId });
```

如果你需要看 live 实际发送时的 prompt 摘要与 runtime trace，可以在请求里显式打开：

- `debugOptions.includePromptSnapshot`
- `debugOptions.includeRuntimeTrace`

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
  debugOptions: {
    includePromptSnapshot: true,
    includeRuntimeTrace: true,
    includeWorldbookMatches: false,
  },
});

console.log(result.floorId);
console.log(result.summaries);
console.log(result.finalState);
console.log(result.memory);
console.log(result.promptSnapshot);
console.log(result.runtimeTrace);
```

`respondStream()` 内部已经处理好 SSE 解析，你只管写回调即可。

当打开 live debug 选项时，`promptSnapshot` 与 `runtimeTrace` 只会出现在最终 `done` 结果里，不会新增新的 SSE 事件类型。

其中 `runtimeTrace.macro` 与同步接口保持同一套结构，便于复用同一份调试面代码。

### 读取和更新 Prompt Runtime 默认策略

```ts
const state = await client.promptRuntime.getSession({
  accountId: "account-1",
  sessionId: "session-1",
});

const policy = await client.promptRuntime.patchPolicy({
  accountId: "account-1",
  sessionId: "session-1",
  structure: {
    mode: "strict_alternating",
    preserveSystemMessages: true,
  },
  delivery: null,
});

const preview = await client.promptRuntime.previewText({
  accountId: "account-1",
  sessionId: "session-1",
  branchId: "main",
  text: "{{setvar::资产.金币::3}}{{getvar::资产}}",
  budget: {
    maxInputTokens: 4096,
    reservedCompletionTokens: 1024,
  },
  sourceSelection: {
    history: { mode: "windowed", maxMessages: 24 },
    examples: { enabled: false },
  },
  visibility: {
    mode: "allow_all_except_hidden",
    hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
  },
});

const explain = await client.promptRuntime.getFloorExplain({
  accountId: "account-1",
  floorId: "floor-12",
});

const capabilities = await client.promptRuntime.getCapabilities();

console.log(state.assets.characterCard?.name);
console.log(policy.resolvedPolicy.structure.mode);
console.log(preview.text);
console.log(preview.runtimeTrace.budgets?.trimReasons);
console.log(preview.runtimeTrace.sourceSelection?.excludedSources);
console.log(preview.runtimeTrace.macro?.stagedMutations); // []
console.log(explain.promptSnapshot?.promptDigest);
console.log(explain.resolvedPolicy); // 历史楼层未持久化时可能为 null
console.log(capabilities.observability.preview.enabled);
console.log(capabilities.observability.explain.enabled);
console.log(capabilities.unsupported);
```

`promptRuntime` 当前覆盖：

- `promptRuntime.getAssets(...)`
- `promptRuntime.getBranchPolicy(...)`
- `promptRuntime.getCapabilities(...)`
- `promptRuntime.getFloorExplain(...)`
- `promptRuntime.getSession(...)`
- `promptRuntime.getPolicy(...)`
- `promptRuntime.patchBranchPolicy(...)`
- `promptRuntime.patchPolicy(...)`
- `promptRuntime.previewText(...)`

需要注意：

- 这是一组独立的高级 API 资源，不会创建第二条聊天执行链。
- `characterCard` 仍然属于 Prompt Assets。
- `patchPolicy(...)` 当前只允许写 `structure` 和 `delivery`。
- `patchBranchPolicy(...)` 当前同样只允许写 `structure` 和 `delivery`，并且只面向已物化 branch。
- `previewText(...)` 只做单段文本 preview，不走 LLM、不创建 floor、不写 `promptSnapshot`、不提交副作用。
- `previewText(...)` 当前支持 request 级 `budget` / `sourceSelection` 覆盖；结构化解释结果位于 `runtimeTrace.budgets.trimReasons` 与 `runtimeTrace.sourceSelection.excludedSources`。
- `previewText(...)` 的宏诊断继续统一走 `runtimeTrace.macro`，并且 `runtimeTrace.macro.stagedMutations` 固定为空。
- `getFloorExplain(...)` 只读取 committed floor 的持久化真相，不会重新组装 prompt、重新展开宏，也不会重新计算 budget / source selection。
- 历史楼层如果没有持久化 `resolvedPolicy`、`trimReasons`、`excludedSources`，SDK 会把它们映射为 `null`，并保留 `diagnostics` / `limitations` 说明原因。
- `delivery: null` 或 `structure: null` 会清空对应持久化 section。
- 当前没有 `promptRuntime.macros(...)` 之类的专用 control plane 方法；宏边界继续通过统一观测面公开。

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

当前 `@tavern/sdk` 已经覆盖会话、内容结构、变量、记忆、导入、导出、LLM Profiles、LLM Instances、Tools、MCP、Client Data 等主要接入域。Client Data 第二期已补齐 grant / audit 之前的核心资源调用面，grant / audit 的高层 SDK 封装将在后续阶段继续扩展。
