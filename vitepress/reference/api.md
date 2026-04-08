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
| API 版本 | `0.2.0-beta.3` |
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

`AUTH_MODE=off` 只应用于本地开发。当前服务会在 `NODE_ENV=production && AUTH_MODE=off` 时直接拒绝启动。

`api_key` 模式下，可在 `AUTH_API_KEYS` 中配置多个 key，逗号分隔。若同时启用 `ACCOUNT_MODE=multi`，还必须配置 `AUTH_API_KEY_ACCOUNTS`，把每个 key 映射到具体账号。

`jwt` 模式下，需要设置 `AUTH_JWT_SECRET`。若同时启用 `ACCOUNT_MODE=multi`，JWT 还必须携带账号 claim，默认字段名为 `account_id`，也可以通过 `AUTH_JWT_ACCOUNT_CLAIM` 改名。

多账号隔离时，`ACCOUNT_MODE=multi`，各资源自动按账号隔离；该模式不能与 `AUTH_MODE=off` 一起使用。

以下 public path 始终按匿名请求处理，不会继承管理员上下文：

- `GET /health`
- `GET /version`
- `GET /openapi.json`
- `GET /docs`
- `GET /docs/*`

认证后的授权真相来源是数据库中的账号行：

- `accounts.role` 决定管理员能力
- `accounts.status` 决定账号是否可用
- JWT 的 `role` claim 不直接授予管理员权限

WebSocket 也遵循相同边界：

- `/ws?session_id=...` 会在握手期校验 session ownership
- 不带 `session_id` 的全局订阅仅允许数据库 `role=admin` 的账号建立

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
    "limit": 50,
    "offset": 0,
    "has_more": true,
    "sort_by": "created_at",
    "sort_order": "desc"
  }
}
```

除非某一页另有说明，接口传输的 JSON 字段名统一使用 `snake_case`。官方 SDK 在少数高层接口中会提供 `camelCase` 映射，但原始 REST 响应、OpenAPI 和本文档都以 `snake_case` 为准。

### 错误响应

```json
{
  "error": {
    "code": "not_found",
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
| `401` | 未认证，或认证后的账号不存在 |
| `403` | 账号被禁用，或缺少系统级能力 |
| `404` | 资源不存在，或资源存在但不属于当前账号 |
| `409` | 冲突（如账号内重名、乐观锁失败） |
| `410` | 资源逻辑上已删除 |
| `413` | 请求体过大 |
| `500` | 服务端错误 |
| `502` | 上游 LLM 服务错误 |
| `503` | 服务不可用或暂时繁忙 |
| `504` | 上游生成超时 |

## 分页

大多数复用通用分页基类的列表接口支持以下查询参数：

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| `limit` | integer | `50` | 每页条数，最大 `100` |
| `offset` | integer | `0` | 偏移量 |
| `sort_order` | string | `desc` | 排序方向，`asc` 或 `desc` |
| `sort_by` | string | 因资源而异 | 排序字段，详见各资源文档 |

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
| Variables | 五级变量系统 | [Variables](./api/variables) |
| Memories | 记忆条目、边、后台任务与 scope 状态 | [Memories](./api/memories) |
| Imports | SillyTavern 兼容导入 | [Imports](./api/imports) |
| Exports | 资源导出 | [Exports](./api/exports) |
| Chat Transfer Jobs | 异步聊天导入导出作业观测、控制与产物下载 | [Chat Transfer Jobs](./api/chat-transfer-jobs) |
| Presets | 预设管理、编辑器视图、条目级 CRUD | [Presets](./api/presets) |
| Worldbooks | 世界书管理 | [Worldbooks](./api/worldbooks) |
| Regex Profiles | 正则配置管理 | [Regex Profiles](./api/regex-profiles) |
| LLM Profiles | LLM 配置管理、模型发现与测试 | [LLM Profiles](./api/llm-profiles) |
| LLM Instances | LLM 实例配置 | [LLM Instances](./api/llm-instances) |
| Tools | 工具定义、execution journal、调用记录与会话权限 | [Tools](./api/tools) |
| MCP Servers | MCP 服务器管理 | [MCP Servers](./api/mcp) |
| Accounts | 账号管理 | [Accounts](./api/accounts) |
| Client Data | 客户端专属数据域、导入导出、授权与审计 | [Client Data](./api/client-data) |

## 高级 API 资源

下面这些资源主要面向开发调试、运维排障、自动化脚本和平台集成，不属于普通聊天主流程接口：

- [Memory Jobs](./api/memory-jobs)
- [Chat Transfer Jobs](./api/chat-transfer-jobs)
- [Tools](./api/tools)
- [MCP Servers](./api/mcp)
- [Client Data](./api/client-data)

其中 `Client Data` 是一个独立的高级系统功能。它用于：

- 按 `application` 或 `plugin` 拥有者隔离存储客户端专属数据
- 为插件 owner 建立细粒度 grant 权限
- 提供治理动作审计日志
- 支持导入、导出、恢复、配额与并发控制

如果接入方只需要普通聊天能力，不需要优先接入这组资源。

## 官方集成层

如果需要在前端、桌面端或脚本中接入 TavernHeadless，建议优先使用官方集成层，而不是直接重复编写请求层和 SSE 处理逻辑。

当前官方集成层包含两个包：

- `@tavern/sdk`：负责 API 调用、默认请求头、统一错误和 SSE
- `@tavern/client-helpers`：负责 usage、timeline、流式状态、变量快照整理和错误展示映射

详细说明请参考：[官方集成层](/guide/integration-kit)
