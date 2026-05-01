---
outline: [2, 3]
---

# SDK 总览

`@tavern/sdk` 的安装、初始化和底层方法。资源方法的 snake_case 协议字段和 HTTP 路由见 API 参考页面。

概念介绍和使用场景见 [官方集成层概览](/guide/integration-kit)。

## 安装

在 monorepo 中通过 workspace 协议引用：

```json
{
  "dependencies": {
    "@tavern/sdk": "workspace:*"
  }
}
```

版本对应：后端 `v0.2.x-beta` ↔ SDK `0.1.x` ↔ client-helpers `0.1.x`。

## createTavernClient

创建客户端实例。

```ts
import { createTavernClient } from "@tavern/sdk";

const client = createTavernClient({
  baseUrl: "http://localhost:3000",
});
```

### 参数 `TavernClientOptions`

| 字段         | 类型                                                        | 必填 | 说明                                    |
| ------------ | ----------------------------------------------------------- | ---- | --------------------------------------- |
| `baseUrl`    | `string`                                                    | 是   | 后端服务地址                            |
| `fetchImpl`  | `typeof fetch`                                              | 否   | 自定义 fetch 实现，默认使用全局 `fetch` |
| `getHeaders` | `() => Record<string, string> \| undefined \| Promise<...>` | 否   | 每次请求前调用，返回要附加的请求头      |

### 返回值 `TavernClient`

返回的 `client` 对象同时包含底层请求方法和全部资源属性。

---

## 底层请求方法

`TavernClient` 继承了类型安全的 HTTP 方法。通常直接使用资源方法即可，底层方法用于直接访问 HTTP 层。

### get

```ts
const res = await client.get("/sessions/{session_id}", {
  path: { session_id: "s1" },
});
console.log(res.body, res.status);
```

### post

```ts
const res = await client.post("/sessions", {
  body: { character_id: "char-1", user_id: "user-1" },
});
```

### put

```ts
const res = await client.put("/sessions/{session_id}", {
  path: { session_id: "s1" },
  body: { name: "新名称" },
});
```

### patch

```ts
const res = await client.patch("/sessions/{session_id}", {
  path: { session_id: "s1" },
  body: { name: "新名称" },
});
```

### delete

```ts
const res = await client.delete("/sessions/{session_id}", {
  path: { session_id: "s1" },
});
```

### request

通用请求方法，第一个参数为 HTTP 方法名。

```ts
const res = await client.request("get", "/health");
console.log(res.body);
```

### 参数（通用）

上述方法的 `options` 参数结构一致：

| 字段      | 类型                      | 必填 | 说明        |
| --------- | ------------------------- | ---- | ----------- |
| `path`    | `Record<string, unknown>` | 否   | 路径参数    |
| `query`   | `Record<string, unknown>` | 否   | 查询参数    |
| `body`    | `object`                  | 否   | JSON 请求体 |
| `headers` | `Record<string, string>`  | 否   | 附加请求头  |
| `signal`  | `AbortSignal`             | 否   | 中止信号    |

路径和请求体的类型基于 OpenAPI 定义推导，传入不存在的路径字符串会得到编译期错误。

### 返回值（通用）

| 字段      | 类型        | 说明                                  |
| --------- | ----------- | ------------------------------------- |
| `body`    | `T \| null` | 响应 JSON body（按 OpenAPI 类型推导） |
| `headers` | `Headers`   | 响应头                                |
| `raw`     | `Response`  | 原始 Response 对象                    |
| `status`  | `number`    | HTTP 状态码                           |

### fetchJson

非类型化的 JSON 请求。非 2xx 响应自动抛出 [`TavernApiError`](/sdk/errors)。

```ts
const res = await client.fetchJson<{ data: unknown }>("/sessions/s1", {
  method: "GET",
});
console.log(res.body, res.status);
```

| 字段              | 类型                     | 必填 | 说明                                           |
| ----------------- | ------------------------ | ---- | ---------------------------------------------- |
| `pathname`        | `string`                 | 是   | 请求路径（第一个参数）                         |
| `options.method`  | `string`                 | 否   | HTTP 方法，默认 `GET`（有 body 时默认 `POST`） |
| `options.body`    | `unknown`                | 否   | JSON 请求体                                    |
| `options.headers` | `Record<string, string>` | 否   | 附加请求头                                     |
| `options.accept`  | `string`                 | 否   | Accept 头                                      |
| `options.signal`  | `AbortSignal`            | 否   | 中止信号                                       |

