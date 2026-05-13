# 数据库数据字典（apps/api）

本文档记录 `apps/api` 当前 SQLite schema 的字段含义、枚举约束与索引约定。

## 迁移与版本

- ORM: Drizzle ORM
- 迁移目录: `apps/api/drizzle/`
- 当前基础迁移: `0000_initial_schema.sql`
- 当前最新迁移: `0056_project_events_observer_scope.sql`

## Workspace / Project scope 规则

阶段一引入 Workspace / Project。阶段二增加 Project Event、ProjectMembership 和 observer 只读访问，但仍保持旧 API 兼容：

- 普通客户端不需要传 `workspace_id` 或 `project_id`。
- `POST /sessions` 可选传 `project_id`。不传时，服务端使用当前账号默认 Workspace，并为该 Session 创建 `session_default` Project。
- Session 默认响应不暴露 `workspace_id` 和 `project_id`。
- `GET /sessions/:id/scope` 可以显式读取 Session 的 Workspace / Project 归属。
- Project owner 可以读写；Project observer 只能读取 Project 范围内的会话、资源和 Project Event。
- 非 Project 成员访问 Project 下资源时，继续按旧账号隔离规则隐藏资源。Project API 通常返回 `404 project_not_found`，旧资源路由通常返回 `404 not_found`。
- Prompt Asset、角色、用户卡、LLM 配置、工具定义和 MCP Server Config 的旧列表接口默认只读当前账号默认 Workspace。
- scope 字段仍保留兼容性 nullable。服务层保证新写入数据有明确 Workspace / Project，旧数据中的 `NULL` 视为默认 Workspace 资源。

当前新增或补齐的 scope 字段如下：

| 表 | 字段 | 说明 |
| ---- | ---- | ---- |
| `workspace` | `account_id` | Workspace 属于账号 |
| `project` | `account_id`, `workspace_id` | Project 属于账号和 Workspace |
| `session` | `workspace_id`, `project_id` | Session 同时保存 Workspace 和 Project，便于查询与审计 |
| `project_membership` | `workspace_id`, `project_id`, `account_id` | Project 成员关系。阶段二只支持 owner 和 observer |
| `project_event_sequence` | `project_id` | 每个 Project 独立分配递增事件序号 |
| `project_event` | `workspace_id`, `project_id` | Project 事件日志，按 Project sequence 递增 |
| `operation_log` | `workspace_id`, `project_id`, `actor_account_id` | 操作日志补齐正式 scope 列，便于按 Workspace / Project 查询 |
| `account_user` | `workspace_id` | 用户卡归属 Workspace |
| `character` | `workspace_id` | 角色归属 Workspace |
| `preset` | `workspace_id` | Preset 归属 Workspace |
| `worldbook` | `workspace_id` | Worldbook 归属 Workspace |
| `regex_profile` | `workspace_id` | Regex Profile 归属 Workspace |
| `llm_profile` | `workspace_id` | LLM Profile 归属 Workspace |
| `llm_profile_binding` | `workspace_id` | `global` scope 阶段一表示默认 Workspace 配置；`session` scope 使用 Session Workspace |
| `llm_instance_config` | `workspace_id` | `global` scope 阶段一表示默认 Workspace 配置；`session` scope 使用 Session Workspace |
| `tool_definition` | `workspace_id` | 自定义工具定义归属 Workspace |
| `mcp_server_config` | `workspace_id` | MCP Server Config 归属 Workspace |

## `account`

账号主表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 账号 ID |
| `name` | `TEXT` | `NOT NULL` | 账号名称 |
| `role` | `TEXT` | `NOT NULL`, default `user` | 账号角色 |
| `status` | `TEXT` | `NOT NULL`, default `active` | 账号状态 |
| `is_default` | `INTEGER` | `NOT NULL`, default `0` | 是否默认账号（布尔） |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：

- `role`: `admin | user`
- `status`: `active | disabled`

## `workspace`

工作区主表。每个账号必须有且只有一个默认 Workspace（`is_default = 1`）。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | Workspace ID，格式 `ws_default_${account_id}` |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id` | 所属账号 |
| `name` | `TEXT` | `NOT NULL` | Workspace 名称 |
| `kind` | `TEXT` | `NOT NULL`, default `default` | Workspace 类型，阶段一固定为 `default` |
| `is_default` | `INTEGER` | `NOT NULL`, default `0` | 是否默认 Workspace（布尔） |
| `status` | `TEXT` | `NOT NULL`, default `active` | 状态 |
| `settings_json` | `TEXT` | `NOT NULL`, default `'{}'` | Workspace 级设置 JSON |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：

- `status`: `active | archived`

索引：

- 部分唯一索引 `workspace_account_default_uq(account_id)` `WHERE is_default = 1`
- 普通索引 `workspace_account_updated_idx(account_id, updated_at)`

## `project`

项目表。每个 Session 必须有一个 Project。不传 `project_id` 时系统为 Session 自动创建 `session_default` Project。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | Project ID |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id` | 所属账号 |
| `workspace_id` | `TEXT` | `NOT NULL`, FK -> `workspace.id` | 所属 Workspace |
| `name` | `TEXT` | `NOT NULL` | Project 名称 |
| `description` | `TEXT` | `NULL` | Project 说明 |
| `kind` | `TEXT` | `NOT NULL`, default `session_default` | Project 类型 |
| `status` | `TEXT` | `NOT NULL`, default `active` | 状态 |
| `settings_override_json` | `TEXT` | `NOT NULL`, default `'{}'` | Project 级设置覆盖 JSON |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：

- `kind`: `session_default | manual`
- `status`: `active | archived`
## `project_event_sequence`

