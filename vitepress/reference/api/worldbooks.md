---
outline: [2, 3]
---

# Worldbooks（世界书管理）

管理通过 [导入接口](./imports#导入-worldbook) 导入的 SillyTavern 世界书。

世界书包含一组关键词触发的条目（entries），用于在对话中注入背景设定。

`GET /worldbooks/:id` 和 `PUT /worldbooks/:id` 面向**原始 SillyTavern 世界书 payload**。如果只需要对条目做结构化 CRUD，请使用后半部分的 `Worldbook Entries` 子资源接口。

## 列出 Worldbooks

```http
GET /worldbooks
```

### 响应 `200`

```json
{
  "data": [
    {
      "id": "wb_kingdom",
      "name": "Kingdom Lore",
      "source": "sillytavern",
      "created_at": 1735689600000,
      "updated_at": 1735689660000,
      "version": 2
    }
  ]
}
```

## 获取 Worldbook 详情

```http
GET /worldbooks/:id
```

返回完整的世界书数据。

### 响应 `200`

```json
{
  "data": {
    "id": "wb_kingdom",
    "name": "Kingdom Lore",
    "source": "sillytavern",
    "data": {
      "name": "Kingdom Lore",
      "entries": [
        {
          "uid": 0,
          "key": ["kingdom", "realm"],
          "keysecondary": ["history"],
          "selective": true,
          "selectiveLogic": 0,
          "constant": false,
          "content": "The kingdom is recovering from a long war.",
          "comment": "Kingdom basics",
          "position": 0,
          "order": 100,
          "depth": 4,
          "role": 0,
          "disable": false,
          "scanDepth": null,
          "caseSensitive": null,
          "matchWholeWords": null
        }
      ],
      "scanDepth": 2,
      "caseSensitive": false,
      "matchWholeWords": false,
      "recursive": false,
      "maxRecursionSteps": 0
    },
    "created_at": 1735689600000,
    "updated_at": 1735689660000,
    "version": 2
  }
}
```

这里的 `data.entries[]` 使用的是原始 SillyTavern 字段名，例如 `key`、`keysecondary`、`selectiveLogic`、`scanDepth`、`caseSensitive`、`matchWholeWords`。它不同于下方 `Worldbook Entries` 子资源接口里的规范化字段 `keys`、`keys_secondary`、`selective_logic`、`scan_depth` 等。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 世界书不存在 |

## 更新 Worldbook

```http
PUT /worldbooks/:id
```

此接口要求提供并发控制字段：

- 新接入应优先传 `expected_version`
- 现有主资源 `PUT` 路由仍兼容 `expected_updated_at`
- 如果两者都不传，会返回 `400`

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | **是** | 名称（至少 1 字符） |
| `data` | object | **是** | 原始 SillyTavern 世界书 JSON 数据 |
| `expected_version` | integer | 否 | 推荐的乐观锁字段；期望的 `version` 值 |
| `expected_updated_at` | integer | 否 | 兼容字段；仅用于已有主资源 `PUT` 调用方 |

### 请求示例

```json
{
  "name": "Kingdom Lore v2",
  "expected_version": 2,
  "data": {
    "name": "Kingdom Lore v2",
    "entries": [
      {
        "uid": 0,
        "key": ["kingdom", "realm"],
        "keysecondary": ["history"],
        "selective": true,
        "selectiveLogic": 0,
        "constant": false,
        "content": "The kingdom has entered a new era of peace.",
        "comment": "Kingdom basics",
        "position": 0,
        "order": 100,
        "depth": 4,
        "role": 0,
        "disable": false,
        "scanDepth": null,
        "caseSensitive": null,
        "matchWholeWords": null
      }
    ]
  }
}
```

### 响应 `200`

```json
{
  "data": {
    "id": "wb_kingdom",
    "name": "Kingdom Lore v2",
    "source": "sillytavern",
    "created_at": 1735689600000,
    "updated_at": 1735690000000,
    "version": 3
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `worldbook_validation_error` | 请求体校验失败、未提供 `expected_version` / `expected_updated_at`，或原始世界书 payload 无法通过校验 |
| `404` | `worldbook_not_found` | 世界书不存在 |
| `409` | `worldbook_conflict` | 版本基线过期，或兼容字段 `expected_updated_at` 不匹配 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |

## 删除 Worldbook

```http
DELETE /worldbooks/:id
```

删除世界书时，其下所有条目会被级联删除。

删除时推荐通过 query string 传入 `expected_version`。此接口不使用 `DELETE` 请求体。

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `expected_version` | integer | 否 | 推荐的版本前置条件；不传时保留无前置条件删除行为 |

### 请求示例

```http
DELETE /worldbooks/wb_kingdom?expected_version=3
```

### 响应 `204`

无响应体。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 查询参数校验失败 |
| `404` | `worldbook_not_found` | 仅当传入 `expected_version` 且目标世界书不存在时返回 |
| `409` | `worldbook_conflict` | `expected_version` 与服务端当前版本不一致 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |

未传 `expected_version` 时，删除走无前置条件的幂等 `204` 路径。即使目标世界书已经不存在，接口仍返回 `204`。

---

## Worldbook Entries（条目管理）

对单个世界书条目进行增删改查和批量操作，无需操作整个世界书 JSON。

所有条目端点都挂载在 `/worldbooks/:worldbook_id/entries` 下。

### 写入并发控制

以下写入端点都支持 `expected_version`：

- `POST /worldbooks/:worldbook_id/entries`
- `PATCH /worldbooks/:worldbook_id/entries/:id`
- `PATCH /worldbooks/:worldbook_id/entries/batch/update`
- `POST /worldbooks/:worldbook_id/entries/batch/delete`
- `PUT /worldbooks/:worldbook_id/entries/batch/reorder`

其中 `DELETE /worldbooks/:worldbook_id/entries/:id` 使用 query string `expected_version`，其他写入端点通过 JSON body 传递 `expected_version`。当版本基线过期时返回 `409 worldbook_conflict`；当 SQLite 写入暂时繁忙时返回 `503 resource_busy`。

## 条目字段说明

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 条目 ID（系统生成） |
| `worldbook_id` | string | 所属世界书 ID |
| `uid` | integer | 数值 UID（ST 兼容，自动分配） |
| `keys` | string[] | 主关键词 |
| `keys_secondary` | string[] | 辅助关键词 |
| `content` | string | 注入的文本内容 |
| `comment` | string | 标题/备注 |
| `selective` | boolean | 是否启用辅助关键词 |
| `selective_logic` | integer | 辅助关键词逻辑（0=AND_ANY, 1=NOT_ALL, 2=NOT_ANY, 3=AND_ALL） |
| `constant` | boolean | 常驻条目（无需触发） |
| `position` | integer | 插入位置（0–7） |
| `order` | integer | 插入优先级 |
| `depth` | integer | @depth 模式的深度 |
| `role` | integer | 消息角色（0=system, 1=user, 2=assistant） |
| `disable` | boolean | 是否禁用 |
| `scan_depth` | integer \| null | 独立扫描深度（null=使用全局） |
| `case_sensitive` | boolean \| null | 独立大小写设置（null=使用全局） |
| `match_whole_words` | boolean \| null | 独立全词匹配（null=使用全局） |
| `exclude_recursion` | boolean | 递归轮是否跳过该条目 |
| `prevent_recursion` | boolean | 该条目内容是否阻止继续进入递归缓冲区 |
| `delay_until_recursion` | integer \| null | 至少递归到指定层级后才允许命中 |
| `outlet_name` | string | `position=7` 时使用的 outlet 名称 |
| `created_at` | integer | 创建时间戳 |
| `updated_at` | integer | 更新时间戳 |

## 列出条目

```http
GET /worldbooks/:worldbook_id/entries
```

### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| `limit` | integer | 50 | 每页数量（1–200） |
| `offset` | integer | 0 | 偏移量 |
| `sort_by` | string | `order` | 排序字段：`order` / `updated_at` / `uid` |
| `sort_order` | string | `asc` | `asc` / `desc` |
| `disable` | boolean | — | 按禁用状态过滤 |
| `constant` | boolean | — | 按常驻状态过滤 |
| `position` | integer | — | 按插入位置过滤 |
| `q` | string | — | 搜索关键词/备注/内容 |

### 响应 `200`

```json
{
  "data": [
    {
      "id": "ent_abc123",
      "worldbook_id": "wb_kingdom",
      "uid": 0,
      "comment": "Kingdom basics",
      "content": "The kingdom is vast and ancient.",
      "keys": ["kingdom", "realm"],
      "keys_secondary": ["history"],
      "selective": true,
      "selective_logic": 0,
      "constant": false,
      "position": 0,
      "order": 100,
      "depth": 4,
      "role": 0,
      "disable": false,
      "scan_depth": null,
      "case_sensitive": null,
      "match_whole_words": null,
      "exclude_recursion": false,
      "prevent_recursion": false,
      "delay_until_recursion": null,
      "outlet_name": "",
      "created_at": 1735689600000,
      "updated_at": 1735689660000
    }
  ],
  "meta": {
    "total": 1,
    "limit": 50,
    "offset": 0,
    "has_more": false,
    "sort_by": "order",
    "sort_order": "asc"
  }
}
```

## 创建条目

```http
POST /worldbooks/:worldbook_id/entries
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `expected_version` | integer | 否 | 期望的父世界书 `version` 值 |
| `keys` | string[] | **是** | 主关键词 |
| `content` | string | **是** | 注入内容 |
| `comment` | string | 否 | 标题/备注 |
| `keys_secondary` | string[] | 否 | 辅助关键词 |
| `selective` | boolean | 否 | 默认 `true` |
| `selective_logic` | integer | 否 | 默认 `0` |
| `constant` | boolean | 否 | 默认 `false` |
| `position` | integer | 否 | 默认 `0`；`7` 表示 outlet |
| `order` | integer | 否 | 默认 `100` |
| `depth` | integer | 否 | 默认 `4` |
| `role` | integer | 否 | 默认 `0` |
| `disable` | boolean | 否 | 默认 `false` |
| `scan_depth` | integer \| null | 否 | 默认 `null` |
| `case_sensitive` | boolean \| null | 否 | 默认 `null` |
| `match_whole_words` | boolean \| null | 否 | 默认 `null` |
| `exclude_recursion` | boolean | 否 | 默认 `false` |
| `prevent_recursion` | boolean | 否 | 默认 `false` |
| `delay_until_recursion` | integer \| null | 否 | 默认 `null` |
| `outlet_name` | string | 否 | 默认空字符串，仅 `position=7` 时有意义 |

运行时说明：

- `position=7` 的条目现在会进入真实 prompt 组装。
- 如果预设里存在同名 outlet marker，会按该 marker 的位置注入；如果没有匹配 marker，当前实现会回退为显式 section，而不是静默丢弃。

### 请求示例

```json
{
  "expected_version": 3,
  "keys": ["kingdom", "realm"],
  "content": "The kingdom is vast and ancient.",
  "comment": "Kingdom basics"
}
```

### 响应 `201`

返回创建的完整条目对象（格式同列表中的单个条目）。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败 |
| `404` | `not_found` | 世界书不存在 |
| `409` | `worldbook_conflict` | `expected_version` 过期 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |

## 获取条目

```http
GET /worldbooks/:worldbook_id/entries/:id
```

### 响应 `200`

```json
{
  "data": {
    "id": "ent_abc123",
    "worldbook_id": "wb_kingdom",
    "uid": 0,
    "comment": "Kingdom basics",
    "content": "The kingdom is vast and ancient.",
    "keys": ["kingdom", "realm"],
    "keys_secondary": ["history"],
    "selective": true,
    "selective_logic": 0,
    "constant": false,
    "position": 0,
    "order": 100,
    "depth": 4,
    "role": 0,
    "disable": false,
    "scan_depth": null,
    "case_sensitive": null,
    "match_whole_words": null,
    "exclude_recursion": false,
    "prevent_recursion": false,
    "delay_until_recursion": null,
    "outlet_name": "",
    "created_at": 1735689600000,
    "updated_at": 1735689660000
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 世界书或条目不存在 |

## 更新条目

```http
PATCH /worldbooks/:worldbook_id/entries/:id
```

部分更新，只传需要修改的字段。至少传一个字段。

请求体可选传入 `expected_version`，用于校验父世界书版本。

### 请求示例

```json
{
  "expected_version": 3,
  "content": "The kingdom has entered a new golden age.",
  "disable": false
}
```

### 响应 `200`

返回更新后的完整条目对象。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败或未传任何更新字段 |
| `404` | `not_found` | 世界书或条目不存在 |
| `409` | `worldbook_conflict` | `expected_version` 过期 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |

## 删除条目

```http
DELETE /worldbooks/:worldbook_id/entries/:id
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `expected_version` | integer | 否 | 期望的父世界书 `version` 值 |

### 响应 `200`

```json
{
  "data": {
    "id": "ent_abc123",
    "deleted": true
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 世界书或条目不存在 |
| `409` | `worldbook_conflict` | `expected_version` 过期 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |

## 批量更新条目

```http
PATCH /worldbooks/:worldbook_id/entries/batch/update
```

对多个条目应用相同的字段更新。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `expected_version` | integer | 否 | 期望的父世界书 `version` 值 |
| `ids` | string[] | **是** | 条目 ID 数组（1–100，不可重复） |
| `fields` | object | **是** | 要更新的字段（同更新条目的请求体） |

### 请求示例

```json
{
  "expected_version": 3,
  "ids": ["ent_abc123", "ent_def456"],
  "fields": {
    "disable": true
  }
}
```

### 响应 `200`

```json
{
  "data": {
    "results": [
      {
        "index": 0,
        "id": "ent_abc123",
        "action": "updated",
        "data": { "...完整条目对象..." }
      },
      {
        "index": 1,
        "id": "ent_def456",
        "action": "not_found"
      }
    ],
    "meta": {
      "total": 2,
      "updated": 1,
      "not_found": 1
    }
  }
}
```

## 批量删除条目

```http
POST /worldbooks/:worldbook_id/entries/batch/delete
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `expected_version` | integer | 否 | 期望的父世界书 `version` 值 |
| `ids` | string[] | **是** | 条目 ID 数组（1–100，不可重复） |

### 请求示例

```json
{
  "expected_version": 3,
  "ids": ["ent_abc123", "ent_def456"]
}
```

### 响应 `200`

```json
{
  "data": {
    "results": [
      { "index": 0, "id": "ent_abc123", "action": "deleted" },
      { "index": 1, "id": "ent_def456", "action": "not_found" }
    ],
    "meta": {
      "total": 2,
      "deleted": 1,
      "not_found": 1
    }
  }
}
```

## 批量重排序条目

```http
PUT /worldbooks/:worldbook_id/entries/batch/reorder
```

批量更新条目的 `order` 字段。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `expected_version` | integer | 否 | 期望的父世界书 `version` 值 |
| `items` | object[] | **是** | 排序项数组（1–100，id 不可重复） |
| `items[].id` | string | **是** | 条目 ID |
| `items[].order` | integer | **是** | 新的排序值 |

### 请求示例

```json
{
  "expected_version": 3,
  "items": [
    { "id": "ent_abc123", "order": 10 },
    { "id": "ent_def456", "order": 20 }
  ]
}
```

### 响应 `200`

```json
{
  "data": {
    "results": [
      {
        "index": 0,
        "id": "ent_abc123",
        "action": "updated",
        "data": { "...完整条目对象..." }
      },
      {
        "index": 1,
        "id": "ent_def456",
        "action": "updated",
        "data": { "...完整条目对象..." }
      }
    ],
    "meta": {
      "total": 2,
      "updated": 2,
      "not_found": 0
    }
  }
}
```

### 错误（所有批量端点通用）

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败或 ID 数组有重复 |
| `404` | `not_found` | 世界书不存在 |
| `409` | `worldbook_conflict` | `expected_version` 过期 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |
