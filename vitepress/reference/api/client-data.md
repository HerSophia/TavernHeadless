---
outline: [2, 3]
---

# Client Data（客户端数据）

Client Data 为应用和插件提供独立的键值数据存储。每个数据域（Domain）按拥有者隔离，域内通过集合（Collection）和条目（Item）两级组织数据。

典型用途：

- 插件偏好设置
- 前端本地同步状态
- 会话外的插件缓存
- 不适合进入聊天主数据模型的结构化数据

> 这组接口属于高级 API 资源，主要面向插件开发和平台集成。如果只需要普通聊天能力，不需要优先接入。

## 数据层级

| 层级 | 说明 | 唯一定位 |
| ---- | ---- | ---- |
| Domain | 数据域，顶层隔离单元 | `account_id + owner_type + owner_id + domain_name` |
| Collection | 域内集合 | `domain_id + collection_name` |
| Item | 集合内键值条目 | `collection_id + item_key` |

此外还有两类管理资源：

- **Grant**：授权记录，允许非拥有者的应用或插件访问某个域
- **Audit Log**：治理动作审计记录，记录域的创建、删除、恢复、授权变更等操作

## 请求头

认证头遵循全局认证规则。

如果需要启用拥有者级别的隔离，应额外传入以下请求头：

| Header | 值 | 说明 |
| ---- | ---- | ---- |
| `X-Client-Owner-Type` | `application` / `plugin` | 拥有者类型 |
| `X-Client-Owner-Id` | string | 拥有者标识，如 `chat-annotator` |

说明：

- 不传这两个头时，服务端按 `account_id + domain_id` 控制访问
- 只传其中一个、或值不合法时，返回 `400 client_data_caller_owner_invalid`
- 如果拥有者不是数据域的创建者，需要通过 Grant 授权才能访问
- 官方 SDK 已支持为 domain-scoped `clientData` 资源显式传入 `callerOwner`

## managed domain 说明

如果某个底层 domain 已被后端标记为 managed domain：

- 普通 `GET /client-data/domains` 默认不会列出它
- 所有带 `:domainId` 的 raw domain-scoped 路径都会在进入业务逻辑之前返回 `403 client_data_managed_domain_raw_access_forbidden`。这一限制同时覆盖读、写和管理操作，包括：
  - `GET / PATCH / DELETE /client-data/domains/:domainId`
  - `POST /client-data/domains/:domainId/restore`
  - `GET / POST / PATCH / DELETE /client-data/domains/:domainId/collections(/...)`
  - `GET / PUT / POST / DELETE /client-data/domains/:domainId/items(/...)`
  - `GET / POST /client-data/domains/:domainId/import`
  - `GET /client-data/domains/:domainId/export`
  - `GET / POST / PATCH / DELETE /client-data/domains/:domainId/grants(/...)`
  - `GET /client-data/domains/:domainId/audit-logs`
- `DELETE /client-data/owners/:ownerType/:ownerId/domains` 在该 owner 下包含任何 managed domain 时，同样返回 `403 client_data_managed_domain_raw_access_forbidden`
- 这类 domain 必须通过对应的受治理服务访问，而不是继续走 raw client-data 路径

## Domain 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 数据域 ID |
| `owner_type` | string | `application` / `plugin` |
| `owner_id` | string | 拥有者标识 |
| `domain_name` | string | 数据域名称 |
| `display_name` | string \| null | 展示名称 |
| `description` | string \| null | 描述 |
| `status` | string | `active` / `suspended` / `deleted` |
| `version` | integer | 元数据版本号，用于乐观锁 |
| `quota_max_entries` | integer | 域级最大条目数 |
| `quota_max_bytes` | integer | 域级最大字节数 |
| `current_entry_count` | integer | 当前条目数 |
| `current_byte_count` | integer | 当前字节数 |
| `created_at` | integer | 创建时间 |
| `updated_at` | integer | 更新时间 |
| `deleted_at` | integer \| null | 删除时间 |

