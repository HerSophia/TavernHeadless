---
outline: [2, 3]
---

# Messages（消息）

消息就是对话里的每一条内容。用户说的、模型回的、系统提示，每条都是一条消息。

消息属于某个消息页，消息页属于某个楼层。

## 什么时候需要看这页

- 你要查看某个楼层里的所有消息
- 你要写入或修改消息内容
- 你要批量切换消息的可见性

## 一个简单例子

查看某个消息页里的消息：

```bash
curl "http://localhost:3000/messages?page_id=page_001"
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| page | 消息页，一个楼层下的一组分页，例如重新生成产生的新页 |
| role | 消息角色：system、user、assistant、narrator |
| hidden | 隐藏消息，不参与提示词组装 |


消息是对话的最小内容单位，属于某个消息页（Page）。

## Message 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 消息 ID |
| `page_id` | string | 所属消息页 ID |
| `seq` | integer | 消息在页内的序号 |
| `role` | string | 角色：`system` / `user` / `assistant` / `narrator` |
| `content` | string | 消息内容 |
| `content_format` | string | 内容格式：`text` / `markdown` / `json` |
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
| `content_format` | string | 否 | 内容格式（默认 `text`） |
| `token_count` | integer | 否 | token 数 |
| `is_hidden` | boolean | 否 | 是否隐藏（默认 `false`） |
| `source` | string | 否 | 来源标记 |

### 响应 `201`

返回 `{ "data": Message }` 。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败 |
| `409` | `message_conflict` | 重复 `(page_id, seq)`，消息序号在目标页内已存在 |
| `404` | `not_found` | 所属消息页不存在，或当前账号不可访问 |

## 列出消息

```http
GET /messages
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `page_id` | string | 按消息页过滤 |
| `role` | string | 按角色过滤：`system` / `user` / `assistant` / `narrator` |
| `is_hidden` | boolean | 按隐藏状态过滤 |
| `sort_by` | string | `created_at`（默认）/ `seq` |
| `sort_order` | string | `asc` / `desc` |
| `limit` | integer | 每页条数，默认 `50` |
| `offset` | integer | 偏移量，默认 `0` |

### 响应 `200`

返回 `{ "data": Message[], "meta": ListMeta }` 。

## 获取消息详情

```http
GET /messages/:id
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 消息不存在 |

## 更新消息

```http
PATCH /messages/:id
```

至少提供一个字段。可更新：`seq`、`role`、`content`、`content_format`、`token_count`、`is_hidden`、`source`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败 |
| `404` | `not_found` | 消息不存在 |
| `409` | `message_conflict` | 更新后的 `seq` 会与同页其他消息冲突 |

## 删除消息

```http
DELETE /messages/:id
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 消息不存在 |

## 批量更新可见性

```http
PATCH /messages/batch/visibility
```

批量设置消息的 `is_hidden` 状态。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `ids` | string[] | **是** | 消息 ID 数组，1-100 条，不可重复 |
| `is_hidden` | boolean | **是** | 目标可见性状态 |

::: warning 去重校验
同一批次内 ID 不可重复，否则返回 `400`。
:::

### 请求示例

```json
{
  "ids": ["msg_001", "msg_002"],
  "is_hidden": true
}
```

### 响应 `200`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `data.results` | array | 每条的处理结果 |
| `data.results[].index` | integer | 对应请求数组中的下标 |
| `data.results[].id` | string | 消息 ID |
| `data.results[].action` | string | `updated`（成功）或 `not_found`（ID 不存在） |
| `data.results[].data` | Message | 更新后的完整消息对象（仅 `action=updated` 时存在） |
| `data.meta.total` | integer | 请求总条数 |
| `data.meta.updated` | integer | 成功更新条数 |
| `data.meta.not_found` | integer | 未找到条数 |
| `data.meta.is_hidden` | boolean | 本次设置的目标状态 |

```json
{
  "data": {
    "results": [
      {
        "index": 0,
        "id": "msg_001",
        "action": "updated",
        "data": {
          "id": "msg_001",
          "page_id": "page_12",
          "seq": 1,
          "role": "assistant",
          "content": "The moon is bright tonight.",
          "content_format": "text",
          "token_count": 6,
          "is_hidden": true,
          "source": null,
          "created_at": 1735689600000
        }
      },
      {
        "index": 1,
        "id": "msg_002",
        "action": "not_found"
      }
    ],
    "meta": { "total": 2, "updated": 1, "not_found": 1, "is_hidden": true }
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败、ids 为空或超过 100 条、存在重复 ID |

## 批量删除消息

```http
POST /messages/batch/delete
```

批量物理删除指定消息。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `ids` | string[] | **是** | 消息 ID 数组，1-100 条，不可重复 |

### 请求示例

```json
{
  "ids": ["msg_001", "msg_002"]
}
```

### 响应 `200`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `data.results` | array | 每条的处理结果 |
| `data.results[].index` | integer | 对应请求数组中的下标 |
| `data.results[].id` | string | 消息 ID |
| `data.results[].action` | string | `deleted`（成功）或 `not_found`（ID 不存在） |
| `data.meta.total` | integer | 请求总条数 |
| `data.meta.deleted` | integer | 成功删除条数 |
| `data.meta.not_found` | integer | 未找到条数 |

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

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败、ids 为空或超过 100 条、存在重复 ID |