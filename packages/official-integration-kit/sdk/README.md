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

### Variables 的三个观察面

变量资源现在同时提供三组方法：

- `client.variables.upsert(...)` / `client.variables.list(...)` / `client.variables.getDetail(...)`
  - 对应显式 durable write / durable read
- `client.variables.resolveContext(...)`
  - 只返回 durable truth
  - 不会把 page staged write 和 promotion trace 混进去
- `client.variables.getPageStagedWrites(...)`
  - 读取某个 page 的 staged write ledger
- `client.variables.getPagePromotions(...)`
  - 读取某个 page 已发生的 durable promotion trace

```ts
const resolved = await client.variables.resolveContext({
  accountId: "account-1",
  sessionId: "session-1",
  branchId: "main",
  floorId: "floor-1",
  pageId: "page-1",
  includeLayers: true,
});

const staged = await client.variables.getPageStagedWrites({
  accountId: "account-1",
  pageId: "page-1",
});

const promotions = await client.variables.getPagePromotions({
  accountId: "account-1",
  pageId: "page-1",
});
```

### 客户端专属数据域

```ts
const domainOwner = { ownerType: "application", ownerId: "my-app" } as const;
const pluginOwner = { ownerType: "plugin", ownerId: "chat-annotator" } as const;

const domain = await client.clientData.domains.create({
  accountId: "account-1",
  ...domainOwner,
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

const grant = await client.clientData.grants.create({
  accountId: "account-1",
  callerOwner: domainOwner,
  domainId: domain.id,
  granteeOwnerType: pluginOwner.ownerType,
  granteeOwnerId: pluginOwner.ownerId,
  canRead: true,
  canWrite: false,
  canDelete: false,
  canList: true,
});

const scopedItem = await client.clientData.items.getByKey({
  accountId: "account-1",
  callerOwner: pluginOwner,
  domainId: domain.id,
  collectionName: "settings",
  itemKey: "theme",
});

const auditLogs = await client.clientData.auditLogs.list({
  accountId: "account-1",
  callerOwner: domainOwner,
  domainId: domain.id,
  limit: 20,
});

const exported = await client.clientData.domains.export({
  accountId: "account-1",
  domainId: domain.id,
});

console.log(domain.version);
console.log(item.item.version);
console.log(grant.canRead);
console.log(scopedItem.valueJson);
console.log(auditLogs.data[0]?.action);
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
- `clientData.grants.list`
- `clientData.grants.create`
- `clientData.grants.update`
- `clientData.grants.remove`
- `clientData.auditLogs.list`

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

第二期 grant 模型要求接入方在需要插件级隔离时显式传递 caller owner。

更稳妥的做法，是在每个 domain-scoped `clientData` 调用上直接传 `callerOwner`：

```ts
const pluginOwner = { ownerType: "plugin", ownerId: "chat-annotator" } as const;

