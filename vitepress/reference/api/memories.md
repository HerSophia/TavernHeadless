---
outline: [2, 3]
---

# Memories（记忆）

记忆域现在包含四部分公开接口：

- `memory_item`：记忆条目 CRUD、列表、统计、批量状态更新、批量删除
- `memory_edge`：记忆关系边 CRUD
- `memory_job`：后台任务列表与 retry / cancel
- `memory_scope_state`：scope 状态列表，以及手动 rebuild / compact

> 说明：`memory_job` 与 `memory_scope_state` 相关接口属于高级开发者特性。
> 它们主要用于后台作业观察、调试、运维和自动化集成，不是普通聊天页面的日常调用接口。
> 正常聊天仍以 `Chat`、`Sessions`、`Floors` 等主链路资源为准。

聊天主链在读取记忆时，会按当前可见范围合并 `global`、`chat`、`floor` 三层候选条目，
再继续应用既有的 importance / balanced / dual-summary 选择与裁剪规则。

---

## Memory Item 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 记忆 ID |
| `scope` | string | 作用域：`global` / `chat` / `floor` |
| `scope_id` | string | 关联资源 ID |
| `type` | string | 类型：`fact` / `summary` / `open_loop` |
| `summary_tier` | string \| null | 仅 `type=summary` 时有意义：`micro` / `macro` |
| `content` | string \| `{ text: string }` | 记忆文本内容。公开契约只承诺纯文本，`{ text }` 是稳定包装写法 |
| `fact_key` | string \| null | 结构化事实键。仅对 `type=fact` 有意义 |
| `importance` | number | 重要度，0-1 |
| `confidence` | number | 置信度，0-1 |
| `source_floor_id` | string \| null | 来源楼层 ID |
| `source_message_id` | string \| null | 来源消息 ID |
| `status` | string | 兼容状态：`active` / `deprecated` |
| `lifecycle_status` | string | 生命周期状态：`active` / `compacted` / `deprecated` |
| `source_job_id` | string \| null | 写入该条记忆的 `memory_job.id` |
| `token_count_estimate` | integer \| null | 估算 token 数 |
| `last_used_at` | integer \| null | 最近一次被注入或使用的时间戳 |
| `coverage_start_floor_no` | integer \| null | 摘要覆盖的起始楼层号 |
| `coverage_end_floor_no` | integer \| null | 摘要覆盖的结束楼层号 |
| `derived_from_count` | integer \| null | 该摘要直接聚合的来源条目数 |
| `created_at` | integer | 创建时间 |
| `updated_at` | integer | 更新时间 |

说明：

- `fact_key` 会按后端规则规范化并以小写形式存储。
- `status` 仍保留给兼容调用方；`lifecycle_status` 才是 Memory V2 的细粒度生命周期字段。
- `summary_tier` 只用于 `type: "summary"`。非摘要类型写入时会被忽略或清空。
- 引擎当前按文本模型处理 `content`。不要依赖任意 JSON 结构被稳定保存和注入。

---

## 创建记忆条目

```http
POST /memories
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `scope` | string | 是 | 作用域 |
| `scope_id` | string | 是 | 关联 ID |
| `type` | string | 是 | 记忆类型 |
| `summary_tier` | string | 否 | `type=summary` 时可传：`micro` / `macro` |
| `content` | string \| `{ text: string }` | 是 | 记忆文本内容 |
| `fact_key` | string \| null | 否 | 结构化事实键，仅对 `type=fact` 有意义 |
| `importance` | number | 否 | 重要度，默认 `0.5` |
| `confidence` | number | 否 | 置信度，默认 `1` |
| `source_floor_id` | string | 否 | 来源楼层 |
| `source_message_id` | string | 否 | 来源消息 |
| `status` | string | 否 | 兼容状态：`active` / `deprecated` |
| `lifecycle_status` | string | 否 | 生命周期状态：`active` / `compacted` / `deprecated` |

### 响应 `201`

返回 `{ "data": MemoryItem }`。

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败，包括传入非文本 `content` |
| `409` | 状态组合不合法或其他冲突 |

---

## 查询记忆条目

```http
GET /memories
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `scope` | string | 按作用域过滤 |
| `scope_id` | string | 按关联 ID 过滤 |
| `type` | string | 按类型过滤 |
| `summary_tier` | string | 按摘要层级过滤：`micro` / `macro` |
| `status` | string | 按兼容状态过滤：`active` / `deprecated` |
| `lifecycle_status` | string | 按生命周期状态过滤：`active` / `compacted` / `deprecated` |
| `fact_key` | string | 按结构化事实键过滤 |
| `source_floor_id` | string | 按来源楼层过滤 |
| `source_message_id` | string | 按来源消息过滤 |
| `created_from` | integer | 创建时间下限 |
| `created_to` | integer | 创建时间上限 |
| `updated_from` | integer | 更新时间下限 |
| `updated_to` | integer | 更新时间上限 |
| `importance_min` | number | 重要度下限 |
| `importance_max` | number | 重要度上限 |
| `confidence_min` | number | 置信度下限 |
| `confidence_max` | number | 置信度上限 |
| `q` | string | 内容全文搜索 |
| `sort_by` | string | `created_at` / `updated_at` / `importance` / `confidence` |
| `sort_order` | string | `asc` / `desc` |
| `limit` | integer | 页大小 |
| `offset` | integer | 偏移量 |

