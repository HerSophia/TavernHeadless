---
outline: [2, 3]
---

# Pages（消息页）

消息页是楼层里面的分页容器。一个楼层可以有多页——比如重新生成后新的一页和旧的一页各是不同的页。

每页下面可以有多条消息。同一个 `floor_id + page_no` 上，只有一个页是当前激活的。

## 什么时候需要看这页

- 你要创建新消息页
- 你要切换激活页
- 你要查看或修改某个页的属性
- 你要对 committed floor 的当前正文做页级人工修订

## 一个简单例子

```bash
# 查看某个楼层下的消息页
curl "http://localhost:3000/pages?floor_id=floor_001"

# 激活某个页
curl -X PATCH http://localhost:3000/pages/page_001/activate
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| page_no | 页序号，input 页通常是 0，output 页通常是 1 |
| page_kind | 页类型：input（输入页）、output（输出页）、mixed（混合页） |
| activate | 把当前这个页设为同一 floor + page_no 下的唯一激活页 |



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
- 如果目标页已经位于 committed floor，这个通用更新入口仍然会返回 `409 content_target_locked`
- committed floor 的人工修订必须走下面的专用 `manual-revisions` 路由

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败 |
| `404` | `not_found` | 消息页不存在 |
| `409` | `page_conflict` | 更新后会命中页版本唯一性或 active 槽位唯一性约束 |
| `409` | `content_target_locked` | 目标页所在楼层处于 committed 或 superseded，只允许走专用人工修订入口 |

## 查看页级人工修订历史

```http
GET /pages/:id/manual-revisions
```

这个端点用于读取 committed floor 页级人工修订历史。
它本质上会解析该 page 对应的唯一可编辑 message，然后返回该 message 的修订时间线。

### 响应 `200`

返回值结构与 message 级人工修订历史相同，至少包含：

- `target_kind`、`target_id`
- `session_id`、`branch_id`、`floor_id`、`page_id`、`message_id`
- `current_content`、`current_token_count`
- `latest_revision_no`
- `items[]`

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 消息页不存在 |
| `409` | `manual_revision_invalid_state` | 目标不满足人工修订条件 |
| `409` | `manual_revision_shape_not_supported` | 这个 page 不能稳定映射到单条可编辑 message |

## 提交页级人工修订

```http
POST /pages/:id/manual-revisions
```

这个端点只修改当前展示正文，也就是 page 下那条目标 message 的 `messages.content` 与 `messages.token_count`。
它不会改 `GET /floors/:id/result` 返回的 committed snapshot，也不会改 prompt snapshot、memory、session state、tool audit。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `content` | string | **是** | 修订后的目标正文 |
| `expected_latest_revision_no` | integer | **是** | 期望的最新修订号，用于乐观锁 |
| `reason` | string | 否 | 本次人工修订原因 |

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败 |
| `404` | `not_found` | 消息页不存在 |
| `409` | `manual_revision_invalid_state` | 目标不满足人工修订条件 |
| `409` | `manual_revision_shape_not_supported` | 这个 page 不能稳定映射到单条可编辑 message |
| `409` | `manual_revision_conflict` | `expected_latest_revision_no` 与当前最新修订号不一致 |

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
