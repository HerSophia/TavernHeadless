# 数据库数据字典（apps/api）

本文档记录 `apps/api` 当前 SQLite schema 的字段含义、枚举约束与索引约定。

## 迁移与版本

- ORM: Drizzle ORM
- 迁移目录: `apps/api/drizzle/`
- 当前基础迁移: `0000_initial_schema.sql`
- 当前最新迁移: `0060_workspace_phase_5_agentic_readiness.sql`

## Workspace / Project scope 规则

阶段一引入 Workspace / Project。阶段二增加 Project Event、Project Membership 和 observer 只读访问。阶段三增加 Derived Output、Project Inbox 和 deriver 成员角色。阶段四加入 Client Identity 与 Client API Key。阶段五加入 Agent Type、Project Agent Binding、Project 级配置覆盖和 Agent Runtime Job 字段。

旧 API 仍保持兼容：

- 普通客户端不需要传 `workspace_id` 或 `project_id`。
- `POST /sessions` 可选传 `project_id`。不传时，服务端使用当前账号默认 Workspace，并为该 Session 创建 `session_default` Project。
- Session 默认响应不暴露 `workspace_id` 和 `project_id`。
- `GET /sessions/:id/scope` 可以显式读取 Session 的 Workspace / Project 归属。
- Project owner 可以读写 Project 资源。
- Project observer 只能读取 Project、Session、Project Event 和 `derived_output`。
- Project deriver 可以读取 Project、观察 Project Event、写入 `derived_output`、创建 `project_inbox_item`，但不能决定 Inbox，也不能修改主 Session、Variable、Memory 或 Session State。
- 非 Project 成员访问 Project 下资源时，继续按旧账号隔离规则隐藏资源。Project API 通常返回 `404 project_not_found`，旧资源路由通常返回 `404 not_found`。
- Prompt Asset、角色、用户卡、LLM 配置、工具定义和 MCP Server Config 的旧列表接口默认只读当前账号默认 Workspace。
- scope 字段仍保留兼容性 nullable。服务层保证新写入数据有明确 Workspace / Project，旧数据中的 `NULL` 视为默认 Workspace 资源。
- `derived_output.value_json` 和 `project_inbox_item.payload_json` 默认大小上限为 256 KiB。对应 Operation Log 只记录字节数和引用，不保存完整 JSON 正文。
- 阶段五 Agent 不能直接写主叙事正史，禁止写入 `session_messages`、`floor`、`page_active`、`variable_live`、`memory_live`、`session_state_live_head`。

当前新增或补齐的 scope 字段如下：

| 表 | 字段 | 说明 |
| ---- | ---- | ---- |
| `workspace` | `account_id` | Workspace 属于账号 |
| `project` | `account_id`, `workspace_id` | Project 属于账号和 Workspace |
| `session` | `workspace_id`, `project_id` | Session 同时保存 Workspace 和 Project，便于查询与审计 |
| `project_membership` | `workspace_id`, `project_id`, `subject_type`, `subject_id` | Project 成员关系。subject 可以是 account 或 client |
| `client` | `account_id` | 同一账号下的 Client 身份记录。默认 Client 由启动修复创建 |
| `client_api_key` | `account_id`, `client_id` | Client API Key。明文 secret 只在创建时返回一次 |
| `project_event_sequence` | `project_id` | 每个 Project 独立分配递增事件序号 |
| `project_event` | `workspace_id`, `project_id` | Project 事件日志，按 Project sequence 递增 |
| `derived_output` | `workspace_id`, `project_id`, `account_id`, `owner_account_id` | Project 派生结果，保存 deriver 或 owner 写入的 JSON 值 |
| `project_inbox_item` | `workspace_id`, `project_id`, `account_id`, `sender_account_id` | Project Inbox 条目，保存待 owner 决策的 JSON 负载 |
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
| `runtime_job` | `workspace_id`, `project_id`, `actor_client_id`, `source_event_id`, `agent_type_id`, `agent_binding_id` | 阶段五 Agent Runtime 关联字段 |

## 阶段五新增表

### `agent_type`