## Collection 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 集合 ID |
| `domain_id` | string | 所属数据域 |
| `collection_name` | string | 集合名称 |
| `description` | string \| null | 描述 |
| `default_expires_ttl_ms` | integer \| null | 默认过期 TTL（毫秒） |
| `max_item_size_bytes` | integer \| null | 单条数据大小上限 |
| `version` | integer | 元数据版本号 |
| `metadata_json` | any | 集合自定义元数据 |
| `item_count` | integer | 当前条目数 |
| `byte_count` | integer | 当前字节数 |
| `created_at` | integer | 创建时间 |
| `updated_at` | integer | 更新时间 |

## Item 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 条目 ID |
| `domain_id` | string | 所属数据域 |
| `collection_id` | string | 所属集合 |
| `item_key` | string | 条目键 |
| `value_json` | any | 条目值（任意 JSON） |
| `byte_size` | integer | 存储字节数 |
| `version` | integer | 条目版本号 |
| `expires_at` | integer \| null | 过期时间 |
| `created_at` | integer | 创建时间 |
| `updated_at` | integer | 更新时间 |

## Grant 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 授权记录 ID |
| `domain_id` | string | 所属数据域 |
| `grantee_owner_type` | string | 被授权方类型：`application` / `plugin` |
| `grantee_owner_id` | string | 被授权方标识 |
| `can_read` | boolean | 读取权限 |
| `can_write` | boolean | 写入权限 |
| `can_delete` | boolean | 删除权限 |
| `can_list` | boolean | 列出权限 |
| `expires_at` | integer \| null | 授权过期时间 |
| `created_at` | integer | 创建时间 |
| `updated_at` | integer | 更新时间 |

---

## 创建数据域

```http
POST /client-data/domains
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `owner_type` | string | **是** | `application` / `plugin` |
| `owner_id` | string | **是** | 拥有者标识 |
| `domain_name` | string | **是** | 数据域名称 |
| `display_name` | string | 否 | 展示名称 |
| `description` | string | 否 | 描述 |

### 请求示例

```json
{
  "owner_type": "application",
  "owner_id": "my-app",
  "domain_name": "preferences",
  "display_name": "Preferences",
  "description": "Client preferences"
}
```

### 响应 `201`

返回 `{ "data": Domain }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败 |
| `409` | `client_data_domain_name_conflict` | 同 owner 下 `domain_name` 重复 |

## 列出数据域

```http
GET /client-data/domains
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `owner_type` | string | 按拥有者类型过滤 |
| `owner_id` | string | 按拥有者标识过滤 |
| `status` | string | 按状态过滤：`active` / `suspended` / `deleted` |
| `sort_by` | string | `updated_at`（默认）/ `created_at` / `domain_name` |
| `sort_order` | string | `asc` / `desc` |
| `limit` | integer | 每页条数 |
| `offset` | integer | 偏移量 |

### 响应 `200`

普通列表默认不返回 managed domain。

```json
{
  "data": [ ],
  "meta": {
    "total": 3,
    "limit": 50,
    "offset": 0,
    "has_more": false,
    "sort_by": "updated_at",
    "sort_order": "desc"
  }
}
```

## 获取数据域详情

```http
GET /client-data/domains/:domainId
```

返回 Domain 对象，额外包含以下字段：


| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `quota_usage` | object | 包含 `entry_count` 和 `byte_count` |
| `restorable_until` | integer \| null | 删除后可恢复的截止时间 |

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 数据域不存在 |
| `410` | `client_data_domain_deleted` | 数据域已删除 |

## 更新数据域元数据

```http
PATCH /client-data/domains/:domainId
```

至少提供一个可修改字段。支持乐观锁。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `display_name` | string | 否 | 展示名称 |
| `description` | string | 否 | 描述 |
| `if_version` | integer | 否 | 乐观锁：当前期望版本号 |

### 请求示例

```json
{
  "display_name": "Preferences Updated",
  "if_version": 2
}
```

### 响应 `200`

返回 `{ "data": Domain }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体为空或校验失败 |
| `404` | `not_found` | 数据域不存在 |
| `409` | `client_data_version_conflict` | 版本号不匹配 |
| `410` | `client_data_domain_deleted` | 数据域已删除 |

