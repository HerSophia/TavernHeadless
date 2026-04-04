---
outline: [2, 3]
---

# Sessions（会话）

会话是 TavernHeadless 的核心资源，代表一段角色扮演对话。每个会话绑定一个角色（Character）和一个用户卡（User），并关联 Preset、Worldbook、Regex 等资源。

## 创建会话

```http
POST /sessions
```

创建一个新的会话。如果绑定的角色有 greeting，会自动创建第一个楼层和消息。

当角色快照中存在 `alternateGreetings` 时，系统会为 floor 0 额外创建同一 `page_no` 下的多个输出页，并将主 greeting 设为活动页。后续可通过 `PATCH /pages/:id/activate` 切换这些 greeting 页。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `title` | string | 否 | 会话标题，1-200 字符 |
| `status` | string | 否 | 状态，`active`（默认）/ `archived` |
| `character_id` | string | 否 | 绑定角色 ID |
| `character_version_id` | string | 否 | 指定角色版本 ID |
| `character_sync_policy` | string | 否 | 同步策略：`pin`（默认）/ `manual` / `force` |
| `character_snapshot` | object | 否 | 手动提供的角色快照。当前支持基础字段，以及 `primaryGreeting`、`alternateGreetings`、`systemPrompt`、`postHistoryInstructions`、`creatorNotes`、`characterBook` 等扩展字段 |
| `user_id` | string | 否 | 绑定用户卡 ID |
| `user_snapshot` | object | 否 | 手动提供的用户快照 |
| `preset_id` | string | 否 | 绑定的 Preset ID |
| `regex_profile_id` | string | 否 | 绑定的 Regex Profile ID |
| `worldbook_profile_id` | string | 否 | 绑定的 Worldbook ID |
| `model_provider` | string | 否 | 模型供应商 |
| `model_name` | string | 否 | 模型名称 |
| `model_params` | object | 否 | 模型参数（如 temperature, top_p 等） |
| `prompt_mode` | string | 否 | 提示词模式：`compat_strict` / `compat_plus` / `native` |
| `metadata` | object | 否 | 自定义元数据 |

### 响应 `201`

```json
{
  "data": {
    "id": "sess_abc123",
    "title": "Campfire Scene",
    "status": "active",
    "character_binding": {
      "character_id": "char_001",
      "character_version_id": "cv_001",
      "sync_policy": "pin",
      "snapshot_summary": {
        "name": "Luna",
        "has_greeting": true
      }
    },
    "user_binding": {
      "user_id": "usr_001",
      "snapshot_summary": {
        "name": "Player"
      }
    },
    "preset_id": "preset_001",
    "regex_profile_id": null,
    "worldbook_profile_id": null,
    "model_provider": "openai",
    "model_name": "gpt-4o-mini",
    "model_params": { "temperature": 0.7 },
    "prompt_mode": "compat_strict",
    "metadata": {},
    "created_at": 1735689600000,
    "updated_at": 1735689600000
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `character_version_mismatch` / `invalid_character_snapshot` / `invalid_user_snapshot` | 请求体校验失败，或绑定快照不合法 |
| `404` | `character_not_found` / `user_not_found` | 指定角色、角色版本或用户不存在 |
| `409` | `user_not_active` | 用户存在但当前不可绑定 |

## 列出会话

```http
GET /sessions
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `status` | string | 按状态过滤：`active` / `archived` |
| `keyword` | string | 按标题模糊搜索，1-200 字符 |
| `sort_by` | string | 排序字段：`created_at`（默认）/ `updated_at` |
| `limit` | integer | 每页条数 |
| `offset` | integer | 偏移量 |
| `sort_order` | string | `asc` / `desc` |

### 响应 `200`

```json
{
  "data": [ ],
  "meta": {
    "total": 5,
    "limit": 20,
    "offset": 0,
    "has_more": false,
    "sort_by": "created_at",
    "sort_order": "desc"
  }
}
```

## 获取会话详情

```http
GET /sessions/:id
```

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 会话 ID |

### 响应 `200`

返回完整的 Session 对象（结构同创建时的响应）。

## 获取会话当前活跃运行

```http
GET /sessions/:id/active-run
```

返回当前会话最近一条仍在运行中的业务运行摘要。

主要字段包括：

- `active_run_id`
- `active_run_type`
- `branch_id`
- `busy`
- `public_phase`
- `latest_floor_id`

如果当前没有活跃运行，`active_run` 返回 `null`。

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 会话不存在 |

## 更新会话

```http
PATCH /sessions/:id
```

至少提供一个字段。可更新的字段与创建时一致（除 `id`）。当前实现中，**只有用户绑定变化**会同步更新已有楼层的用户绑定元数据；角色绑定更新只会修改 session 自身字段。

### 响应 `200`

返回更新后的完整 Session 对象。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `character_version_mismatch` / `invalid_character_snapshot` / `invalid_user_snapshot` | 请求体为空、请求体校验失败，或绑定快照不合法 |
| `404` | `not_found` / `character_not_found` / `user_not_found` | 会话、角色、角色版本或用户不存在 |
| `409` | `user_not_active` | 用户存在但当前不可绑定 |

