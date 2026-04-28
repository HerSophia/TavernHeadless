---
outline: [2, 3]
---

# Floors（楼层）

楼层就是一次对话回合。用户说一句话、模型回一句话，合在一起就是一个楼层。

每个楼层属于一个会话、一条分支。同一个楼层位置上可以有多个版本（比如重新生成后旧版本和新版本各是一个楼层）。

## 什么时候需要看这页

- 你要查看某个会话的楼层列表
- 你要为一次对话创建一个新楼层
- 你要创建或删除分支
- 你要回看某个楼层当时的运行结果

## 一个简单例子

假设你想查看某个会话最近聊了哪些回合：

```bash
curl "http://localhost:3000/floors?session_id=sess_001&sort_by=created_at&sort_order=desc&limit=10"
```

如果要创建新分支，可以先调用 `POST /floors/:id/branch`，拿到一个分支描述对象，下次发起聊天时带上这个 `branch_id`。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| floor | 一次对话回合（用户消息 + 模型回复） |
| branch | 对话的分支线，同一个位置可以有多个分支 |
| superseded | 被新版本替代的旧楼层，不会再出现在默认列表里 |
| run | 一次楼层运行的业务状态，包括运行类型、进度和结果 |



## Floor 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 楼层 ID |
| `session_id` | string | 所属会话 ID |
| `floor_no` | integer | 楼层序号（从 0 开始） |
| `branch_id` | string | 所属分支 ID |
| `parent_floor_id` | string \| null | 父楼层 ID |
| `superseded_at` | integer \| null | 被替代时间戳（毫秒时间戳）；为 `null` 表示当前仍是 live floor |
| `superseded_by_floor_id` | string \| null | 替代它的新楼层 ID |
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

如果 `parent_floor_id` 存在但不属于 `session_id` 指定的同一会话，接口返回 `409 floor_parent_session_mismatch`。

## 列出楼层

```http
GET /floors
```

默认只返回 live floor；已经被后续 regenerate 替代的 superseded floor 不会出现在列表中。

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

只接受**拓扑字段**的局部更新：`floor_no`、`branch_id`、`parent_floor_id`。至少提供一个字段。

以下字段**不再允许**通过本接口修改：

- `state`：由楼层 run 状态机驱动。要推进一个 floor 的状态，应走 `/sessions/:id/respond` / `/floors/:id/retry` / commit pipeline，而不是直接 PATCH。
- `token_in` / `token_out`：由 commit 事务根据本次生成的真实 prompt/output 写入。直接改这两个字段会污染会话预算真相。

如果请求体**仅包含**上述受限字段，接口返回 `400 floor_patch_restricted_field`。如果请求体同时包含受限字段与拓扑字段，接口返回 `400 floor_patch_mixed_fields`，整条请求被拒绝。

拓扑字段还会做额外校验：

- `parent_floor_id` 不能指向当前 floor 自身，否则返回 `400 floor_patch_topology_invalid`。
- `parent_floor_id` 对应的 floor 必须属于同一 session，否则返回 `409 floor_parent_session_mismatch`。
- parent floor 的 `floor_no` 必须严格小于本次 PATCH 后的 `floor_no`，否则返回 `400 floor_patch_topology_invalid`。
- 如果只改 `branch_id` 而不同时显式更新 `parent_floor_id`，而当前 `parent_floor_id` 指向的 floor 又不属于同一 session，接口返回 `400 floor_patch_topology_invalid`。

### 响应 `200`

返回更新后的 Floor 对象。

如果目标 floor 当前仍有活跃运行，接口返回 `409 active_run_in_progress`。

## 删除楼层

```http
DELETE /floors/:id
```

### 响应 `200`

```json
{ "data": { "id": "floor_001", "deleted": true } }
```

如果目标 floor 当前仍有活跃运行，接口返回 `409 active_run_in_progress`。

## 从楼层创建分支

```http
POST /floors/:id/branch
```

为指定楼层准备一个可用的分支描述对象。

当前实现会校验 source floor 是否存在、未被 superseded 且处于 `committed` 状态，并检查目标 `branch_id` 是否冲突；如果校验通过，返回一个 branch 描述对象。这个过程**不会立即写入新的 floor 或持久化 branch 记录**。

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
- 如果目标 branch 当前仍有活跃运行，接口返回 `409 active_run_in_progress`

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