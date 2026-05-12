---
outline: [2, 3]
---

# Backup（核心资产备份）

核心资产备份接口负责把一个账号下的 `characters`、`presets`、`worldbooks`、`regex_profiles`、`sessions` 导出为 `.thbackup` 文件，并支持在同一实例中做恢复预览与异步恢复。

当前导出的备份文件使用 `spec_version: "1.1.0"`，仍然可以恢复 `1.0.0` 文件。备份 v1 只支持 `create_copy`。恢复时会为所有资源分配新 ID，不会原地覆盖已有资源。

## 什么时候需要看这页

- 你要导出账号下的核心资产。
- 你要在恢复前先做结构校验、引用校验和重名规划。
- 你要通过后台作业执行较大的恢复任务。

## 一个简单例子

1. `POST /backup/jobs/export`：创建导出作业。
2. `GET /backup-jobs/:id`：轮询导出作业状态。
3. `GET /backup-jobs/:id/file`：下载导出的 `.thbackup` 文件。
4. 读取 `.thbackup` 的 JSON 内容，调用 `POST /backup/restore/preview`。
5. 确认 preview 结果后，再调用 `POST /backup/jobs/restore`。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| `.thbackup` | TavernHeadless 核心资产备份文件 |
| restore preview | 只做校验和恢复规划，不写数据库 |
| `create_copy` | 恢复时总是创建新资源，不覆盖旧资源 |
| `include_linked_assets` | 选中 session 时，是否自动补入它引用的 character、preset、worldbook 和 regex profile |
| `include_vc_tags` | 是否导出指向已导出 floor 或资产版本的 VC Tag，默认 `true` |
| `include_operation_logs` | 是否把相关 Operation Log 写入 `vc.operation_logs`，默认 `none` |

## 备份范围与限制

- 备份范围固定是 `characters`、`presets`、`worldbooks`、`regex_profiles`、`sessions`。
- session 子树会保留 `session_branch`、`floors`、`pages`、`messages`、branch 相关变量、branch local snapshot、chat / branch / floor 记忆和记忆边。
- `session_branch.asset_binding_*` 会写入 `sessions[].branches[].asset_binding`，恢复时会映射到新资产和新版本 ID。
- 默认会导出 VC Tag。Operation Log 是可选审计数据，不会用来重放业务状态。
- 不备份 `secrets`、`runtime_job`、`runtime_scope_state`、`global` variables、`global` memories 等非 v1 范围数据。
- preview 和 restore 都只接受 JSON 请求体，不支持 multipart。
- `POST /backup/restore/preview` 与 `POST /backup/jobs/restore` 的请求体大小由 `BACKUP_IMPORT_MAX_BYTES` 控制，默认 `50000000`。

## 创建导出作业

```http
POST /backup/jobs/export
```

创建一个核心资产导出作业。真正的快照抓取、序列化和产物写入会在后台 worker 中完成。

### 选择规则

- 如果不传任何选择字段，默认导出当前账号下五类核心资产。
- `domains` 可以把全量导出限制在某几个域内。
- 传入 `session_ids`、`character_ids`、`preset_ids`、`worldbook_ids`、`regex_profile_ids` 时，系统会把对应资源加入导出选择。
- 当 `include_linked_assets=true` 时，选中的 session 会自动补入它引用的 character、preset、worldbook 和 regex profile。
- 当 `include_linked_assets=false` 时，如果 session 仍然引用了未选中的 character、preset、worldbook 或 regex profile，会返回 `400 backup_incomplete_selection`。
- preset、worldbook、regex profile 会带上对应不可变版本行。session 的 `deep_binding` 和版本引用也会写入备份文件。