Workspace 级 Agent 类型注册表。一个 Agent Type 定义一个可被 Project 启用的 Agent 模板。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | Agent Type ID，格式 `agt_` 前缀 |
| `workspace_id` | `TEXT` | `NOT NULL`, FK -> `workspace.id`, `ON DELETE CASCADE` | 所属 Workspace |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id`, `ON DELETE RESTRICT` | 所属账号 |
| `key` | `TEXT` | `NOT NULL` | Workspace 内唯一 key |
| `name` | `TEXT` | `NOT NULL` | 展示名称 |
| `scope_kind` | `TEXT` | `NOT NULL` | 作用域类型 |
| `status` | `TEXT` | `NOT NULL`, default `active` | 状态 |
| `default_llm_profile_id` | `TEXT` | `NULL` | 默认 LLM Profile ID |
| `default_tool_policy_id` | `TEXT` | `NULL` | 默认 Tool Policy ID |
| `default_mcp_binding_json` | `TEXT` | `NOT NULL`, default `'{}'` | 默认 MCP 绑定 JSON |
| `default_event_subscriptions_json` | `TEXT` | `NOT NULL`, default `'[]'` | 默认订阅事件 JSON |
| `default_grants_json` | `TEXT` | `NOT NULL`, default `'{}'` | 默认 grants JSON |
| `metadata_json` | `TEXT` | `NOT NULL`, default `'{}'` | 元数据 JSON |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：

- `scope_kind`: `floor | session | project | workspace`
- `status`: `active | disabled`

索引：

- 唯一索引 `agent_type_workspace_key_uq(workspace_id, key)`
- 普通索引 `agent_type_workspace_status_idx(workspace_id, status, created_at)`
- 普通索引 `agent_type_account_status_idx(account_id, status, created_at)`

说明：

- Workspace 级 Agent Type 管理仅允许账号 actor。
- 不开放 DELETE。通过 `status=disabled` 停用。
- `default_grants_json.allowed_output_targets` 必须是安全集合子集，且不能包含主叙事写入口。

### `project_agent_binding`

Project 级 Agent 启用表。它把一个 Agent Type 绑定到某个 Project，并允许做只收窄的 override。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | Binding ID，格式 `agb_` 前缀 |
| `workspace_id` | `TEXT` | `NOT NULL`, FK -> `workspace.id`, `ON DELETE CASCADE` | 所属 Workspace |
| `project_id` | `TEXT` | `NOT NULL`, FK -> `project.id`, `ON DELETE CASCADE` | 所属 Project |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id`, `ON DELETE RESTRICT` | 所属账号 |
| `agent_type_id` | `TEXT` | `NOT NULL`, FK -> `agent_type.id`, `ON DELETE RESTRICT` | 绑定的 Agent Type |
| `status` | `TEXT` | `NOT NULL`, default `enabled` | 状态 |
| `scope_kind` | `TEXT` | `NOT NULL` | 生效作用域类型 |
| `llm_profile_id` | `TEXT` | `NULL` | 覆盖 LLM Profile ID |
| `tool_policy_id` | `TEXT` | `NULL` | 覆盖 Tool Policy ID |
| `mcp_binding_json` | `TEXT` | `NOT NULL`, default `'{}'` | MCP override JSON |
| `event_subscriptions_json` | `TEXT` | `NOT NULL`, default `'[]'` | 订阅事件 JSON |
| `grants_json` | `TEXT` | `NOT NULL`, default `'{}'` | grants override JSON |
| `metadata_json` | `TEXT` | `NOT NULL`, default `'{}'` | 元数据 JSON |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：

- `status`: `enabled | disabled | error`
- `scope_kind`: `floor | session | project | workspace`

索引：

- 唯一索引 `project_agent_binding_project_agent_uq(project_id, agent_type_id)`
- 普通索引 `project_agent_binding_project_status_idx(project_id, status, created_at)`
- 普通索引 `project_agent_binding_workspace_idx(workspace_id, status, created_at)`
- 普通索引 `project_agent_binding_agent_type_idx(agent_type_id, status)`

说明：

- override 只能收窄，不能扩大 Agent Type 默认上限。
- `scope_kind` 当前必须等于 `agent_type.scope_kind`。
- disabled 后不会参与事件触发，也不能手动 run。

### `project_llm_profile_override`

