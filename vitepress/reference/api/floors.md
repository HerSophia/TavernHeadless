---
outline: [2, 3]
---

# Floors（楼层）

楼层是会话中消息的容器。每个楼层对应一轮对话（用户消息 + AI 回复），可包含多个消息页（Page）用于支持重新生成。

## Floor 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 楼层 ID |
| `session_id` | string | 所属会话 ID |
| `floor_no` | integer | 楼层序号（从 0 开始） |
| `branch_id` | string | 所属分支 ID |
| `parent_floor_id` | string \| null | 父楼层 ID |
| `state` | string | 状态：`pending` / `generating` / `committed` / `failed` / `cancelled` |
| `token_in` | integer | 输入 token 数 |
| `token_out` | integer | 输出 token 数 |
| `created_at` | integer | 创建时间（毫秒时间戳） |
| `updated_at` | integer | 更新时间 |

## 创建楼层

```http
POST /floors
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `session_id` | string | **是** | 所属会话 ID |
| `floor_no` | integer | 否 | 楼层序号 |
| `branch_id` | string | 否 | 分支 ID |
| `parent_floor_id` | string | 否 | 父楼层 ID |
| `state` | string | 否 | 初始状态 |
| `token_in` | integer | 否 | 输入 token 数 |
| `token_out` | integer | 否 | 输出 token 数 |

### 响应 `201`

返回 `{ "data": Floor }` 。

## 列出楼层

```http
GET /floors
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `session_id` | string | 按会话过滤 |
| `branch_id` | string | 按分支过滤 |
| `state` | string | 按状态过滤 |
| `sort_by` | string | `floor_no`（默认）/ `created_at` / `updated_at` |

### 响应 `200`

返回 `{ "data": Floor[], "meta": ListMeta }` 。

## 获取楼层详情

```http
GET /floors/:id
```

### 响应 `200`

返回 `{ "data": Floor }` 。

## 更新楼层

```http
PATCH /floors/:id
```

至少提供一个字段。可更新字段：`floor_no`、`branch_id`、`parent_floor_id`、`state`、`token_in`、`token_out`。

### 响应 `200`

返回更新后的 Floor 对象。

## 删除楼层

```http
DELETE /floors/:id
```

### 响应 `200`

```json
{ "data": { "id": "floor_001", "deleted": true } }
```

## 从楼层创建分支

```http
POST /floors/:id/branch
```

以指定楼层为分叉点，创建一个新分支。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `branch_id` | string | 否 | 新分支 ID（不传则自动生成） |

### 响应 `201`

```json
{
  "data": {
    "branch_id": "alt-1",
    "source_floor_id": "floor_005",
    "source_floor_no": 5,
    "session_id": "sess_abc123"
  }
}
```

## 删除分支

```http
DELETE /branches/:id
```

删除指定分支下的所有楼层。

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `session_id` | string | 限定会话范围（可选，用于安全校验） |

### 响应 `200`

```json
{
  "data": {
    "branch_id": "alt-1",
    "session_id": "sess_abc123",
    "deleted_floor_count": 6
  }
}
```