## 更新数据域配额

```http
PATCH /client-data/domains/:domainId/quota
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `quota_max_entries` | integer | 否 | 最大条目数 |
| `quota_max_bytes` | integer | 否 | 最大字节数 |

### 请求示例

```json
{
  "quota_max_entries": 20000,
  "quota_max_bytes": 20971520
}
```

### 响应 `200`

返回 `{ "data": Domain }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 校验失败 |
| `403` | `forbidden` | 权限不足 |
| `404` | `not_found` | 数据域不存在 |
| `409` | `client_data_domain_quota_below_usage` | 新配额低于当前使用量 |

## 删除数据域

```http
DELETE /client-data/domains/:domainId
```

软删除。删除后在宽限期内可通过 restore 接口恢复。

### 响应 `200`

```json
{
  "data": {
    "id": "domain_abc123",
    "deleted": true
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 数据域不存在 |

## 恢复数据域

```http
POST /client-data/domains/:domainId/restore
```

恢复已删除的数据域。仅在宽限期内有效。

### 响应 `200`

返回 `{ "data": Domain }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 数据域不存在 |
| `409` | `client_data_domain_restore_invalid_state` | 数据域状态不允许恢复 |
| `409` | `client_data_domain_restore_expired` | 宽限期已过 |
| `409` | `client_data_domain_restore_conflict` | 恢复时 owner/name 冲突 |

## 按拥有者批量删除数据域

```http
DELETE /client-data/owners/:ownerType/:ownerId/domains
```

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `ownerType` | string | `application` / `plugin` |
| `ownerId` | string | 拥有者标识 |

### 响应 `200`

返回被删除的数据域 ID 列表。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 路径参数不合法 |

## 导出数据域

```http
GET /client-data/domains/:domainId/export
```

导出整个数据域的完整快照，包含域信息、所有集合及其条目。

这组导出 / 导入接口的定位是：

- 备份
- 迁移
- merge 工具输入输出

它不是 turn 级、floor 级的精确保真 snapshot restore 语义，也不用于替代受治理状态层的历史恢复。

### 响应 `200`

```json
{
  "data": {
    "domain": {
      "id": "domain_abc123",
      "owner_type": "application",
      "owner_id": "my-app",
      "domain_name": "preferences"
    },
    "collections": [
      {
        "collection_name": "settings",
        "items": [
          {
            "item_key": "theme.dark",
            "value_json": true,
            "version": 1
          }
        ]
      }
    ],
    "exported_at": 1735689600000
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 数据域不存在 |
| `410` | `client_data_domain_deleted` | 数据域已删除 |

## 导入为新数据域

```http
POST /client-data/domains/import
```

以导出格式创建一个新的数据域。

这组导入接口适合：

- 备份导回
- 环境迁移
- merge 补齐

不适合把它当作历史楼层快照、分支状态回滚或 turn 级精确恢复接口。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `conflict_policy` | string | **是** | 冲突策略：`fail` / `overwrite` / `skip` |
| `payload` | object | **是** | 导出格式的完整快照 |

### 请求示例

```json
{
  "conflict_policy": "fail",
  "payload": {
    "domain": {
      "owner_type": "application",
      "owner_id": "my-app",
      "domain_name": "preferences"
    },
    "collections": []
  }
}
```

### 响应 `201`

返回创建的域、集合列表和导入统计摘要。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | payload 校验失败 |
| `400` | `client_data_import_item_limit_exceeded` | 导入条目数超过上限 |
| `400` | `client_data_import_payload_too_large` | payload 过大 |
| `409` | `client_data_import_conflict` | `fail` 策略下检测到冲突 |

## 导入到现有数据域

```http
POST /client-data/domains/:domainId/import
```

将导出数据合并到一个已存在的数据域。冲突策略决定键名重复时的处理方式。

### 请求体

与「导入为新数据域」相同。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `client_data_import_item_limit_exceeded` / `client_data_import_payload_too_large` | 校验或大小超限 |
| `404` | `not_found` | 目标数据域不存在 |
| `409` | `client_data_import_domain_mismatch` | payload 中的域信息与目标域不一致 |
| `409` | `client_data_import_conflict` | `fail` 策略下检测到冲突 |
| `410` | `client_data_domain_deleted` | 目标数据域已删除 |

---

## 创建集合

```http
POST /client-data/domains/:domainId/collections
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `collection_name` | string | **是** | 集合名称 |
| `description` | string | 否 | 描述 |
| `default_expires_ttl_ms` | integer | 否 | 默认过期 TTL（毫秒） |
| `max_item_size_bytes` | integer | 否 | 单条数据大小上限 |
| `metadata_json` | any | 否 | 集合自定义元数据 |

