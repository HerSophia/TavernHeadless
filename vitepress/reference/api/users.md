---
outline: [2, 3]
---

# Users（用户卡）

用户卡代表参与对话的用户角色。一个账号下面可以有多个用户卡，每个会话在创建时需要绑定一个用户卡。

## 什么时候需要看这页

- 你要创建新的用户卡
- 你要查看或修改已有用户卡
- 你要删除不再需要的用户卡

## 一个简单例子

```bash
# 创建一个用户卡
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{
    "snapshot": {
      "name": "Player",
      "description": "A brave adventurer."
    }
  }'

# 列出所有活跃用户卡
curl "http://localhost:3000/users?status=active"
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| snapshot | 用户卡的完整快照，包括名字和描述 |
| user | 这里指用户卡，不是账号 |



## User 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 用户卡 ID |
| `name` | string | 用户名称 |
| `status` | string | `active` / `disabled` / `deleted` |
| `snapshot` | object | 用户快照（name, description 等） |
| `revision` | integer | 用户资源版本号，用于并发写入 CAS |
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

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败 |
| `409` | `user_conflict` | 同账号下用户名称冲突 |
| `503` | `resource_busy` | SQLite `busy / locked` 重试耗尽 |

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
| `sort_by` | string | `updated_at`（默认）/ `created_at` / `name` |
| `sort_order` | string | `asc` / `desc` |
| `limit` | integer | 每页条数，默认 `50` |
| `offset` | integer | 偏移量，默认 `0` |

## 获取用户卡详情

```http
GET /users/:id
```

## 更新用户卡

```http
PATCH /users/:id
```

至少提供一个字段。可更新：`snapshot`、`status`。

可选字段：`expected_revision`。传入后，服务端会按 CAS 方式校验用户当前 revision；不匹配时返回 `user_revision_conflict`。

```json
{
  "expected_revision": 3,
  "status": "disabled"
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体为空或字段校验失败 |
| `404` | `not_found` | 用户不存在，或已处于 `deleted` 状态 |
| `409` | `user_revision_conflict` / `user_conflict` | `expected_revision` 过期，或同账号下用户名称冲突 |
| `503` | `resource_busy` | SQLite `busy / locked` 重试耗尽 |

## 软删除用户卡

```http
DELETE /users/:id
```

将用户卡状态设为 `deleted`。

可选请求体：`{ "expected_revision": 3 }`

### 响应 `200`

```json
{ "data": { "id": "usr_001", "deleted": true, "revision": 4 } }
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败 |
| `404` | `not_found` | 用户不存在，或已处于 `deleted` 状态 |
| `409` | `user_revision_conflict` | `expected_revision` 过期 |
| `503` | `resource_busy` | SQLite `busy / locked` 重试耗尽 |

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

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败、ids 为空或超过 100 条、存在重复 ID |
| `503` | `resource_busy` | SQLite `busy / locked` 重试耗尽 |

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

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败、ids 为空或超过 100 条、存在重复 ID |
| `503` | `resource_busy` | SQLite `busy / locked` 重试耗尽 |

## 并发错误码

| 错误码 | 说明 |
| ---- | ---- |
| `user_conflict` | 用户重名冲突 |
| `user_revision_conflict` | `expected_revision` 过期，或同一 revision 上的写入已被其他请求抢先提交 |
| `resource_busy` | SQLite `busy / locked` 重试耗尽 |
