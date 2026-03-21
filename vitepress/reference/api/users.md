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