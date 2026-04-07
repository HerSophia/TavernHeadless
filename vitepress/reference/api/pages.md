---
outline: [2, 3]
---

# Pages（消息页）

消息页是楼层内的版本容器。系统当前的 active 不变量是：同一 `(floor_id, page_no)` 最多只能有一个 `is_active = true` 的版本。

这不是“同一楼层只能有一个 active page”。因此：

- `page_no = 0` 的 input 页和 `page_no = 1` 的 output 页可以同时处于 active 状态
- `PATCH /pages/:id/activate` 只会切换目标页所在的同一 `(floor_id, page_no)` 槽位
- `POST /pages` 和 `PATCH /pages/:id` 不再接受公开的 `is_active` 写入

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
| `version` | integer | 否 | 版本号 |
| `checksum` | string | 否 | 校验和 |

### 说明

- 公开请求体不再接受 `is_active`
- 如果旧客户端仍发送 `is_active`，会收到 `400 validation_error`
- active 版本的选择由内部服务处理，而不是由公开写接口直接控制

### 响应 `201`

返回 `{ "data": Page }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败，包括仍发送 `is_active` |
| `404` | `not_found` | 所属 floor 不存在 |
| `409` | `page_conflict` | 重复 `(floor_id, page_no, version)`，或命中同一 `(floor_id, page_no)` 的 active 槽位唯一约束 |

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

返回 `{ "data": Page[], "meta": ListMeta }`。

## 获取消息页详情

```http
GET /pages/:id
```

## 更新消息页

```http
PATCH /pages/:id
```

### 说明

- 公开请求体不再接受 `is_active`
- 如果需要切换当前激活版本，必须使用 `PATCH /pages/:id/activate`
- 旧客户端如果继续发送 `is_active`，会收到 `400 validation_error`

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败 |
| `404` | `not_found` | 消息页不存在 |
| `409` | `page_conflict` | 更新后会命中页版本唯一性或 active 槽位唯一性约束 |

## 删除消息页

```http
DELETE /pages/:id
```

## 激活消息页

```http
PATCH /pages/:id/activate
```

将指定消息页设为当前激活页。

### 语义

- 这个端点是事务化的
- 它只会切换目标页所在的同一 `(floor_id, page_no)` 槽位
- 它不会清空同一楼层中其他 `page_no` 槽位的 active 页
- `page_kind = "input"` 的页不允许通过这个端点激活
- committed 楼层中，公开 page 变更只保留这个受约束的激活路径

### 响应 `200`

返回激活后的 Page 对象。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 目标页不允许激活，例如 `page_kind = "input"` |
| `404` | `not_found` | 消息页不存在，或不属于当前账号 |
| `409` | `conflict` | 激活事务中的约束冲突 |

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
