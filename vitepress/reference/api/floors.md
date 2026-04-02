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
| `state` | string | 状态：`draft` / `generating` / `committed` / `failed` |
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
| `floor_no` | integer | **是** | 楼层序号 |
| `branch_id` | string | 否 | 分支 ID，默认 `main` |
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
| `sort_by` | string | `created_at`（默认）/ `updated_at` / `floor_no` |
| `sort_order` | string | `asc` / `desc` |
| `limit` | integer | 每页条数，默认 `50` |
| `offset` | integer | 偏移量，默认 `0` |

### 响应 `200`

返回 `{ "data": Floor[], "meta": ListMeta }` 。

## 获取楼层详情

```http
GET /floors/:id
```

### 响应 `200`

返回 `{ "data": Floor }` 。

## 获取楼层运行快照

```http
GET /floors/:id/run
```

返回当前楼层最近一次业务运行的快照。

这组字段不等于 `Floor.state`。它主要表达：

- `run_id` / `run_type`
- `status`
- `phase` / `public_phase`
- `attempt_no`
- `pending_output`
- `verifier`

## 获取 committed floor 结果快照

```http
GET /floors/:id/result
```

返回已经提交完成的结构化结果快照。

主要字段包括：

- `floor_id`
- `output_page_id`
- `assistant_message_id`
- `generated_text`
- `summaries`
- `usage`
- `verifier`
- `committed_at`

如果楼层还不是 `committed`，接口返回 `409 invalid_state`。

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

为指定楼层准备一个可用的分支描述对象。

当前实现会校验 source floor 是否存在且处于 `committed` 状态，并检查目标 `branch_id` 是否冲突；如果校验通过，返回一个 branch 描述对象。这个过程**不会立即写入新的 floor 或持久化 branch 记录**。

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

补充语义：

- `main` 分支不可删除，服务端返回 `409 protected_branch`
- 如果同名 `branch_id` 同时存在于多个 session，不传 `session_id` 会返回 `409 ambiguous_branch`
- 删除分支前，服务端会先清理该 branch 对应的 branch-scope 变量

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `session_id` | string | 限定会话范围；当同名 branch 存在于多个会话时会变成必填 |

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