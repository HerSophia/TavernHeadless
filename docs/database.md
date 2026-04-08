# 数据库数据字典（apps/api）

本文档记录 `apps/api` 当前 SQLite schema 的字段含义、枚举约束与索引约定。

## 迁移与版本

- ORM: Drizzle ORM
- 迁移目录: `apps/api/drizzle/`
- 当前基础迁移: `0000_initial_schema.sql`
- 当前最新迁移: `0037_client_data_domain.sql`

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

- 部分唯一索引 `floor_session_no_branch_live_uq(session_id, floor_no, branch_id)`
  `WHERE superseded_at IS NULL`
- 普通索引 `floor_session_branch_state_no_idx(session_id, branch_id, state, floor_no)`
- 部分索引
  `floor_session_branch_live_state_no_idx(session_id, branch_id, state, floor_no)`
  `WHERE superseded_at IS NULL`

说明：

- `superseded_at IS NULL` 表示 live floor
- `superseded_at IS NOT NULL` 表示该楼层已经被后续 regenerate 替代，
  但记录仍保留用于审计与追溯

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
- 部分唯一索引 `message_page_floor_no_active_uq(floor_id, page_no)`
  `WHERE is_active = 1`

说明：

- active 不变量是“每个 `(floor_id, page_no)` 槽位最多一个 active version”，
  不是“每个 floor 最多一个 active page”
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
- 普通索引
  `client_data_domain_account_owner_status_idx(account_id, owner_type, owner_id, status)`

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
| `version` | `INTEGER` | `NOT NULL`, default `1` | 版本号 |
| `expires_at` | `INTEGER` | `NULL` | 过期时间（ms） |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

索引：

- 唯一索引 `client_data_item_collection_key_uq(collection_id, item_key)`
- 普通索引
  `client_data_item_domain_collection_updated_idx(domain_id, collection_id, updated_at)`
- 普通索引 `client_data_item_expires_idx(expires_at)`
