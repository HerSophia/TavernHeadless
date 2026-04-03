---
outline: [2, 3]
---

# 数据库数据字典

本文档记录 `apps/api` 当前 SQLite schema 的字段含义、枚举约束与索引约定。

- ORM: Drizzle ORM
- 迁移目录: `apps/api/drizzle/`
- 当前最新迁移: `0024_background_job_runtime.sql`

## account

账号主表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 账号 ID |
| `name` | `TEXT` | `NOT NULL` | 账号名称 |
| `role` | `TEXT` | `NOT NULL`, default `user` | 账号角色（`admin \| user`） |
| `status` | `TEXT` | `NOT NULL`, default `active` | 状态（`active \| disabled`） |
| `is_default` | `INTEGER` | `NOT NULL`, default `0` | 是否默认账号 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

## account_user

账号内用户卡。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 用户卡 ID |
| `account_id` | `TEXT` | `NOT NULL`, FK → `account.id` | 所属账号 |
| `name` | `TEXT` | `NOT NULL` | 用户卡名称 |
| `snapshot_json` | `TEXT` | `NOT NULL` | 用户卡快照 JSON |
| `status` | `TEXT` | `NOT NULL`, default `active` | 状态（`active \| disabled \| deleted`） |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

索引：`account_user_account_updated_idx(account_id, updated_at)`、`account_user_account_name_uq(account_id, name)` (唯一)

## character

角色模板主表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 角色 ID |
| `name` | `TEXT` | `NOT NULL` | 角色名 |
| `source` | `TEXT` | `NOT NULL`, default `sillytavern` | 来源 |
| `account_id` | `TEXT` | `NOT NULL`, FK → `account.id` | 所属账号 |
| `status` | `TEXT` | `NOT NULL`, default `active` | 状态（`active \| deleted`） |
| `deleted_at` | `INTEGER` | `NULL` | 软删除时间（ms） |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

## character_version

角色版本表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 版本 ID |
| `character_id` | `TEXT` | `NOT NULL`, FK → `character.id` | 所属角色 |
| `version_no` | `INTEGER` | `NOT NULL` | 版本号（递增） |
| `data_json` | `TEXT` | `NOT NULL` | 角色快照 JSON |
| `content_hash` | `TEXT` | `NOT NULL` | 内容哈希 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

## session

会话主表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 会话 ID |
| `title` | `TEXT` | `NULL` | 会话标题 |
| `account_id` | `TEXT` | `NOT NULL`, FK → `account.id` | 所属账号 |
| `status` | `TEXT` | `NOT NULL`, default `active` | 状态（`active \| archived`） |
| `character_id` | `TEXT` | `NULL`, FK → `character.id` | 绑定角色 |
| `character_version_id` | `TEXT` | `NULL` | 绑定角色版本 |
| `character_snapshot_json` | `TEXT` | `NULL` | 冻结角色快照 |
| `character_sync_policy` | `TEXT` | `NOT NULL`, default `pin` | 同步策略（`pin \| manual \| force`） |
| `user_id` | `TEXT` | `NULL`, FK → `account_user.id` | 绑定用户卡 |
| `user_snapshot_json` | `TEXT` | `NULL` | 冻结用户卡快照 |
| `preset_id` | `TEXT` | `NULL` | 预设 ID |
| `regex_profile_id` | `TEXT` | `NULL` | 正则配置 ID |
| `worldbook_profile_id` | `TEXT` | `NULL` | 世界书配置 ID |
| `model_provider` | `TEXT` | `NULL` | 模型服务商 |
| `model_name` | `TEXT` | `NULL` | 模型名称 |
| `model_params_json` | `TEXT` | `NULL` | 模型参数 JSON |
| `prompt_mode` | `TEXT` | `NULL` | Prompt 模式（`compat_strict \| compat_plus \| native`） |
| `metadata_json` | `TEXT` | `NULL` | 扩展元信息 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

## floor

