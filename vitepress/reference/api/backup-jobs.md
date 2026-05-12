---
outline: [2, 3]
---

# Backup Jobs（备份作业）

`/backup-jobs/*` 这组接口负责观察和控制核心资产备份作业。

这些接口直接投影 `runtime_job`，只显示 `scope_type = "backup"` 的作业。

## 什么时候需要看这页

- 你已经创建了 backup export / restore job，想查看当前状态。
- 你要在脚本里轮询作业，等导出完成后再下载 `.thbackup` 文件。
- 你要取消排队中的作业，或者重试失败作业。

## 一个简单例子

1. `POST /backup/jobs/export`：创建导出作业。
2. `GET /backup-jobs/:id`：轮询 `status` 和 `phase`。
3. 当 `status=succeeded` 时，调用 `GET /backup-jobs/:id/file` 下载文件。
4. 如果作业进入 `dead_letter`，调用 `POST /backup-jobs/:id/retry` 重新排队。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| `status` | 作业整体状态，例如等待、运行中、成功、失败 |
| `phase` | 作业当前所处的细分阶段 |
| `output_artifact_path` | 后台导出产物在 artifact store 中的路径 |
| `output_expires_at` | 导出文件的过期时间戳，过期后下载会返回 `410` |

## 作业状态与阶段

### `status`

| 值 | 说明 |
| ---- | ---- |
| `pending` | 已入队，等待 worker 领取 |
| `leased` | 已被 worker 领取，正在持有租约 |
| `running` | 正在执行 |
| `retry_waiting` | 失败后等待重试 |
| `succeeded` | 已成功完成 |
| `dead_letter` | 已达到最大重试次数，不再自动重试 |
| `cancelled` | 已取消 |

### `phase`

导出作业可能出现：

- `queued`
- `collecting`
- `serializing`
- `writing_artifact`
- `finalizing`
- `completed`

恢复作业可能出现：

- `queued`
- `validating`
- `normalizing`
- `remapping`
- `publishing`
- `rebuilding_runtime_state`
- `finalizing`
- `completed`

## 列出作业

```http
GET /backup-jobs
```

按当前账号列出 backup 作业。

### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- |
| `limit` | integer | `50` | 每页条数，最大 `100` |
| `offset` | integer | `0` | 偏移量 |
| `sort_order` | string | `desc` | 排序方向：`asc` 或 `desc` |
| `sort_by` | string | `created_at` | 排序字段：`created_at`、`updated_at`、`available_at` |
| `job_kind` | string | 否 | `export_core_assets` 或 `restore_core_assets` |
| `status` | string | 否 | 按作业状态过滤 |

### 响应 `200`

```json
{
  "data": [
    {
      "id": "backup-job-export-1",
      "job_kind": "export_core_assets",
      "status": "succeeded",
      "phase": "completed",
      "request": {
        "domains": null,
        "session_ids": ["sess_001"],
        "character_ids": [],
        "preset_ids": [],
        "worldbook_ids": [],
        "regex_profile_ids": [],
        "include_linked_assets": true,
        "include_secrets": false
      },
      "result": {
        "file_name": "core-assets-20250101-120000.thbackup",
        "content_type": "application/json; charset=utf-8",
        "byte_length": 2048,
        "included_domains": ["characters", "presets", "worldbooks", "regex_profiles", "sessions"],
        "counts": {
          "characters": 1,
          "character_versions": 1,
          "presets": 1,
          "preset_versions": 1,
          "worldbooks": 1,
          "worldbook_versions": 1,
          "worldbook_entries": 3,
          "regex_profiles": 1,
          "regex_profile_versions": 1,
          "sessions": 1,
          "session_branches": 2,
          "floors": 4,
          "pages": 4,
          "messages": 8,
          "variables": 6,
          "branch_local_variable_snapshots": 1,
          "memory_items": 3,
          "memory_edges": 2
        }
      },
      "output_artifact_path": "backup-job-export-1/output.thbackup",
      "output_expires_at": 1735689700000,
      "progress_current": 4,
      "progress_total": 4,
      "progress_message": "completed",
      "attempt_count": 1,
      "max_attempts": 5,
      "available_at": 1735689600000,
      "lease_owner": null,
      "lease_until": null,
      "last_error": null,
      "created_at": 1735689600000,
      "updated_at": 1735689650000,
      "finished_at": 1735689650000
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
GET /backup-jobs/:id
```

读取单个 backup 作业的当前状态。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 作业 ID |

### 响应 `200`

返回字段与列表中的单项一致。

### 常见轮询判断

- `status === "pending" | "leased" | "running" | "retry_waiting"`：继续轮询。
- `status === "succeeded"`：
  - 对导出作业，可继续调用 `GET /backup-jobs/:id/file` 下载文件。
  - 对恢复作业，可查看 `result.created`、`result.renamed_resources`、`result.warnings`。
- `status === "dead_letter"`：人工决定是否重试。
- `status === "cancelled"`：视为结束。

## 取消作业

```http
POST /backup-jobs/:id/cancel
```

只允许取消 `pending` 或 `retry_waiting` 状态的作业。

### 响应 `200`

```json
{
  "data": {
    "job_id": "backup-job-export-1",
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
POST /backup-jobs/:id/retry
```

只允许重试 `dead_letter` 或 `cancelled` 状态的作业。

### 响应 `200`

```json
{
  "data": {
    "job_id": "backup-job-restore-1",
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
GET /backup-jobs/:id/file
```

下载导出作业的 `.thbackup` 文件。

### 下载前提

只有满足下面条件时才允许下载：

1. 作业存在。
2. 作业类型是 `export_core_assets`。
3. 作业 `status === "succeeded"`。
4. 作业存在 `output_artifact_path`。
5. `output_expires_at` 未过期。
6. 产物文件仍然存在。

### 成功响应

- `Content-Disposition: attachment`
- `Content-Type: application/json; charset=utf-8`
- 响应体为 `.thbackup` 文件内容

### 错误

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| `404` | `not_found` | 作业不存在 |
| `409` | `backup_artifact_unavailable` | 该作业当前没有可下载的导出产物 |
| `410` | `artifact_expired` | 导出文件已过期 |

## 生产环境建议

- backup 作业需要后台 worker 才会继续执行。
- 生产环境建议单独运行：`pnpm --filter @tavern/api jobs:backup`。
- worker 相关开关和参数见 `.env.example` 中的 `ENABLE_BACKUP_WORKER` 与 `BACKUP_*` 配置项。
