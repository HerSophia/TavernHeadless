---
outline: [2, 3]
---

# Messages（消息）

消息是对话的最小内容单位，属于某个消息页（Page）。

## Message 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 消息 ID |
| `page_id` | string | 所属消息页 ID |
| `seq` | integer | 消息在页内的序号 |
| `role` | string | 角色：`system` / `user` / `assistant` |
| `content` | string | 消息内容 |
| `content_format` | string | 内容格式：`plain` / `markdown` |
| `token_count` | integer | token 数量 |
| `is_hidden` | boolean | 是否隐藏（不参与 Prompt 组装） |
| `source` | string \| null | 来源标记 |
| `created_at` | integer | 创建时间 |

## 创建消息

```http
POST /messages
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `page_id` | string | **是** | 所属消息页 ID |
| `seq` | integer | **是** | 序号 |
| `role` | string | **是** | 角色 |
| `content` | string | **是** | 内容 |
| `content_format` | string | 否 | 内容格式（默认 `plain`） |
| `token_count` | integer | 否 | token 数 |
| `is_hidden` | boolean | 否 | 是否隐藏（默认 `false`） |
| `source` | string | 否 | 来源标记 |

### 响应 `201`

返回 `{ "data": Message }` 。

## 列出消息

```http
GET /messages
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `page_id` | string | 按消息页过滤 |
| `role` | string | 按角色过滤 |
| `is_hidden` | boolean | 按隐藏状态过滤 |
| `sort_by` | string | `seq`（默认）/ `created_at` |

## 获取消息详情

```http
GET /messages/:id
```

## 更新消息

```http
PATCH /messages/:id
```

至少提供一个字段。可更新：`seq`、`role`、`content`、`content_format`、`token_count`、`is_hidden`、`source`。

## 删除消息

```http
DELETE /messages/:id
```

## 批量更新可见性

```http
PATCH /messages/batch/visibility
```

批量设置消息的 `is_hidden` 状态。

### 请求体

```json
{
  "ids": ["msg_001", "msg_002"],
  "is_hidden": true
}
```

- `ids`：消息 ID 数组，1-100 条，不可重复
- `is_hidden`：目标可见性状态

### 响应 `200`

```json
{
  "data": {
    "results": [
      { "index": 0, "id": "msg_001", "action": "updated", "data": {} },
      { "index": 1, "id": "msg_002", "action": "not_found" }
    ],
    "meta": {
      "total": 2,
      "updated": 1,
      "not_found": 1,
      "is_hidden": true
    }
  }
}
```

## 批量删除消息

```http
POST /messages/batch/delete
```

### 请求体

```json
{
  "ids": ["msg_001", "msg_002"]
}
```

### 响应 `200`

```json
{
  "data": {
    "results": [
      { "index": 0, "id": "msg_001", "action": "deleted" },
      { "index": 1, "id": "msg_002", "action": "not_found" }
    ],
    "meta": { "total": 2, "deleted": 1, "not_found": 1 }
  }
}
```