### 响应 `201`

返回 `{ "data": Collection }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 校验失败 |
| `404` | `not_found` | 数据域不存在 |
| `409` | `client_data_collection_name_conflict` | 同域内 `collection_name` 重复 |

## 列出集合

```http
GET /client-data/domains/:domainId/collections
```

### 响应 `200`

返回 `{ "data": Collection[] }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 数据域不存在 |
| `410` | `client_data_domain_deleted` | 数据域已删除 |

## 获取集合详情

```http
GET /client-data/domains/:domainId/collections/:collectionId
```

### 响应 `200`

返回 `{ "data": Collection }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 数据域或集合不存在 |
| `410` | `client_data_domain_deleted` | 数据域已删除 |

## 更新集合

```http
PATCH /client-data/domains/:domainId/collections/:collectionId
```

至少提供一个可修改字段。支持乐观锁。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `description` | string | 否 | 描述 |
| `default_expires_ttl_ms` | integer | 否 | 默认过期 TTL |
| `max_item_size_bytes` | integer | 否 | 单条大小上限 |
| `metadata_json` | any | 否 | 集合自定义元数据 |
| `if_version` | integer | 否 | 乐观锁：当前期望版本号 |

### 响应 `200`

返回 `{ "data": Collection }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体为空或校验失败 |
| `404` | `not_found` | 数据域或集合不存在 |
| `409` | `client_data_version_conflict` | 版本号不匹配 |
| `410` | `client_data_domain_deleted` | 数据域已删除 |

## 删除集合

```http
DELETE /client-data/domains/:domainId/collections/:collectionId
```

删除集合及其下所有条目。

### 响应 `200`

```json
{
  "data": {
    "id": "coll_abc123",
    "deleted": true
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 数据域或集合不存在 |

---

## 列出条目

```http
GET /client-data/domains/:domainId/items
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `collection_id` | string | 按集合过滤 |
| `item_key_prefix` | string | 按键名前缀过滤 |
| `updated_after` | integer | 更新时间下限 |
| `updated_before` | integer | 更新时间上限 |
| `expires_after` | integer | 过期时间下限 |
| `expires_before` | integer | 过期时间上限 |
| `expired` | boolean | `true` 只返回已过期，`false` 只返回未过期 |
| `sort_by` | string | `updated_at`（默认）/ `created_at` / `item_key` |
| `sort_order` | string | `asc` / `desc` |
| `limit` | integer | 每页条数 |
| `offset` | integer | 偏移量 |

### 响应 `200`

返回 `{ "data": Item[], "meta": ListMeta }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 查询参数不合法 |
| `403` | `client_data_domain_forbidden` | 拥有者没有对应权限 |
| `404` | `not_found` | 数据域不存在 |
| `410` | `client_data_domain_deleted` | 数据域已删除 |

## 按键名直接读取条目

```http
GET /client-data/domains/:domainId/items/by-key?collection_name=settings&item_key=theme.dark
```

通过集合名称和键名直接定位条目，不需要先查 `collection_id`。

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `collection_name` | string | **是** | 集合名称 |
| `item_key` | string | **是** | 条目键名 |

### 响应 `200`

返回 `{ "data": Item }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 参数缺失或不合法 |
| `403` | `client_data_domain_forbidden` | 拥有者没有对应权限 |
| `404` | `not_found` | 数据域、集合或条目不存在 |
| `410` | `client_data_domain_deleted` | 数据域已删除 |