Project 级 LLM Profile 覆盖表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 记录 ID，格式 `plo_` 前缀 |
| `workspace_id` | `TEXT` | `NOT NULL`, FK -> `workspace.id`, `ON DELETE CASCADE` | 所属 Workspace |
| `project_id` | `TEXT` | `NOT NULL`, FK -> `project.id`, `ON DELETE CASCADE` | 所属 Project |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id`, `ON DELETE RESTRICT` | 所属账号 |
| `base_profile_id` | `TEXT` | `NOT NULL` | 基础 profile ID，数据库层不加 FK |
| `override_json` | `TEXT` | `NOT NULL`, default `'{}'` | 覆盖 JSON |
| `status` | `TEXT` | `NOT NULL`, default `active` | 状态 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：

- `status`: `active | archived`

索引：

- 唯一索引 `project_llm_profile_override_project_uq(project_id)`
- 普通索引 `project_llm_profile_override_workspace_idx(workspace_id, status, created_at)`

说明：

- 同一 Project 只有一条 active 记录。
- `base_profile_id` 当前保持 TEXT，无数据库级 FK。

### `project_mcp_binding`

Project 级 MCP Server 启用与覆盖表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 记录 ID，格式 `pmb_` 前缀 |
| `workspace_id` | `TEXT` | `NOT NULL`, FK -> `workspace.id`, `ON DELETE CASCADE` | 所属 Workspace |
| `project_id` | `TEXT` | `NOT NULL`, FK -> `project.id`, `ON DELETE CASCADE` | 所属 Project |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id`, `ON DELETE RESTRICT` | 所属账号 |
| `mcp_server_id` | `TEXT` | `NOT NULL` | MCP Server ID，数据库层不加 FK |
| `status` | `TEXT` | `NOT NULL`, default `enabled` | 状态 |
| `allowed_tools_json` | `TEXT` | `NOT NULL`, default `'[]'` | 允许工具列表 JSON |
| `config_override_json` | `TEXT` | `NOT NULL`, default `'{}'` | 配置覆盖 JSON |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：

- `status`: `enabled | disabled`

索引：

- 唯一索引 `project_mcp_binding_project_server_uq(project_id, mcp_server_id)`
- 普通索引 `project_mcp_binding_workspace_idx(workspace_id, status, created_at)`

### `project_tool_policy_override`

Project 级 Tool Policy 覆盖表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 记录 ID，格式 `pto_` 前缀 |
| `workspace_id` | `TEXT` | `NOT NULL`, FK -> `workspace.id`, `ON DELETE CASCADE` | 所属 Workspace |
| `project_id` | `TEXT` | `NOT NULL`, FK -> `project.id`, `ON DELETE CASCADE` | 所属 Project |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id`, `ON DELETE RESTRICT` | 所属账号 |
| `base_policy_id` | `TEXT` | `NOT NULL` | 基础 policy ID，数据库层不加 FK |
| `override_json` | `TEXT` | `NOT NULL`, default `'{}'` | 覆盖 JSON |
| `status` | `TEXT` | `NOT NULL`, default `active` | 状态 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：

- `status`: `active | archived`

索引：

- 唯一索引 `project_tool_policy_override_project_base_uq(project_id, base_policy_id)`
- 普通索引 `project_tool_policy_override_workspace_idx(workspace_id, status, created_at)`

## `runtime_job` 阶段五新增字段

`runtime_job` 在原有后台作业基础上，新增 6 个 Agent 维度字段：

| 列名 | 类型 | 约束 | 说明 |
| ---- | ---- | ---- | ---- |
| `workspace_id` | `TEXT` | `NULL` | 所属 Workspace |
| `project_id` | `TEXT` | `NULL` | 所属 Project |
| `actor_client_id` | `TEXT` | `NULL` | 触发作业的 Client |
| `source_event_id` | `TEXT` | `NULL` | 来源 Project Event |
| `agent_type_id` | `TEXT` | `NULL` | 关联 Agent Type |
| `agent_binding_id` | `TEXT` | `NULL` | 关联 Project Agent Binding |

新增索引：

- `runtime_job_agent_type_status_idx(agent_type_id, status, available_at)`
- `runtime_job_agent_binding_status_idx(agent_binding_id, status, available_at)`
- `runtime_job_project_status_idx(project_id, status, available_at)`
- `runtime_job_source_event_idx(source_event_id)`

说明：

- 旧 memory / mutation / tool / chat transfer job 允许这些字段为 `NULL`。
- 阶段五 Agent job 的 `job_type` 固定为 `agent.run`。
- 当前占位 Processor 会直接进入 dead letter，不执行真实 Agent。

## 迁移记录补充

阶段五新增迁移：

- `0060_workspace_phase_5_agentic_readiness.sql`

该迁移完成：

- 新建 `agent_type`
- 新建 `project_agent_binding`
- 新建 `project_llm_profile_override`
- 新建 `project_mcp_binding`
- 新建 `project_tool_policy_override`
- 为 `runtime_job` 添加 6 个 Agent 维度字段
- 添加对应索引

其余旧表结构与前期说明保持一致。
