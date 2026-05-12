---
outline: [2, 3]
---

# Sessions（会话）

会话就是一段聊天。每个会话绑定了一个角色卡和一个用户卡，并挂上了预设、世界书、正则配置这些资源。

创建会话之后，就可以往里面发消息聊起来了。

## 什么时候需要看这页

- 你要创建一个新会话
- 你要查看或搜索已有会话
- 你要修改会话的绑定资源
- 你要删除或归档会话
- 你要同步角色卡的最新内容到会话

## 一个简单例子

```bash
# 创建一个会话
curl -X POST http://localhost:3000/sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Campfire",
    "character_id": "char_001",
    "user_id": "usr_001",
    "preset_id": "preset_001"
  }'
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| preset | 预设，决定提示词的组装方式和外观 |
| character | 角色卡，角色的人设和对话风格 |
| user | 用户卡，玩家的人设 |
| worldbook | 世界书，对话中触发关键词时注入的背景信息 |
| regex profile | 正则配置，对文本做批量替换的规则集 |



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
| `preset_id` | string \| null | 否 | 绑定的 Preset ID。省略或传 `null` 表示创建时不绑定 |
| `regex_profile_id` | string \| null | 否 | 绑定的 Regex Profile ID。省略或传 `null` 表示创建时不绑定 |
| `worldbook_profile_id` | string \| null | 否 | 绑定的 Worldbook ID。省略或传 `null` 表示创建时不绑定 |
| `deep_binding` | boolean | 否 | 是否开启会话级深度绑定。默认 `false`。开启后运行时优先读取绑定的资产版本内容 |
| `preset_version_id` | string \| null | 否 | 绑定的 Preset 版本 ID。`deep_binding=true` 时生效；省略时使用该 Preset 的当前版本 |
| `regex_profile_version_id` | string \| null | 否 | 绑定的 Regex Profile 版本 ID。`deep_binding=true` 时生效；省略时使用该 Regex Profile 的当前版本 |
| `worldbook_version_id` | string \| null | 否 | 绑定的 Worldbook 版本 ID。`deep_binding=true` 时生效；省略时使用该 Worldbook 的当前版本 |
| `model_provider` | string | 否 | 模型供应商 |
| `model_name` | string | 否 | 模型名称 |
| `model_params` | object | 否 | 模型参数（如 temperature, top_p 等） |
| `prompt_mode` | string | 否 | 提示词模式：`compat_strict` / `compat_plus` / `native`。它仍写入 `sessions.prompt_mode`。如果你想在 Prompt Runtime 控制面里显式读取、清空或改写这个值，也可以使用 [Prompt Runtime Mode](./prompt-runtime-mode) |
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
    "deep_binding": false,
    "preset_version_id": null,
    "regex_profile_version_id": null,
    "worldbook_version_id": null,
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
服务端会先修正已经超过运行超时窗口、且长时间没有继续更新的陈旧 generating run；这类 run 不再作为活跃运行返回。

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 会话不存在 |

## 更新会话

```http
PATCH /sessions/:id
```

至少提供一个字段。可更新的字段与创建时一致（除 `id`）。当前实现中，**只有用户绑定变化**会同步更新已有楼层的用户绑定元数据；角色绑定更新只会修改 session 自身字段。

会话的浅绑定资产字段支持明确解绑：

- 省略 `preset_id` / `regex_profile_id` / `worldbook_profile_id`：不改变现有资产绑定。
- 传入字符串：绑定到当前账号下的对应资产。
- 传入 `null`：解除该绑定。

深度绑定字段也采用同样的 PATCH 语义：

- `deep_binding=false`：清空三类 `*_version_id`，运行时按资产 ID 读取当前内容。
- `deep_binding=true`：已绑定资产但未传版本 ID 时，服务端会绑定该资产当前版本。
- 传入 `preset_version_id` / `regex_profile_version_id` / `worldbook_version_id` 字符串时，版本必须属于同一资产且资产属于当前账号。


如果你只想改 `prompt_mode`，也可以改用 [Prompt Runtime Mode](./prompt-runtime-mode) 里的独立 `/mode` 控制面。两条写入口最终都落到同一份持久化真相：`sessions.prompt_mode`。

### 响应 `200`

返回更新后的完整 Session 对象。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `character_version_mismatch` / `invalid_character_snapshot` / `invalid_user_snapshot` | 请求体为空、请求体校验失败，或绑定快照不合法 |
| `404` | `not_found` / `character_not_found` / `user_not_found` / `preset_not_found` / `regex_profile_not_found` / `worldbook_not_found` / `asset_version_not_found` | 会话、角色、角色版本、用户、绑定资产或资产版本不存在，或不属于当前账号 |
| `409` | `user_not_active` | 用户存在但当前不可绑定 |


## 资产版本读取

下面这些接口用于读取 Preset、Worldbook、Regex Profile 的不可变版本。它们只读取版本，不修改当前资产。

```http
GET /presets/:id/versions
GET /presets/:id/versions/:version_id
GET /worldbooks/:id/versions
GET /worldbooks/:id/versions/:version_id
GET /regex-profiles/:id/versions
GET /regex-profiles/:id/versions/:version_id
```

单条版本响应：

```json
{
  "data": {
    "id": "preset_ver_001",
    "asset_id": "preset_001",
    "kind": "preset",
    "version_no": 1,
    "parent_version_id": null,
    "content_hash": "sha256:...",
    "snapshot": {},
    "created_by_operation_id": null,
    "created_at": 1735689600000
  }
}
```

版本列表响应为 `{ "data": [ ... ] }`。如果资产不存在或不属于当前账号，返回对应的 `preset_not_found`、`worldbook_not_found` 或 `regex_profile_not_found`。如果指定版本不存在，返回 `asset_version_not_found`。

### 资产版本比较

```http
POST /presets/:id/versions/compare
POST /worldbooks/:id/versions/compare
POST /regex-profiles/:id/versions/compare
```

请求体：

```json
{
  "left_version_id": "preset_ver_001",
  "right_version_id": "preset_ver_002",
  "mode": "summary"
}
```

`mode` 默认为 `summary`，也可以传 `full`。默认摘要模式会使用结构化 diff，适合审计和调试列表展示。

响应示例：

```json
{
  "data": {
    "asset_id": "preset_001",
    "kind": "preset",
    "left_version_id": "preset_ver_001",
    "right_version_id": "preset_ver_002",
    "diff": {
      "mode": "summary",
      "total_changes": 1,
      "truncated": false,
      "changes": [
        {
          "path": "temperature",
          "change_type": "changed",
          "before_hash": "sha256:...",
          "after_hash": "sha256:...",
          "redacted": false
        }
      ]
    }
  }
}
```

如果任一版本不存在、版本不属于该资产，返回 `404 asset_version_not_found`。

### 资产版本回滚

```http
POST /presets/:id/versions/:version_id/rollback
POST /worldbooks/:id/versions/:version_id/rollback
POST /regex-profiles/:id/versions/:version_id/rollback
```

回滚不会修改旧版本。服务端会把目标版本内容复制成一个新的最新版本，并更新资产当前内容。已经开启 deep binding 的 session 不会自动切到新版本，除非调用方再显式更新 session 绑定。

请求体需要提供 `expected_version` 或 `expected_updated_at`，用于防止并发覆盖：

```json
{
  "expected_version": 2
}
```

响应示例：

```json
{
  "data": {
    "id": "preset_001",
    "name": "Default Preset",
    "source": "sillytavern",
    "created_at": 1735689600000,
    "updated_at": 1735689700000,
    "version": 3,
    "version_id": "preset_ver_003",
    "content_hash": "sha256:...",
    "rolled_back_from_version_id": "preset_ver_001"
  }
}
```

回滚会写入操作日志：`rollback_preset`、`rollback_worldbook` 或 `rollback_regex_profile`。

常见错误：

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `400` | `validation_error` | 缺少 `expected_version` / `expected_updated_at`，或请求体不合法 |
| `404` | `preset_not_found` / `worldbook_not_found` / `regex_profile_not_found` / `asset_version_not_found` | 资产或版本不存在 |
| `409` | `preset_conflict` / `worldbook_conflict` / `regex_profile_conflict` | 资产当前版本和请求中的期望版本不一致 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |


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

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 会话不存在 |
| `409` | `active_run_in_progress` | 当前会话仍有活跃运行，不能删除。已经超过运行超时窗口的陈旧 generating run 会先被回收 |

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

获取会话的楼层时间线。响应按 page-aware 结构返回：每个楼层下可能同时存在多个 active page（例如 input + output），`pages` 与 `active_pages` 是新的真相源，`active_page` / `messages` 是兼容字段。

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
        "pages": [
          {
            "id": "page_001",
            "page_no": 0,
            "page_kind": "output",
            "is_active": true,
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
          }
        ],
        "active_pages": [
          {
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
          }
        ],
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
        "messages": [
          {
            "id": "msg_001",
            "seq": 0,
            "role": "assistant",
            "content": "*Luna sits by the campfire...*",
            "content_format": "text"
          }
        ],
        "page_count": 3
      }
    ]
  },
  "meta": { "total": 1, "limit": 50, "offset": 0, "has_more": false, "sort_by": "floor_no", "sort_order": "asc" }
}
```

