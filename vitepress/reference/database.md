---
outline: [2, 3]
---

# 数据库数据字典

本文档记录 `apps/api` 当前 SQLite schema 的字段含义、枚举约束与索引约定。

- ORM: Drizzle ORM
- 迁移目录: `apps/api/drizzle/`
- 当前最新迁移: `0011_resource_account_isolation.sql`

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
| `importance` | `REAL` | `NOT NULL`, default `0.5` | 重要度（0-1） |
| `confidence` | `REAL` | `NOT NULL`, default `1.0` | 置信度（0-1） |
| `source_floor_id` | `TEXT` | `NULL` | 来源楼层 |
| `source_message_id` | `TEXT` | `NULL` | 来源消息 |
| `account_id` | `TEXT` | `NOT NULL`, FK → `account.id` | 所属账号 |
| `status` | `TEXT` | `NOT NULL`, default `active` | 状态（`active \| deprecated`） |
| `created_at` | `INTEGER` | `NOT NULL` | 创建时间戳（ms） |
| `updated_at` | `INTEGER` | `NOT NULL` | 更新时间戳（ms） |

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

## 列表接口约定

所有列表接口统一支持：

- 分页：`limit`（1-200）、`offset`（>=0）
- 排序：`sort_by`、`sort_order`（`asc | desc`）
- 过滤：保留各实体特有过滤字段

统一返回：

- `data`: 当前页数据
- `meta`: `{ total, limit, offset, has_more, sort_by, sort_order }`