### 响应 `200`

返回 `{ "data": MemoryItem[], "meta": ListMeta }`。

---

## 获取记忆详情

```http
GET /memories/:id
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 记忆条目不存在 |

---

## 更新记忆

```http
PATCH /memories/:id
```

至少提供一个字段。可更新所有可写字段，包括：

- `scope`
- `scope_id`
- `type`
- `summary_tier`
- `content`
- `fact_key`
- `importance`
- `confidence`
- `source_floor_id`
- `source_message_id`
- `status`
- `lifecycle_status`

说明：

- `status` 会推导 `lifecycle_status`；但如果你只更新 `lifecycle_status`，服务端不会自动改写 `status`，即使把 `lifecycle_status` 设为 `deprecated` 也是如此。
- 当类型变成非 `summary`，或只传了非摘要类型却仍传 `summary_tier`，服务端会清空 `summary_tier`。
- `content` 仍只接受文本或 `{ text: string }` 包装。其他 JSON 结构会直接返回 `400`。

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败 |
| `404` | 记忆条目不存在 |

---

## 删除记忆

```http
DELETE /memories/:id
```

### 响应 `200`

```json
{ "data": { "id": "mem_fact_1", "deleted": true } }
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 记忆条目不存在 |

---

## 记忆统计

```http
GET /memories/stats
```

返回记忆条目的统计信息。支持与列表接口相同的过滤参数，包括 `summary_tier` 和 `lifecycle_status`。

### 响应 `200`

```json
{
  "data": {
    "total": 42,
    "active": 38,
    "deprecated": 4,
    "by_type": {
      "fact": 20,
      "summary": 15,
      "open_loop": 7
    },
    "avg_importance": 0.65,
    "avg_confidence": 0.72,
    "estimated_tokens": 8400
  }
}
```

---

## 批量更新记忆状态

```http
PATCH /memories/batch/status
```

批量将指定记忆条目的 `status` 设为 `active` 或 `deprecated`。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `ids` | string[] | 是 | 记忆 ID 数组，1-100 条，不可重复 |
| `status` | string | 是 | 目标状态：`active` / `deprecated` |

### 响应 `200`

返回：

- `data.results[]`：逐条处理结果
- `data.meta.total`：请求总条数
- `data.meta.updated`：成功更新条数
- `data.meta.not_found`：未找到条数
- `data.meta.status`：本次设置的目标状态

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败、ids 为空或超过 100 条、存在重复 ID、status 不合法 |

---

## 批量删除记忆

```http
POST /memories/batch/delete
```

批量物理删除指定记忆条目。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `ids` | string[] | 是 | 记忆 ID 数组，1-100 条，不可重复 |

### 响应 `200`

返回：

- `data.results[]`：逐条处理结果
- `data.meta.total`：请求总条数
- `data.meta.deleted`：成功删除条数
- `data.meta.not_found`：未找到条数

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败、ids 为空或超过 100 条、存在重复 ID |

---

## Memory Edge（记忆边）

记忆边表达两个记忆条目之间的关系。

### Memory Edge 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 边 ID |
| `from_id` | string | 起始记忆 ID |
| `to_id` | string | 目标记忆 ID |
| `relation` | string | 关系类型：`supports` / `contradicts` / `updates` / `derived_from` / `compacts` / `resolves` |
| `created_at` | integer | 创建时间 |

### 创建记忆边

```http
POST /memory-edges
```

#### 请求体

| 字段 | 类型 | 必填 |
| ---- | ---- | ---- |
| `from_id` | string | 是 |
| `to_id` | string | 是 |
| `relation` | string | 是 |

`from_id` 和 `to_id` 都必须指向当前账号下已存在的记忆条目。

#### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败 |
| `404` | `from_id` 或 `to_id` 不存在，或不属于当前账号 |
| `409` | `memory_edge_conflict`，例如重复创建相同关系边 |

### 列出记忆边

```http
GET /memory-edges
```

#### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `from_id` | string | 按起始记忆过滤 |
| `to_id` | string | 按目标记忆过滤 |
| `relation` | string | 按关系类型过滤 |
| `sort_by` | string | `created_at` |
| `sort_order` | string | `asc` / `desc` |
| `limit` | integer | 页大小 |
| `offset` | integer | 偏移量 |

### 获取记忆边详情

```http
GET /memory-edges/:id
```

#### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 记忆边不存在 |

### 更新记忆边

```http
PATCH /memory-edges/:id
```

仅允许更新 `relation` 字段。

#### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `relation` | string | 是 | 新的关系类型 |

#### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败 |
| `404` | 记忆边不存在，或其 `from_id` / `to_id` 已不再属于当前账号 |
| `409` | `memory_edge_conflict`，例如更新后与现有同账号边重复 |

### 删除记忆边

```http
DELETE /memory-edges/:id
```

#### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 记忆边不存在 |

---

## 后台作业与 Scope 状态

记忆系统会在后台自动产生作业（提取摘要、压缩长摘要、定期维护等），并维护每个作用域的处理状态。这些接口主要用于调试和运维，不属于普通对话流程。

完整文档请参阅 [记忆后台作业](/reference/api/memory-jobs)。
