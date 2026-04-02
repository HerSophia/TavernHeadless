---
outline: [2, 3]
---

# Pages（消息页）

消息页是楼层内的版本容器。每次重新生成通常会在同一楼层下创建新的消息页。`PATCH /pages/:id/activate` 会把同楼层的其他 active page 取消激活，但 `POST /pages`、`PATCH /pages/:id` 和数据库层目前都没有全局唯一 active page 约束。

## Page 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 消息页 ID |
| `floor_id` | string | 所属楼层 ID |
| `page_no` | integer | 页序号 |
| `page_kind` | string | 类型：`input` / `output` / `mixed` |
| `is_active` | boolean | 是否为当前激活页 |
| `version` | integer | 版本号 |
| `checksum` | string \| null | 内容校验和 |
| `created_at` | integer | 创建时间 |
| `updated_at` | integer | 更新时间 |

## 创建消息页

```http
POST /pages
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `floor_id` | string | **是** | 所属楼层 ID |
| `page_no` | integer | **是** | 页序号 |
| `page_kind` | string | **是** | 类型：`input` / `output` / `mixed` |
| `is_active` | boolean | 否 | 是否激活 |
| `version` | integer | 否 | 版本号 |
| `checksum` | string | 否 | 校验和 |

### 响应 `201`

返回 `{ "data": Page }` 。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败 |
| `404` | `not_found` | 所属 floor 不存在 |
| `409` | `conflict` | 页唯一性等约束冲突 |

## 列出消息页

```http
GET /pages
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `floor_id` | string | 按楼层过滤 |
| `page_kind` | string | 按类型过滤 |
| `is_active` | boolean | 按激活状态过滤 |
| `sort_by` | string | `created_at`（默认）/ `updated_at` / `page_no` / `version` |
| `sort_order` | string | `asc` / `desc` |
| `limit` | integer | 每页条数，默认 `50` |
| `offset` | integer | 偏移量，默认 `0` |

### 响应 `200`

返回 `{ "data": Page[], "meta": ListMeta }` 。

## 获取消息页详情

```http
GET /pages/:id
```

## 更新消息页

```http
PATCH /pages/:id
```

## 删除消息页

```http
DELETE /pages/:id
```

## 激活消息页

```http
PATCH /pages/:id/activate
```

将指定消息页设为当前激活页。这个端点会在同一楼层内取消其他 active page，但这只是 activate 路径上的行为，不代表系统在所有写路径上都强制保证“同楼层只能有一个 active page”。

### 响应 `200`

返回激活后的 Page 对象。

## 批量删除消息页

```http
POST /pages/batch/delete
```

批量硬删除消息页。每次最多 100 条，不允许重复 ID。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `ids` | string[] | **是** | 消息页 ID 数组，1-100 条，不允许重复 |

### 请求示例

```json
{
  "ids": ["page_001", "page_002", "page_missing"]
}
```

### 响应 `200`

```json
{
  "data": {
    "results": [
      { "index": 0, "id": "page_001", "action": "deleted" },
      { "index": 1, "id": "page_002", "action": "deleted" },
      { "index": 2, "id": "page_missing", "action": "not_found" }
    ],
    "meta": { "total": 3, "deleted": 2, "not_found": 1 }
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败、ids 为空或超过 100 条、存在重复 ID |
