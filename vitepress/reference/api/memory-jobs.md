---
outline: [2, 3]
---

# 记忆后台作业

这组接口用来查看和管理记忆系统的后台作业。它们主要面向调试、运维和自动化工具，不属于普通聊天流程。

记忆系统在对话过程中会自动产生后台作业——提取摘要、压缩长摘要、定期维护等。这些作业在后台排队执行，不阻塞对话。通过这组接口，你可以查看作业状态、手动重试失败的作业，或主动触发压缩与 `rebuild_scope` 维护入口。

## 基本概念

### 作业类型

| 类型 | 说明 |
| ---- | ---- |
| `ingest_turn` | 回合提交后自动触发，从对话内容中提取记忆。主聊天链默认落到当前 `branch` scope |
| `compact_macro` | 把多条短摘要压缩成一条长摘要 |
| `maintenance` | 定期维护：衰减排序、弃用过期记忆 |
| `rebuild_scope` | 当前是辅助维护入口：触发该 scope 的重整流程，并在需要时继续排入 `compact_macro` |

### 作业状态

| 状态 | 说明 |
| ---- | ---- |
| `pending` | 等待执行 |
| `leased` | 已被后台 worker 领取，准备执行 |
| `running` | 正在执行 |
| `retry_waiting` | 上次失败，等待重试 |
| `succeeded` | 执行成功 |
| `dead_letter` | 多次重试后仍然失败，进入死信状态 |
| `cancelled` | 已取消 |

### 作用域

每个作业和 scope 状态都绑定到一个作用域，表示这个作业处理的是哪个范围的记忆：

| 作用域 | 说明 |
| ---- | ---- |
| `global` | 全局记忆 |
| `chat` | 显式 session 级共享记忆 |
| `branch` | 某次会话下某个分支的隔离记忆 |
| `floor` | 某个楼层的记忆 |

---

## Memory Job 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 作业 ID |
| `scope` | string | 作用域：`global` / `chat` / `branch` / `floor` |
| `scope_id` | string | 作用域目标 ID。`branch` scope 使用 `JSON.stringify([sessionId, branchId])` 编码 |
| `job_type` | string | 作业类型 |
| `status` | string | 当前状态 |
| `floor_id` | string \| null | 关联的楼层 ID（如果有） |
| `based_on_revision` | integer \| null | 作业基于的 scope 版本号 |
| `payload` | object | 作业的附加数据，字段取决于 `job_type` |
| `attempt_count` | integer | 已尝试次数 |
| `max_attempts` | integer | 最大尝试次数 |
| `available_at` | integer | 可被 worker 领取的最早时间 |
| `lease_owner` | string \| null | 当前领取这个作业的 worker 标识 |
| `lease_until` | integer \| null | 领取租约到期时间 |
| `last_error` | string \| null | 最近一次执行错误信息 |
| `created_at` | integer | 创建时间 |
| `updated_at` | integer | 更新时间 |
| `finished_at` | integer \| null | 完成时间（成功或进入死信时） |

---

## 列出作业

```http
GET /memory/jobs
```

#### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- |
| `scope` | string | - | 按作用域过滤 |
| `scope_id` | string | - | 按作用域目标 ID 过滤 |
| `job_type` | string | - | 按作业类型过滤 |
| `status` | string | - | 按状态过滤 |
| `floor_id` | string | - | 按楼层 ID 过滤 |
| `created_from` | integer | - | 创建时间下限（毫秒时间戳） |
| `created_to` | integer | - | 创建时间上限 |
| `available_from` | integer | - | 可执行时间下限 |
| `available_to` | integer | - | 可执行时间上限 |
| `sort_by` | string | `created_at` | 排序字段：`created_at` / `updated_at` / `available_at` |
| `sort_order` | string | `desc` | `asc` / `desc` |
| `limit` | integer | `50` | 页大小，最大 100 |
| `offset` | integer | `0` | 偏移量 |

#### 响应示例

```json
{
  "data": [
    {
      "id": "job_abc123",
      "scope": "branch",
      "scope_id": "[\"sess_001\",\"main\"]",
      "job_type": "ingest_turn",
      "status": "succeeded",
      "floor_id": "floor_xyz",
      "based_on_revision": 3,
      "payload": {},
      "attempt_count": 1,
      "max_attempts": 5,
      "available_at": 1735689600000,
      "lease_owner": null,
      "lease_until": null,
      "last_error": null,
      "created_at": 1735689600000,
      "updated_at": 1735689660000,
      "finished_at": 1735689660000
    }
  ],
  "meta": {
    "total": 1,
    "limit": 50,
    "offset": 0,
    "has_more": false,
    "sort_by": "created_at",
    "sort_order": "desc"
  }
}
```