await client.clientData.items.getByKey({
  accountId: "account-1",
  domainId: "domain-1",
  callerOwner: pluginOwner,
  collectionName: "settings",
  itemKey: "theme.dark",
});
```

如果整个客户端都固定代表同一个 owner，也可以在默认请求头中加入：

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

- SDK 的 `callerOwner` 参数会为单次请求补齐 `X-Client-Owner-Type` 和 `X-Client-Owner-Id`
- 未传 caller owner 时，服务端保持第一期兼容行为，继续按 `account_id + domain_id` 控制
- 传了非法 caller owner 头时，服务端会返回 `400 client_data_caller_owner_invalid`
- grant / audit 管理接口要求 caller owner 必须是 domain owner；否则返回 `403 client_data_domain_grant_manage_forbidden`
- 如果服务端把某个 domain 标记为 managed domain，raw client-data 写路径会返回 `403 client_data_managed_domain_raw_access_forbidden`；这时需要改走对应的受治理服务，而不是继续调用 raw `clientData` 资源

### 使用公开的 Session State

`client.sessionState` 对应公开的 `/sessions/:sessionId/state/*` 接口，不对应内部 observation 面。

当前已经覆盖：

- `sessionState.registerNamespace`
- `sessionState.listNamespaces`
- `sessionState.writeValue`
- `sessionState.deleteValue`
- `sessionState.resolve`
- `sessionState.getFloorSnapshots`
- `sessionState.diff`

```ts
const registeredNamespace = await client.sessionState.registerNamespace({
  accountId: "account-1",
  sessionId: "session-1",
  namespace: "quest_flags",
  logicalOwnerType: "plugin",
  logicalOwnerId: "quest-plugin",
});

const written = await client.sessionState.writeValue({
  accountId: "account-1",
  sessionId: "session-1",
  branchId: "main",
  namespace: "quest_flags",
  slot: "companion",
  value: { mood: "ally" },
});

const deleted = await client.sessionState.deleteValue({
  accountId: "account-1",
  sessionId: "session-1",
  branchId: "main",
  namespace: "quest_flags",
  slot: "companion",
});

const definitions = await client.sessionState.listNamespaces({
  accountId: "account-1",
  sessionId: "session-1",
});

const values = await client.sessionState.resolve({
  accountId: "account-1",
  sessionId: "session-1",
  branchId: "main",
  namespace: "game_state",
});

console.log(registeredNamespace.defaultSlotTemplate.defaultWriteMode);
console.log(definitions[0]?.slots.map((slot) => slot.slot));
console.log(written.present, written.value);
console.log(deleted.present, deleted.value);
console.log(values[0]?.source, values[0]?.value);
```

说明：

- `registerNamespace(...)` 是 control-plane write，只负责注册 custom namespace，不负责写入具体 state value
- `writeValue(...)` 与 `deleteValue(...)` 是 public Session State 写接口，当前只允许 registered custom namespace
- turn API 现在也支持 `sessionStateWrites`，对应 turn-embedded `commit_bound` 写入：
  - `sessions.respond(...)`
  - `sessions.respondStream(...)`
  - `sessions.regenerate(...)`
  - `floors.retry(...)`
  - `messages.editAndRegenerate(...)`
- `listNamespaces(...)` 现在会同时返回公开稳定的 built-in namespace，以及当前 session 下已注册的 custom namespace
- custom slot 在首次成功 `writeValue(...)` 或首次成功 turn-bound commit 后会进入 discovery，并作为 materialized synthetic slot definition 返回
- 当前公开稳定的 built-in slot 只有 `game_state.scene` 与 `game_state.world`
- `game_state` 仍然对客户端只读；public `deleteValue(...)` 与 turn 内 `delete: true` 的治理语义都是把值写成 `present: false`
- turn-embedded `sessionStateWrites` 不会新增独立 stage API，也不接受客户端自带 `branchId` / `sourceFloorId` / `writeMode` / `replaySafety`
- `registerNamespace(...)` 当前遵循已经冻结的 identity contract：
  - `namespace` 与 `logicalOwnerType` 必须使用小写稳定标识，可带点分段
  - `logicalOwnerId` 必须使用小写稳定 id，允许字符 `a-z0-9._:@/-`
  - `game_state` 与 `game_state.*` 这类 built-in namespace / prefix 仍然保留，不能注册为 custom namespace
  - 服务端只会先做 `trim()`，不会自动转小写
- `listNamespaces(...)`、`resolve(...)`、`getFloorSnapshots(...)`、`diff(...)` 当前都不提供 `limit` / `offset` 分页；服务端会直接返回当前过滤条件命中的完整结果
- `listNamespaces(...)` 返回的 `sizeBudgetBytes` 就是 slot 当前有效的 payload budget。custom namespace 默认继承当前部署的 Client Data item size limit；built-in slot 使用各自固定预算
- Session State 的规模限制来自底层 managed storage。触发时，SDK 会抛出 `TavernApiError`，常见 `error.code` 包括：
  - `validation_error`
  - `session_state_namespace_count_limit_exceeded`、`session_state_namespace_item_limit_exceeded`、`session_state_namespace_byte_limit_exceeded`
  - `session_state_account_item_limit_exceeded`、`session_state_account_byte_limit_exceeded`
  - `session_state_payload_too_large`
- 当前实现里，如果部署关闭了 `enableClientData`：
  - `/sessions/:sessionId/state/*` 这组 public route family 默认不会注册，外部通常直接看到 `404`
  - turn API 如果携带了 `sessionStateWrites`，会返回 `503 feature_unavailable`

### 内部 observation 面仍不在 SDK 包装范围内

`/sessions/:id/session-state/*` 与 `/floors/:id/session-state/*` 仍然是内部观察面。它们不会进入 `@tavern/sdk` 和 `@tavern/client-helpers`。如果确实需要对接，请基于 OpenAPI 自行封装，并接受该契约可能变化。

最小联调顺序见 [`vitepress/guide/session-state-client-checklist.md`](../../../vitepress/guide/session-state-client-checklist.md)。

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
  sessionStateWrites: [
    {
      namespace: "quest_flags",
      slot: "companion",
      value: { mood: "ally" },
    },
    {
      namespace: "quest_flags",
      slot: "expired_hint",
      delete: true,
    },
  ],
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

如果 live debug 返回了结构化记忆真相，`runtimeTrace.memory` 现在会继续保留 `runtimeMode`、`scopeResolution`、`selectedItems`、`tokenStats`、`proposalStatus`、`promotionStatus` 等字段，而不再只有 `summaryInjected`。

其中 `finalState === "committed"` 表示生成结果已经越过提交边界，相关持久化写入已经完成。

### 会话级工具目录与会话基础权限

工具相关接入目前分成两层：

- `client.sessions.getRuntimeToolCatalog(...)` 读取 **session 级** 运行时工具目录快照。
- `client.sessions.getToolPermissions(...)`、`putToolPermissions(...)`、`patchToolPermissions(...)` 读写 session 基础工具权限，对应 `metadata_json.tool_permissions`。

这两组能力都不直接表示未来 run / node / step overlay 的最终执行权限。

如果你需要看某个 MCP server 自己声明了哪些工具，可用 `client.mcp.listServerTools(...)`。
但它不等于某个 session 当前真正可见的运行时工具目录。

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
  sessionStateWrites: [
    {
      namespace: "quest_flags",
      slot: "companion",
      value: { mood: "ally" },
    },
    {
      namespace: "quest_flags",
      slot: "expired_hint",
      delete: true,
    },
  ],
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

如果你要把 custom namespace 的写入和当前 turn 一起提交，应优先使用 `sessionStateWrites`。
它会在生成成功后先 stage，再在 turn commit 成功时落地；读取仍走 `client.sessionState.resolve(...)` / `getFloorSnapshots(...)` / `diff(...)`。
`delete: true` 的治理语义与 `sessionState.deleteValue(...)` 一致，都是把值改成 `present: false`。

### 读取、治理和比较 Prompt Runtime

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
  budget: {
    maxInputTokens: 4096,
    reservedCompletionTokens: 1024,
  },
  sourceSelection: {
    history: { mode: "windowed", maxMessages: 24 },
    examples: { enabled: false },
  },
  delivery: null,
});

const branchPolicy = await client.promptRuntime.patchBranchPolicy({
  accountId: "account-1",
  sessionId: "session-1",
  branchId: "main",
  delivery: {
    noAssistant: true,
  },
});

const inspect = await client.promptRuntime.inspect({
  accountId: "account-1",
  sessionId: "session-1",
  message: "Please continue the campfire scene.",
  branchId: "alt-branch",
  sourceFloorId: "floor-12",
  generationParams: {
    maxOutputTokens: 256,
    temperature: 0.7,
  },
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

const diff = await client.promptRuntime.compare({
  accountId: "account-1",
  sessionId: "session-1",
  leftFloorId: "floor-11",
  rightFloorId: "floor-12",
});

const capabilities = await client.promptRuntime.getCapabilities();

console.log(state.assets.characterCard?.name);
console.log(policy.resolvedPolicy.structure.mode);
console.log(policy.persistentPolicyEnvelope?.version);
console.log(policy.persistentPolicyEnvelope?.updatedBy);
console.log(branchPolicy.persistentPolicyEnvelope?.value.delivery?.noAssistant);
console.log(preview.policy.budget);
console.log(preview.text);
console.log(preview.runtimeTrace.sourceSelection?.excludedSources);
console.log(preview.memory?.runtimeMode);
console.log(preview.memory?.scopeResolution);
console.log(inspect.preparedTurn.memorySummary);
console.log(inspect.preparedTurn.memory);
console.log(inspect.preparedTurn.messages);
console.log(inspect.preparedTurn.promptSnapshot?.promptDigest);
console.log(inspect.governance.entries);
console.log(preview.runtimeTrace.visibility?.filteredFloorNos);
console.log(preview.runtimeTrace.macro?.mutationPreview);
console.log(preview.runtimeTrace.macro?.stagedMutations); // []
console.log(explain.promptSnapshot?.promptDigest);
console.log(explain.snapshotAvailable);
console.log(explain.assets);
console.log(explain.sectionStats);
console.log(explain.governance); // 旧 snapshot 可能为 null
console.log(explain.memory); // 较旧 explain snapshot 行可能为 null
console.log(explain.resolvedPolicy); // 旧楼层 fallback 时可能为 null
console.log(diff.policyChanges);
console.log(diff.left.snapshotAvailable, diff.right.snapshotAvailable);
console.log(capabilities.observability.preview.enabled);
console.log(capabilities.observability.preview.mode); // "macro_text_preview"
console.log(capabilities.observability.preview.returnsAssemblyTruth); // false
console.log(capabilities.observability.preview.traceSubset); // ["macro", "source_selection", "visibility"]
console.log(capabilities.observability.explain.enabled);
console.log(capabilities.governance.session.envelopeMetadata);
console.log(capabilities.compare.committedFloorsOnly);
console.log(capabilities.unsupported);
```

`promptRuntime` 当前覆盖：

- `promptRuntime.compare(...)`
- `promptRuntime.getAssets(...)`
- `promptRuntime.getBranchPolicy(...)`
- `promptRuntime.getCapabilities(...)`
- `promptRuntime.inspect(...)`
- `promptRuntime.getFloorExplain(...)`
- `promptRuntime.getSession(...)`
- `promptRuntime.getPolicy(...)`
- `promptRuntime.patchBranchPolicy(...)`
- `promptRuntime.patchPolicy(...)`
- `promptRuntime.previewText(...)`

需要注意：

- 这是一组独立的高级 API 资源，不会创建第二条聊天执行链。
- `characterCard` 仍然属于 Prompt Assets。
- `patchPolicy(...)` 与 `patchBranchPolicy(...)` 现在都支持 `structure`、`delivery`、`budget`、`sourceSelection`、`visibility`。
- 读取侧继续兼容旧的 bare object metadata；写入侧统一升级为 envelope：`{ version, updatedAt, updatedBy, value }`。
- `previewText(...)` 正式契约是 `macro_text_preview` 子视图，对应 `capabilities.observability.preview.mode === "macro_text_preview"` 且 `returnsAssemblyTruth === false`。它不走 LLM、不创建 floor、不写 `promptSnapshot`、不提交副作用，也不会执行完整 prompt assembly、budget allocation 或 delivery materialization。
- `previewText(...)` 仍接受 request 级 `structure` / `delivery` / `budget` / `sourceSelection` / `visibility` 覆盖，但返回的 `runtimeTrace` 固定只投影 `capabilities.observability.preview.traceSubset`，即 `macro`、`sourceSelection`、`visibility`。resolved budget / policy 请查看 `policy` 与 `sourceMap`。
- `previewText(...)` 的宏诊断继续统一走 `runtimeTrace.macro`，并且 `runtimeTrace.macro.stagedMutations` 固定为空；结构化 budget trim reason 仍以 dry-run / live 为主。
- `previewText(...)` 响应的 `limitations` 会额外说明 preview 只是 `macro_text_preview` 子视图、不包含 assembly / delivery 真相，便于接入方在 UI 上提示用户 preview 不等于 live / dry-run 结果。
- `inspect(...)` 是只读 prepared-turn 检查接口。它会返回 `preparedTurn`、`policy`、`sourceMap`、`governance`、`diagnostics`、`trimReasons`、`excludedSources`、`sectionStats`，但不会调用模型，也不会创建 floor、写 `promptSnapshot`、写 explain snapshot，或者提交任何副作用。
- `previewText(...)` 现在会在顶层 `memory` 字段里返回结构化记忆真相；`runtimeTrace` 仍固定只保留 preview 子集，不会重复承载这部分信息。
- `inspect(...).preparedTurn.memorySummary` 继续保留兼容摘要字符串；`inspect(...).preparedTurn.memory` 和 `inspect(...).preparedTurn.runtimeTrace?.memory` 会返回同一套结构化记忆真相。
- `inspect(...).preparedTurn.sessionStateWrites` 只回显请求里的写入摘要，不代表这些写入已经 stage 或提交。若部署没有开启 client-data，而请求里带了 `sessionStateWrites`，服务端会返回 `503 feature_unavailable`。
- `getFloorExplain(...)` 只读取 committed floor 的持久化真相，不会重新组装 prompt、重新展开宏，也不会重新计算 budget / source selection。对应 `capabilities.observability.explain.persistedTruthOnly === true`。
- `getFloorExplain(...)` 现在会返回 `memory` 与 `governance`。新的 explain snapshot 写入版本是 `snapshotVersion = 3`；较旧的 `snapshotVersion = 1 | 2` 行仍然可读，但 `memory` 可能是 `null`，并且 `snapshotVersion = 1` 的 `governance` 仍会是 `null`。
- `getFloorExplain(...)` 的 `snapshotAvailable` 表示 explain 是否来自 committed explain snapshot。snapshot-backed 路径会返回持久化 limitations 声明，fallback 路径会在其基础上追加"旧 floor 字段可能为 null"的 fallback 限制条目；`assets`、`resolvedPolicy`、`trimReasons`、`excludedSources`、`sectionStats` 在 fallback 路径可能为 `null`，并会保留 `diagnostics` / `limitations`。
- `supportedSources` 与 `excludedSources[].source` 继续只承诺公开 source kind；具体 budget group 标签会出现在 `budgets.byGroup[].group`、`trimReasons[].group` 与 compare 的 `trimChanges` 中，例如 `section:main`。
- `sectionStats[].sectionName` 直接反映后端真实写入的 IR section 名称。记忆相关 section 在 `compat_plus` 与 `native` 装配路径下稳定命名为 `memory`；`compat` 路径下记忆以后置 `system` 消息形式注入，不产生 `memory` section，`sectionStats` 中也不会出现对应条目。
- `compare(...)` 只支持同一 session 内的两个 committed floor。返回值是结构化 path/value diff，不是全文级 diff；现在还会返回 `governanceChanges`。缺 snapshot 时会保留 `limitations`，而不是重算 explain。
- `delivery: null`、`structure: null`、`budget: null`、`sourceSelection: null`、`visibility: null` 都会清空对应持久化 section。
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

当前 `@tavern/sdk` 已经覆盖会话、内容结构、变量、记忆、Prompt Runtime 结构化 memory truth、导入、导出、LLM Profiles、LLM Instances、Tools、MCP、Client Data 等主要接入域。Client Data 第二期已补齐 grant / audit 之前的核心资源调用面，grant / audit 的高层 SDK 封装将在后续阶段继续扩展。
