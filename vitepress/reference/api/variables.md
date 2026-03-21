---
outline: [2, 3]
---

# Variables（变量）

变量系统提供四级作用域，用于在对话过程中存储和检索键值对。

## 作用域

| scope | 说明 |
| ----- | ---- |
| `global` | 全局变量 |
| `session` | 会话级变量 |
| `floor` | 楼层级变量 |
| `page` | 页级变量 |

优先级从高到低：`page` > `floor` > `session` > `global`。

## Variable 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 变量 ID |
| `scope` | string | 作用域 |
| `scope_id` | string | 作用域关联的资源 ID |
| `key` | string | 变量键名 |
| `value` | any | 变量值（任意 JSON） |
| `updated_at` | integer | 更新时间 |

## 设置变量（Upsert）

```http
PUT /variables
```

如果相同 scope + scope_id + key 的变量已存在则更新，否则创建。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `scope` | string | **是** | 作用域 |
| `scope_id` | string | **是** | 关联资源 ID |
| `key` | string | **是** | 键名 |
| `value` | any | **是** | 值 |

### 响应

- `200`：更新成功
- `201`：创建成功

返回 `{ "data": Variable }` 。

## 批量设置变量

```http
PUT /variables/batch
```

### 请求体

```json
{
  "items": [
    { "scope": "session", "scope_id": "sess_001", "key": "mood", "value": "happy" },
    { "scope": "session", "scope_id": "sess_001", "key": "score", "value": 42 }
  ]
}
```

- `items`：1-100 条，同一 scope + scope_id + key 组合不可重复

### 响应 `200`

```json
{
  "data": {
    "results": [
      { "index": 0, "action": "updated", "data": {} },
      { "index": 1, "action": "created", "data": {} }
    ],
    "meta": { "total": 2, "created": 1, "updated": 1 }
  }
}
```

## 查询变量

```http
GET /variables
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `scope` | string | 按作用域过滤 |
| `scope_id` | string | 按关联 ID 过滤 |
| `key` | string | 按键名过滤 |
| `sort_by` | string | `key`（默认）/ `updated_at` |

## 获取变量详情

```http
GET /variables/:id
```

## 删除变量

```http
DELETE /variables/:id
```

### 响应 `200`

```json
{ "data": { "id": "var_001", "deleted": true } }
```