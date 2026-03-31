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

---

## Memory Item 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 记忆 ID |
| `scope` | string | 作用域：`global` / `chat` / `floor` |
| `scope_id` | string | 关联资源 ID |
| `type` | string | 类型：`fact` / `summary` / `open_loop` |
| `summary_tier` | string \| null | 仅 `type=summary` 时有意义：`micro` / `macro` |
| `content` | object | 记忆内容（任意 JSON） |
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
| `content` | object | 是 | 记忆内容 |
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
| `400` | 请求体校验失败 |
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

- 只更新 `lifecycle_status` 不会强制把 `status` 改成 `deprecated`，除非你显式传入 `status` 或把 `lifecycle_status` 设为 `deprecated`。
- 当类型变成非 `summary`，或只传了非摘要类型却仍传 `summary_tier`，服务端会清空 `summary_tier`。

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败 |
| `404` | 记忆条目不存在 |
| `409` | 状态组合不合法或其他冲突 |

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

#### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败 |
| `404` | `from_id` 或 `to_id` 对应的记忆条目不存在 |

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
| `404` | 记忆边不存在 |

### 删除记忆边

```http
DELETE /memory-edges/:id
```

#### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 记忆边不存在 |

---

## Memory Job（后台任务）

`memory_job` 是 Memory V2 遗留队列模型的命名来源；当前公开路由已经投影到统一 `Background Job Runtime`。对外语义仍保持 Memory Job 风格，但它本质上是一组**高级开发者接口**。公开 job 类型包括：

- `ingest_turn`
- `compact_macro`
- `maintenance`
- `rebuild_scope`

任务状态包括：

- `pending`
- `leased`
- `running`
- `retry_waiting`
- `succeeded`
- `dead_letter`
- `cancelled`

### Memory Job 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 任务 ID |
| `scope` | string | 作用域：`global` / `chat` / `floor` |
| `scope_id` | string | 作用域目标 ID |
| `job_type` | string | 任务类型 |
| `status` | string | 任务状态 |
| `floor_id` | string \| null | 关联楼层 ID（如果有） |
| `based_on_revision` | integer \| null | 任务基于的 `memory_scope_state.revision` |
| `payload` | object | 任务 payload。字段取决于 `job_type` |
| `attempt_count` | integer | 已尝试次数 |
| `max_attempts` | integer | 最大尝试次数 |
| `available_at` | integer | 可被 worker 领取的时间 |
| `lease_owner` | string \| null | 当前租约持有者 |
| `lease_until` | integer \| null | 租约到期时间 |
| `last_error` | string \| null | 最近一次错误 |
| `created_at` | integer | 创建时间 |
| `updated_at` | integer | 更新时间 |
| `finished_at` | integer \| null | 终态完成时间 |

### 列出任务

```http
GET /memory/jobs
```

#### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `scope` | string | 按作用域过滤 |
| `scope_id` | string | 按作用域目标过滤 |
| `job_type` | string | 按任务类型过滤 |
| `status` | string | 按任务状态过滤 |
| `floor_id` | string | 按楼层过滤 |
| `created_from` | integer | 创建时间下限 |
| `created_to` | integer | 创建时间上限 |
| `available_from` | integer | 可执行时间下限 |
| `available_to` | integer | 可执行时间上限 |
| `sort_by` | string | `created_at` / `updated_at` / `available_at` |
| `sort_order` | string | `asc` / `desc` |
| `limit` | integer | 页大小 |
| `offset` | integer | 偏移量 |

### Retry 终态任务

```http
POST /memory/jobs/:id/retry
```

仅允许重试：

- `dead_letter`
- `cancelled`

重试后，服务端会把任务重置为可再次领取的状态：

- `status = retry_waiting`
- `based_on_revision = null`
- `attempt_count = 0`
- 清空 lease / last_error / finished_at

### Cancel 待处理任务

```http
POST /memory/jobs/:id/cancel
```

仅允许取消：

- `pending`
- `retry_waiting`

说明：当前没有公开的 in-flight cancellation 语义，`running` 任务不能通过这个接口中断。

---

## Memory Scope State（scope 状态）

`memory_scope_state` 记录每个 `(account_id, scope, scope_id)` 的串行化状态、revision 和最近处理进度。

### Memory Scope State 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `scope` | string | 作用域：`global` / `chat` / `floor` |
| `scope_id` | string | 作用域目标 ID |
| `revision` | integer | 当前 revision |
| `lease_owner` | string \| null | 当前 scope 租约持有者 |
| `lease_until` | integer \| null | 当前租约到期时间 |
| `last_processed_floor_no` | integer \| null | 最近已处理的楼层号 |
| `last_compaction_at` | integer \| null | 最近一次宏摘要压缩时间 |
| `updated_at` | integer | 更新时间 |

### 列出 scope 状态

```http
GET /memory/scopes
```

#### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `scope` | string | 按作用域过滤 |
| `scope_id` | string | 按作用域目标过滤 |
| `sort_by` | string | `updated_at` / `revision` / `last_compaction_at` / `last_processed_floor_no` |
| `sort_order` | string | `asc` / `desc` |
| `limit` | integer | 页大小 |
| `offset` | integer | 偏移量 |

### Enqueue scope rebuild

```http
POST /memory/scopes/:scope/:scopeId/rebuild
```

该接口会 enqueue 一个 `rebuild_scope` 任务。

#### 请求体

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `trigger_floor_id` | string | 可选，作为重建起点或上下文线索 |
| `force_compaction` | boolean | 是否允许在 rebuild 后继续强制触发 compaction，默认 `true` |

说明：这个接口要求服务端已经启用 background worker。未启用时返回 `409 invalid_state`。

### Enqueue manual compact

```http
POST /memory/scopes/:scope/:scopeId/compact
```

该接口会先对当前 scope 运行一次 compaction planner，再 enqueue 一个 `compact_macro` 任务。

#### 请求体

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `trigger_floor_id` | string | 可选，作为本次 compaction 的关联楼层 |
| `force` | boolean | 是否允许强制压缩，默认 `true` |

#### 响应字段

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `job_id` | string | 任务 ID |
| `created` | boolean | 是否新建成功；若命中去重 ID 可能为 `false` |
| `scope` | string | 作用域 |
| `scope_id` | string | 作用域目标 ID |
| `reason` | string | planner 触发原因：`micro_count_threshold` / `micro_token_threshold` / `floor_gap_threshold` / `forced` |
| `source_micro_ids` | string[] | 本轮选中的 micro summary ID |
| `coverage_start_floor_no` | integer \| null | 覆盖起始楼层号 |
| `coverage_end_floor_no` | integer \| null | 覆盖结束楼层号 |

说明：这个接口同样要求服务端已经启用 background worker。若没有可压缩候选，会返回 `409 invalid_state`。
