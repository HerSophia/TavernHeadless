---
outline: [2, 3]
---

# Users（用户卡）

用户卡代表参与对话的用户角色。一个账号可以有多个用户卡。

## User 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 用户卡 ID |
| `name` | string | 用户名称 |
| `status` | string | `active` / `deleted` |
| `snapshot` | object | 用户快照（name, description 等） |
| `created_at` | integer | 创建时间 |
| `updated_at` | integer | 更新时间 |

## 创建用户卡

```http
POST /users
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `snapshot` | object | **是** | 用户快照，必须包含 `name` |

```json
{
  "snapshot": {
    "name": "Player",
    "description": "A brave adventurer."
  }
}
```

### 响应 `201`

返回 `{ "data": User }` 。

## 列出用户卡

```http
GET /users
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `status` | string | 按状态过滤 |
| `include_deleted` | boolean | 是否包含已删除（默认 `false`） |
| `keyword` | string | 按名称搜索 |
| `sort_by` | string | `created_at`（默认）/ `updated_at` / `name` |

## 获取用户卡详情

```http
GET /users/:id
```

## 更新用户卡

```http
PATCH /users/:id
```

至少提供一个字段。可更新：`snapshot`、`status`。

## 软删除用户卡

```http
DELETE /users/:id
```

将用户卡状态设为 `deleted`。

### 响应 `200`

```json
{ "data": { "id": "usr_001", "deleted": true } }
```

## 批量更新用户状态

```http
PATCH /users/batch/status
```

批量更新用户卡状态。每次最多 100 条，不允许重复 ID。目标状态仅限 `active` 或 `disabled`。已删除（`status: deleted`）的用户卡视为 `not_found`。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `ids` | string[] | **是** | 用户卡 ID 数组，1-100 条，不允许重复 |
| `status` | string | **是** | 目标状态：`active` / `disabled` |

### 请求示例

```json
{
  "ids": ["usr_001", "usr_002", "usr_missing"],
  "status": "disabled"
}
```

### 响应 `200`

```json
{
  "data": {
    "results": [
      { "index": 0, "id": "usr_001", "action": "updated" },
      { "index": 1, "id": "usr_002", "action": "updated" },
      { "index": 2, "id": "usr_missing", "action": "not_found" }
    ],
    "meta": { "total": 3, "updated": 2, "not_found": 1, "status": "disabled" }
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败、ids 为空或超过 100 条、存在重复 ID |

## 批量删除用户

```http
POST /users/batch/delete
```

批量软删除用户卡（将状态设为 `deleted`）。每次最多 100 条，不允许重复 ID。已处于 `deleted` 状态的用户卡视为 `not_found`。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `ids` | string[] | **是** | 用户卡 ID 数组，1-100 条，不允许重复 |

### 请求示例

```json
{
  "ids": ["usr_001", "usr_missing"]
}
```

### 响应 `200`

```json
{
  "data": {
    "results": [
      { "index": 0, "id": "usr_001", "action": "deleted" },
      { "index": 1, "id": "usr_missing", "action": "not_found" }
    ],
    "meta": { "total": 2, "deleted": 1, "not_found": 1 }
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败、ids 为空或超过 100 条、存在重复 ID |
