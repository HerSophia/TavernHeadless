---
outline: [2, 3]
---

# Worldbooks（世界书管理）

管理通过 [导入接口](./imports#导入-worldbook) 导入的 SillyTavern 世界书。

世界书包含一组关键词触发的条目（entries），用于在对话中注入背景设定。

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
      "updated_at": 1735689660000
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
      "entries": [
        {
          "keys": ["kingdom"],
          "content": "The kingdom is recovering from a long war."
        }
      ]
    },
    "created_at": 1735689600000,
    "updated_at": 1735689660000
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 世界书不存在 |

## 更新 Worldbook

```http
PUT /worldbooks/:id
```

支持乐观锁：传入 `expected_updated_at`，如果数据库中的 `updated_at` 不匹配则返回 `409`。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | **是** | 名称（至少 1 字符） |
| `data` | object | **是** | 世界书 JSON 数据 |
| `expected_updated_at` | integer | 否 | 乐观锁 |

### 请求示例

```json
{
  "name": "Kingdom Lore v2",
  "data": {
    "entries": [
      {
        "keys": ["kingdom", "realm"],
        "content": "The kingdom has entered a new era of peace."
      }
    ]
  },
  "expected_updated_at": 1735689660000
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
    "updated_at": 1735690000000
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败 |
| `404` | 世界书不存在 |
| `409` | 乐观锁冲突 |

## 删除 Worldbook

```http
DELETE /worldbooks/:id
```

删除世界书时，其下所有条目会被级联删除。

### 响应 `204`

无响应体。

---

# Worldbook Entries（条目管理）

对单个世界书条目进行增删改查和批量操作，无需操作整个世界书 JSON。

所有条目端点都挂载在 `/worldbooks/:worldbook_id/entries` 下。

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
| `position` | integer | 插入位置（0–6） |
| `order` | integer | 插入优先级 |
| `depth` | integer | @depth 模式的深度 |
| `role` | integer | 消息角色（0=system, 1=user, 2=assistant） |
| `disable` | boolean | 是否禁用 |
| `scan_depth` | integer \| null | 独立扫描深度（null=使用全局） |
| `case_sensitive` | boolean \| null | 独立大小写设置（null=使用全局） |
| `match_whole_words` | boolean \| null | 独立全词匹配（null=使用全局） |
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
| `keys` | string[] | **是** | 主关键词 |
| `content` | string | **是** | 注入内容 |
| `comment` | string | 否 | 标题/备注 |
| `keys_secondary` | string[] | 否 | 辅助关键词 |
| `selective` | boolean | 否 | 默认 `true` |
| `selective_logic` | integer | 否 | 默认 `0` |
| `constant` | boolean | 否 | 默认 `false` |
| `position` | integer | 否 | 默认 `0` |
| `order` | integer | 否 | 默认 `100` |
| `depth` | integer | 否 | 默认 `4` |
| `role` | integer | 否 | 默认 `0` |
| `disable` | boolean | 否 | 默认 `false` |
| `scan_depth` | integer \| null | 否 | 默认 `null` |
| `case_sensitive` | boolean \| null | 否 | 默认 `null` |
| `match_whole_words` | boolean \| null | 否 | 默认 `null` |

### 请求示例

```json
{
  "keys": ["kingdom", "realm"],
  "content": "The kingdom is vast and ancient.",
  "comment": "Kingdom basics"
}
```

### 响应 `201`

返回创建的完整条目对象（格式同列表中的单个条目）。

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败 |
| `404` | 世界书不存在 |

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

### 请求示例

```json
{
  "content": "The kingdom has entered a new golden age.",
  "disable": false
}
```

### 响应 `200`

返回更新后的完整条目对象。

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败或未传任何字段 |
| `404` | 世界书或条目不存在 |

## 删除条目

```http
DELETE /worldbooks/:worldbook_id/entries/:id
```

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

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 世界书或条目不存在 |

## 批量更新条目

```http
PATCH /worldbooks/:worldbook_id/entries/batch/update
```

对多个条目应用相同的字段更新。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `ids` | string[] | **是** | 条目 ID 数组（1–100，不可重复） |
| `fields` | object | **是** | 要更新的字段（同更新条目的请求体） |

### 请求示例

```json
{
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
| `ids` | string[] | **是** | 条目 ID 数组（1–100，不可重复） |

### 请求示例

```json
{
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
| `items` | object[] | **是** | 排序项数组（1–100，id 不可重复） |
| `items[].id` | string | **是** | 条目 ID |
| `items[].order` | integer | **是** | 新的排序值 |

### 请求示例

```json
{
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

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败或 ID 数组有重复 |
| `404` | 世界书不存在 |