会话内楼层（回合）。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 楼层 ID |
| `session_id` | `TEXT` | `NOT NULL`, FK → `session.id` | 所属会话 |
| `floor_no` | `INTEGER` | `NOT NULL` | 楼层编号 |
| `branch_id` | `TEXT` | `NOT NULL`, default `main` | 分支标识 |
| `parent_floor_id` | `TEXT` | `NULL` | 父楼层 ID |
| `state` | `TEXT` | `NOT NULL`, default `draft` | 状态（`draft \| generating \| committed \| failed`） |
| `metadata_json` | `TEXT` | `NULL` | 楼层元信息 |
| `token_in` | `INTEGER` | `NOT NULL`, default `0` | 输入 token |
| `token_out` | `INTEGER` | `NOT NULL`, default `0` | 输出 token |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

## message_page

楼层内消息页（版本）。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 消息页 ID |
| `floor_id` | `TEXT` | `NOT NULL`, FK → `floor.id` | 所属楼层 |
| `page_no` | `INTEGER` | `NOT NULL` | 页序号 |
| `page_kind` | `TEXT` | `NOT NULL` | 类型（`input \| output \| mixed`） |
| `is_active` | `INTEGER` | `NOT NULL`, default `1` | 是否当前生效页 |
| `version` | `INTEGER` | `NOT NULL`, default `1` | 版本号 |
| `checksum` | `TEXT` | `NULL` | 内容校验摘要 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

索引：

- `message_page_floor_no_version_uq(floor_id, page_no, version)`
- `message_page_floor_active_no_idx(floor_id, is_active, page_no)`
- `message_page_floor_no_active_uq(floor_id, page_no) WHERE is_active = 1`

说明：active 不变量是“每个 `(floor_id, page_no)` 槽位最多一个 active version”，不是“每个 floor 最多一个 active page”。

## message

消息明细。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 消息 ID |
| `page_id` | `TEXT` | `NOT NULL`, FK → `message_page.id` | 所属消息页 |
| `seq` | `INTEGER` | `NOT NULL` | 页内顺序号 |
| `role` | `TEXT` | `NOT NULL` | 角色（`user \| assistant \| system \| narrator`） |
| `content` | `TEXT` | `NOT NULL` | 消息内容 |
| `content_format` | `TEXT` | `NOT NULL`, default `text` | 格式（`text \| markdown \| json`） |
| `token_count` | `INTEGER` | `NOT NULL`, default `0` | token 数 |
| `is_hidden` | `INTEGER` | `NOT NULL`, default `0` | 是否隐藏 |
| `source` | `TEXT` | `NULL` | 来源标记 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

## variable

多层级变量存储。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 变量记录 ID |
| `scope` | `TEXT` | `NOT NULL` | 作用域（`global \| chat \| floor \| branch \| page`） |
| `scope_id` | `TEXT` | `NOT NULL` | 作用域实体 ID（`branch` 时为内部规范化宿主 ID） |
| `key` | `TEXT` | `NOT NULL` | 变量名 |
| `value_json` | `TEXT` | `NOT NULL` | 变量值 JSON |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

## memory_item

记忆条目。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 记忆 ID |
| `scope` | `TEXT` | `NOT NULL` | 作用域（`global \| chat \| floor`） |
| `scope_id` | `TEXT` | `NOT NULL` | 作用域实体 ID |
| `type` | `TEXT` | `NOT NULL` | 类型（`fact \| summary \| open_loop`） |
| `content_json` | `TEXT` | `NOT NULL` | 记忆内容 JSON |
| `fact_key` | `TEXT` | `NULL` | 结构化事实键，仅 `type = fact` 时有意义 |
| `importance` | `REAL` | `NOT NULL`, default `0.5` | 重要度（0-1） |
| `confidence` | `REAL` | `NOT NULL`, default `1.0` | 置信度（0-1） |
| `source_floor_id` | `TEXT` | `NULL` | 来源楼层 |
| `source_message_id` | `TEXT` | `NULL` | 来源消息 |
| `account_id` | `TEXT` | `NOT NULL`, FK → `account.id` | 所属账号 |
| `status` | `TEXT` | `NOT NULL`, default `active` | 状态（`active \| deprecated`） |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

说明：`fact_key` 是事实类记忆的结构化主键；`content_json` 继续保留展示/注入文本。

## memory_edge

记忆关系边。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 关系 ID |
| `from_id` | `TEXT` | `NOT NULL`, FK → `memory_item.id` | 起始记忆 |
| `to_id` | `TEXT` | `NOT NULL`, FK → `memory_item.id` | 目标记忆 |
| `relation` | `TEXT` | `NOT NULL` | 关系（`supports \| contradicts \| updates`） |
| `account_id` | `TEXT` | `NOT NULL`, FK → `account.id` | 所属账号 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

