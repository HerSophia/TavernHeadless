---
outline: [2, 3]
---

# Variables（变量）

变量系统提供五级作用域，用于在对话过程中存储和检索键值对。

## 作用域

| scope | 说明 |
| ----- | ---- |
| `global` | 全局变量 |
| `chat` | 会话级变量 |
| `branch` | 分支级变量 |
| `floor` | 楼层级变量 |
| `page` | 页级变量 |

优先级从高到低：`page` > `floor` > `branch` > `chat` > `global`。

`global` 写入和解析时会把 `scope_id` 规范化为固定值 `global`。

`branch` 的宿主由 `session_id + branch_id` 共同确定。对 `branch` 来说，`scope_id` 是服务端内部使用的规范化字符串。调用方更适合使用 `scope_ref`、`session_id` 和 `branch_id`。

## Variable 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 变量 ID |
| `scope` | string | 作用域 |
| `scope_id` | string | 作用域关联的资源 ID |
| `scope_ref` | object | 仅 `branch` 返回，包含 `session_id` 和 `branch_id` |
| `key` | string | 变量键名 |
| `value` | any | 变量值（任意 JSON） |
| `updated_at` | integer | 更新时间 |

### `scope_ref`

当变量来自 `branch` 作用域时，响应会额外返回：

```json
{
  "scope_ref": {
    "session_id": "session-a",
    "branch_id": "alt-1"
  }
}
```

## 设置变量（Upsert）

```http
PUT /variables
```

如果相同 `account_id + scope + scope_id + key` 的变量已存在则更新，否则创建。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `scope` | string | **是** | 作用域：`global` / `chat` / `branch` / `floor` / `page` |
| `scope_id` | string | 条件必填 | 非 `branch` 作用域时必填；`branch` 时可选 |
| `session_id` | string | 条件必填 | `branch` 作用域可与 `branch_id` 一起提供 |
| `branch_id` | string | 条件必填 | `branch` 作用域可与 `session_id` 一起提供 |
| `key` | string | **是** | 键名（至少 1 字符） |
| `value` | any | **是** | 值（任意 JSON，不可为 `undefined`） |

### `branch` 的两种写法

写法一：显式提供分支宿主

```json
{
  "scope": "branch",
  "session_id": "session-a",
  "branch_id": "alt-1",
  "key": "route",
  "value": "campfire"
}
```

写法二：直接提供内部 `scope_id`

```json
{
  "scope": "branch",
  "scope_id": "branch:session-a:alt-1",
  "key": "route",
  "value": "campfire"
}
```

如果同时提供 `scope_id` 和 `session_id + branch_id`，服务端会校验两者是否一致；不一致时返回 `400`。

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
| `items` | VariableWrite[] | **是** | 变量数组，1-100 条 |

每个 `items` 元素都可以使用单条 upsert 的字段。

::: warning 去重校验
同一批次内，规范化后的 `scope + scope_id + key` 组合不可重复，否则返回 `400`。
这意味着两个 `branch` 条目即使一个使用 `scope_id`，另一个使用 `session_id + branch_id`，只要最终目标相同，也会被视为重复。
:::

### 响应 `200`

```json
{
  "data": {
    "results": [
      {
        "index": 0,
        "action": "created",
        "data": {
          "id": "var_001",
          "scope": "branch",
          "scope_id": "branch:session-a:alt-1",
          "scope_ref": {
            "session_id": "session-a",
            "branch_id": "alt-1"
          },
          "key": "route",
          "value": "campfire",
          "updated_at": 1735689600000
        }
      },
      {
        "index": 1,
        "action": "updated",
        "data": {
          "id": "var_002",
          "scope": "chat",
          "scope_id": "sess_001",
          "key": "mood",
          "value": "tense",
          "updated_at": 1735689605000
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
| `400` | 请求体校验失败、items 为空或超过 100 条、同批次目标重复 |
| `404` | 某个变量宿主不存在，或当前账号不可访问 |
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
| `session_id` | string | - | `scope=branch` 时可与 `branch_id` 一起过滤 |
| `branch_id` | string | - | `scope=branch` 时可与 `session_id` 一起过滤 |
| `key` | string | - | 按键名过滤 |
| `limit` | integer | `50` | 返回条数上限 |
| `offset` | integer | `0` | 偏移量 |
| `sort_by` | string | `updated_at` | `updated_at` / `key` |
| `sort_order` | string | `desc` | `asc` / `desc` |

### 说明

- `session_id` 和 `branch_id` 只在 `scope=branch` 时可用。
- `scope=branch` 时，可以使用 `scope_id`，也可以使用 `session_id + branch_id`。
- 只传 `scope=branch` 而不带过滤参数时，会列出当前账号下所有分支变量。

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

这个接口返回当前 `session / branch / floor / page` 上下文里最终可见的变量快照。

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `session_id` | string | **是** | 会话 ID |
| `branch_id` | string | 否 | 分支 ID |
| `floor_id` | string | 否 | 楼层 ID |
| `page_id` | string | 否 | 页 ID |
| `include_layers` | boolean | 否 | 是否附带各层原始快照，默认 `false` |

### 解析规则

- 如果提供 `page_id`，服务端会从页反查楼层和分支。
- 如果提供 `floor_id`，服务端会从楼层反查分支。
- 如果显式提供 `branch_id`，服务端会校验它是否与 `page_id` 或 `floor_id` 推导出的分支一致。

### 响应 `200`

```json
{
  "data": {
    "context": {
      "account_id": "default-admin",
      "session_id": "session-a",
      "branch_id": "alt-1",
      "floor_id": "floor-a",
      "page_id": "page-a",
      "global_scope_id": "global"
    },
    "resolved": [
      {
        "key": "route",
        "value": "campfire",
        "source_scope": "branch",
        "source_scope_id": "branch:session-a:alt-1",
        "source_scope_ref": {
          "session_id": "session-a",
          "branch_id": "alt-1"
        },
        "updated_at": 1735689720100
      }
    ],
    "layers": {
      "branch": {
        "scope": "branch",
        "scope_id": "branch:session-a:alt-1",
        "scope_ref": {
          "session_id": "session-a",
          "branch_id": "alt-1"
        },
        "items": [
          {
            "id": "var_branch_route",
            "scope": "branch",
            "scope_id": "branch:session-a:alt-1",
            "scope_ref": {
              "session_id": "session-a",
              "branch_id": "alt-1"
            },
            "key": "route",
            "value": "campfire",
            "updated_at": 1735689720100
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
| `branch_id` | string | 当前分支（如果可以解析到） |
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
| `source_scope_ref` | object | 胜出值来自 `branch` 时，补充返回 `{ session_id, branch_id }` |
| `updated_at` | integer | 胜出值更新时间 |

`resolved` 会按 `key` 排序。

#### `data.layers`

只有当 `include_layers=true` 时才会返回。

每个层级对象结构相同：

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `scope` | string | 当前层级 |
| `scope_id` | string | 当前层级 ID |
| `scope_ref` | object | 当层级为 `branch` 时，补充返回 `{ session_id, branch_id }` |
| `items` | Variable[] | 该层级下原始变量列表 |

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 查询参数不合法，或 `session_id / branch_id / floor_id / page_id` 上下文不一致 |
| `404` | 目标宿主不存在，或当前账号不可访问 |

## 官方集成层对应方法

- `@tavern/sdk`：`client.variables.resolveContext(...)`
- `@tavern/client-helpers`：`flattenVariableSnapshot(...)`、`sortVariableInspectorRows(...)`