返回 `TransportJsonResult<T>`，字段与上方通用返回值一致。

### fetchRaw

返回原始 `Response` 对象，不做 JSON 解析，不做错误检查。

```ts
const response = await client.fetchRaw("/exports/characters/char-1");
const blob = await response.blob();
```

参数与 `fetchJson` 一致。返回值为原始 `Response`。

---

## 资源一览

`client` 上的全部资源属性：

| 属性               | 类型                       | 参考文档                                                             |
| ------------------ | -------------------------- | -------------------------------------------------------------------- |
| `sessions`         | `SessionsResource`         | [Sessions](/reference/api/sessions)、[Chat](/reference/api/chat)     |
| `promptRuntime`    | `PromptRuntimeResource`    | [Prompt Runtime](/reference/api/prompt-runtime)                      |
| `floors`           | `FloorsResource`           | [Floors](/reference/api/floors)                                      |
| `pages`            | `PagesResource`            | [Pages](/reference/api/pages)                                        |
| `messages`         | `MessagesResource`         | [Messages](/reference/api/messages)                                  |
| `characters`       | `CharactersResource`       | [Characters](/reference/api/characters)                              |
| `users`            | `UsersResource`            | [Users](/reference/api/users)                                        |
| `accounts`         | `AccountsResource`         | [Accounts](/reference/api/accounts)                                  |
| `variables`        | `VariablesResource`        | [Variables](/reference/api/variables)                                |
| `memories`         | `MemoriesResource`         | [Memories](/reference/api/memories)                                  |
| `memoryEdges`      | `MemoryEdgesResource`      | [Memories](/reference/api/memories)                                  |
| `memoryJobs`       | `MemoryJobsResource`       | [记忆后台作业](/reference/api/memory-jobs)                           |
| `memoryScopes`     | `MemoryScopesResource`     | [Memories](/reference/api/memories)                                  |
| `imports`          | `ImportsResource`          | [Imports](/reference/api/imports)                                    |
| `exports`          | `ExportsResource`          | [Exports](/reference/api/exports)                                    |
| `chatTransferJobs` | `ChatTransferJobsResource` | [Exports](/reference/api/exports)、[Imports](/reference/api/imports) |
| `presets`          | `PresetsResource`          | [Presets](/reference/api/presets)                                    |
| `presetEntries`    | `PresetEntriesResource`    | [Presets](/reference/api/presets)                                    |
| `worldbooks`       | `WorldbooksResource`       | [Worldbooks](/reference/api/worldbooks)                              |
| `worldbookEntries` | `WorldbookEntriesResource` | [Worldbooks](/reference/api/worldbooks)                              |
| `regexProfiles`    | `RegexProfilesResource`    | [Regex Profiles](/reference/api/regex-profiles)                      |
| `llmProfiles`      | `LlmProfilesResource`      | [LLM Profiles](/reference/api/llm-profiles)                          |
| `llmInstances`     | `LlmInstancesResource`     | [LLM Instances](/reference/api/llm-instances)                        |
| `tools`            | `ToolsResource`            | [Tools](/reference/api/tools)                                        |
| `clientData`       | `ClientDataResource`       | [Client Data](/reference/api/client-data)                            |
| `sessionState`     | `SessionStateResource`     | [Session State](/reference/api/session-state)                        |
| `mcp`              | `McpResource`              | [MCP Servers](/reference/api/mcp)                                    |
| `branches`         | `BranchesResource`         | [Sessions](/reference/api/sessions)                                  |
| `health`           | `HealthResource`           | [API 总览](/reference/api)、[见下方](#health)                        |

`sessions` 上同时挂载了 CRUD 方法和对话生成方法（`respond` / `respondStream` / `respondDryRun` / `regenerate`）。其中 `respond` / `respondStream` 会保留 `summaries` 和 `finalState`，`respondDryRun` 会返回对齐真实提交快照的 `promptSnapshot`。如果你要把 registered custom namespace 的写入与 turn 一起提交，`respond` / `respondStream` / `regenerate` 现在都接受 `sessionStateWrites`。`sessions.create()` / `sessions.update()` 也会直接返回完整的 session payload。

`promptRuntime.previewText(...)`、`inspect(...)` 和 `getFloorExplain(...)` 现在还会返回结构化记忆真相：分别对应 `preview.memory`、`inspect.preparedTurn.memory`、`explain.memory`。兼容字符串 `memorySummary` 仍然保留，但它不再是唯一真相。对于较旧的 explain snapshot 行，`explain.memory` 可能是 `null`。

`tools.listExecutions()` 对应新的主执行审计路由；`tools.listCallRecords()` 仍保留为兼容查询面。`imports.chat()` 会按 `format` 区分 `.thchat` 与 `sillytavern_jsonl` 的返回结构，`imports.character()` 会保留 `characterVersionId` 和可选 `session`。

```ts
const session = await client.sessions.create({ title: "黎明前的酒馆", promptMode: "native" });
const imported = await client.imports.character({ payload: cardJson, createSession: false });
const executions = await client.tools.listExecutions({ sessionId: session?.id ?? "session-1" });

console.log(imported.characterVersionId);
console.log(executions.records[0]?.runtimeJobId);
```

---

## clientData

`client.clientData` 对应 raw `/client-data` 资源。

当前已经覆盖：

- domain / collection / item 读写
- domain 级 import / export / restore / quota update
- domain-scoped `callerOwner` 参数
- grants 管理：`list` / `create` / `update` / `remove`
- audit logs 查询：`list`

```ts
const domainOwner = { ownerType: "application", ownerId: "my-app" } as const;

const domain = await client.clientData.domains.create({
  accountId: "account-1",
  ...domainOwner,
  domainName: "preferences",
});

const auditLogs = await client.clientData.auditLogs.list({
  accountId: "account-1",
  callerOwner: domainOwner,
  domainId: domain.id,
  limit: 20,
});

console.log(auditLogs.data[0]?.action);
```

如果服务端把某个 domain 标记为 managed domain，
raw `clientData` 写路径会返回 `403 client_data_managed_domain_raw_access_forbidden`。
这时应改走对应的受治理服务，而不是继续直接写 `clientData`。

---

## sessionState

`client.sessionState` 对应公开的 `/sessions/:sessionId/state/*` 接口，不对应内部 observation 面。

当前已经覆盖：

- `registerNamespace`
- `listNamespaces`
- `writeValue`
- `deleteValue`
- `resolve`
- `getFloorSnapshots`
- `diff`

```ts
const registeredNamespace = await client.sessionState.registerNamespace({
  sessionId: "session-1",
  namespace: "quest_flags",
  logicalOwnerType: "plugin",
  logicalOwnerId: "quest-plugin",
});
const written = await client.sessionState.writeValue({
  sessionId: "session-1",
  branchId: "main",
  namespace: "quest_flags",
  slot: "companion",
  value: { mood: "ally" },
});
const deleted = await client.sessionState.deleteValue({
  sessionId: "session-1",
  branchId: "main",
  namespace: "quest_flags",
  slot: "companion",
});
const definitions = await client.sessionState.listNamespaces({ sessionId: "session-1" });
const values = await client.sessionState.resolve({ sessionId: "session-1", branchId: "main", namespace: "game_state" });
const snapshots = await client.sessionState.getFloorSnapshots({ sessionId: "session-1", floorId: "floor-1", namespace: "game_state" });
const diff = await client.sessionState.diff({
  sessionId: "session-1",
  floorId: "floor-1",
  against: { kind: "live", branchId: "main" },
  namespace: "game_state",
});

console.log(registeredNamespace.defaultSlotTemplate.defaultWriteMode);
console.log(definitions[0]?.slots[0]?.slot);
console.log(written.present, written.value);
console.log(deleted.present, deleted.value);
console.log(values[0]?.source);
console.log(snapshots[0]?.committedAt);
console.log(diff[0]?.changeType);
```

说明：

- `registerNamespace(...)` 是 control-plane write，只负责注册 custom namespace，不负责写具体 state value
- `writeValue(...)` 与 `deleteValue(...)` 是 public Session State 写接口，当前只允许 registered custom namespace
- turn API 现在也支持 `sessionStateWrites`，对应 turn-embedded `commit_bound` 写入：
  - `client.sessions.respond(...)`
  - `client.sessions.respondStream(...)`
  - `client.sessions.regenerate(...)`
  - `client.floors.retry(...)`
  - `client.messages.editAndRegenerate(...)`
- `listNamespaces(...)` 会同时返回公开稳定的 built-in namespace 与当前 session 下已注册的 custom namespace
- custom slot 在首次成功 `writeValue(...)` 或首次成功 turn-bound commit 后会被 materialize，并进入 `listNamespaces(...)`
- 当前公开稳定的 built-in slot 只有 `game_state.scene` 与 `game_state.world`
- `game_state` 仍然对客户端只读；`deleteValue(...)` 与 turn 内 `delete: true` 的治理语义都是把值改成 `present: false`
- `registerNamespace(...)` 当前遵循已经冻结的 identity contract：
  - `namespace` 与 `logicalOwnerType` 必须使用小写稳定标识，可带点分段
  - `logicalOwnerId` 必须使用小写稳定 id，允许字符 `a-z0-9._:@/-`
  - `game_state` 与 `game_state.*` 仍然是保留 built-in namespace / prefix，不能注册为 custom namespace
  - 服务端只会先做 `trim()`，不会自动转小写
- `listNamespaces(...)`、`resolve(...)`、`getFloorSnapshots(...)`、`diff(...)` 当前都不提供 `limit` / `offset` 分页；服务端会直接返回当前过滤条件命中的完整结果
- `listNamespaces(...)` 返回的 `sizeBudgetBytes` 就是 slot 当前有效的 payload budget。custom namespace 默认继承当前部署的 Client Data item size limit；built-in slot 使用各自固定预算
- Session State 的规模限制来自底层 managed storage。触发时，SDK 会抛出 `TavernApiError`。常见 `error.code` 包括：
  - `validation_error`
  - `session_state_namespace_count_limit_exceeded`、`session_state_namespace_item_limit_exceeded`、`session_state_namespace_byte_limit_exceeded`
  - `session_state_account_item_limit_exceeded`、`session_state_account_byte_limit_exceeded`
  - `session_state_payload_too_large`
- 内部 `/sessions/:id/session-state/*` 与 `/floors/:id/session-state/*` 观察面仍不在 SDK 包装范围内

---

## health

`client.health` 只有一个方法。

### get

获取服务和数据库健康状态。

```ts
const status = await client.health.get();
console.log(status.service, status.database);
```

#### 返回值 `HealthStatus`

| 字段       | 类型             | 说明       |
| ---------- | ---------------- | ---------- |
| `service`  | `string \| null` | 服务状态   |
| `database` | `string \| null` | 数据库状态 |

> 对应 HTTP 端点：[GET /health](/reference/api#健康检查)

---

## 工具函数

SDK 还导出两个工具函数，用于手动构造请求时使用。

### buildAccountHeaders

根据账号 ID 构造旧的 `x-account-id` 兼容请求头。

这个头部不会单独完成认证，也不会直接切换账号。多账号身份必须来自已绑定账号的 API Key 或 JWT 账号 claim。SDK 各资源方法里的 `accountId` 参数，与这里构造的头部属于同一类兼容提示。

```ts
import { buildAccountHeaders } from "@tavern/sdk";

const headers = buildAccountHeaders("account-1");
// { "x-account-id": "account-1" }
```

| 参数        | 类型      | 说明                                         |
| ----------- | --------- | -------------------------------------------- |
| `accountId` | `string?` | 兼容用途的账号提示值；为空时返回 `undefined` |

### resolvePath

拼接 baseUrl 和路径。

```ts
import { resolvePath } from "@tavern/sdk";

const url = resolvePath("http://localhost:3000", "/sessions");
// "http://localhost:3000/sessions"
```

| 参数       | 类型     | 说明     |
| ---------- | -------- | -------- |
| `baseUrl`  | `string` | 基础 URL |
| `pathname` | `string` | 路径     |

---

SDK 参考展示 TypeScript 调用方式；HTTP 层的 snake_case 字段名、完整的 JSON 请求体和响应体格式见 [API 参考](/reference/api)。