Project Event 序号表。每个 Project 一行，用于分配单调递增的事件序号。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `project_id` | `TEXT` | PK, FK -> `project.id`, `ON DELETE RESTRICT` | Project ID |
| `current_sequence` | `INTEGER` | `NOT NULL`, default `0` | 当前已分配到的最大序号 |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

说明：

- Project Event 序号通过这张表分配，不使用 `MAX(sequence)`。
- 同一个 Project 内 sequence 单调递增。

## `project_membership`

Project 成员关系表。阶段二只支持 `owner` 和 `observer` 两种角色。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 成员关系 ID，格式 `pmem_` 前缀。迁移回填 owner 使用确定性 ID |
| `workspace_id` | `TEXT` | `NOT NULL`, FK -> `workspace.id`, `ON DELETE RESTRICT` | 所属 Workspace |
| `project_id` | `TEXT` | `NOT NULL`, FK -> `project.id`, `ON DELETE RESTRICT` | 所属 Project |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id`, `ON DELETE RESTRICT` | 成员账号 |
| `role` | `TEXT` | `NOT NULL` | 成员角色 |
| `status` | `TEXT` | `NOT NULL`, default `active` | 成员关系状态 |
| `created_by_account_id` | `TEXT` | `NULL`, FK -> `account.id`, `ON DELETE SET NULL` | 创建该成员关系的账号 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：

- `role`: `owner | observer`
- `status`: `active | removed`

索引：

- 唯一索引 `project_membership_project_account_uq(project_id, account_id)`
- 普通索引 `project_membership_account_status_idx(account_id, status)`
- 普通索引 `project_membership_project_role_status_idx(project_id, role, status)`

说明：

- owner 可以读写 Project 下资源。
- observer 只能读取 Project 下资源和 `visibility=project` 的 Project Event。
- 阶段二不支持 observer 写入，也不支持移除 owner。

## `project_event`

Project 事件日志表。它保存 Project 范围内可供轮询和 SSE 消费的事件摘要。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 事件 ID，格式 `evt_` 前缀 |
| `workspace_id` | `TEXT` | `NOT NULL`, FK -> `workspace.id`, `ON DELETE RESTRICT` | 所属 Workspace |
| `project_id` | `TEXT` | `NOT NULL`, FK -> `project.id`, `ON DELETE RESTRICT` | 所属 Project |
| `sequence` | `INTEGER` | `NOT NULL` | Project 内递增序号 |
| `type` | `TEXT` | `NOT NULL` | 事件类型，如 `session.created`、`message.updated` |
| `visibility` | `TEXT` | `NOT NULL`, default `project` | 可见性 |
| `source` | `TEXT` | `NOT NULL`, default `api` | 事件来源 |
| `actor_account_id` | `TEXT` | `NULL`, FK -> `account.id`, `ON DELETE SET NULL` | 触发事件的账号 |
| `session_id` | `TEXT` | `NULL`, FK -> `session.id`, `ON DELETE SET NULL` | 关联 Session |
| `branch_id` | `TEXT` | `NULL` | 关联分支 |
| `floor_id` | `TEXT` | `NULL`, FK -> `floor.id`, `ON DELETE SET NULL` | 关联楼层 |
| `page_id` | `TEXT` | `NULL`, FK -> `message_page.id`, `ON DELETE SET NULL` | 关联消息页 |
| `message_id` | `TEXT` | `NULL`, FK -> `message.id`, `ON DELETE SET NULL` | 关联消息 |
| `operation_log_id` | `TEXT` | `NULL`, FK -> `operation_log.id`, `ON DELETE SET NULL` | 关联操作日志 |
| `correlation_id` | `TEXT` | `NULL` | 相关请求或批处理 ID |
| `causation_event_id` | `TEXT` | `NULL`, FK -> `project_event.id`, `ON DELETE SET NULL` | 原因事件 ID |
| `payload_json` | `TEXT` | `NOT NULL`, default `'{}'` | 事件负载摘要 JSON |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

枚举约束：

- `visibility`: `project | owner | internal`
- `source`: `api | runtime_job | migration | system`

索引：

- 唯一索引 `project_event_project_sequence_uq(project_id, sequence)`
- 普通索引 `project_event_project_sequence_idx(project_id, sequence)`
- 普通索引 `project_event_workspace_created_idx(workspace_id, created_at)`
- 普通索引 `project_event_project_created_idx(project_id, created_at)`
- 普通索引 `project_event_session_sequence_idx(session_id, sequence)`
- 普通索引 `project_event_project_type_sequence_idx(project_id, type, sequence)`
- 普通索引 `project_event_operation_log_idx(operation_log_id)`

说明：

- `payload_json` 只保存摘要，不保存 API Key、密钥、完整 prompt、MCP secret、完整异常堆栈或完整模型输出。
- owner 可见 `project` 和 `owner` 事件。
- observer 只可见 `project` 事件。
- `internal` 事件为内部保留，不对普通 Project 读取接口返回。



索引：

- 普通索引 `project_account_workspace_updated_idx(account_id, workspace_id, updated_at)`
- 普通索引 `project_workspace_updated_idx(workspace_id, updated_at)`
- 普通索引 `project_account_status_updated_idx(account_id, status, updated_at)`


## `account_user`

账号内用户卡（第一类角色卡）主表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 用户卡 ID |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id`, default `default-admin` | 所属账号 |
| `name` | `TEXT` | `NOT NULL` | 用户卡名称（快照中的主名称） |
| `snapshot_json` | `TEXT` | `NOT NULL` | 用户卡快照 JSON |
| `status` | `TEXT` | `NOT NULL`, default `active` | 用户卡状态 |
| `workspace_id` | `TEXT` | `NULL`, FK -> `workspace.id` | Workspace ID。阶段一为 nullable，服务层保证新数据不为空。旧数据 null 视为默认 Workspace 资源 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：