## runtime_scope_state

Background Job Runtime 的 scope 串行状态表。当前 `memory` 与 `chat transfer` 都通过它维护统一 scope lease 和 revision。

> 说明：这是一组偏开发、调试、运维的高级后端能力，对应的 job / scope 查询与管理路由也属于高级开发者特性。
>
> 统一的查询、取消、重试能力由 `RuntimeJobQueryService` 提供；业务路由只是对这些表做 `memory`、`chat transfer` 的投影。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `account_id` | `TEXT` | `NOT NULL`, FK → `account.id` | 所属账号 |
| `scope_type` | `TEXT` | `NOT NULL` | 运行时 scope 域，例如 `memory`、`chat_transfer` |
| `scope_key` | `TEXT` | `NOT NULL` | 域内 scope 键，例如 `chat:sessionId`、`job:jobId` |
| `revision` | `INTEGER` | `NOT NULL`, default `0` | scope revision |
| `lease_owner` | `TEXT` | `NULL` | 当前 scope 租约持有者 |
| `lease_until` | `INTEGER` | `NULL` | scope 租约到期时间 |
| `last_processed_at` | `INTEGER` | `NULL` | 最近一次成功处理时间 |
| `last_success_job_id` | `TEXT` | `NULL` | 最近一次成功作业 ID |
| `metadata_json` | `TEXT` | `NOT NULL`, default `'{}'` | 域专用扩展元数据 |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

索引：`runtime_scope_state_account_scope_uq(account_id, scope_type, scope_key)`（唯一）、`runtime_scope_state_lease_idx(lease_until)`

## runtime_job

Background Job Runtime 的统一作业表。第一批消费者是 `memory.*` 与 `chat_transfer.*`。旧的 `memory_job` / `chat_transfer_job` 会暂时保留，用于兼容窗口，但新运行时以本表为准。

> 说明：该表对应的 HTTP 路由主要是高级开发者接口，用于作业观察、重试、取消和调试，不是普通用户日常聊天接口。
>
> Runtime 还会围绕本表发出统一 `runtime.job_*` 生命周期事件，用于日志、测试和运行时观测。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 作业 ID |
| `job_type` | `TEXT` | `NOT NULL` | 作业类型，例如 `memory.ingest_turn`、`chat_transfer.export_chat` |
| `account_id` | `TEXT` | `NOT NULL`, FK → `account.id` | 所属账号 |
| `scope_type` | `TEXT` | `NOT NULL` | scope 域 |
| `scope_key` | `TEXT` | `NOT NULL` | scope 键 |
| `session_id` | `TEXT` | `NULL`, FK → `session.id` | 关联会话 ID（如果有） |
| `floor_id` | `TEXT` | `NULL`, FK → `floor.id` | 关联楼层 ID（如果有） |
| `page_id` | `TEXT` | `NULL`, FK → `message_page.id` | 关联消息页 ID（如果有） |
| `status` | `TEXT` | `NOT NULL`, default `pending` | 生命周期状态：`pending / leased / running / retry_waiting / succeeded / dead_letter / cancelled` |
| `phase` | `TEXT` | `NULL` | 业务阶段名 |
| `payload_json` | `TEXT` | `NOT NULL`, default `'{}'` | 请求负载 JSON |
| `state_json` | `TEXT` | `NULL` | 运行中状态 JSON |
| `result_json` | `TEXT` | `NULL` | 最终结果 JSON |
| `attempt_count` | `INTEGER` | `NOT NULL`, default `0` | 已尝试次数 |
| `max_attempts` | `INTEGER` | `NOT NULL`, default `5` | 最大尝试次数 |
| `available_at` | `INTEGER` | `NOT NULL` | 下次可被领取时间 |
| `started_at` | `INTEGER` | `NULL` | 首次开始执行时间 |
| `finished_at` | `INTEGER` | `NULL` | 终态完成时间 |
| `lease_owner` | `TEXT` | `NULL` | 当前作业租约持有者 |
| `lease_until` | `INTEGER` | `NULL` | 当前作业租约到期时间 |
| `based_on_revision` | `INTEGER` | `NULL` | 领取时冻结的 scope revision |
| `dedupe_key` | `TEXT` | `NULL` | 幂等去重键 |
| `progress_current` | `INTEGER` | `NOT NULL`, default `0` | 当前进度值 |
| `progress_total` | `INTEGER` | `NULL` | 总进度值 |
| `progress_message` | `TEXT` | `NULL` | 进度说明 |
| `last_error` | `TEXT` | `NULL` | 最近一次错误消息 |
| `last_error_code` | `TEXT` | `NULL` | 最近一次错误码 |
| `last_error_class` | `TEXT` | `NULL` | 最近一次错误分类 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

