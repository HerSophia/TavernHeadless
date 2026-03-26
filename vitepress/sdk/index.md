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

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `baseUrl` | `string` | 是 | 后端服务地址 |
| `fetchImpl` | `typeof fetch` | 否 | 自定义 fetch 实现，默认使用全局 `fetch` |
| `getHeaders` | `() => Record<string, string> \| undefined \| Promise<...>` | 否 | 每次请求前调用，返回要附加的请求头 |

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

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `path` | `Record<string, unknown>` | 否 | 路径参数 |
| `query` | `Record<string, unknown>` | 否 | 查询参数 |
| `body` | `object` | 否 | JSON 请求体 |
| `headers` | `Record<string, string>` | 否 | 附加请求头 |
| `signal` | `AbortSignal` | 否 | 中止信号 |

路径和请求体的类型基于 OpenAPI 定义推导，传入不存在的路径字符串会得到编译期错误。

### 返回值（通用）

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `body` | `T \| null` | 响应 JSON body（按 OpenAPI 类型推导） |
| `headers` | `Headers` | 响应头 |
| `raw` | `Response` | 原始 Response 对象 |
| `status` | `number` | HTTP 状态码 |

### fetchJson

非类型化的 JSON 请求。非 2xx 响应自动抛出 [`TavernApiError`](/sdk/errors)。

```ts
const res = await client.fetchJson<{ data: unknown }>("/sessions/s1", {
  method: "GET",
});
console.log(res.body, res.status);
```

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `pathname` | `string` | 是 | 请求路径（第一个参数） |
| `options.method` | `string` | 否 | HTTP 方法，默认 `GET`（有 body 时默认 `POST`） |
| `options.body` | `unknown` | 否 | JSON 请求体 |
| `options.headers` | `Record<string, string>` | 否 | 附加请求头 |
| `options.accept` | `string` | 否 | Accept 头 |
| `options.signal` | `AbortSignal` | 否 | 中止信号 |

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

| 属性 | 类型 | 参考文档 |
| ---- | ---- | ---- |
| `sessions` | `SessionsResource` | [Sessions](/reference/api/sessions)、[Chat](/reference/api/chat) |
| `floors` | `FloorsResource` | [Floors](/reference/api/floors) |
| `pages` | `PagesResource` | [Pages](/reference/api/pages) |
| `messages` | `MessagesResource` | [Messages](/reference/api/messages) |
| `characters` | `CharactersResource` | [Characters](/reference/api/characters) |
| `users` | `UsersResource` | [Users](/reference/api/users) |
| `accounts` | `AccountsResource` | [Accounts](/reference/api/accounts) |
| `variables` | `VariablesResource` | [Variables](/reference/api/variables) |
| `memories` | `MemoriesResource` | [Memories](/reference/api/memories) |
| `memoryEdges` | `MemoryEdgesResource` | [Memories](/reference/api/memories) |
| `imports` | `ImportsResource` | [Imports](/reference/api/imports) |
| `exports` | `ExportsResource` | [Exports](/reference/api/exports) |
| `presets` | `PresetsResource` | [Presets](/reference/api/presets) |
| `presetEntries` | `PresetEntriesResource` | [Presets](/reference/api/presets) |
| `worldbooks` | `WorldbooksResource` | [Worldbooks](/reference/api/worldbooks) |
| `worldbookEntries` | `WorldbookEntriesResource` | [Worldbooks](/reference/api/worldbooks) |
| `regexProfiles` | `RegexProfilesResource` | [Regex Profiles](/reference/api/regex-profiles) |
| `llmProfiles` | `LlmProfilesResource` | [LLM Profiles](/reference/api/llm-profiles) |
| `llmInstances` | `LlmInstancesResource` | [LLM Instances](/reference/api/llm-instances) |
| `tools` | `ToolsResource` | [Tools](/reference/api/tools) |
| `mcp` | `McpResource` | [MCP Servers](/reference/api/mcp) |
| `branches` | `BranchesResource` | [Sessions](/reference/api/sessions) |
| `health` | `HealthResource` | [API 总览](/reference/api)、[见下方](#health) |

`sessions` 上同时挂载了 CRUD 方法和对话生成方法（`respond` / `respondStream` / `respondDryRun` / `regenerate`）。其中 `respond` / `respondStream` 会保留 `summaries` 和 `finalState`，`respondDryRun` 会返回对齐真实提交快照的 `promptSnapshot`。

`tools.listCallRecords()` 当前仍是兼容查询面，对应公开路由 `/tools/call-records`。在 API 对外公开新的 execution records 路由之前，SDK 不会提前新增新的 execution records 查询方法。

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

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `service` | `string \| null` | 服务状态 |
| `database` | `string \| null` | 数据库状态 |

> 对应 HTTP 端点：[GET /health](/reference/api#健康检查)

---

## 工具函数

SDK 还导出两个工具函数，用于手动构造请求时使用。

### buildAccountHeaders

根据账号 ID 构造 `x-account-id` 请求头。多账号模式下使用。

```ts
import { buildAccountHeaders} from "@tavern/sdk";

const headers = buildAccountHeaders("account-1");
// { "x-account-id": "account-1" }
```

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `accountId` | `string?` | 账号 ID，为空时返回 `undefined` |

### resolvePath

拼接 baseUrl 和路径。

```ts
import { resolvePath } from "@tavern/sdk";

const url = resolvePath("http://localhost:3000", "/sessions");
// "http://localhost:3000/sessions"
```

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `baseUrl` | `string` | 基础 URL |
| `pathname` | `string` | 路径 |

---

SDK 参考展示 TypeScript 调用方式；HTTP 层的 snake_case 字段名、完整的 JSON 请求体和响应体格式见 [API 参考](/reference/api)。
