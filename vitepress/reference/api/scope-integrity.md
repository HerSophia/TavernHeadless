---
outline: [2, 3]
---

# Scope Integrity（作用域一致性运维）

平台用 `workspace_id` / `project_id` 把 Session、派生结果、收件箱、操作日志等数据归属到具体的 Workspace / Project。历史数据或旧客户端可能留下缺失或漂移的作用域字段（例如某个 Session 缺 `workspace_id`）。这组接口把内部的**作用域一致性诊断与修复**能力，暴露为**受控、可审计**的对外入口。

- `GET /scope-integrity/report`：只读诊断当前账号的作用域漂移，返回按 code 聚合的摘要与截断的问题列表。
- `POST /scope-integrity/repair`：受控修复。**默认 dry-run**（只预览不落库），必须显式传 `dry_run = false` 才真实修复。

修复是**加性、安全的子集**：只从 Project / Session 血缘推导可回填的字段（如从 Project 推导 Session 的 `workspace_id`），绝不改写权威字段（如 `project.account_id` 冲突、矛盾的 `source_floor_id` / `source_session_id`）。

## 什么时候需要看这页

- 你怀疑历史数据存在作用域缺失 / 漂移，想先做一次只读体检。
- 你要在不改表结构的前提下，把可加性回填的漂移一次性修复干净。
- 你在为后续「收紧作用域约束」（加 `NOT NULL` / 外键）建立干净基线，需要一个可观测的报告入口。

启动时平台已会对每个账号做一次 best-effort 的加性修复（`source = startup_repair` 的 `system` actor 审计）。这组接口用于**主动、按需**地体检与修复，尤其是想先 dry-run 预览时。

## 权限

只允许账号身份调用：

- 账号身份（account actor）：允许
- Client 身份（client actor）：`403 scope_integrity_account_only`

`accountId` 始终取自认证上下文，**不接受跨账户参数**——你只能诊断 / 修复自己账号下的数据。为后续管理员能力（admin capability）预留了扩展点。

## 审计

- **真实修复**（`dry_run = false` 且发现了漂移）写一条 `scope_integrity.repair` 操作日志。
- **dry-run 预览**（`dry_run = true` 且发现了漂移）写一条 `scope_integrity.diagnose` 操作日志。
- **账号干净**（没有发现任何漂移）时**不写审计**，避免启动 / 轮询噪声。

审计的 `metadata` 记录 `dry_run`、`issues_found`、`repaired_count` / `remaining_count` 以及按 code 聚合的计数，可在 [Operation Logs](./operation-logs) 中按 `action = scope_integrity.repair` / `scope_integrity.diagnose` 查询。

## 响应格式说明

这组接口不使用通用的 `data` 包裹，直接返回下面描述的对象。

## 对象：Issue（一条漂移）

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 稳定的问题标识（`<code>:<table>:<record_id>` 语义） |
| `severity` | string | `error` 或 `warning` |
| `table` | string | 出问题的表名，如 `session` |
| `record_id` | string | 出问题记录的主键 |
| `code` | string | 问题类型，如 `session_workspace_missing` |
| `message` | string | 人类可读描述 |
| `expected` | object \| null | 期望的作用域字段值（若可推导） |
| `actual` | object \| null | 实际值 |
| `repairable` | boolean | 是否属于加性、可安全修复的子集 |

常见 `code`：`session_workspace_missing`、`session_project_missing`、`operation_log_workspace_missing`、`derived_output_workspace_mismatch`、`project_inbox_workspace_mismatch`、`project_membership_workspace_mismatch` 等。

## `GET /scope-integrity/report`

只读诊断，返回聚合摘要 + 截断的问题列表。

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `project_id` | string | 可选。只诊断该 Project 作用域下的记录 |
| `limit` | integer | 可选。问题列表的最大条数，默认 `50`，上限 `500` |

### 响应

```json
{
  "summary": {
    "total_issues": 3,
    "repairable_issues": 3,
    "unrepairable_issues": 0,
    "truncated": false,
    "sessions_missing_workspace_id": 2,
    "sessions_missing_project_id": 1,
    "by_code": [
      {
        "code": "session_project_missing",
        "severity": "error",
        "total": 1,
        "repairable": 1,
        "unrepairable": 0
      },
      {
        "code": "session_workspace_missing",
        "severity": "error",
        "total": 2,
        "repairable": 2,
        "unrepairable": 0
      }
    ]
  },
  "issues": [
    {
      "id": "session_workspace_missing:session:sess_123",
      "severity": "error",
      "table": "session",
      "record_id": "sess_123",
      "code": "session_workspace_missing",
      "message": "Session sess_123 is missing workspace_id",
      "expected": { "workspace_id": "ws_abc" },
      "actual": { "workspace_id": null },
      "repairable": true
    }
  ]
}
```

- `summary` 是对**默认诊断上限**（500）内的完整聚合；`summary.truncated = true` 表示触及该上限。
- `summary.by_code` 按 `code` 升序排序，便于稳定渲染。
- `issues` 是受 `limit` 约束的原始问题列表，用于快速抽样查看具体记录。

## `POST /scope-integrity/repair`

受控修复或预览。默认安全：不传 `dry_run` 或传 `dry_run = true` 时只预览。

### 请求体

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `dry_run` | boolean | 可选，默认 `true`。为 `true` 时只预览不落库；必须显式传 `false` 才真实修复 |
| `project_id` | string | 可选。只修复该 Project 作用域下的记录 |

### 响应

```json
{
  "dry_run": false,
  "repaired_count": 2,
  "remaining_count": 0,
  "repaired": [
    {
      "id": "session_workspace_missing:session:sess_123",
      "severity": "error",
      "table": "session",
      "record_id": "sess_123",
      "code": "session_workspace_missing",
      "message": "Session sess_123 is missing workspace_id",
      "expected": { "workspace_id": "ws_abc" },
      "actual": { "workspace_id": null },
      "repairable": true
    }
  ],
  "remaining": []
}
```

- `dry_run = true` 时，`repaired` 表示**将会**被修复的问题（预览），数据库不发生变化。
- `dry_run = false` 时，`repaired` 表示实际已修复的问题；`remaining` 表示未能修复（不可修复或修复失败）的问题。
- `remaining` 里的不可修复问题需要人工介入（它们涉及权威字段冲突，接口不会擅自改写）。

### 推荐流程

1. 先 `GET /scope-integrity/report` 或 `POST /scope-integrity/repair`（默认 dry-run）看清楚有哪些漂移、是否都可修复。
2. 确认无误后，`POST /scope-integrity/repair` 带 `{ "dry_run": false }` 真实修复。
3. 复查 `report`，确认 `repairable_issues` 归零；`remaining` 中若仍有不可修复项，按 `code` 单独排查。

## 错误码

| HTTP | code | 说明 |
| ---- | ---- | ---- |
| 400 | （校验错误） | 查询参数 / 请求体不合法（如 `limit` 越界、未知字段） |
| 403 | `scope_integrity_account_only` | 非账号身份调用 |

## 相关

- 修复只做「不改写权威字段」的加性子集；DB 级约束收紧（`NOT NULL` / 外键）属后续批次，本接口用于建立并观测干净基线。
- 审计统一进 [Operation Logs](./operation-logs)，不新增并行审计存储。
