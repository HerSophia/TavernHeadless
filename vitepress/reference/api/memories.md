---
outline: [2, 3]
---

# Memories（记忆）

记忆系统用于存储和管理从对话中提取的结构化信息。包含记忆条目（Memory Item）和记忆边（Memory Edge）。

## Memory Item 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 记忆 ID |
| `scope` | string | 作用域：`global` / `session` |
| `scope_id` | string | 关联资源 ID |
| `type` | string | 类型：`fact` / `summary` / `open_loop` |
| `content` | object | 记忆内容（任意 JSON） |
| `importance` | number | 重要度，0-1 |
| `confidence` | number | 置信度，0-1 |
| `source_floor_id` | string \| null | 来源楼层 ID |
| `source_message_id` | string \| null | 来源消息 ID |
| `status` | string | 状态：`active` / `deprecated` |
| `created_at` | integer | 创建时间 |
| `updated_at` | integer | 更新时间 |

## 创建记忆条目

```http
POST /memories
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `scope` | string | **是** | 作用域 |
| `scope_id` | string | **是** | 关联 ID |
| `type` | string | **是** | 记忆类型 |
| `content` | object | **是** | 记忆内容 |
| `importance` | number | 否 | 重要度（默认 0.5） |
| `confidence` | number | 否 | 置信度（默认 0.5） |
| `source_floor_id` | string | 否 | 来源楼层 |
| `source_message_id` | string | 否 | 来源消息 |
| `status` | string | 否 | 状态（默认 `active`） |

### 响应 `201`

返回 `{ "data": MemoryItem }` 。

## 查询记忆条目

```http
GET /memories
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `scope` | string | 按作用域过滤 |
| `scope_id` | string | 按关联 ID 过滤 |
| `type` | string | 按类型过滤 |
| `status` | string | 按状态过滤 |
| `source_floor_id` | string | 按来源楼层过滤 |
| `source_message_id` | string | 按来源消息过滤 |
| `created_from` | integer | 创建时间下限 |
| `created_to` | integer | 创建时间上限 |
| `updated_from` | integer | 更新时间下限 |
| `updated_to` | integer | 更新时间上限 |
| `importance_min` | number | 重要度下限 |
| `importance_max` | number | 重要度上限 |
| `confidence_min` | number | 置信度下限 |
| `confidence_max` | number | 置信度上限 |
| `q` | string | 全文搜索 |
| `sort_by` | string | `created_at`（默认）/ `updated_at` / `importance` / `confidence` / `type` |

## 获取记忆详情

```http
GET /memories/:id
```

## 更新记忆

```http
PATCH /memories/:id
```

至少提供一个字段。可更新所有可写字段。

## 删除记忆

```http
DELETE /memories/:id
```

## 记忆统计

```http
GET /memories/stats
```

返回记忆条目的统计信息。支持与列表接口相同的过滤参数。

### 响应 `200`

```json
{
  "data": {
    "total": 42,
    "active": 38,
    "deprecated": 4,
    "by_type": {
      "fact": 20,
      "summary": 15,
      "open_loop": 7
    },
    "avg_importance": 0.65,
    "avg_confidence": 0.72,
    "estimated_tokens": 8400
  }
}
```

## 批量更新记忆状态

```http
PATCH /memories/batch/status
```

### 请求体

```json
{
  "ids": ["mem_001", "mem_002"],
  "status": "deprecated"
}
```

### 响应 `200`

```json
{
  "data": {
    "results": [
      { "index": 0, "id": "mem_001", "action": "updated", "data": {} },
      { "index": 1, "id": "mem_002", "action": "not_found" }
    ],
    "meta": { "total": 2, "updated": 1, "not_found": 1, "status": "deprecated" }
  }
}
```

## 批量删除记忆

```http
POST /memories/batch/delete
```

### 请求体

```json
{ "ids": ["mem_001", "mem_002"] }
```

---

## Memory Edge（记忆边）

记忆边表达两个记忆条目之间的关系。

### Memory Edge 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 边 ID |
| `from_id` | string | 起始记忆 ID |
| `to_id` | string | 目标记忆 ID |
| `relation` | string | 关系类型：`supersedes` / `contradicts` / `elaborates` / `causes` |
| `created_at` | integer | 创建时间 |

### 创建记忆边

```http
POST /memory-edges
```

#### 请求体

| 字段 | 类型 | 必填 |
| ---- | ---- | ---- |
| `from_id` | string | **是** |
| `to_id` | string | **是** |
| `relation` | string | **是** |

### 列出记忆边

```http
GET /memory-edges
```

#### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `from_id` | string | 按起始记忆过滤 |
| `to_id` | string | 按目标记忆过滤 |
| `relation` | string | 按关系类型过滤 |
| `sort_by` | string | `created_at`（默认） |

### 获取记忆边详情

```http
GET /memory-edges/:id
```

### 删除记忆边

```http
DELETE /memory-edges/:id
```