索引：`runtime_job_due_idx(status, available_at)`、`runtime_job_scope_idx(account_id, scope_type, scope_key, created_at)`、`runtime_job_session_idx(account_id, session_id, created_at)`、`runtime_job_account_type_dedupe_uq(account_id, job_type, dedupe_key)`（唯一）


## prompt_snapshot

单轮 Prompt 快照表。用于冻结某个 floor 实际生成时使用的 Prompt 资源版本与摘要信息。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `floor_id` | `TEXT` | PK, FK → `floor.id` ON DELETE CASCADE | 所属楼层 |
| `session_id` | `TEXT` | `NOT NULL`, FK → `session.id` ON DELETE CASCADE | 所属会话 |
| `preset_id` | `TEXT` | `NULL`, FK → `preset.id` ON DELETE SET NULL | 冻结的预设 ID |
| `preset_updated_at` | `INTEGER` | `NULL` | 预设更新时间快照 |
| `worldbook_id` | `TEXT` | `NULL`, FK → `worldbook.id` ON DELETE SET NULL | 冻结的世界书 ID |
| `worldbook_updated_at` | `INTEGER` | `NULL` | 世界书更新时间快照 |
| `regex_profile_id` | `TEXT` | `NULL`, FK → `regex_profile.id` ON DELETE SET NULL | 冻结的正则配置 ID |
| `regex_profile_updated_at` | `INTEGER` | `NULL` | 正则配置更新时间快照 |
| `worldbook_activated_entry_uids_json` | `TEXT` | `NOT NULL`, default `'[]'` | 命中的世界书 entry uid 列表 |
| `regex_pre_rule_names_json` | `TEXT` | `NOT NULL`, default `'[]'` | 命中的前处理规则名 |
| `regex_post_rule_names_json` | `TEXT` | `NOT NULL`, default `'[]'` | 命中的后处理规则名 |
| `prompt_mode` | `TEXT` | `NOT NULL` | Prompt 模式（`compat_strict \| compat_plus \| native`） |
| `prompt_digest` | `TEXT` | `NOT NULL` | 组装后消息摘要 |
| `token_estimate` | `INTEGER` | `NOT NULL`, default `0` | Prompt token 估算 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

索引：`prompt_snapshot_session_created_idx(session_id, created_at)`、`prompt_snapshot_digest_idx(prompt_digest)`

## llm_profile

LLM Profile Vault 主表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | Profile ID |
| `preset_name` | `TEXT` | `NOT NULL` | Profile 名称 |
| `account_id` | `TEXT` | `NOT NULL`, FK → `account.id` | 所属账号 |
| `provider` | `TEXT` | `NOT NULL` | LLM 提供商 |
| `model_id` | `TEXT` | `NOT NULL` | 模型 ID |
| `base_url` | `TEXT` | `NULL` | 自定义网关 |
| `api_key_name` | `TEXT` | `NULL` | Key 展示名 |
| `api_key_encrypted` | `TEXT` | `NOT NULL` | 加密密文 |
| `api_key_masked` | `TEXT` | `NOT NULL` | 掩码值 |
| `status` | `TEXT` | `NOT NULL`, default `active` | 状态 |
| `last_used_at` | `INTEGER` | `NULL` | 最后使用时间 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

provider 枚举：`openai | anthropic | google | deepseek | xai | openai-compatible`

## llm_profile_binding

LLM Profile 绑定表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 绑定记录 ID |
| `scope` | `TEXT` | `NOT NULL` | 作用域（`global \| session`） |
| `account_id` | `TEXT` | `NOT NULL`, FK → `account.id` | 所属账号 |
| `scope_id` | `TEXT` | `NOT NULL` | 作用域 ID |
| `instance_slot` | `TEXT` | `NOT NULL`, default `*` | 实例槽位 |
| `profile_id` | `TEXT` | `NOT NULL`, FK → `llm_profile.id` | 被绑定 Profile |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

