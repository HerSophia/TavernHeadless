---
outline: [2, 3]
---

# API 参考

TavernHeadless 后端提供 RESTful 风格的 HTTP API，返回 JSON。本节按资源分类，详细列出每个接口的路径、参数、请求体、响应体和错误码。

## 基础信息

| 项目 | 值 |
| ---- | -- |
| 基础 URL | `http://localhost:3000` |
| OpenAPI 版本 | 3.0.3 |
| API 版本 | `0.2.0-beta.2` |
| OpenAPI JSON | `GET /openapi.json` |
| Swagger UI | `GET /docs/` |
| 中文文档 | `GET /docs-zh` |
| 英文文档 | `GET /docs-en` |
| Health | `GET /health` |
| Version | `GET /version` |

## 认证

通过 `.env` 中的 `AUTH_MODE` 控制认证模式：

| 模式 | 说明 | 请求头 |
| ---- | ---- | ------ |
| `off` | 无认证（默认） | 无需携带 |
| `api_key` | API Key | `Authorization: Bearer <key>` 或 `x-api-key: <key>` |
| `jwt` | JWT | `Authorization: Bearer <token>` |

`api_key` 模式下，可在 `AUTH_API_KEYS` 中配置多个 key，逗号分隔。

`jwt` 模式下，需要设置 `AUTH_JWT_SECRET`。

多账号隔离时，`ACCOUNT_MODE=multi`，各资源自动按 `account_id` 隔离。

## 响应格式

### 成功响应

所有成功响应都包裹在 `data` 字段中：

```json
{
  "data": { }
}
```

列表接口额外包含 `meta` 字段：

```json
{
  "data": [ ],
  "meta": {
    "total": 42,
    "limit": 20,
    "offset": 0,
    "has_more": true,
    "sort_by": "created_at",
    "sort_order": "desc"
  }
}
```

### 错误响应

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Session not found"
  }
}
```

常见 HTTP 状态码：

| 状态码 | 含义 |
| ------ | ---- |
| `200` | 成功 |
| `201` | 创建成功 |
| `204` | 删除成功（无响应体） |
| `400` | 请求参数错误 |
| `401` | 未认证 |
| `403` | 权限不足 |
| `404` | 资源不存在 |
| `409` | 冲突（如重名、乐观锁失败） |
| `413` | 请求体过大 |
| `500` | 服务端错误 |
| `502` | 上游 LLM 服务错误 |
| `503` | 服务不可用（如 LLM Vault 未配置） |
| `504` | 上游生成超时 |

对于已经建立的 SSE 聊天流，运行期失败会通过 `event: error` 事件返回，而不是再切换 HTTP 状态码。此时应读取 `error.code`，例如 `generation_timeout`、`commit_busy`、`generation_queue_timeout`。

当前默认服务配置使用单实例内存协调器，且 `queueMode` 为 `reject`。因此同一 `session + branch` 的并发生成通常直接返回 `generation_conflict`。只有部署方显式启用 `queue` 模式时，才可能看到 `generation_queue_timeout`；即便如此，排队也只在当前进程内生效。

## 分页

所有列表接口支持以下查询参数：

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| `limit` | integer | `20` | 每页条数，最大 `100` |
| `offset` | integer | `0` | 偏移量 |
| `sort_order` | string | `desc` | 排序方向，`asc` 或 `desc` |
| `sort_by` | string | 因资源而异 | 排序字段，详见各资源文档 |

响应的 `meta` 字段中，`has_more` 指示后续是否还有更多数据。

## 时间戳

所有时间戳字段均为 **Unix 毫秒时间戳**（integer），字段名通常为 `created_at`、`updated_at`。

## 资源版本与乐观锁

`preset`、`worldbook`、`regex profile` 这几类可编辑资源现在都会返回 `version` 字段。

- 列表接口会返回当前 `version`
- 详情接口会返回当前 `version`
- 更新成功响应也会返回新的 `version`

更新这些资源时，新的并发控制字段是 `expected_version`。

- 推荐新接入统一使用 `expected_version`
- 旧调用方仍可继续传 `expected_updated_at` 作为兼容令牌
- 当版本不匹配时，会返回 `409`，例如 `preset_conflict`、`worldbook_conflict`、`regex_profile_conflict`

聊天 dry-run 的 `prompt_snapshot` 与落库的 `prompt_snapshot` 记录也会保存 `preset_version`、`worldbook_version`、`regex_profile_version`，用于说明当轮生成实际冻结使用的资源版本。

## 资源目录

| 资源 | 说明 | 文档 |
| ---- | ---- | ---- |
| Sessions | 会话管理、时间线、分支 | [Sessions](./api/sessions) |
| Chat | 对话生成、SSE 流、Dry-run | [Chat](./api/chat) |
| Floors | 楼层管理、分支操作 | [Floors](./api/floors) |
| Pages | 消息页管理、激活切换 | [Pages](./api/pages) |
| Messages | 消息管理、批量操作 | [Messages](./api/messages) |
| Characters | 角色卡管理、版本控制 | [Characters](./api/characters) |
| Users | 用户卡管理 | [Users](./api/users) |
| Variables | 四级变量系统 | [Variables](./api/variables) |
| Memories | 记忆条目与边 | [Memories](./api/memories) |
| Imports | SillyTavern 兼容导入 | [Imports](./api/imports) |
| Exports | 资源导出（聊天、预设、世界书、正则、角色卡） | [Exports](./api/exports) |
| Presets | 预设管理、编辑器视图、条目级 CRUD | [Presets](./api/presets) |
| Worldbooks | 世界书管理 | [Worldbooks](./api/worldbooks) |
| Regex Profiles | 正则配置管理 | [Regex Profiles](./api/regex-profiles) |
| LLM Profiles | LLM 配置管理、模型发现与测试 | [LLM Profiles](./api/llm-profiles) |
| LLM Instances | LLM 实例配置 | [LLM Instances](./api/llm-instances) |
| Tools | 工具调用（定义/权限/调用记录） | [Tools](./api/tools) |
| MCP Servers | MCP 服务器管理（配置/连接/工具查询） | [MCP Servers](./api/mcp) |
| Accounts | 账号管理 | [Accounts](./api/accounts) |

## 官方集成层

如果需要在前端、桌面端或脚本中接入 TavernHeadless，建议优先使用官方集成层，而不是直接重复编写请求层和 SSE 处理逻辑。

当前官方集成层包含两个包：

- `@tavern/sdk`：负责 API 调用、默认请求头、统一错误和 SSE。
- `@tavern/client-helpers`：负责 usage、timeline、流式状态、变量快照整理和错误展示映射。

其中，`@tavern/sdk` 当前已经覆盖：

- 会话与内容结构：`sessions`、`messages`、`floors`、`pages`、`branches`
- 角色、资料与配置：`characters`、`users`、`presets`、`presetEntries`、`worldbooks`、`worldbookEntries`、`regexProfiles`
- 导入、导出与模型配置：`imports`、`exports`、`llmProfiles`、`llmInstances`
- 账号、变量与记忆：`accounts`、`variables`、`memories`、`memoryEdges`
- 工具与运行集成：`tools`、`mcp`

变量系统相关的接入现在建议直接使用：

- `client.variables.resolveContext(...)` 读取当前上下文可见变量快照
- `flattenVariableSnapshot(...)` 和 `sortVariableInspectorRows(...)` 整理 inspector 行数据

如果 API 路由、OpenAPI、SSE 事件或其他接入方可见语义发生变化，应同步检查官方包与文档，而不是只在某一个前端里做局部适配。

详细说明请参考：[官方集成层](/guide/integration-kit)
