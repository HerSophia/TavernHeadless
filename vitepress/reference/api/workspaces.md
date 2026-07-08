---
outline: [2, 3]
---

# Workspaces（Workspace 管理）

Workspace 是账号下最外层的隔离与归属边界，所有 Project、Agent Type、资源都挂在某个 Workspace 下。每个账号有且仅有一个**默认 Workspace**（`kind = "default"`，由系统自动创建并托管），此外你可以创建任意多个**手动 Workspace**（`kind = "manual"`）用于分区管理。

这组接口负责 Workspace 自身的生命周期：列出、读取、创建、更新、归档、恢复。它不接管默认 Workspace 的解析逻辑，也不允许归档默认 Workspace。

## 什么时候需要看这页

- 你要为账号新建一个独立的 Workspace 来隔离一批 Project。
- 你要重命名 Workspace 或调整它的 `settings`。
- 你要归档一个不再使用的手动 Workspace，或把它恢复。

如果你只是想在 Workspace 下管理 Project、Agent Type，请分别看 [Projects](./projects) 和 [Agent Types](./agent-types)。

## 一个简单例子

```bash
curl -X POST http://localhost:3000/workspaces \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "增长团队",
    "settings": { "theme": "dark" }
  }'
```

成功后返回一个 `kind = "manual"`、`is_default = false` 的新 Workspace。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| `kind` | Workspace 类型：`default`（系统默认，每账号一个）或 `manual`（手动创建） |
| `is_default` | 是否为账号默认 Workspace。默认 Workspace 不能被归档 |
| `status` | 生命周期状态：`active` 或 `archived` |
| `settings` | 自由结构 JSON，作为 Workspace 级配置。写接口整体替换，不做字段级合并 |
| 归档 | 把 Workspace 标记为 `archived` 并记录 `archived_at`，默认从列表中隐藏，可随时恢复 |

## 响应格式说明

这组接口不使用通用的 `data` 包裹。列表接口返回 `{ "items": [...] }`，详情和写接口直接返回 Workspace 对象。

## 权限

这组接口只允许账号身份调用：

- 账号身份（account actor）：允许
- Client 身份（client actor）：`403 workspace_account_only`

写操作（创建 / 更新 / 归档 / 恢复）都会写入一条 `workspace.*` 运行治理审计日志，可在 [Operation Logs](./operation-logs) 中查询。`settings` 只以脱敏摘要形式记录，不落原文。

## Workspace 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Workspace ID。手动创建的形如 `ws_<random>` |
| `account_id` | string | 所属账号 |
| `name` | string | 显示名称，1 - 200 字符 |
| `kind` | string | `default` 或 `manual` |
| `is_default` | boolean | 是否为账号默认 Workspace |
| `status` | string | `active` 或 `archived` |
| `settings` | object | Workspace 级配置，自由结构 JSON |
| `archived_at` | integer \| null | 归档时间戳（ms）。未归档时为 `null` |
| `created_at` | integer | 创建时间戳（ms） |
| `updated_at` | integer | 更新时间戳（ms） |

## 列出 Workspace

```http
GET /workspaces
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `status` | string | 只返回指定状态：`active` 或 `archived`。指定后忽略默认过滤 |
| `include_archived` | boolean | 为 `true` 时同时返回已归档 Workspace。默认只返回 `active` |

### 响应 `200`

```json
{
  "items": [
    {
      "id": "ws_default_acc_1",
      "account_id": "acc_1",
      "name": "默认 Workspace",
      "kind": "default",
      "is_default": true,
      "status": "active",
      "settings": {},
      "archived_at": null,
      "created_at": 1735689600000,
      "updated_at": 1735689600000
    }
  ]
}
```

## 读取单个 Workspace

```http
GET /workspaces/:id
```

### 响应 `200`

直接返回 [Workspace](#workspace-对象) 对象。

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `404` | `workspace_not_found` | Workspace 不存在或不属于当前账号 |

## 创建 Workspace

```http
POST /workspaces
```

始终创建 `kind = "manual"`、`is_default = false` 的 Workspace。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | 是 | 显示名称，1 - 200 字符（首尾空白会被去除） |
| `settings` | object | 否 | Workspace 级配置。省略时为 `{}` |

### 响应 `201`

返回创建后的 [Workspace](#workspace-对象) 对象。

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `400` | `workspace_name_required` | `name` 为空 |
| `404` | `account_not_found` | 当前账号不存在 |

## 更新 Workspace

```http
PATCH /workspaces/:id
```

两个字段都是可选的，至少提供一个：

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | 否 | 新名称，1 - 200 字符 |
| `settings` | object \| null | 否 | 整体替换 `settings`。`null` 视为清空为 `{}` |

### 请求示例

```bash
curl -X PATCH http://localhost:3000/workspaces/ws_growth \
  -H 'Content-Type: application/json' \
  -d '{ "name": "增长团队 v2" }'
```

### 响应 `200`

返回更新后的 [Workspace](#workspace-对象) 对象。

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `400` | `workspace_update_empty` | `name` 和 `settings` 都未提供 |
| `400` | `workspace_name_required` | 提供了 `name` 但为空 |
| `404` | `workspace_not_found` | Workspace 不存在 |

## 归档与恢复

```http
POST /workspaces/:id/archive
POST /workspaces/:id/restore
```

两个接口都不需要请求体，成功时返回更新后的 Workspace 对象。

- 归档会把 `status` 置为 `archived` 并记录 `archived_at`。
- 恢复会把 `status` 置回 `active` 并清空 `archived_at`。
- 默认 Workspace（`is_default = true` 或 `kind = "default"`）不能归档。

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `409` | `workspace_default_immutable` | 试图归档默认 Workspace |
| `409` | `workspace_already_archived` | 归档一个已归档的 Workspace |
| `409` | `workspace_not_archived` | 恢复一个未归档的 Workspace |
| `404` | `workspace_not_found` | Workspace 不存在 |

## 错误码汇总

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `403` | `workspace_account_only` | Workspace 管理只允许账号身份 |
| `400` | `workspace_name_required` | `name` 为空 |
| `400` | `workspace_update_empty` | 更新时未提供任何字段 |
| `404` | `account_not_found` | 当前账号不存在 |
| `404` | `workspace_not_found` | Workspace 不存在 |
| `409` | `workspace_default_immutable` | 默认 Workspace 不能被归档 |
| `409` | `workspace_already_archived` | Workspace 已归档 |
| `409` | `workspace_not_archived` | Workspace 未归档 |

## 相关页面

- 路由族总览：[Workspace / Project](./workspace-project)
- Project 基础接口：[Projects](./projects)
- Workspace 级 Agent 模板：[Agent Types](./agent-types)
- 审计日志：[Operation Logs](./operation-logs)