## 获取条目详情

```http
GET /client-data/domains/:domainId/items/:itemId
```

### 响应 `200`

返回 `{ "data": Item }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `403` | `client_data_domain_forbidden` | 拥有者没有对应权限 |
| `404` | `not_found` | 数据域或条目不存在 |
| `410` | `client_data_domain_deleted` | 数据域已删除 |

## 单条 Upsert

```http
PUT /client-data/domains/:domainId/items
```

如果相同 `collection_name + item_key` 的条目已存在则更新，否则创建。集合不存在时自动创建。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `collection_name` | string | **是** | 集合名称 |
| `item_key` | string | **是** | 条目键 |
| `value_json` | any | **是** | 条目值（任意 JSON） |
| `expires_at` | integer | 否 | 过期时间 |
| `if_version` | integer | 否 | 乐观锁：当前期望版本号 |

### 响应 `200`

```json
{
  "data": {
    "action": "created",
    "collection": { },
    "item": { }
  }
}
```

`action` 为 `created` 或 `updated`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 校验失败 |
| `403` | `client_data_domain_forbidden` | 拥有者没有对应权限 |
| `404` | `not_found` | 数据域不存在 |
| `409` | `client_data_version_conflict` | 版本号不匹配 |
| `410` | `client_data_domain_deleted` | 数据域已删除 |

## 批量 Upsert

```http
PUT /client-data/domains/:domainId/items/batch
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `items` | array | **是** | Upsert 条目数组，每个元素结构同单条 upsert 的请求体 |

### 响应 `200`

