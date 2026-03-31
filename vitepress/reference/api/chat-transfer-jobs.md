---
outline: [2, 3]
---

# Chat Transfer Jobs（聊天传输作业）

聊天导入和聊天导出的异步接口共用同一套作业观测面。

这是一组面向平台接入、批处理和自动化脚本的高级开发特性，不属于普通聊天主流程接口。

v1 的作业观测方式是**轮询**。

- 创建异步导入作业：`POST /import/chat/jobs`
- 创建异步导出作业：`POST /export/chat/:id/jobs`
- 查询和控制作业：本页的 `/chat-transfer-jobs/*` 路由

如果需要查看导入和导出的请求体，请分别参考：

- [Imports（导入）](./imports)
- [Exports（导出）](./exports)

## 作业状态与阶段

### `status`

| 值 | 说明 |
| ---- | ---- |
| `pending` | 已入队，等待 worker 领取 |
| `leased` | 已被 worker 租约领取 |
| `running` | 正在执行 |
| `retry_waiting` | 失败后等待重试 |
| `succeeded` | 已成功完成 |
| `dead_letter` | 已达到最大重试次数，不再自动重试 |
| `cancelled` | 已取消 |

### `phase`

导入作业可能出现：

- `queued`
- `parsing`
- `normalizing`
- `publishing`
- `completed`

导出作业可能出现：

- `queued`
- `snapshotting`
- `rendering`
- `writing_artifact`
- `completed`

路由层会保留完整的统一枚举，因此也可能看到其他内部阶段值，例如 `finalizing`。

## 列出作业

```http
GET /chat-transfer-jobs
```

按当前账号列出聊天传输作业。

### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- |
| `limit` | integer | `50` | 每页条数，最大 `100` |
| `offset` | integer | `0` | 偏移量 |
| `sort_order` | string | `desc` | 排序方向：`asc` 或 `desc` |
| `sort_by` | string | `created_at` | 排序字段：`created_at`、`updated_at`、`available_at` |
| `job_kind` | string | 否 | `import_chat` 或 `export_chat` |
| `status` | string | 否 | 作业状态过滤 |
| `format` | string | 否 | `thchat`、`sillytavern_jsonl`、`st_jsonl` |
| `requested_session_id` | string | 否 | 按请求会话 ID 过滤 |
| `result_session_id` | string | 否 | 按结果会话 ID 过滤 |
| `created_from` | integer | 否 | 创建时间下界（Unix 毫秒） |
| `created_to` | integer | 否 | 创建时间上界（Unix 毫秒） |
| `available_from` | integer | 否 | 可领取时间下界（Unix 毫秒） |
| `available_to` | integer | 否 | 可领取时间上界（Unix 毫秒） |

### 响应 `200`

```json
{
  "data": [
    {
      "id": "ctj_export_demo",
      "job_kind": "export_chat",
      "format": "thchat",
      "status": "succeeded",
      "phase": "completed",
      "requested_session_id": "sess_demo",
      "result_session_id": null,
      "request": {
        "sessionId": "sess_demo",
        "format": "thchat",
        "includeVariables": true,
        "includeMemories": true
      },
      "result": {
        "fileName": "Campfire Scene.thchat",
        "contentType": "application/json; charset=utf-8",
        "byteLength": 2048
      },
      "input_artifact_path": null,
      "normalized_artifact_path": null,
      "output_artifact_path": "ctj_export_demo/output.thchat",
      "output_expires_at": 1735689600000,
      "progress_current": 4,
      "progress_total": 4,
      "progress_message": "completed",
      "attempt_count": 1,
      "max_attempts": 5,
      "available_at": 1735686000000,
      "lease_owner": null,
      "lease_until": null,
      "last_error": null,
      "created_at": 1735686000000,
      "updated_at": 1735686050000,
      "finished_at": 1735686050000
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

## 获取作业详情

```http
GET /chat-transfer-jobs/:id
```

读取单个作业的当前状态。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 作业 ID |

### 响应 `200`

```json
{
  "data": {
    "id": "ctj_export_demo",
    "job_kind": "export_chat",
    "format": "thchat",
    "status": "succeeded",
    "phase": "completed",
    "requested_session_id": "sess_demo",
    "result_session_id": null,
    "request": {
      "sessionId": "sess_demo",
      "format": "thchat",
      "includeVariables": true,
      "includeMemories": true
    },
    "result": {
      "fileName": "Campfire Scene.thchat",
      "contentType": "application/json; charset=utf-8",
      "byteLength": 2048
    },
    "output_artifact_path": "ctj_export_demo/output.thchat",
    "output_expires_at": 1735689600000,
    "progress_current": 4,
    "progress_total": 4,
    "progress_message": "completed",
    "attempt_count": 1,
    "max_attempts": 5,
    "available_at": 1735686000000,
    "created_at": 1735686000000,
    "updated_at": 1735686050000,
    "finished_at": 1735686050000
  }
}
```

### 常见轮询判断

- `status === "pending" | "leased" | "running" | "retry_waiting"`：继续轮询
- `status === "succeeded"`：
  - 对导入作业，可从 `result` 或 `result_session_id` 读取结果
  - 对导出作业，可继续调用 `GET /chat-transfer-jobs/:id/file` 下载产物
- `status === "dead_letter"`：人工决定是否重试
- `status === "cancelled"`：视为结束

## 取消作业

```http
POST /chat-transfer-jobs/:id/cancel
```

只允许取消 `pending` 或 `retry_waiting` 状态的作业。

### 响应 `200`

```json
{
  "data": {
    "job_id": "ctj_import_demo",
    "status": "cancelled"
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| `404` | `not_found` | 作业不存在 |
| `409` | `invalid_state` | 当前状态不允许取消 |

## 重试作业

```http
POST /chat-transfer-jobs/:id/retry
```

只允许重试 `dead_letter` 或 `cancelled` 状态的作业。

### 响应 `200`

```json
{
  "data": {
    "job_id": "ctj_import_demo",
    "status": "retry_waiting"
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| `404` | `not_found` | 作业不存在 |
| `409` | `invalid_state` | 当前状态不允许重试 |

## 下载导出产物

```http
GET /chat-transfer-jobs/:id/file
```

下载导出作业产物。

只有满足下面条件时才可以下载：

1. 作业 `status === "succeeded"`
2. 作业存在 `output_artifact_path`
3. `output_expires_at` 未过期
4. 产物文件仍然存在

### 成功响应

- `Content-Disposition: attachment`
- `Content-Type` 由作业结果决定
  - `.thchat` 通常是 `application/json; charset=utf-8`
  - `.jsonl` 通常是 `application/x-ndjson; charset=utf-8`

### 错误

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| `404` | `not_found` | 作业不存在 |
| `404` | `artifact_not_found` | 产物记录存在，但文件已不存在 |
| `409` | `invalid_state` | 作业尚未成功完成 |
| `409` | `artifact_unavailable` | 该作业没有可下载产物 |
| `410` | `artifact_expired` | 产物已过期 |

## 与导入导出路由的关系

- `POST /import/chat/jobs` 只负责入队，真正的解析、归一化、发布在 worker 中完成
- `POST /export/chat/:id/jobs` 只负责入队，真正的快照、渲染、产物写入在 worker 中完成
- 生产环境推荐使用独立 worker 进程运行 `pnpm --filter @tavern/api jobs:chat-transfer`