### 请求体

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `domains` | string[] | 否 | 当前全量导出范围 | 可选值：`characters`、`presets`、`worldbooks`、`regex_profiles`、`sessions` |
| `session_ids` | string[] | 否 | - | 指定要导出的 session |
| `character_ids` | string[] | 否 | - | 指定要导出的 character |
| `preset_ids` | string[] | 否 | - | 指定要导出的 preset |
| `worldbook_ids` | string[] | 否 | - | 指定要导出的 worldbook |
| `regex_profile_ids` | string[] | 否 | - | 指定要导出的 regex profile |
| `include_linked_assets` | boolean | 否 | `true` | 选中 session 时，是否自动补入它引用的角色、预设、世界书与正则配置 |
| `include_vc_tags` | boolean | 否 | `true` | 是否导出指向已导出 floor 或资产版本的 VC Tag |
| `include_operation_logs` | string | 否 | `none` | `none` 不导出日志；`referenced` 只导出资产版本和 VC Tag 引用的日志；`selected_scope` 导出与已导出 session、floor、资产、资产版本、VC Tag 相关的日志 |
| `include_secrets` | boolean | 否 | `false` | v1 固定只能为 `false` |

### 请求示例

```json
{
  "session_ids": ["sess_001"],
  "include_linked_assets": true,
  "include_vc_tags": true,
  "include_operation_logs": "referenced"
}
```

### 响应 `202`

```json
{
  "data": {
    "job_id": "backup-job:export_core_assets:abc123",
    "job_kind": "export_core_assets",
    "status": "pending",
    "phase": "queued"
  }
}
```

### 导出文件名

后台导出成功后，下载接口返回的文件名固定遵循下面规则：

- 全量导出：`core-assets-YYYYMMDD-HHmmss.thbackup`
- 选择导出：`core-assets-selection-YYYYMMDD-HHmmss.thbackup`

文件名不带 `accountId`，也不带 session title。

### 错误

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| `400` | `validation_error` | 请求体字段不合法 |
| `400` | `backup_incomplete_selection` | 关闭自动补链后，选中的 session 仍引用了未选中的角色、预设、世界书或正则配置 |
| `400` | `backup_selection_not_found` | 指定的 session / character / preset / worldbook / regex profile 不存在 |
| `400` | `backup_secrets_unsupported` | `include_secrets=true`，但 v1 不支持 |
| `503` | `resource_busy` | 入队写入暂时繁忙 |

## 恢复预览

```http
POST /backup/restore/preview
```

对 `.thbackup` 文件做同步预检。这个接口不会写数据库。

### 请求体

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `data` | object | 是 | - | `.thbackup` 文件解析后的 JSON 对象 |
| `mode` | string | 否 | `create_copy` | v1 只支持 `create_copy` |

### 请求示例

```json
{
  "data": {
    "spec": "tavern_headless_backup",
    "spec_version": "1.1.0",
    "backup_kind": "account_core_assets",
    "created_at": 1735689600000,
    "source": {
      "account_id": "acc_demo"
    },
    "included_domains": ["characters", "presets", "worldbooks", "regex_profiles", "sessions"],
    "options": {
      "include_secrets": false
    },
    "resources": {
      "characters": [],
      "presets": [],
      "worldbooks": [],
      "regex_profiles": []
    },
    "sessions": [],
    "vc": {
      "tags": [],
      "operation_logs": []
    },
    "extensions": {
      "secrets": {
        "mode": "excluded"
      }
    }
  },
  "mode": "create_copy"
}
```

### 响应 `200`

```json
{
  "data": {
    "backup_kind": "account_core_assets",
    "restore_mode": "create_copy",
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
      "memory_edges": 2,
      "vc_tags": 1,
      "operation_logs": 1
    },
    "will_create": {
      "characters": 1,
      "presets": 1,
      "worldbooks": 1,
      "regex_profiles": 1,
      "sessions": 1
    },
    "renamed_resources": [
      {
        "type": "session",
        "old_name": "Story A",
        "new_name": "Story A (restored)"
      }
    ],
    "dropped_bindings": {
      "users": 1,
      "presets": 1,
      "regex_profiles": 1
    },
    "warnings": [
      {
        "code": "restore_drops_user_binding",
        "message": "1 个 session 的 user 绑定将在 restore 时清空"
      }
    ]
  }
}
```

### preview 会告诉你什么