```json
{
  "data": {
    "results": [
      { "action": "created", "collection": { }, "item": { } },
      { "action": "updated", "collection": { }, "item": { } }
    ]
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 校验失败 |
| `403` | `client_data_domain_forbidden` | 拥有者没有对应权限 |
| `404` | `not_found` | 数据域不存在 |
| `409` | `client_data_version_conflict` | 某条数据版本号不匹配 |
| `410` | `client_data_domain_deleted` | 数据域已删除 |

## 删除单条

```http
DELETE /client-data/domains/:domainId/items/:itemId
```

### 响应 `200`

```json
{
  "data": {
    "id": "item_abc123",
    "deleted": true
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `403` | `client_data_domain_forbidden` | 拥有者没有对应权限 |
| `404` | `not_found` | 数据域或条目不存在 |

## 批量删除

```http
POST /client-data/domains/:domainId/items/delete-batch
```

按条目 ID 列表或集合 ID 删除，两者至少提供一个。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `item_ids` | string[] | 条件必填 | 要删除的条目 ID 列表 |
| `collection_id` | string | 条件必填 | 要清空的集合 ID |

### 响应 `200`

返回被删除的条目列表，每条包含 `id`、`collection_id`、`item_key`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 两个字段都没有提供，或校验失败 |
| `403` | `client_data_domain_forbidden` | 拥有者没有对应权限 |
| `404` | `not_found` | 数据域不存在 |

---

## 列出授权

```http
GET /client-data/domains/:domainId/grants
```

仅数据域拥有者可操作。

### 响应 `200`

返回 `{ "data": Grant[] }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `403` | `client_data_domain_grant_manage_forbidden` | 非拥有者不能管理授权 |
| `404` | `not_found` | 数据域不存在 |

## 创建授权

```http
POST /client-data/domains/:domainId/grants
```

仅数据域拥有者可操作。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `grantee_owner_type` | string | **是** | 被授权方类型：`application` / `plugin` |
| `grantee_owner_id` | string | **是** | 被授权方标识 |
| `can_read` | boolean | 否 | 读取权限，默认 `false` |
| `can_write` | boolean | 否 | 写入权限，默认 `false` |
| `can_delete` | boolean | 否 | 删除权限，默认 `false` |
| `can_list` | boolean | 否 | 列出权限，默认 `false` |
| `expires_at` | integer | 否 | 授权过期时间 |

### 请求示例

```json
{
  "grantee_owner_type": "plugin",
  "grantee_owner_id": "chat-annotator",
  "can_read": true,
  "can_write": false,
  "can_delete": false,
  "can_list": true,
  "expires_at": null
}
```

### 响应 `201`

返回 `{ "data": Grant }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 校验失败 |
| `403` | `client_data_domain_grant_manage_forbidden` | 非拥有者不能管理授权 |
| `404` | `not_found` | 数据域不存在 |
| `409` | `client_data_domain_grant_conflict` | 同一被授权方已有授权记录 |

## 更新授权

```http
PATCH /client-data/domains/:domainId/grants/:grantId
```

仅数据域拥有者可操作。至少提供一个可修改字段。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `can_read` | boolean | 否 | 读取权限 |
| `can_write` | boolean | 否 | 写入权限 |
| `can_delete` | boolean | 否 | 删除权限 |
| `can_list` | boolean | 否 | 列出权限 |
| `expires_at` | integer \| null | 否 | 授权过期时间 |

### 响应 `200`

返回 `{ "data": Grant }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体为空或校验失败 |
| `403` | `client_data_domain_grant_manage_forbidden` | 非拥有者不能管理授权 |
| `404` | `not_found` | 数据域或授权记录不存在 |

## 删除授权

```http
DELETE /client-data/domains/:domainId/grants/:grantId
```

仅数据域拥有者可操作。

### 响应 `200`

```json
{
  "data": {
    "id": "grant_abc123",
    "deleted": true
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `403` | `client_data_domain_grant_manage_forbidden` | 非拥有者不能管理授权 |
| `404` | `not_found` | 数据域或授权记录不存在 |

---

## 列出审计日志

```http
GET /client-data/domains/:domainId/audit-logs
```

仅数据域拥有者可查看。

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `actor_type` | string | 按操作者类型过滤 |
| `action` | string | 按动作过滤 |
| `sort_by` | string | `created_at`（默认） |
| `sort_order` | string | `asc` / `desc` |
| `limit` | integer | 每页条数 |
| `offset` | integer | 偏移量 |

### 响应 `200`

返回 `{ "data": AuditLog[], "meta": ListMeta }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `403` | `client_data_domain_grant_manage_forbidden` | 非拥有者不能查看审计日志 |
| `404` | `not_found` | 数据域不存在 |

---

## 错误码汇总

| HTTP | `error.code` | 说明 |
| ---- | ------------ | ---- |
| 400 | `client_data_caller_owner_invalid` | 拥有者请求头不合法 |
| 400 | `client_data_import_item_limit_exceeded` | 导入条目数超过上限 |
| 400 | `client_data_import_payload_too_large` | 导入数据过大 |
| 403 | `client_data_managed_domain_raw_access_forbidden` | managed domain 不能走 raw `/client-data` 路径 |
| 403 | `client_data_domain_forbidden` | 拥有者没有对应权限 |
| 403 | `client_data_domain_grant_manage_forbidden` | 非拥有者不能管理授权或审计 |
| 404 | `not_found` | 资源不存在 |
| 409 | `client_data_domain_name_conflict` | 同 owner 下 domain 名冲突 |
| 409 | `client_data_collection_name_conflict` | 同域内 collection 名冲突 |
| 409 | `client_data_domain_grant_conflict` | 同一被授权方已有 grant |
| 409 | `client_data_version_conflict` | 元数据或条目乐观锁冲突 |
| 409 | `client_data_domain_quota_below_usage` | 新配额低于当前使用量 |
| 409 | `client_data_domain_restore_invalid_state` | 数据域状态不允许恢复 |
| 409 | `client_data_domain_restore_expired` | 恢复宽限期已过 |
| 409 | `client_data_domain_restore_conflict` | 恢复时 owner/name 冲突 |
| 409 | `client_data_import_domain_mismatch` | 导入目标与数据不一致 |
| 409 | `client_data_import_conflict` | `fail` 策略下检测到冲突 |
| 410 | `client_data_domain_deleted` | 数据域已删除 |
