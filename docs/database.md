# 数据库数据字典（apps/api）

本文档记录 `apps/api` 当前 SQLite schema 的字段含义、枚举约束与索引约定。

## 迁移与版本

- ORM: Drizzle ORM
- 迁移目录: `apps/api/drizzle/`
- 当前基础迁移: `0000_initial_schema.sql`
- 当前最新迁移: `0008_account_user_binding.sql`

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

## `account_user`

账号内用户卡（第一类角色卡）主表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 用户卡 ID |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id`, default `default-admin` | 所属账号 |
| `name` | `TEXT` | `NOT NULL` | 用户卡名称（快照中的主名称） |
| `snapshot_json` | `TEXT` | `NOT NULL` | 用户卡快照 JSON |
| `status` | `TEXT` | `NOT NULL`, default `active` | 用户卡状态 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：
- `status`: `active | disabled | deleted`

索引：
- 普通索引 `account_user_account_updated_idx(account_id, updated_at)`
- 唯一索引 `account_user_account_name_uq(account_id, name)`

## `character`

角色模板主表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 角色 ID |
| `name` | `TEXT` | `NOT NULL` | 角色名 |
| `source` | `TEXT` | `NOT NULL`, default `sillytavern` | 来源 |
| `status` | `TEXT` | `NOT NULL`, default `active` | 状态 |
| `deleted_at` | `INTEGER` | `NULL` | 软删除时间（ms） |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

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
| `model_provider` | `TEXT` | `NULL` | 模型服务商 |
| `model_name` | `TEXT` | `NULL` | 模型名称 |
| `model_params_json` | `TEXT` | `NULL` | 模型参数 JSON |
| `prompt_mode` | `TEXT` | `NULL` | Prompt 模式 |
| `metadata_json` | `TEXT` | `NULL` | 扩展元信息 JSON |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：
- `status`: `active | archived`
- `character_sync_policy`: `pin | manual | force`
- `prompt_mode`: `compat_strict | compat_plus | native`

索引：
- 普通索引 `session_account_updated_idx(account_id, updated_at)`

## `floor`

会话内楼层（回合）。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 楼层 ID |
| `session_id` | `TEXT` | `NOT NULL`, FK -> `session.id` | 所属会话 |
| `floor_no` | `INTEGER` | `NOT NULL` | 楼层编号 |
| `branch_id` | `TEXT` | `NOT NULL`, default `main` | 分支标识 |
| `parent_floor_id` | `TEXT` | `NULL` | 父楼层 ID |
| `state` | `TEXT` | `NOT NULL`, default `draft` | 楼层状态 |
| `metadata_json` | `TEXT` | `NULL` | 楼层元信息（含 `user_binding`） |
| `token_in` | `INTEGER` | `NOT NULL`, default `0` | 输入 token 计数 |
| `token_out` | `INTEGER` | `NOT NULL`, default `0` | 输出 token 计数 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：
- `state`: `draft | generating | committed | failed`

索引：
- 唯一索引 `floor_session_no_branch_uq(session_id, floor_no, branch_id)`
- 普通索引 `floor_session_branch_state_no_idx(session_id, branch_id, state, floor_no)`

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
| `scope_id` | `TEXT` | `NOT NULL` | 作用域实体 ID |
| `key` | `TEXT` | `NOT NULL` | 变量名 |
| `value_json` | `TEXT` | `NOT NULL` | 变量值 JSON |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：
- `scope`: `global | chat | floor | page`

索引：
- 唯一索引 `variable_scope_scope_id_key_uq(scope, scope_id, key)`

## `memory_item`

记忆条目。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 记忆 ID |
| `scope` | `TEXT` | `NOT NULL` | 记忆作用域 |
| `scope_id` | `TEXT` | `NOT NULL` | 作用域实体 ID |
| `type` | `TEXT` | `NOT NULL` | 记忆类型 |
| `content_json` | `TEXT` | `NOT NULL` | 记忆内容 JSON |
| `importance` | `REAL` | `NOT NULL`, default `0.5` | 重要度（0-1） |
| `confidence` | `REAL` | `NOT NULL`, default `1.0` | 置信度（0-1） |
| `source_floor_id` | `TEXT` | `NULL` | 来源楼层 ID |
| `source_message_id` | `TEXT` | `NULL` | 来源消息 ID |
| `status` | `TEXT` | `NOT NULL`, default `active` | 条目状态 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：
- `scope`: `global | chat | floor`
- `type`: `fact | summary | open_loop`
- `status`: `active | deprecated`

## `memory_edge`

记忆关系边。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 关系 ID |
| `from_id` | `TEXT` | `NOT NULL`, FK -> `memory_item.id` | 起始记忆 |
| `to_id` | `TEXT` | `NOT NULL`, FK -> `memory_item.id` | 目标记忆 |
| `relation` | `TEXT` | `NOT NULL` | 关系类型 |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |

枚举约束：
- `relation`: `supports | contradicts | updates`

## 导入资源表

### `preset`
- 核心字段：`id`, `name`, `source`, `data_json`, `created_at`, `updated_at`

### `worldbook`
- 核心字段：`id`, `name`, `source`, `data_json`, `created_at`, `updated_at`

### `regex_profile`
- 核心字段：`id`, `name`, `source`, `data_json`, `created_at`, `updated_at`

## `llm_profile`

LLM Profile Vault 主表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | Profile ID |
| `preset_name` | `TEXT` | `NOT NULL` | Profile 名称 |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id`, default `default-admin` | 所属账号 |
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

枚举约束：
- `provider`: `openai | anthropic | google | deepseek | xai | openai-compatible`
- `status`: `active | disabled | deleted`

索引：
- 唯一索引 `llm_profile_account_preset_name_uq(account_id, preset_name)`
- 普通索引 `llm_profile_status_updated_idx(status, updated_at)`

## `llm_profile_binding`

LLM Profile 绑定表。

| 列名 | 类型 | 约束/默认值 | 说明 |
| ---- | ---- | ----------- | ---- |
| `id` | `TEXT` | PK | 绑定记录 ID |
| `scope` | `TEXT` | `NOT NULL` | 绑定作用域 |
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id`, default `default-admin` | 所属账号 |
| `scope_id` | `TEXT` | `NOT NULL` | 作用域 ID |
| `instance_slot` | `TEXT` | `NOT NULL`, default `*` | 实例槽位 |
| `profile_id` | `TEXT` | `NOT NULL`, FK -> `llm_profile.id` | 被绑定 Profile |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

枚举约束：
- `scope`: `global | session`

索引：
- 唯一索引 `llm_profile_binding_account_scope_scope_id_slot_uq(account_id, scope, scope_id, instance_slot)`
- 普通索引 `llm_profile_binding_profile_account_scope_idx(profile_id, account_id, scope, scope_id, instance_slot)`

## 列表接口约定

所有列表接口统一支持：
- 分页：`limit`（1-200）、`offset`（>=0）
- 排序：`sort_by`（各接口限定字段）、`sort_order`（`asc | desc`）
- 过滤：保留各实体特有过滤字段（例如 `session_id`、`scope`、`status`）

统一返回：
- `data`: 当前页数据
- `meta`: `{ total, limit, offset, has_more, sort_by, sort_order }`