## llm_instance_config

LLM 实例配置表。独立管理各实例槽位的配置（预设绑定、启用状态、生成参数）。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 配置记录 ID |
| `account_id` | `TEXT` | `NOT NULL`, FK → `account.id` | 所属账号 |
| `scope` | `TEXT` | `NOT NULL` | 作用域（`global \| session`） |
| `scope_id` | `TEXT` | `NOT NULL` | 作用域 ID |
| `instance_slot` | `TEXT` | `NOT NULL` | 槽位（`* \| narrator \| director \| verifier \| memory`） |
| `preset_id` | `TEXT` | `NULL` | 关联预设 ID |
| `enabled` | `INTEGER` | `NOT NULL`, default `1` | 是否启用 |
| `params_json` | `TEXT` | `NULL` | 生成参数 JSON |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

优先级解析：`session(slot) > session(*) > global(slot) > global(*) > default`

## tool_call_record

旧兼容查询表。每条记录绑定到一个 `message_page`，供仍按 page 维度读取的旧接口使用。当前主审计模型已经切换为 `tool_execution_record`。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 调用记录 ID |
| `page_id` | `TEXT` | `NOT NULL`, FK → `message_page.id` ON DELETE CASCADE | 所属消息页 |
| `seq` | `INTEGER` | `NOT NULL` | 页内调用序号 |
| `caller_slot` | `TEXT` | `NOT NULL` | 调用方槽位（`narrator \| director \| verifier \| memory`） |
| `tool_name` | `TEXT` | `NOT NULL` | 工具名称 |
| `args_json` | `TEXT` | `NOT NULL` | 调用参数 JSON |
| `result_json` | `TEXT` | `NOT NULL` | 返回结果 JSON |
| `status` | `TEXT` | `NOT NULL`, default `success` | 状态（`success \| error \| denied \| queued \| running`） |
| `duration_ms` | `INTEGER` | `NOT NULL`, default `0` | 执行耗时（ms） |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

索引：`tool_call_record_page_seq_idx(page_id, seq)`、`tool_call_record_tool_name_idx(tool_name)`

说明：`tool_call_record` 仍是兼容查询面，不是新的主审计真相源。

## tool_execution_record

当前真实工具执行记录表。记录来源必须是 `ToolExecutor` 的真实执行过程，以 `floor_id` 为主归属，`page_id` 可空。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 执行记录 ID |
| `run_id` | `TEXT` | `NOT NULL` | 单轮工具执行 run ID |
| `floor_id` | `TEXT` | `NOT NULL`, FK → `floor.id` ON DELETE CASCADE | 所属楼层 |
| `page_id` | `TEXT` | `NULL`, FK → `message_page.id` ON DELETE SET NULL | 可选的真实页绑定 |
| `caller_slot` | `TEXT` | `NOT NULL` | 调用方实例槽位 |
| `provider_id` | `TEXT` | `NOT NULL` | 工具提供者 ID |
| `tool_name` | `TEXT` | `NOT NULL` | 工具名称 |
| `provider_type` | `TEXT` | `NOT NULL`, default `unknown` | provider 类型（`builtin \| preset \| mcp \| unknown`） |
| `args_json` | `TEXT` | `NOT NULL`, default `'{}'` | 调用参数 JSON |
| `result_json` | `TEXT` | `NOT NULL`, default `'{}'` | 返回结果 JSON |
| `status` | `TEXT` | `NOT NULL`, default `running` | 执行状态（`running \| queued \| success \| error \| denied \| timeout \| uncertain \| blocked`） |
| `lifecycle_state` | `TEXT` | `NOT NULL`, default `finished` | 生命周期状态（`opened \| finished`） |
| `commit_outcome` | `TEXT` | `NOT NULL`, default `pending` | 提交结果（`pending \| committed \| discarded \| replay_blocked \| uncertain`） |
| `delivery_mode` | `TEXT` | `NOT NULL`, default `inline` | 交付模式（`inline \| async_job`） |
| `runtime_job_id` | `TEXT` | `NULL` | 关联的 `runtime_job.id` |
| `side_effect_level` | `TEXT` | `NULL` | 副作用级别（`none \| sandbox \| irreversible`） |
| `error_message` | `TEXT` | `NULL` | 错误信息 |
| `duration_ms` | `INTEGER` | `NOT NULL`, default `0` | 执行耗时（ms） |
| `started_at` | `INTEGER` | `NOT NULL`, default `0` | 开始时间戳（ms） |
| `finished_at` | `INTEGER` | `NULL` | 完成时间戳（ms） |
| `attempt_no` | `INTEGER` | `NOT NULL`, default `1` | 执行尝试号 |
| `replay_parent_execution_id` | `TEXT` | `NULL` | 回放父执行记录 ID |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

