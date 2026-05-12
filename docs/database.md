# 数据库数据字典（apps/api）

本文档记录 `apps/api` 当前 SQLite schema 的字段含义、枚举约束与索引约定。

## 迁移与版本

- ORM: Drizzle ORM
- 迁移目录: `apps/api/drizzle/`
- 当前基础迁移: `0000_initial_schema.sql`
- 当前最新迁移: `0042_session_state_governance.sql`

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
| `account_id` | `TEXT` | `NOT NULL`, FK -> `account.id`, default `default-admin` | 所属账号 |
| `status` | `TEXT` | `NOT NULL`, default `active` | 状态 |
| `deleted_at` | `INTEGER` | `NULL` | 软删除时间（ms） |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

索引：

- 普通索引 `character_account_updated_idx(account_id, updated_at)`

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
