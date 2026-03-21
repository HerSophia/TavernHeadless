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
| Presets | 预设管理、编辑器视图 | [Presets](./api/presets) |
| Worldbooks | 世界书管理 | [Worldbooks](./api/worldbooks) |
| Regex Profiles | 正则配置管理 | [Regex Profiles](./api/regex-profiles) |
| LLM Profiles | LLM 配置管理、模型发现与测试 | [LLM Profiles](./api/llm-profiles) |
| Accounts | 账号管理 | [Accounts](./api/accounts) |