#### 字段语义

| 字段 | 说明 |
| ---- | ---- |
| `pages` | 楼层下全部 page（含历史非 active 版本）。每个条目带 `is_active` 指示当前是否 active。新调用方应以此为主。 |
| `active_pages` | `pages` 中 `is_active === true` 的子集。一个楼层可能同时包含多个 active page（例如 active input page + active output page）。 |
| `active_page` | 兼容字段。**当且仅当** `active_pages.length === 1` 时返回该 page，其余情况（含 0 或 ≥ 2 条）固定为 `null`。不要依赖它做多 active page 展示。 |
| `messages` | 兼容字段（deprecated）。按 `active_pages` 顺序拼接所有消息。多 active page 场景下无法无损还原 page 结构。 |
| `page_count` | 楼层下 page 总数，包含 inactive 历史版本。 |

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

新建 session 在尚未产生任何 floor 时，这个接口仍会返回默认 `main` 分支。此时 `floor_count` 为 `0`，`latest_floor_no`、`latest_floor_id`、`latest_state` 都返回 `null`。

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

## 重置分支

```http
POST /sessions/:id/branches/:branch_id/reset
```

将一个已经有楼层的分支显式重置到同分支内较早的 committed floor。这个操作不会删除旧 floor，而是把目标 floor 之后的 live floor 标记为 superseded。