---

## 重试作业

```http
POST /memory/jobs/:id/retry
```

把一个已经终结的作业重新放回队列。只能重试以下状态的作业：

- `dead_letter`（多次失败后进入死信）
- `cancelled`（已取消）

重试后，作业会被重置为可以重新领取的状态：尝试次数归零，清空租约和错误信息。

#### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| 404 | `not_found` | 作业不存在 |
| 409 | `invalid_state` | 作业当前状态不允许重试（比如还在运行中） |

---

## 取消作业

```http
POST /memory/jobs/:id/cancel
```

取消一个等待执行的作业。只能取消以下状态的作业：

- `pending`（等待执行）
- `retry_waiting`（等待重试）

正在运行中的作业不能通过这个接口中断。

#### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| 404 | `not_found` | 作业不存在 |
| 409 | `invalid_state` | 作业当前状态不允许取消 |

---

## Scope 状态

每个作用域（比如某次会话、某个楼层）都有一条独立的状态记录，跟踪记忆处理进度。这些状态由后台 worker 自动维护，你一般只需要查看，不需要手动修改。

### Scope 状态对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `scope` | string | 作用域：`global` / `chat` / `branch` / `floor` |
| `scope_id` | string | 作用域目标 ID。`branch` scope 使用 `JSON.stringify([sessionId, branchId])` 编码 |
| `revision` | integer | 当前版本号，每次处理后递增 |
| `lease_owner` | string \| null | 当前正在处理这个 scope 的 worker 标识 |
| `lease_until` | integer \| null | 处理租约到期时间 |
| `last_processed_floor_no` | integer \| null | 最近已处理到的楼层号 |
| `last_compaction_at` | integer \| null | 最近一次长摘要压缩时间 |
| `updated_at` | integer | 更新时间 |

### 列出 scope 状态

```http
GET /memory/scopes
```

#### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- |
| `scope` | string | - | 按作用域过滤 |
| `scope_id` | string | - | 按作用域目标 ID 过滤 |
| `sort_by` | string | `updated_at` | 排序字段：`updated_at` / `revision` / `last_compaction_at` / `last_processed_floor_no` |
| `sort_order` | string | `desc` | `asc` / `desc` |
| `limit` | integer | `50` | 页大小，最大 100 |
| `offset` | integer | `0` | 偏移量 |

---

## 触发 `rebuild_scope`

```http
POST /memory/scopes/:scope/:scopeId/rebuild
```

手动为某个作用域排入一个 `rebuild_scope` 作业。

当前 Beta3 语义下，这个入口主要用于触发该 scope 的维护与 compaction 补偿流程，不应理解为“完整重建该 scope 下全部记忆真相”。

这个接口要求服务端已经启用后台 worker。未启用时返回 `409`。

#### 请求体

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `trigger_floor_id` | string | 否 | - | 作为维护触发点的楼层 ID |
| `force_compaction` | boolean | 否 | `true` | 是否继续显式触发长摘要压缩 |

#### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| 409 | `invalid_state` | 后台 worker 未启用 |

---

## 触发长摘要压缩

```http
POST /memory/scopes/:scope/:scopeId/compact
```

手动为某个作用域排入一个长摘要压缩作业。系统会先评估当前是否有足够的短摘要可供压缩，如果有，就排入作业。

这个接口同样要求后台 worker 已启用。如果当前没有可压缩的候选（比如短摘要太少），返回 `409`。

#### 请求体

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `trigger_floor_id` | string | 否 | - | 关联的楼层 ID |
| `force` | boolean | 否 | `true` | 是否强制压缩（跳过阈值检查） |

#### 响应

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `job_id` | string | 作业 ID |
| `created` | boolean | 是否新建成功（如果命中去重可能为 `false`） |
| `scope` | string | 作用域 |
| `scope_id` | string | 作用域目标 ID |
| `reason` | string | 触发原因 |
| `source_micro_ids` | string[] | 本次选中的短摘要 ID 列表 |
| `coverage_start_floor_no` | integer \| null | 覆盖的起始楼层号 |
| `coverage_end_floor_no` | integer \| null | 覆盖的结束楼层号 |

`reason` 的可能值：

| 值 | 说明 |
| ---- | ---- |
| `micro_count_threshold` | 短摘要数量超过阈值 |
| `micro_token_threshold` | 短摘要的 token 总量超过阈值 |
| `floor_gap_threshold` | 最早和最近短摘要之间跨越的楼层数超过阈值 |
| `forced` | 由 `force: true` 参数强制触发 |

#### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| 409 | `invalid_state` | 后台 worker 未启用，或当前没有可压缩的候选 |