- `status`: `active | disabled | deleted`

索引：

- 普通索引 `account_user_account_updated_idx(account_id, updated_at)`
- 普通索引 `account_user_account_workspace_updated_idx(account_id, workspace_id, updated_at)`
- 唯一索引 `account_user_account_name_uq(account_id, name)`

## `character`

角色模板主表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 角色 ID |
| `name` | `TEXT` | `NOT NULL` | 角色名 |
| `source` | `TEXT` | `NOT NULL`, default `sillytavern` | 来源 |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id`, default `default-admin` | 所属账号 |
| `status` | `TEXT` | `NOT NULL`, default `active` | 状态 |
| `workspace_id` | `TEXT` | `NULL`, FK -> `workspace.id` | Workspace ID。阶段一为 nullable，服务层保证新数据不为空。旧数据 null 视为默认 Workspace 资源 |
| `deleted_at` | `INTEGER` | `NULL` | 软删除时间（ms） |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

索引：

- 普通索引 `character_account_updated_idx(account_id, updated_at)`
- 普通索引 `character_account_workspace_updated_idx(account_id, workspace_id, updated_at)`

枚举约束：

- `status`: `active | deleted`

## `character_version`

角色版本表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 版本 ID |
| `character_id` | `TEXT` | `NOT NULL`, FK -> `character.id` | 所属角色 |
| `version_no` | `INTEGER` | `NOT NULL` | 版本号（递增） |
| `data_json` | `TEXT` | `NOT NULL` | 角色快照 JSON |
| `content_hash` | `TEXT` | `NOT NULL` | 内容哈希 |
| `source_artifact_json` | `TEXT` | `NULL` | 导入来源原始工件 JSON |
| `source_artifact_format` | `TEXT` | `NULL` | 导入来源格式 |
| `source_artifact_digest` | `TEXT` | `NULL` | 导入来源工件哈希 |
| `created_by_operation_id` | `TEXT` | `NULL` | 创建该版本的操作日志 ID |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

索引：

- 唯一索引 `character_version_character_no_uq(character_id, version_no)`
- 普通索引 `character_version_character_created_idx(character_id, created_at)`

## `session`

会话主表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 会话 ID（nanoid） |
| `title` | `TEXT` | `NULL` | 会话标题 |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id`, default `default-admin` | 所属账号 |
| `status` | `TEXT` | `NOT NULL`, default `active` | 会话状态 |
| `character_id` | `TEXT` | `NULL`, FK -> `character.id` | 绑定角色 ID |
| `character_version_id` | `TEXT` | `NULL`, FK -> `character_version.id` | 绑定角色版本 ID |
| `character_snapshot_json` | `TEXT` | `NULL` | 冻结角色快照 |
| `character_sync_policy` | `TEXT` | `NOT NULL`, default `pin` | 角色同步策略 |
| `user_id` | `TEXT` | `NULL`, FK -> `account_user.id` | 绑定用户卡 ID |
| `user_snapshot_json` | `TEXT` | `NULL` | 冻结用户卡快照 |
| `preset_id` | `TEXT` | `NULL` | 预设配置 ID |
| `regex_profile_id` | `TEXT` | `NULL` | 正则配置 ID |
| `worldbook_profile_id` | `TEXT` | `NULL` | 世界书配置 ID |
| `deep_binding` | `INTEGER` | `NOT NULL`, default `0` | 是否启用深度资产版本绑定 |
| `preset_version_id` | `TEXT` | `NULL` | 绑定的 Preset 版本 ID |
| `worldbook_version_id` | `TEXT` | `NULL` | 绑定的 Worldbook 版本 ID |
| `regex_profile_version_id` | `TEXT` | `NULL` | 绑定的 Regex Profile 版本 ID |
| `model_provider` | `TEXT` | `NULL` | 模型服务商 |
| `model_name` | `TEXT` | `NULL` | 模型名称 |
| `model_params_json` | `TEXT` | `NULL` | 模型参数 JSON |
| `prompt_mode` | `TEXT` | `NULL` | Prompt 模式 |
| `metadata_json` | `TEXT` | `NULL` | 扩展元信息 JSON |
| `workspace_id` | `TEXT` | `NULL` | Workspace ID。阶段一为 nullable，服务层保证新数据不为空。可通过 `project_id` 推导，冗余保留用于查询 |
| `project_id` | `TEXT` | `NULL` | Project ID。阶段一为 nullable，服务层保证新数据不为空 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：

- `status`: `active | archived`
- `character_sync_policy`: `pin | manual | force`
- `prompt_mode`: `compat_strict | compat_plus | native`

索引：

- 普通索引 `session_account_updated_idx(account_id, updated_at)`
- 普通索引 `session_account_workspace_updated_idx(account_id, workspace_id, updated_at)`
- 普通索引 `session_account_project_updated_idx(account_id, project_id, updated_at)`
- 普通索引 `session_project_updated_idx(project_id, updated_at)`

## `floor`

