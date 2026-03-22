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
| `scope` | string | **是** | 作用域：`global` / `session` / `floor` / `page` |
| `scope_id` | string | **是** | 关联资源 ID |
| `key` | string | **是** | 键名（至少 1 字符） |
| `value` | any | **是** | 值（任意 JSON，不可为 `undefined`） |

### 响应

- `200`：更新成功
- `201`：创建成功

返回 `{ "data": Variable }` 。

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败（scope 不合法、key 为空等） |

## 批量设置变量

```http
PUT /variables/batch
```

批量 upsert 变量。每个条目的语义与单条 `PUT /variables` 相同。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `items` | Variable[] | **是** | 变量数组，1-100 条 |

每个 `items` 元素的字段与单条 upsert 相同（`scope`、`scope_id`、`key`、`value`）。

::: warning 去重校验
同一批次内，`scope + scope_id + key` 组合不可重复，否则返回 `400`。
:::

### 请求示例

```json
{
  "items": [
    { "scope": "session", "scope_id": "sess_001", "key": "mood", "value": "happy" },
    { "scope": "session", "scope_id": "sess_001", "key": "score", "value": 42 }
  ]
}
```

### 响应 `200`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `data.results` | array | 每条的处理结果 |
| `data.results[].index` | integer | 对应请求数组中的下标 |
| `data.results[].action` | string | `created` 或 `updated` |
| `data.results[].data` | Variable | 完整的变量对象 |
| `data.meta.total` | integer | 总条数 |
| `data.meta.created` | integer | 新建条数 |
| `data.meta.updated` | integer | 更新条数 |

```json
{
  "data": {
    "results": [
      {
        "index": 0,
        "action": "updated",
        "data": {
          "id": "var_mood",
          "scope": "session",
          "scope_id": "sess_001",
          "key": "mood",
          "value": "happy",
          "updated_at": 1735689720000
        }
      },
      {
        "index": 1,
        "action": "created",
        "data": {
          "id": "var_score",
          "scope": "session",
          "scope_id": "sess_001",
          "key": "score",
          "value": 42,
          "updated_at": 1735689720000
        }
      }
    ],
    "meta": { "total": 2, "created": 1, "updated": 1 }
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败、items 为空或超过 100 条、存在重复的 scope+scope_id+key 组合 |

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

### 响应 `200`

返回 `{ "data": Variable[], "meta": ListMeta }` 。

## 获取变量详情

```http
GET /variables/:id
```

### 响应 `200`

返回 `{ "data": Variable }` 。

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 变量不存在 |

## 删除变量

```http
DELETE /variables/:id
```

### 响应 `200`

```json
{ "data": { "id": "var_001", "deleted": true } }
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 变量不存在 |