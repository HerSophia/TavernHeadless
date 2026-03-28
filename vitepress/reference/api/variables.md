---
outline: [2, 3]
---

# Variables（变量）

变量系统提供四级作用域，用于在对话过程中存储和检索键值对。

## 作用域

| scope | 说明 |
| ----- | ---- |
| `global` | 全局变量 |
| `chat` | 会话级变量 |
| `floor` | 楼层级变量 |
| `page` | 页级变量 |

优先级从高到低：`page` > `floor` > `chat` > `global`。

`global` 写入和解析时会把 `scope_id` 规范化为固定值 `global`。

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

如果相同 `account_id + scope + scope_id + key` 的变量已存在则更新，否则创建。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `scope` | string | **是** | 作用域：`global` / `chat` / `floor` / `page` |
| `scope_id` | string | **是** | 关联资源 ID |
| `key` | string | **是** | 键名（至少 1 字符） |
| `value` | any | **是** | 值（任意 JSON，不可为 `undefined`） |

### 响应

- `200`：更新成功
- `201`：创建成功

返回 `{ "data": Variable }`。

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败、上下文不一致、变量值不合法 |
| `404` | 目标宿主不存在，或当前账号不可访问 |
| `409` | 目标已锁定，例如写入已 `committed` 的 `floor` 或 `page` |

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
    { "scope": "chat", "scope_id": "sess_001", "key": "mood", "value": "happy" },
    { "scope": "chat", "scope_id": "sess_001", "key": "score", "value": 42 }
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

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败、items 为空或超过 100 条、存在重复的 `scope+scope_id+key` 组合 |
| `404` | 某个目标宿主不存在，或当前账号不可访问 |
| `409` | 某个目标已锁定，例如写入已 `committed` 的 `floor` 或 `page` |

## 查询变量

```http
GET /variables
```

### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| `scope` | string | - | 按作用域过滤 |
| `scope_id` | string | - | 按关联 ID 过滤 |
| `key` | string | - | 按键名过滤 |
| `limit` | integer | `100` | 返回条数上限 |
| `offset` | integer | `0` | 偏移量 |
| `sort_by` | string | `updated_at` | `updated_at` / `key` |
| `sort_order` | string | `desc` | `asc` / `desc` |

### 响应 `200`

返回 `{ "data": Variable[], "meta": ListMeta }`。

## 获取变量详情

```http
GET /variables/:id
```

### 响应 `200`

返回 `{ "data": Variable }`。

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 变量不存在，或当前账号不可访问 |

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
| `404` | 变量不存在，或当前账号不可访问 |
| `409` | 目标已锁定，例如删除已 `committed` 的 `floor` 或 `page` 变量 |

## 解析当前上下文可见变量

```http
GET /variables/resolve
```

这个接口返回当前 `session / floor / page` 上下文里最终可见的变量快照。

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `session_id` | string | **是** | 会话 ID |
| `floor_id` | string | 否 | 楼层 ID |
| `page_id` | string | 否 | 页 ID |
| `include_layers` | boolean | 否 | 是否附带各层原始快照，默认 `false` |

### 响应 `200`

```json
{
  "data": {
    "context": {
      "account_id": "default-admin",
      "session_id": "session-a",
      "floor_id": "floor-a",
      "page_id": "page-a",
      "global_scope_id": "global"
    },
    "resolved": [
      {
        "key": "mood",
        "value": "tense",
        "source_scope": "floor",
        "source_scope_id": "floor-a",
        "updated_at": 1735689720000
      }
    ],
    "layers": {
      "global": {
        "scope": "global",
        "scope_id": "global",
        "items": [
          {
            "id": "var_global_theme",
            "scope": "global",
            "scope_id": "global",
            "key": "theme",
            "value": "midnight",
            "updated_at": 1735689700000
          }
        ]
      }
    }
  }
}
```

### 返回字段

#### `data.context`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `account_id` | string | 当前账号 |
| `session_id` | string | 当前会话 |
| `floor_id` | string | 当前楼层（如果提供） |
| `page_id` | string | 当前页（如果提供） |
| `global_scope_id` | string | 全局作用域固定值，通常为 `global` |

#### `data.resolved[]`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `key` | string | 变量键 |
| `value` | any | 当前胜出值 |
| `source_scope` | string | 胜出值来自哪个作用域 |
| `source_scope_id` | string | 胜出值来自哪个作用域 ID |
| `updated_at` | integer | 胜出值更新时间 |

`resolved` 会按 `key` 排序。

#### `data.layers`

只有当 `include_layers=true` 时才会返回。

每个层级对象结构相同：

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `scope` | string | 当前层级 |
| `scope_id` | string | 当前层级 ID |
| `items` | Variable[] | 该层级下原始变量列表 |

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 查询参数不合法，或 `session_id / floor_id / page_id` 上下文不一致 |
| `404` | 目标宿主不存在，或当前账号不可访问 |

## 官方集成层对应方法

- `@tavern/sdk`：`client.variables.resolveContext(...)`
- `@tavern/client-helpers`：`flattenVariableSnapshot(...)`、`sortVariableInspectorRows(...)`