会话内楼层（回合）。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 楼层 ID |
| `session_id` | `TEXT` | `NOT NULL`, FK -> `session.id` | 所属会话 |
| `floor_no` | `INTEGER` | `NOT NULL` | 楼层编号 |
| `branch_id` | `TEXT` | `NOT NULL`, default `main` | 分支标识 |
| `parent_floor_id` | `TEXT` | `NULL` | 父楼层 ID |
| `superseded_at` | `INTEGER` | `NULL` | 被替代时间戳（ms） |
| `superseded_by_floor_id` | `TEXT` | `NULL` | 替代它的新楼层 ID |
| `state` | `TEXT` | `NOT NULL`, default `draft` | 楼层状态 |
| `metadata_json` | `TEXT` | `NULL` | 楼层元信息（含 `user_binding`） |
| `token_in` | `INTEGER` | `NOT NULL`, default `0` | 输入 token 计数 |
| `token_out` | `INTEGER` | `NOT NULL`, default `0` | 输出 token 计数 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：

- `state`: `draft | generating | committed | failed`

索引：

- 部分唯一索引 `floor_session_no_branch_live_uq(session_id, floor_no, branch_id)` `WHERE superseded_at IS NULL`
- 普通索引 `floor_session_branch_state_no_idx(session_id, branch_id, state, floor_no)`
- 部分索引 `floor_session_branch_live_state_no_idx(session_id, branch_id, state, floor_no)` `WHERE superseded_at IS NULL`

说明：

- `superseded_at IS NULL` 表示 live floor
- `superseded_at IS NOT NULL` 表示该楼层已经被后续 regenerate 替代，但记录仍保留用于审计与追溯

## `session_branch`

会话分支登记表。它记录分支来源，也保存 checkout 分支的可选资产绑定引用。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 分支登记行 ID |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id` | 所属账号 |
| `session_id` | `TEXT` | `NOT NULL`, FK -> `session.id` | 所属会话 |
| `branch_id` | `TEXT` | `NOT NULL` | 分支标识 |
| `source_floor_id` | `TEXT` | `NULL`, FK -> `floor.id` | 分支来源楼层 |
| `source_branch_id` | `TEXT` | `NULL` | 分支来源分支 |
| `asset_binding_deep_binding` | `INTEGER` | `NULL` | 分支级资产绑定是否启用深度绑定；`NULL` 表示没有分支级覆盖 |
| `asset_binding_preset_id` | `TEXT` | `NULL`, FK -> `preset.id` | 分支级 Preset 绑定 |
| `asset_binding_preset_version_id` | `TEXT` | `NULL`, FK -> `preset_version.id` | 分支级 Preset 版本绑定 |
| `asset_binding_worldbook_profile_id` | `TEXT` | `NULL`, FK -> `worldbook.id` | 分支级 Worldbook 绑定 |
| `asset_binding_worldbook_version_id` | `TEXT` | `NULL`, FK -> `worldbook_version.id` | 分支级 Worldbook 版本绑定 |
| `asset_binding_regex_profile_id` | `TEXT` | `NULL`, FK -> `regex_profile.id` | 分支级 Regex Profile 绑定 |
| `asset_binding_regex_profile_version_id` | `TEXT` | `NULL`, FK -> `regex_profile_version.id` | 分支级 Regex Profile 版本绑定 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

索引：

- 唯一索引 `session_branch_account_session_branch_uq(account_id, session_id, branch_id)`
- 普通索引 `session_branch_account_session_created_idx(account_id, session_id, created_at)`
- 普通索引 `session_branch_account_session_branch_created_idx(account_id, session_id, branch_id, created_at)`

说明：

- `source_floor_id` / `source_branch_id` 表达非破坏性 checkout 或分支创建的来源。
- `asset_binding_*` 字段只在分支需要固定自己的资产绑定时使用。字段全为 `NULL` 时，运行时继续使用 session 级资产绑定。

## `preset`

Preset 主表。保存当前预设内容，版本历史写入 `preset_version`。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | Preset ID |
| `name` | `TEXT` | `NOT NULL` | Preset 名称 |
| `source` | `TEXT` | `NOT NULL`, default `sillytavern` | 来源 |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id` | 所属账号 |
| `workspace_id` | `TEXT` | `NULL`, FK -> `workspace.id` | Workspace ID。阶段一为 nullable，服务层保证新数据不为空。旧数据 null 视为默认 Workspace 资源 |
| `data_json` | `TEXT` | `NOT NULL` | 当前 Preset 内容 JSON |
| `version` | `INTEGER` | `NOT NULL`, default `1` | 当前版本号 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

索引：

- 普通索引 `preset_account_updated_idx(account_id, updated_at)`
- 普通索引 `preset_account_workspace_updated_idx(account_id, workspace_id, updated_at)`

## `worldbook`

Worldbook 主表。保存当前世界书内容，条目写入 `worldbook_entry`，版本历史写入 `worldbook_version`。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | Worldbook ID |
| `name` | `TEXT` | `NOT NULL` | Worldbook 名称 |
| `source` | `TEXT` | `NOT NULL`, default `sillytavern` | 来源 |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id` | 所属账号 |
| `workspace_id` | `TEXT` | `NULL`, FK -> `workspace.id` | Workspace ID。阶段一为 nullable，服务层保证新数据不为空。旧数据 null 视为默认 Workspace 资源 |
| `data_json` | `TEXT` | `NOT NULL` | 当前 Worldbook 内容 JSON |
| `version` | `INTEGER` | `NOT NULL`, default `1` | 当前版本号 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

索引：

- 普通索引 `worldbook_account_updated_idx(account_id, updated_at)`
- 普通索引 `worldbook_account_workspace_updated_idx(account_id, workspace_id, updated_at)`

## `regex_profile`

Regex Profile 主表。保存当前正则配置，版本历史写入 `regex_profile_version`。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | Regex Profile ID |
| `name` | `TEXT` | `NOT NULL` | Regex Profile 名称 |
| `source` | `TEXT` | `NOT NULL`, default `sillytavern` | 来源 |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id` | 所属账号 |
| `workspace_id` | `TEXT` | `NULL`, FK -> `workspace.id` | Workspace ID。阶段一为 nullable，服务层保证新数据不为空。旧数据 null 视为默认 Workspace 资源 |
| `data_json` | `TEXT` | `NOT NULL` | 当前 Regex Profile 内容 JSON |
| `version` | `INTEGER` | `NOT NULL`, default `1` | 当前版本号 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