这个接口是破坏 live 视图的显式操作，因此请求体必须带 `expected_head_floor_id`。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `target_floor_id` | string | 是 | 要重置到的目标 floor。必须属于同 session、同 branch，且状态为 `committed` |
| `expected_head_floor_id` | string | 是 | 调用方看到的当前分支 head floor ID，用于防止并发覆盖 |

### 响应 `200`

```json
{
  "data": {
    "session_id": "sess_001",
    "branch_id": "main",
    "target_floor_id": "floor_003",
    "expected_head_floor_id": "floor_005",
    "superseded_floor_ids": ["floor_004", "floor_005"],
    "superseded_count": 2
  }
}
```

接口会写入 `reset_branch` 操作日志，目标类型为 `session_branch`。

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `404` | `not_found` / `floor_not_found` | 会话或目标 floor 不存在 |
| `409` | `session_busy` | 该分支有活跃生成运行 |
| `409` | `branch_head_conflict` | `expected_head_floor_id` 已过期 |
| `409` | `invalid_state` | 分支尚未物化、目标 floor 不是 committed，或目标 floor 已被 superseded |
| `409` | `invalid_reset_target` | 目标 floor 不在当前分支 head 可达范围内 |

## 预览分支合并

```http
POST /sessions/:id/branches/:branch_id/merge/preview
```

预览把 `:branch_id` 源分支合并到目标分支的结果。这个接口只做检查，不修改数据。

当前版本只支持无冲突的 fast-forward 合并。如果源分支已经包含在目标分支历史里，会返回 `no_op`。源分支和目标分支都在共同祖先之后有新 floor 时会被阻止。源分支待合入 floor 必须全部是 `committed`；源分支和目标分支都不能有活跃 run。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `target_branch_id` | string | 是 | 目标分支 ID |

### 响应 `200`

