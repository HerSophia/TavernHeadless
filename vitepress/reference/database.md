---
outline: [2, 3]
---

# 数据库数据字典

本文档记录 `apps/api` 当前 SQLite schema 的字段含义、枚举约束与索引约定。

- ORM: Drizzle ORM
- 迁移目录: `apps/api/drizzle/`
- 当前最新迁移: `0016_consistency_boundary_foundations.sql`

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
| `scope` | `TEXT` | `NOT NULL` | 作用域（`global \| chat \| floor \| page`） |
| `scope_id` | `TEXT` | `NOT NULL` | 作用域实体 ID |
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
| `status` | `TEXT` | `NOT NULL`, default `success` | 状态（`success \| error \| denied`） |
| `duration_ms` | `INTEGER` | `NOT NULL`, default `0` | 执行耗时（ms） |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

索引：`tool_call_record_page_seq_idx(page_id, seq)`、`tool_call_record_tool_name_idx(tool_name)`

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
| `args_json` | `TEXT` | `NOT NULL`, default `'{}'` | 调用参数 JSON |
| `result_json` | `TEXT` | `NOT NULL`, default `'{}'` | 返回结果 JSON |
| `status` | `TEXT` | `NOT NULL`, default `success` | 执行状态（`success \| error \| denied`） |
| `error_message` | `TEXT` | `NULL` | 错误信息 |
| `duration_ms` | `INTEGER` | `NOT NULL`, default `0` | 执行耗时（ms） |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

索引：`tool_execution_record_floor_created_idx(floor_id, created_at)`、`tool_execution_record_run_idx(run_id)`、`tool_execution_record_page_created_idx(page_id, created_at)`、`tool_execution_record_tool_name_idx(tool_name)`

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

MCP 服务器配置表。通过 `ENABLE_MCP=true` 启用。迁移: `0015_mcp_server_config.sql`

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | nanoid |
| `name` | `TEXT` | `NOT NULL`, UNIQUE | 服务器显示名称 |
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

索引：`mcp_server_config_name_uq(name)` (唯一)

## 列表接口约定

所有列表接口统一支持：

- 分页：`limit`（1-200）、`offset`（>=0）
- 排序：`sort_by`、`sort_order`（`asc | desc`）
- 过滤：保留各实体特有过滤字段

统一返回：

- `data`: 当前页数据
- `meta`: `{ total, limit, offset, has_more, sort_by, sort_order }`