索引：

- 普通索引 `regex_profile_account_updated_idx(account_id, updated_at)`
- 普通索引 `regex_profile_account_workspace_updated_idx(account_id, workspace_id, updated_at)`


## `preset_version`

Preset 版本表。主表 `preset` 保存当前内容，本表保存每次写入后的不可变快照，用于深度绑定、审计和历史回放。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | Preset 版本 ID |
| `preset_id` | `TEXT` | `NOT NULL`, FK -> `preset.id`, `ON DELETE CASCADE` | 所属 Preset |
| `parent_version_id` | `TEXT` | `NULL`, FK -> `preset_version.id`, `ON DELETE SET NULL` | 父版本 ID |
| `version_no` | `INTEGER` | `NOT NULL` | 版本号。同一 Preset 内递增 |
| `data_json` | `TEXT` | `NOT NULL` | Preset 快照 JSON |
| `content_hash` | `TEXT` | `NOT NULL` | 内容哈希 |
| `created_by_operation_id` | `TEXT` | `NULL` | 创建该版本的操作日志 ID。当前只存文本，不加外键 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

索引：

- 唯一索引 `preset_version_preset_no_uq(preset_id, version_no)`
- 普通索引 `preset_version_preset_created_idx(preset_id, created_at)`
- 普通索引 `preset_version_content_hash_idx(content_hash)`

说明：

- `parent_version_id` 是同表自引用外键，删除父版本时置为 `NULL`。
- `created_by_operation_id` 第一版只记录引用值，不约束到 `operation_log.id`。

## `worldbook_version`

Worldbook 版本表。主表 `worldbook` 和 `worldbook_entry` 保存当前内容，本表保存组合后的世界书快照。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | Worldbook 版本 ID |
| `worldbook_id` | `TEXT` | `NOT NULL`, FK -> `worldbook.id`, `ON DELETE CASCADE` | 所属 Worldbook |
| `parent_version_id` | `TEXT` | `NULL`, FK -> `worldbook_version.id`, `ON DELETE SET NULL` | 父版本 ID |
| `version_no` | `INTEGER` | `NOT NULL` | 版本号。同一 Worldbook 内递增 |
| `data_json` | `TEXT` | `NOT NULL` | Worldbook 快照 JSON |
| `content_hash` | `TEXT` | `NOT NULL` | 内容哈希 |
| `created_by_operation_id` | `TEXT` | `NULL` | 创建该版本的操作日志 ID。当前只存文本，不加外键 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

索引：

- 唯一索引 `worldbook_version_worldbook_no_uq(worldbook_id, version_no)`
- 普通索引 `worldbook_version_worldbook_created_idx(worldbook_id, created_at)`
- 普通索引 `worldbook_version_content_hash_idx(content_hash)`

说明：

- `parent_version_id` 是同表自引用外键，删除父版本时置为 `NULL`。
- `created_by_operation_id` 第一版只记录引用值，不约束到 `operation_log.id`。

## `regex_profile_version`

Regex Profile 版本表。主表 `regex_profile` 保存当前正则配置，本表保存每次写入后的不可变快照。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | Regex Profile 版本 ID |
| `regex_profile_id` | `TEXT` | `NOT NULL`, FK -> `regex_profile.id`, `ON DELETE CASCADE` | 所属 Regex Profile |
| `parent_version_id` | `TEXT` | `NULL`, FK -> `regex_profile_version.id`, `ON DELETE SET NULL` | 父版本 ID |
| `version_no` | `INTEGER` | `NOT NULL` | 版本号。同一 Regex Profile 内递增 |
| `data_json` | `TEXT` | `NOT NULL` | Regex Profile 快照 JSON |
| `content_hash` | `TEXT` | `NOT NULL` | 内容哈希 |
| `created_by_operation_id` | `TEXT` | `NULL` | 创建该版本的操作日志 ID。当前只存文本，不加外键 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

索引：

- 唯一索引 `regex_profile_version_profile_no_uq(regex_profile_id, version_no)`
- 普通索引 `regex_profile_version_profile_created_idx(regex_profile_id, created_at)`
- 普通索引 `regex_profile_version_content_hash_idx(content_hash)`

说明：

- `parent_version_id` 是同表自引用外键，删除父版本时置为 `NULL`。
- `created_by_operation_id` 第一版只记录引用值，不约束到 `operation_log.id`。

## `operation_log`