- 文件头是否是合法的 TavernHeadless 备份文件。
- `spec_version` 是否被当前服务接受。
- 文件内部引用是否完整。
- 恢复后会新建多少顶层资源。
- 哪些资源会因为重名而自动改名。
- 哪些 session 绑定会在恢复时被清空。
- 哪些 Operation Log 或 `created_by_operation_id` 引用会因为备份中没有对应日志而在恢复时清空。

### 错误

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| `400` | `validation_error` | 请求体字段不合法 |
| `400` | `backup_invalid_spec` | `spec` 不是 TavernHeadless 备份文件 |
| `400` | `backup_unsupported_version` | `spec_version` 当前不受支持 |
| `400` | `backup_restore_mode_unsupported` | 请求了 v1 不支持的恢复模式 |
| `400` | `backup_invalid_structure` | 文件结构不合法 |
| `400` | `backup_invalid_reference` | 文件内部引用不合法 |
| `413` | `backup_payload_too_large` | 请求体超过 `BACKUP_IMPORT_MAX_BYTES` |

## 创建恢复作业

```http
POST /backup/jobs/restore
```

创建一个核心资产恢复作业。真正的写库、ID 重映射、branch registry 恢复和记忆 runtime state 重建由后台 worker 完成。

### 请求体

与 `POST /backup/restore/preview` 相同：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `data` | object | 是 | - | `.thbackup` 文件解析后的 JSON 对象 |
| `mode` | string | 否 | `create_copy` | v1 只支持 `create_copy` |

### 响应 `202`

```json
{
  "data": {
    "job_id": "backup-job:restore_core_assets:def456",
    "job_kind": "restore_core_assets",
    "status": "pending",
    "phase": "queued"
  }
}
```

### 恢复语义

- 所有恢复出的资源都会分配新 ID。
- session 会保留 `character_snapshot_json`、`character_sync_policy`、`user_snapshot_json`、`prompt_mode`、`model_provider`、`model_name`、`model_params_json`、`metadata_json`。
- session 会恢复 `deep_binding`，并把 `preset_id`、`worldbook_profile_id`、`regex_profile_id` 以及对应版本引用映射到新资源和新版本行。
- `user_id` 会被清空，因为 user 资产不在 v1 备份范围内。
- 旧格式备份中只有 `preset_id` 或 `regex_profile_id`、但没有对应资源引用时，这些绑定仍会在 restore 时清空。
- branch 变量 scope 和 branch 记忆 scope 会按恢复后的新 session / branch 重建。
- 记忆相关 `runtime_scope_state` 不进入备份文件，但会在 restore 时重建。
- VC Tag 会恢复为新标签名和新 ID，目标 floor 或资产版本会映射到恢复后的新 ID。
- 如果备份中包含 `vc.operation_logs`，Operation Log 会生成新 ID，`operation_group_id` 会按组映射，`request_id` 会清空。
- 恢复后的 Operation Log 会在 `metadata.restore.source` 中保存原始 `operation_log_id`、`operation_group_id`、`request_id` 和 `run_id`。
- `1.1.0` 文件中的 `created_by_operation_id` 只有在对应 Operation Log 也被导入时才会恢复；否则恢复为 `null`。`1.0.0` 文件保留旧行为。

### 错误

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| `400` | `validation_error` | 请求体字段不合法 |
| `400` | `backup_invalid_spec` | `spec` 非法 |
| `400` | `backup_unsupported_version` | `spec_version` 不受支持 |
| `400` | `backup_restore_mode_unsupported` | 请求了 v1 不支持的恢复模式 |
| `400` | `backup_invalid_structure` | 文件结构不合法 |
| `400` | `backup_invalid_reference` | 文件内部引用不合法 |
| `413` | `backup_payload_too_large` | 请求体超过大小限制 |
| `503` | `resource_busy` | 入队写入暂时繁忙 |

## 后续流程

- 导出作业与恢复作业的状态轮询、取消、重试和文件下载，请看 [Backup Jobs（备份作业）](./backup-jobs)。
- 生产环境建议为 backup 单独运行 worker：`pnpm --filter @tavern/api jobs:backup`。