索引：`tool_execution_record_floor_created_idx(floor_id, started_at)`、`tool_execution_record_run_idx(run_id, started_at)`、`tool_execution_record_page_created_idx(page_id, started_at)`、`tool_execution_record_runtime_job_idx(runtime_job_id)`、`tool_execution_record_tool_name_idx(tool_name)`

说明：新的查询和审计应优先读取 `tool_execution_record`。

## tool_definition

自定义工具定义。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 工具定义 ID |
| `name` | `TEXT` | `NOT NULL` | 工具名称 |
| `description` | `TEXT` | `NOT NULL` | 工具描述 |
| `parameters_json` | `TEXT` | `NOT NULL` | 参数 schema JSON |
| `side_effect_level` | `TEXT` | `NOT NULL` | 副作用级别（`none \| sandbox \| irreversible`） |
| `allowed_slots_json` | `TEXT` | `NOT NULL` | 允许调用的槽位 JSON 数组 |
| `source` | `TEXT` | `NOT NULL` | 来源（`preset \| character \| custom`） |
| `source_id` | `TEXT` | `NULL` | 来源关联 ID |
| `enabled` | `INTEGER` | `NOT NULL`, default `1` | 是否启用 |
| `handler_type` | `TEXT` | `NOT NULL` | 处理器类型（`script \| prompt \| delegate`） |
| `handler_json` | `TEXT` | `NOT NULL` | 处理器配置 JSON |
| `account_id` | `TEXT` | `NOT NULL`, FK → `account.id` | 所属账号 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

索引：`tool_definition_name_source_source_id_uq(name, source, source_id)` (唯一)、`tool_definition_account_source_idx(account_id, source)`

## mcp_server_config

MCP 服务器配置表。通过 `ENABLE_MCP=true` 启用。迁移: `0015_mcp_server_config.sql`、`0021_mcp_account_scope.sql`

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | nanoid |
| `name` | `TEXT` | `NOT NULL` | 服务器显示名称（账号内唯一） |
| `account_id` | `TEXT` | `NOT NULL`, FK → `account.id` | 所属账号 |
| `transport` | `TEXT` | `NOT NULL` | 传输类型（`stdio` / `http`） |
| `config_json` | `TEXT` | `NOT NULL` | 传输配置 JSON（stdio 或 http 参数） |
| `tool_prefix` | `TEXT` | `NULL` | 工具名称前缀 |
| `enabled` | `INTEGER` | `NOT NULL` DEFAULT `1` | 是否启用 |
| `connect_timeout_ms` | `INTEGER` | `NOT NULL` DEFAULT `30000` | 连接超时 |
| `call_timeout_ms` | `INTEGER` | `NOT NULL` DEFAULT `60000` | 工具调用超时 |
| `tool_refresh_interval_ms` | `INTEGER` | `NOT NULL` DEFAULT `300000` | 工具列表刷新间隔 |
| `default_side_effect_level` | `TEXT` | `NOT NULL` DEFAULT `irreversible` | 默认副作用级别 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

索引：`mcp_server_config_account_name_uq(account_id, name)` (唯一)、`mcp_server_config_account_updated_idx(account_id, updated_at)`

## 列表接口约定

所有列表接口统一支持：

- 分页：`limit`（1-200）、`offset`（>=0）
- 排序：`sort_by`、`sort_order`（`asc | desc`）
- 过滤：保留各实体特有过滤字段

统一返回：

- `data`: 当前页数据
- `meta`: `{ total, limit, offset, has_more, sort_by, sort_order }`