操作日志表。它记录会影响统一 VC 追溯的写操作，是 append-only 记录。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 操作日志 ID |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id`, `ON DELETE RESTRICT` | 所属账号 |
| `actor_type` | `TEXT` | `NOT NULL` | 操作者类型 |
| `actor_id` | `TEXT` | `NULL` | 操作者 ID |
| `operation_group_id` | `TEXT` | `NULL` | 操作组 ID |
| `request_id` | `TEXT` | `NULL` | 请求 ID |
| `source_type` | `TEXT` | `NOT NULL` | 操作来源类型 |
| `action` | `TEXT` | `NOT NULL` | 操作动作 |
| `status` | `TEXT` | `NOT NULL` | 操作状态 |
| `session_id` | `TEXT` | `NULL` | 关联会话 ID |
| `branch_id` | `TEXT` | `NULL` | 关联分支 ID |
| `floor_id` | `TEXT` | `NULL` | 关联楼层 ID |
| `run_id` | `TEXT` | `NULL` | 关联 run ID |
| `target_type` | `TEXT` | `NOT NULL` | 目标类型 |
| `target_id` | `TEXT` | `NULL` | 目标 ID |
| `before_ref_json` | `TEXT` | `NULL` | 变更前引用 JSON |
| `after_ref_json` | `TEXT` | `NULL` | 变更后引用 JSON |
| `diff_json` | `TEXT` | `NULL` | 摘要 diff JSON |
| `workspace_id` | `TEXT` | `NULL`, FK -> `workspace.id`, `ON DELETE SET NULL` | 关联 Workspace |
| `project_id` | `TEXT` | `NULL`, FK -> `project.id`, `ON DELETE SET NULL` | 关联 Project |
| `actor_account_id` | `TEXT` | `NULL`, FK -> `account.id`, `ON DELETE SET NULL` | 实际执行动作的账号 |
| `metadata_json` | `TEXT` | `NULL` | 元信息 JSON |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

枚举约束：

- `status`: `succeeded | failed | denied | cancelled`

索引：

- 普通索引 `operation_log_account_created_idx(account_id, created_at)`
- 普通索引 `operation_log_session_created_idx(session_id, created_at)`
- 普通索引 `operation_log_account_target_created_idx(account_id, target_type, target_id, created_at)`
- 普通索引 `operation_log_group_idx(operation_group_id)`
- 普通索引 `operation_log_request_idx(request_id)`
- 普通索引 `operation_log_floor_created_idx(floor_id, created_at)`
- 普通索引 `operation_log_run_created_idx(run_id, created_at)`
- 普通索引 `operation_log_workspace_created_idx(workspace_id, created_at)`
- 普通索引 `operation_log_project_created_idx(project_id, created_at)`
- 普通索引 `operation_log_actor_account_created_idx(actor_account_id, created_at)`

说明：

- `operation_log` 只追加，不做业务更新。
- 日志不保存完整 prompt、用户消息、工具参数、工具结果或 LLM 输出正文。
- `diff_json` 只保存摘要 diff。需要保存完整内容时，应保存目标对象引用和内容哈希。
- 核心资产备份 `1.1.0` 可以按 `none`、`referenced`、`selected_scope` 三种模式导出日志。恢复时日志只作为审计数据导入，不用于重放业务状态。

## `vc_tag`

统一 VC 标签表。它给重要 Floor 或资产版本保存一个账号内唯一的名字。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 标签 ID |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id` | 所属账号 |
| `name` | `TEXT` | `NOT NULL` | 标签名。账号内唯一 |
| `target_type` | `TEXT` | `NOT NULL` | 目标类型：`floor` / `asset_version` |
| `target_id` | `TEXT` | `NOT NULL` | 目标 ID。`asset_version` 可指向角色版本或 prompt 资产版本 |
| `session_id` | `TEXT` | `NULL`, FK -> `session.id` | 可选会话范围。指向 floor 时由服务端派生 |
| `metadata_json` | `TEXT` | `NULL` | 标签元信息 JSON |
| `created_by_operation_id` | `TEXT` | `NULL`, FK -> `operation_log.id` | 创建标签的操作日志 ID |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

枚举约束：

- `target_type`: `floor | asset_version`

索引：

- 唯一索引 `vc_tag_account_name_uq(account_id, name)`
- 普通索引 `vc_tag_account_target_idx(account_id, target_type, target_id)`
- 普通索引 `vc_tag_account_session_created_idx(account_id, session_id, created_at)`
- 普通索引 `vc_tag_operation_idx(created_by_operation_id)`

说明：

- `vc_tag` 是引用表，不复制 Floor 或资产版本内容。
- 创建和删除标签会写入 `operation_log`。
- 核心资产备份 `1.1.0` 默认导出目标已进入备份的 VC Tag。恢复时会为标签生成新 ID，并重写目标引用。


## `message_page`

楼层内消息页（版本）。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 消息页 ID |
| `floor_id` | `TEXT` | `NOT NULL`, FK -> `floor.id` | 所属楼层 |
| `page_no` | `INTEGER` | `NOT NULL` | 页序号 |
| `page_kind` | `TEXT` | `NOT NULL` | 页类型 |
| `is_active` | `INTEGER` | `NOT NULL`, default `1` | 是否当前生效页（布尔） |
| `version` | `INTEGER` | `NOT NULL`, default `1` | 版本号 |
| `checksum` | `TEXT` | `NULL` | 内容校验摘要 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：

- `page_kind`: `input | output | mixed`

索引：

- 唯一索引 `message_page_floor_no_version_uq(floor_id, page_no, version)`
- 普通索引 `message_page_floor_active_no_idx(floor_id, is_active, page_no)`
- 部分唯一索引 `message_page_floor_no_active_uq(floor_id, page_no)` `WHERE is_active = 1`

说明：

- active 不变量是“每个 `(floor_id, page_no)` 槽位最多一个 active version”，不是“每个 floor 最多一个 active page”
- 因此 input 槽位和 output 槽位可以同时 active

## `message`

消息明细。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 消息 ID |
| `page_id` | `TEXT` | `NOT NULL`, FK -> `message_page.id` | 所属消息页 |
| `seq` | `INTEGER` | `NOT NULL` | 页内顺序号 |
| `role` | `TEXT` | `NOT NULL` | 消息角色 |
| `content` | `TEXT` | `NOT NULL` | 消息内容 |
| `content_format` | `TEXT` | `NOT NULL`, default `text` | 内容格式 |
| `token_count` | `INTEGER` | `NOT NULL`, default `0` | token 数 |
| `is_hidden` | `INTEGER` | `NOT NULL`, default `0` | 是否隐藏（布尔） |
| `source` | `TEXT` | `NULL` | 来源标记 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

