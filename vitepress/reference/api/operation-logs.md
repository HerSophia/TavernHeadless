---
outline: [2, 3]
---

# Operation Logs（操作日志）

Operation Log 记录一次用户、LLM 或系统操作留下的审计信息。它保存操作的来源、动作、目标、引用和摘要 diff。

它不是运行时真相源。Floor 快照、资产版本、工具执行记录、Session State mutation 仍然由各自的表保存。

## 什么时候需要看这页

- 你要追踪一个会话被谁改过
- 你要查看某个楼层由哪个 run 提交
- 你要按目标、动作、请求 ID 查询审计记录
- 你要做回滚、排查或治理审计

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| actor | 操作者，可以是用户、LLM 或系统 |
| source | 操作来源，例如 HTTP 请求或 LLM run |
| target | 被操作的对象，例如 session、floor、preset |
| ref | 对业务对象的引用快照，只保存必要字段 |
| diff | `before_ref` 和 `after_ref` 之间的摘要差异 |
| formal scope | 写入 `operation_log` 正式列的 scope 字段 |

## 安全边界

Operation Log 不保存完整提示词、完整用户消息、完整 LLM 输出、工具参数、工具结果或模型密钥。

写入日志时应只保存引用和摘要。敏感字段会被摘要 diff 默认遮蔽。

`workspace_id`、`project_id` 和 `actor_account_id` 只用于过滤和返回
调用方已经有权看到的日志，不会扩大可见范围。

例如，`POST /floors/:id/branch` 成功创建 checkout 分支时会写入
`checkout_branch`，目标类型是 `session_branch`。

引用中只包含分支 ID、来源楼层 ID 和资产绑定 ID / 版本 ID。
显式 reset 会写入 `reset_branch`。资产版本回滚会写入
`rollback_preset`、`rollback_worldbook` 或 `rollback_regex_profile`。
VC Tag 创建和删除会写入 `create_tag` / `delete_tag`。

## 备份与恢复

Operation Log 是审计数据。核心资产恢复不会用它重放业务状态，也不会要求备份文件必须包含日志。

`POST /backup/jobs/export` 的 `include_operation_logs` 有三个取值：

| 值 | 说明 |
| ---- | ---- |
| `none` | 默认值，不导出 Operation Log |
| `referenced` | 只导出被资产版本或 VC Tag 的 `created_by_operation_id` 引用到的日志 |
| `selected_scope` | 导出与已导出 session、floor、资产、资产版本、VC Tag 相关的日志 |

恢复时会为日志生成新 `id`。同一个 `operation_group_id` 会映射到同一个新分组 ID。
`request_id` 会清空，原始 ID 会保存在 `metadata.restore.source`。

## 列出操作日志

```http
GET /operation-logs
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `workspace_id` | string | 按正式 Workspace scope 过滤 |
| `project_id` | string | 按正式 Project scope 过滤 |
| `actor_account_id` | string | 按正式 actor account 过滤 |
| `session_id` | string | 按会话过滤 |
| `floor_id` | string | 按楼层过滤 |
| `run_id` | string | 按 run 过滤 |
| `target_type` | string | 按目标类型过滤，例如 `session` |
| `target_id` | string | 按目标 ID 过滤 |
| `action` | string | 按动作过滤，例如 `update_session` |
| `actor_type` | string | 按操作者类型过滤，例如 `user` |
| `status` | string | `succeeded` / `failed` / `denied` / `cancelled` |
| `operation_group_id` | string | 按操作分组过滤 |
| `request_id` | string | 按请求 ID 过滤 |
| `limit` | integer | 每页条数，默认 `50`，最大 `200` |
| `offset` | integer | 偏移量，默认 `0` |
| `sort_order` | string | `asc` / `desc`，默认 `desc` |

### 响应 `200`

```json
{
  "data": [
    {
      "id": "op_001",
      "account_id": "default-admin",
      "actor_type": "user",
      "actor_id": "default-admin",
      "operation_group_id": null,
      "request_id": "req-001",
      "workspace_id": "ws_default_default-admin",
      "project_id": "proj_session_sess_001",
      "actor_account_id": "default-admin",
      "source_type": "http",
      "action": "update_session",
      "status": "succeeded",
      "session_id": "sess_001",
      "branch_id": null,
      "floor_id": null,
      "run_id": null,
      "target_type": "session",
      "target_id": "sess_001",
      "before_ref": {
        "session_id": "sess_001",
        "title": "Old title"
      },
      "after_ref": {
        "session_id": "sess_001",
        "title": "New title"
      },
      "diff": {
        "mode": "summary",
        "total_changes": 1,
        "changes": [
          {
            "path": "title",
            "change_type": "changed"
          }
        ],
        "truncated": false,
        "max_bytes": 16000
      },
      "metadata": {
        "route": "PATCH /sessions/:id"
      },
      "created_at": 1735689600000
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

新增的 formal scope 字段含义如下：

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `workspace_id` | string \| null | 操作日志所属 Workspace。旧数据或系统日志可能为空 |
| `project_id` | string \| null | 操作日志所属 Project。旧数据或非 Project 级日志可能为空 |
| `actor_account_id` | string \| null | 归一化后的操作者账号 |

`actor_account_id` 的派生规则是：`actor_type = 'account'` 且
`actor_id` 非空时使用 `actor_id`，否则回退到 `account_id`。
都没有时返回 `null`。

## 列出某个会话的操作日志

```http
GET /sessions/:id/operation-logs
```

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 会话 ID |

### 查询参数

同 `GET /operation-logs`，但 `session_id` 会由路径参数决定。

### 响应 `200`

返回结构同 `GET /operation-logs`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 会话不存在，或不属于当前账号 |

## 列出某个楼层的操作日志

```http
GET /floors/:id/operation-logs
```

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 楼层 ID |

### 查询参数

同 `GET /operation-logs`，但 `floor_id` 会由路径参数决定。

### 响应 `200`

返回结构同 `GET /operation-logs`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 楼层不存在，或不属于当前账号 |