## 删除会话

```http
DELETE /sessions/:id
```

### 响应 `200`

```json
{
  "data": {
    "id": "sess_abc123",
    "deleted": true
  }
}
```

## 同步角色绑定

```http
POST /sessions/:id/character/sync
```

当角色卡更新后，手动触发会话的角色快照同步。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `force` | boolean | 否 | 是否强制同步（忽略 sync_policy 检查） |

### 响应 `200`

返回更新后的 Session 对象。

## 获取时间线

```http
GET /sessions/:id/timeline
```

获取会话的楼层时间线，包含每个楼层当前生效的消息页和消息内容。

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `branch_id` | string | 指定分支 ID（不传则使用默认分支） |
| `limit` | integer | 最大 `200`，默认 `50` |
| `offset` | integer | 偏移量 |

### 响应 `200`

```json
{
  "data": {
    "session_id": "sess_abc123",
    "branch_id": "main",
    "floors": [
      {
        "id": "floor_001",
        "floor_no": 0,
        "state": "committed",
        "token_in": 0,
        "token_out": 42,
        "created_at": 1735689600000,
        "active_page": {
          "id": "page_001",
          "page_no": 0,
          "page_kind": "output",
          "version": 1,
          "messages": [
            {
              "id": "msg_001",
              "seq": 0,
              "role": "assistant",
              "content": "*Luna sits by the campfire...*",
              "content_format": "text"
            }
          ]
        },
        "page_count": 3
      }
    ]
  },
  "meta": { "total": 1, "limit": 50, "offset": 0, "has_more": false, "sort_by": "floor_no", "sort_order": "asc" }
}
```

## 列出分支

```http
GET /sessions/:id/branches
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `sort_by` | string | `updated_at`（默认）/ `branch_id` / `floor_count` / `latest_floor_no` |
| `sort_order` | string | `asc` / `desc` |
| `limit` | integer | 每页条数，默认 `50` |
| `offset` | integer | 偏移量，默认 `0` |

### 响应 `200`

```json
{
  "data": [
    {
      "branch_id": "main",
      "floor_count": 12,
      "latest_floor_no": 11,
      "latest_floor_id": "floor_011",
      "latest_state": "committed",
      "updated_at": 1735689660000
    }
  ],
  "meta": { "total": 2, "limit": 50, "offset": 0, "has_more": false, "sort_by": "updated_at", "sort_order": "desc" }
}
```

## 分支差异

```http
GET /sessions/:id/branches/diff
```

比较两个分支之间的楼层差异。

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `base_branch_id` | string | 否 | 基准分支 ID，默认 `main` |
| `target_branch_id` | string | 是 | 目标分支 ID |

### 响应 `200`

```json
{
  "data": {
    "session_id": "sess_abc123",
    "base_branch_id": "main",
    "target_branch_id": "alt-1",
    "fork_floor_no": 5,
    "shared_floor_nos": [0, 1, 2, 3, 4, 5],
    "base_only_floors": [ { "id": "f_06", "floorNo": 6, "branchId": "main", "state": "committed" } ],
    "target_only_floors": [ { "id": "f_06b", "floorNo": 6, "branchId": "alt-1", "state": "committed" } ]
  }
}
```

## 批量更新会话状态

```http
PATCH /sessions/batch/status
```

批量更新会话状态。每次最多 100 条，不允许重复 ID。目标状态仅限 `active` 或 `archived`。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `ids` | string[] | **是** | 会话 ID 数组，1-100 条，不允许重复 |
| `status` | string | **是** | 目标状态：`active` / `archived` |

### 请求示例

```json
{
  "ids": ["sess_001", "sess_002", "sess_missing"],
  "status": "archived"
}
```

### 响应 `200`

```json
{
  "data": {
    "results": [
      { "index": 0, "id": "sess_001", "action": "updated" },
      { "index": 1, "id": "sess_002", "action": "updated" },
      { "index": 2, "id": "sess_missing", "action": "not_found" }
    ],
    "meta": { "total": 3, "updated": 2, "not_found": 1, "status": "archived" }
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败、ids 为空或超过 100 条、存在重复 ID |

## 批量删除会话

```http
POST /sessions/batch/delete
```

批量硬删除会话。每次最多 100 条，不允许重复 ID。删除会话时，其下属的楼层、消息页、消息等资源通过数据库级联一并删除。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `ids` | string[] | **是** | 会话 ID 数组，1-100 条，不允许重复 |

### 请求示例

```json
{
  "ids": ["sess_001", "sess_missing"]
}
```

### 响应 `200`

```json
{
  "data": {
    "results": [
      { "index": 0, "id": "sess_001", "action": "deleted" },
      { "index": 1, "id": "sess_missing", "action": "not_found" }
    ],
    "meta": { "total": 2, "deleted": 1, "not_found": 1 }
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败、ids 为空或超过 100 条、存在重复 ID |