```json
{
  "data": {
    "session_id": "sess_001",
    "source_branch_id": "feature",
    "target_branch_id": "main",
    "strategy": "fast_forward",
    "can_merge": true,
    "source_head_floor_id": "floor_feature_003",
    "target_head_floor_id": "floor_main_002",
    "fork_floor_id": "floor_main_002",
    "source_only_floors": [
      {
        "id": "floor_feature_003",
        "branch_id": "feature",
        "floor_no": 3,
        "state": "committed",
        "parent_floor_id": "floor_main_002"
      }
    ],
    "target_only_floors": [],
    "shared_floor_ids": ["floor_main_002", "floor_main_001"],
    "conflicts": []
  }
}
```

如果不能合并，`strategy` 返回 `blocked`，`can_merge` 返回 `false`，`conflicts` 会列出原因。常见 `code` 包括：

| code | 说明 |
| ---- | ---- |
| `same_branch` | 源分支和目标分支相同 |
| `source_branch_not_found` | 源分支不存在 |
| `target_branch_not_found` | 目标分支不存在 |
| `no_common_ancestor` | 两个分支没有共同祖先 |
| `target_diverged` | 源分支和目标分支都在共同祖先之后有自己的新 floor |
| `source_floor_not_committed` | 源分支待合入 floor 不是 committed |
| `source_branch_busy` / `target_branch_busy` | 分支存在活跃 run |

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `404` | `not_found` | 会话不存在 |

## 执行分支合并

```http
POST /sessions/:id/branches/:branch_id/merge
```

执行把 `:branch_id` 源分支合并到目标分支。服务端会再次计算 preview，并用 `expected_target_head_floor_id` 做并发检查。

合并成功后，源分支独有 floor 会被克隆到目标分支。克隆内容包括楼层、消息页、消息、prompt snapshot、result snapshot、explain snapshot 和 branch-local variable snapshot。接口会写入 `merge_branch` 操作日志，目标类型为 `session_branch`。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `target_branch_id` | string | 是 | 目标分支 ID |
| `expected_target_head_floor_id` | string | 是 | 调用方看到的目标分支 head floor ID，用于防止并发覆盖 |

### 响应 `200`

```json
{
  "data": {
    "session_id": "sess_001",
    "source_branch_id": "feature",
    "target_branch_id": "main",
    "strategy": "fast_forward",
    "merged_floor_ids": ["floor_merged_003"],
    "merged_count": 1,
    "operation_id": "op_001",
    "preview": {
      "session_id": "sess_001",
      "source_branch_id": "feature",
      "target_branch_id": "main",
      "strategy": "fast_forward",
      "can_merge": true,
      "source_head_floor_id": "floor_feature_003",
      "target_head_floor_id": "floor_main_002",
      "fork_floor_id": "floor_main_002",
      "source_only_floors": [
        {
          "id": "floor_feature_003",
          "branch_id": "feature",
          "floor_no": 3,
          "state": "committed",
          "parent_floor_id": "floor_main_002"
        }
      ],
      "target_only_floors": [],
      "shared_floor_ids": ["floor_main_002", "floor_main_001"],
      "conflicts": []
    }
  }
}
```

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `404` | `not_found` | 会话不存在 |
| `409` | `branch_head_conflict` | `expected_target_head_floor_id` 已过期 |
| `409` | `branch_merge_conflict` | preview 发现冲突，不能执行合并 |


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
  "ids": ["sess_001", "sess_002", "sess_missing"]
}
```

### 响应 `200`

```json
{
  "data": {
    "results": [
      { "index": 0, "id": "sess_001", "action": "conflict" },
      { "index": 1, "id": "sess_002", "action": "deleted" },
      { "index": 2, "id": "sess_missing", "action": "not_found" }
    ],
    "meta": { "total": 3, "deleted": 1, "not_found": 1, "conflicts": 1 }
  }
}
```

其中 `action = "conflict"` 表示该会话仍有活跃运行，本次批量删除不会删除它。
已经超过运行超时窗口、且长时间没有继续更新的陈旧 generating run 会先被服务端回收，不再计入 `conflict`。

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败、ids 为空或超过 100 条、存在重复 ID |
