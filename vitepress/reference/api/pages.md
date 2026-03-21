---
outline: [2, 3]
---

# Pages（消息页）

消息页是楼层内的版本容器。每次重新生成会在同一楼层下创建新的消息页，只有一个页处于激活（active）状态。

## Page 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 消息页 ID |
| `floor_id` | string | 所属楼层 ID |
| `page_no` | integer | 页序号 |
| `page_kind` | string | 类型：`generation` / `user_edit` / `system` |
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
| `page_no` | integer | 否 | 页序号 |
| `page_kind` | string | 否 | 类型 |
| `is_active` | boolean | 否 | 是否激活 |
| `version` | integer | 否 | 版本号 |
| `checksum` | string | 否 | 校验和 |

### 响应 `201`

返回 `{ "data": Page }` 。

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
| `sort_by` | string | `page_no`（默认）/ `created_at` / `updated_at` / `version` |

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

将指定消息页设为当前激活页。同一楼层下的其他页会自动取消激活。

### 响应 `200`

返回激活后的 Page 对象。