枚举约束：

- `role`: `user | assistant | system | narrator`
- `content_format`: `text | markdown | json`

索引：

- 唯一索引 `message_page_seq_uq(page_id, seq)`
- 普通索引 `message_page_hidden_seq_idx(page_id, is_hidden, seq)`

## `variable`

多层级变量存储。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 变量记录 ID |
| `scope` | `TEXT` | `NOT NULL` | 变量作用域 |
| `scope_id` | `TEXT` | `NOT NULL` | 作用域实体 ID（`branch` 时为内部规范化宿主 ID） |
| `key` | `TEXT` | `NOT NULL` | 变量名 |
| `value_json` | `TEXT` | `NOT NULL` | 变量值 JSON |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

## `client_data_domain`

客户端专属数据域主表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 数据域 ID |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id`, default `default-admin` | 所属账号 |
| `owner_type` | `TEXT` | `NOT NULL` | 拥有者类型 |
| `owner_id` | `TEXT` | `NOT NULL` | 拥有者 ID |
| `domain_name` | `TEXT` | `NOT NULL` | 数据域名称 |
| `display_name` | `TEXT` | `NULL` | 展示名称 |
| `description` | `TEXT` | `NULL` | 描述 |
| `status` | `TEXT` | `NOT NULL`, default `active` | 数据域状态 |
| `version` | `INTEGER` | `NOT NULL`, default `1` | 元数据版本号 |
| `quota_max_entries` | `INTEGER` | `NOT NULL` | 域级最大条目数 |
| `quota_max_bytes` | `INTEGER` | `NOT NULL` | 域级最大字节数 |
| `current_entry_count` | `INTEGER` | `NOT NULL`, default `0` | 当前条目数 |
| `current_byte_count` | `INTEGER` | `NOT NULL`, default `0` | 当前字节数 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |
| `deleted_at` | `INTEGER` | `NULL` | 软删除时间（ms） |

枚举约束：

- `owner_type`: `application | plugin`
- `status`: `active | suspended | deleted`

索引：

- 唯一索引 `client_data_domain_owner_name_uq(account_id, owner_type, owner_id, domain_name)`
- 普通索引 `client_data_domain_account_owner_status_idx(account_id, owner_type, owner_id, status)`

## `client_data_collection`

客户端数据集合表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 集合 ID |
| `domain_id` | `TEXT` | `NOT NULL`, FK -> `client_data_domain.id` | 所属数据域 |
| `collection_name` | `TEXT` | `NOT NULL` | 集合名称 |
| `description` | `TEXT` | `NULL` | 描述 |
| `default_expires_ttl_ms` | `INTEGER` | `NULL` | 默认过期 TTL（ms） |
| `max_item_size_bytes` | `INTEGER` | `NULL` | 集合级单项大小上限 |
| `version` | `INTEGER` | `NOT NULL`, default `1` | 元数据版本号 |
| `metadata_json` | `TEXT` | `NULL` | 集合元信息 JSON |
| `item_count` | `INTEGER` | `NOT NULL`, default `0` | 当前条目数 |
| `byte_count` | `INTEGER` | `NOT NULL`, default `0` | 当前字节数 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

索引：

- 唯一索引 `client_data_collection_domain_name_uq(domain_id, collection_name)`
- 普通索引 `client_data_collection_domain_updated_idx(domain_id, updated_at)`

## `client_data_item`

客户端数据条目表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 条目 ID |
| `domain_id` | `TEXT` | `NOT NULL`, FK -> `client_data_domain.id` | 所属数据域 |
| `collection_id` | `TEXT` | `NOT NULL`, FK -> `client_data_collection.id` | 所属集合 |
| `item_key` | `TEXT` | `NOT NULL` | 条目键 |
| `value_json` | `TEXT` | `NOT NULL` | 条目值 JSON |
| `byte_size` | `INTEGER` | `NOT NULL` | 存储字节数 |
| `version` | `INTEGER` | `NOT NULL`, default `1` | 条目版本号 |
| `expires_at` | `INTEGER` | `NULL` | 过期时间（ms） |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

索引：

- 唯一索引 `client_data_item_collection_key_uq(collection_id, item_key)`
- 普通索引 `client_data_item_domain_collection_updated_idx(domain_id, collection_id, updated_at)`
- 部分索引 `client_data_item_expires_idx(expires_at)` `WHERE expires_at IS NOT NULL`

## `client_data_domain_grant`

客户端数据域授权表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 授权记录 ID |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id` | 所属账号 |
| `domain_id` | `TEXT` | `NOT NULL`, FK -> `client_data_domain.id` | 所属数据域 |
| `grantee_owner_type` | `TEXT` | `NOT NULL` | 被授权 owner 类型 |
| `grantee_owner_id` | `TEXT` | `NOT NULL` | 被授权 owner ID |
| `can_read` | `INTEGER` | `NOT NULL`, default `0` | 读权限（布尔） |
| `can_write` | `INTEGER` | `NOT NULL`, default `0` | 写权限（布尔） |
| `can_delete` | `INTEGER` | `NOT NULL`, default `0` | 删除权限（布尔） |
| `can_list` | `INTEGER` | `NOT NULL`, default `0` | 列表权限（布尔） |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |
| `expires_at` | `INTEGER` | `NULL` | 授权过期时间（ms） |

枚举约束：

- `grantee_owner_type`: `application | plugin`

索引：

- 唯一索引 `client_data_domain_grant_unique_uq(domain_id, grantee_owner_type, grantee_owner_id)`
- 普通索引 `client_data_domain_grant_account_grantee_idx(account_id, grantee_owner_type, grantee_owner_id)`

## `client_data_audit_log`

客户端数据域治理审计日志表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 审计日志 ID |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id` | 所属账号 |
| `domain_id` | `TEXT` | `NULL`, FK -> `client_data_domain.id` | 关联数据域 |
| `owner_type` | `TEXT` | `NULL` | 数据域 owner 类型 |
| `owner_id` | `TEXT` | `NULL` | 数据域 owner ID |
| `actor_type` | `TEXT` | `NOT NULL` | 操作者类型 |
| `actor_id` | `TEXT` | `NULL` | 操作者 ID |
| `action` | `TEXT` | `NOT NULL` | 操作名称 |
| `target_type` | `TEXT` | `NOT NULL` | 目标类型 |
| `target_id` | `TEXT` | `NULL` | 目标 ID |
| `request_id` | `TEXT` | `NULL` | 请求 ID |
| `metadata_json` | `TEXT` | `NULL` | 审计元数据 JSON |
| `created_at` | `INTEGER` | `NOT NULL` | 记录时间戳（ms） |

索引：

- 普通索引 `client_data_audit_log_account_created_idx(account_id, created_at)`
- 普通索引 `client_data_audit_log_domain_created_idx(domain_id, created_at)`


## `client_data_managed_domain`

受治理 `Client Data` 数据域注册表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `domain_id` | `TEXT` | PK, FK -> `client_data_domain.id` | 被治理的数据域 ID |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id` | 所属账号 |
| `manager_kind` | `TEXT` | `NOT NULL` | 治理器类型 |
| `host_type` | `TEXT` | `NOT NULL` | 宿主类型 |
| `host_id` | `TEXT` | `NOT NULL` | 宿主 ID |
| `state_namespace` | `TEXT` | `NOT NULL` | 状态命名空间 |
| `require_caller_owner` | `INTEGER` | `NOT NULL`, default `1` | 是否要求显式 caller owner（布尔） |
| `allow_auto_create_collection` | `INTEGER` | `NOT NULL`, default `0` | 是否允许自动建 collection（布尔） |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：

- `manager_kind`: `session_state`
- `host_type`: `session`

索引：

- 唯一索引 `client_data_managed_domain_account_manager_host_namespace_uq(account_id, manager_kind, host_type, host_id, state_namespace)`
- 普通索引 `client_data_managed_domain_account_host_idx(account_id, host_type, host_id, state_namespace)`

说明：

- 该表只标记某个底层 domain 已进入 managed 模式，不新建第二套状态存储
- `session_state` 当前通过它把 managed domain 绑定到具体 `session + namespace`
- 相关只读观察端点见 `vitepress/reference/api/session-state.md`。这组端点是 session-state 的内部调试面，不会进入 `@tavern/sdk` 或 `@tavern/client-helpers`。


## `session_state_mutation`

会话状态治理层的 mutation 日志表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | mutation ID |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id` | 所属账号 |
| `domain_id` | `TEXT` | `NOT NULL`, FK -> `client_data_domain.id` | 对应 managed domain |
| `state_namespace` | `TEXT` | `NOT NULL` | 状态命名空间 |
| `session_id` | `TEXT` | `NOT NULL`, FK -> `session.id` | 所属会话 |
| `branch_id` | `TEXT` | `NOT NULL` | 所属分支 |
| `source_floor_id` | `TEXT` | `NULL`, FK -> `floor.id` | 来源楼层 |
| `target_slot` | `TEXT` | `NOT NULL` | 目标槽位 |
| `visibility_mode` | `TEXT` | `NOT NULL` | 可见性模式 |
| `write_mode` | `TEXT` | `NOT NULL` | 写入模式 |
| `replay_safety` | `TEXT` | `NOT NULL` | 重放安全级别 |
| `status` | `TEXT` | `NOT NULL`, default `staged` | 当前治理状态 |
| `request_id` | `TEXT` | `NULL` | 来源请求 ID |
| `run_id` | `TEXT` | `NULL` | 来源 run ID |
| `payload_json` | `TEXT` | `NOT NULL`, default `'{}'` | mutation 负载 |
| `source_snapshot_floor_id` | `TEXT` | `NULL`, FK -> `floor.id` | apply 时引用的 floor snapshot |
| `live_head_key` | `TEXT` | `NULL` | 对应 live head item key |
| `discard_reason` | `TEXT` | `NULL` | discard 原因 |
| `blocked_reason` | `TEXT` | `NULL` | blocked 原因 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |
| `applied_at` | `INTEGER` | `NULL` | 实际应用时间戳（ms） |

枚举约束：

- `visibility_mode`: `session_shared | branch_local | fork_on_branch`
- `write_mode`: `direct | commit_bound`
- `replay_safety`: `safe | confirm_on_replay | never_auto_replay | uncertain`
- `status`: `staged | applied | discarded | blocked | uncertain`

索引：

- 普通索引 `session_state_mutation_session_branch_status_created_idx(session_id, branch_id, status, created_at)`
- 普通索引 `session_state_mutation_source_floor_idx(source_floor_id, status, created_at)`
- 普通索引 `session_state_mutation_run_idx(run_id, created_at)`

说明：

- 相关只读观察端点（mutation 列表、live head、floor snapshot、replay safety、diff）见 `vitepress/reference/api/session-state.md`。

- 状态值本身仍落在 `client_data_item` 中，`session_state_mutation` 负责治理日志与提交边界
- 当前第一批内置 namespace 是 `game_state`，默认 slot 包括 `world`、`scene`、`inventory`、`combat`
