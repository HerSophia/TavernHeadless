---
outline: [2, 3]
---

# Session State（公开受治理 API）

Session State 是会话里的受治理状态存储。

可以把它理解为：**给一个会话挂上一组有规则的状态项。** 客户端可以读取这些状态，也可以在受限制的条件下写入其中一部分状态。

这组公开接口主要做六件事：

- 注册会话自己的自定义命名空间
- 列出当前公开的命名空间和状态项定义
- 直接写入自定义状态项的当前值
- 在聊天回合里通过 `session_state_writes` 一起提交写入
- 把某个状态项治理为“当前无值”
- 读取当前值、楼层快照，以及两个时点之间的差异

如果你只是想保存插件自己的普通结构化数据，而不是会话里的受治理状态，请改看 [Client Data](./client-data)。

## 什么时候需要看这页

- 你想给一个会话保存轻量状态，例如任务标记、角色关系、场景附加信息。
- 你需要在前端读取某个会话当前真正生效的状态值。
- 你需要把某个自定义状态和一次聊天回合绑在一起，只有回合成功提交时才生效。
- 你需要回看某个楼层当时看到的状态快照，或者比较两个时点之间的状态差异。

## 一个简单例子

假设你要在会话里记录一个任务插件的状态：

1. 先调用 `POST /sessions/:sessionId/state/namespaces`，注册 `quest_flags` 这个自定义命名空间。
2. 如果要立刻生效，调用 `POST /sessions/:sessionId/state/values/write`，把 `quest_flags.companion` 写成 `{ "mood": "ally" }`。
3. 如果要和一次聊天回合一起提交，就在 `POST /sessions/:sessionId/respond` 的请求体里带上 `session_state_writes`。
4. 后面可以用 `GET /sessions/:sessionId/state/resolve` 或 `GET /sessions/:sessionId/state/diff` 读取当前值和差异。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| namespace（命名空间） | 一组状态项的分类，例如 `quest_flags` |
| slot（槽位） | 命名空间下面的单个状态项，例如 `quest_flags.companion` 里的 `companion` |
| direct write | 调用写接口后立刻生效的写入 |
| turn-bound write | 把写入和一次聊天回合绑在一起；只有这次回合成功提交时才生效 |
| `present: false` | 表示这个状态项当前按治理规则视为“没有值”，不是把历史记录物理删除 |

## 当前公开边界

当前公开边界如下：

- 开放 `POST /sessions/:sessionId/state/namespaces`，用于注册自定义命名空间
- 开放 `POST /sessions/:sessionId/state/values/write`，用于直接写入自定义命名空间的当前值
- 开放 `DELETE /sessions/:sessionId/state/values`，用于把自定义状态项治理为“当前无值”
- `game_state` 仍然是内建第一方命名空间
- 当前公开稳定的内建状态项只有：
  - `game_state.scene`
  - `game_state.world`
- `inventory` 与 `combat` 当前不在公开接口中承诺
- `game_state` 对客户端当前仍然是只读
- 自定义命名空间当前支持两类客户端写入：
  - `POST /sessions/:sessionId/state/values/write` 的直接写入
  - turn API 中 `session_state_writes` 的随回合提交写入
- 自定义状态项会在首次成功直接写入或首次成功随回合提交后自动出现在公开定义里
- public `DELETE` 的治理语义是把当前值写成 `present: false`，不是物理删除历史
- 跨账号访问仍然统一返回 `404 not_found`
- `enableClientData=false` 时，这组端点不可用

::: tip SDK 支持
`@tavern/sdk` 现在已经封装这组公开 Session State 接口，对应资源为 `client.sessionState`。
:::

::: warning 与内部观察面分离
内部观察面 `/sessions/:sessionId/session-state/*` 与 `/floors/:floorId/session-state/*` 仍然单独保留，不属于这组 public API。完整定义见 [Session-State Observation（内部）](./session-state-observation)。
:::

## 通用语义

- `POST /sessions/:sessionId/state/namespaces` 只负责注册自定义命名空间，不负责写入状态值
- `POST /sessions/:sessionId/state/values/write` 是直接写入路径，当前只允许已注册的自定义命名空间
- `POST /sessions/:sessionId/respond`、`POST /sessions/:sessionId/respond/stream`、`POST /sessions/:sessionId/regenerate`、`POST /floors/:id/retry`、`POST /messages/:id/edit-and-regenerate` 当前都支持 `session_state_writes`
- `session_state_writes` 是随回合一起提交的写入，不会额外新增独立 `/state/values/stage` 一类接口
- `DELETE /sessions/:sessionId/state/values` 的对内语义是写成 `present: false`
- `namespaces` 返回内建命名空间和已注册自定义命名空间的公开定义与能力说明
- 自定义命名空间在某个状态项首次成功写入之前，仍然返回 `slots: []`
- 自定义命名空间在首次成功直接写入或首次成功随回合提交之后，会把已出现的状态项作为公开定义返回
- `session_state_writes` 每项只接受：
  - `namespace`
  - `slot`
  - 二选一：`value` 或 `delete: true`
- `resolve` 返回当前有效值；传 `source_floor_id` 时返回对应楼层看到的基线值
- `snapshot` 返回某个 floor 的快照值
- `diff` 当前直接返回公开稳定状态项的左右值
- 这组公开接口只会返回当前公开稳定的状态项；不会把内部候选状态项暴露出来
- 传入 `slot` 过滤时必须同时传 `namespace`
- `game_state` 继续保持客户端只读
- 自定义状态的值当前仍然按任意 JSON 处理

## 注册 custom namespace

```http
POST /sessions/:sessionId/state/namespaces
```

### 请求体

```json
{
  "namespace": "quest_flags",
  "logical_owner_type": "plugin",
  "logical_owner_id": "quest-plugin"
}
```

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `namespace` | string | 是 | 要注册的 custom namespace。当前按 `account_id + session_id + namespace` 保证唯一 |
| `logical_owner_type` | string | 是 | 逻辑 owner 类型。当前保留为开放字符串 |
| `logical_owner_id` | string | 是 | 逻辑 owner 标识 |

### 响应 201

```json
{
  "data": {
    "namespace": "quest_flags",
    "owner_kind": "custom",
    "logical_owner_type": "plugin",
    "logical_owner_id": "quest-plugin",
    "default_slot_template": {
      "default_visibility_mode": "fork_on_branch",
      "default_write_mode": "direct",
      "default_replay_safety": "safe",
      "client_writable": true,
      "allowed_write_modes": ["direct", "commit_bound"],
      "supports_snapshot": true,
      "supports_diff": true,
      "replay_policy_source": "system_default"
    },
    "slots": []
  }
}
```

## 列出当前公开的 namespace / slot definition

```http
GET /sessions/:sessionId/state/namespaces
```

### 响应 200

```json
{
  "data": [
    {
      "namespace": "game_state",
      "owner_kind": "built_in",
      "slots": [
        {
          "slot": "scene",
          "exposure_lifecycle": "public_stable",
          "visibility_mode": "fork_on_branch",
          "default_write_mode": "commit_bound",
          "default_replay_safety": "safe",
          "schema_version": 1,
          "size_budget_bytes": 262144,
          "capabilities": {
            "client_readable": true,
            "client_writable": false,
            "allowed_write_modes": [],
            "supports_snapshot": true,
            "supports_diff": true
          }
        },
        {
          "slot": "world",
          "exposure_lifecycle": "public_stable",
          "visibility_mode": "fork_on_branch",
          "default_write_mode": "commit_bound",
          "default_replay_safety": "safe",
          "schema_version": 1,
          "size_budget_bytes": 524288,
          "capabilities": {
            "client_readable": true,
            "client_writable": false,
            "allowed_write_modes": [],
            "supports_snapshot": true,
            "supports_diff": true
          }
        }
      ]
    },
    {
      "namespace": "quest_flags",
      "owner_kind": "custom",
      "logical_owner_type": "plugin",
      "logical_owner_id": "quest-plugin",
      "default_slot_template": {
        "default_visibility_mode": "fork_on_branch",
        "default_write_mode": "direct",
        "default_replay_safety": "safe",
        "client_writable": true,
        "allowed_write_modes": ["direct", "commit_bound"],
        "supports_snapshot": true,
        "supports_diff": true,
        "replay_policy_source": "system_default"
      },
      "slots": [
        {
          "slot": "companion",
          "exposure_lifecycle": "public_stable",
          "visibility_mode": "fork_on_branch",
          "default_write_mode": "direct",
          "default_replay_safety": "safe",
          "schema_version": 1,
          "size_budget_bytes": 1048576,
          "capabilities": {
            "client_readable": true,
            "client_writable": true,
            "allowed_write_modes": ["direct", "commit_bound"],
            "supports_snapshot": true,
            "supports_diff": true
          }
        }
      ]
    }
  ]
}
```

## 写入 custom namespace 当前值

```http
POST /sessions/:sessionId/state/values/write
```

### 请求体

```json
{
  "branch_id": "main",
  "namespace": "quest_flags",
  "slot": "companion",
  "value": {
    "mood": "ally"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `branch_id` | string | 是 | 目标 branch |
| `namespace` | string | 是 | 已注册 custom namespace |
| `slot` | string | 是 | custom slot 名称。首次成功 direct write 或首次成功 turn-bound commit 会触发 implicit materialization |
| `value` | any JSON | 是 | custom payload。当前平台按 opaque JSON value 治理 |

### 响应 200

```json
{
  "data": {
    "namespace": "quest_flags",
    "slot": "companion",
    "source": "live_head",
    "visibility_mode": "fork_on_branch",
    "schema_version": 1,
    "present": true,
    "value": {
      "mood": "ally"
    },
    "session_id": "sess_xxx",
    "branch_id": "main",
    "floor_id": null,
    "source_mutation_ids": ["mut_xxx"],
    "updated_at": 1700000000000
  }
}
```

### 说明

- 当前只允许对 registered custom namespace 执行 public direct write
- 当前不开放 `replay_safety`、`write_mode` 等客户端自由输入
- slot policy 继承 namespace registration 的 `default_slot_template`
- `game_state` 不允许通过这条 public write 路径写入

## 删除 custom namespace 当前值

```http
DELETE /sessions/:sessionId/state/values
```

### 请求体

```json
{
  "branch_id": "main",
  "namespace": "quest_flags",
  "slot": "companion"
}
```

### 响应 200

```json
{
  "data": {
    "namespace": "quest_flags",
    "slot": "companion",
    "source": "live_head",
    "visibility_mode": "fork_on_branch",
    "schema_version": 1,
    "present": false,
    "value": null,
    "session_id": "sess_xxx",
    "branch_id": "main",
    "floor_id": null,
    "source_mutation_ids": ["mut_xxx"],
    "updated_at": 1700000000100
  }
}
```

`DELETE` 的 public 语义是把当前值改成 `present: false`。它不会物理删除 mutation history，也不会让已经 materialized 的 slot 从 discovery 中消失。

## 解析当前有效值

```http
GET /sessions/:sessionId/state/resolve
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `branch_id` | string | 是 | 目标分支 |
| `namespace` | string | 否 | 按 namespace 过滤 |
| `slot` | string | 否 | 按 slot 过滤；传入时必须同时提供 `namespace` |
| `source_floor_id` | string | 否 | 传入后按 source floor snapshot 解析，而不是当前 live head |

### 响应 200

```json
{
  "data": [
    {
      "namespace": "game_state",
      "slot": "scene",
      "source": "live_head",
      "visibility_mode": "fork_on_branch",
      "schema_version": 1,
      "present": true,
      "value": {
        "kind": "first_party_scene_state",
        "schemaVersion": 1,
        "sessionId": "sess_xxx",
        "branchId": "main",
        "floorId": "floor_xxx",
        "runType": "respond",
        "generatedText": "...",
        "summaries": ["..."],
        "usage": {
          "inputTokens": 123,
          "outputTokens": 45,
          "totalTokens": 168
        },
        "toolExecutionIds": [],
        "updatedAt": 1700000000000
      },
      "session_id": "sess_xxx",
      "branch_id": "main",
      "floor_id": "floor_xxx",
      "source_mutation_ids": ["mut_xxx"],
      "updated_at": 1700000000000
    },
    {
      "namespace": "game_state",
      "slot": "world",
      "source": "live_head",
      "visibility_mode": "fork_on_branch",
      "schema_version": 1,
      "present": true,
      "value": {
        "kind": "first_party_world_state",
        "schemaVersion": 1,
        "sessionId": "sess_xxx",
        "branchId": "main",
        "floorId": "floor_xxx",
        "runType": "respond",
        "summaryLines": ["..."],
        "worldbookId": "wb_xxx",
        "worldbookVersion": 3,
        "activatedWorldbookEntryUids": [12, 18],
        "toolExecutionIds": [],
        "updatedAt": 1700000000000
      },
      "session_id": "sess_xxx",
      "branch_id": "main",
      "floor_id": "floor_xxx",
      "source_mutation_ids": ["mut_xxx"],
      "updated_at": 1700000000000
    }
  ]
}
```

如果某个 public-stable slot 当前没有值，响应项仍会保留，但会返回：

- `source: "none"`
- `present: false`
- `value: null`
- `updated_at: null`

## 读取某个 floor 的 snapshot 值

```http
GET /sessions/:sessionId/state/floors/:floorId/snapshot
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `namespace` | string | 否 | 按 namespace 过滤 |
| `slot` | string | 否 | 按 slot 过滤；传入时必须同时提供 `namespace` |

### 响应 200

```json
{
  "data": [
    {
      "namespace": "game_state",
      "slot": "scene",
      "visibility_mode": "fork_on_branch",
      "schema_version": 1,
      "present": true,
      "value": {
        "kind": "first_party_scene_state",
        "schemaVersion": 1,
        "sessionId": "sess_xxx",
        "branchId": "main",
        "floorId": "floor_xxx",
        "runType": "respond",
        "generatedText": "...",
        "summaries": ["..."],
        "usage": {
          "inputTokens": 123,
          "outputTokens": 45,
          "totalTokens": 168
        },
        "toolExecutionIds": [],
        "updatedAt": 1700000000000
      },
      "session_id": "sess_xxx",
      "branch_id": "main",
      "floor_id": "floor_xxx",
      "source_mutation_ids": ["mut_xxx"],
      "committed_at": 1700000000000
    }
  ]
}
```

## 比较一个 floor 与 live / 另一个 floor 的差异

```http
GET /sessions/:sessionId/state/diff
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `floor_id` | string | 是 | 右侧 floor |
| `against` | string | 是 | `live` 或 `floor:<id>` |
| `branch_id` | string | `against=live` 时必填 | live 侧 branch |
| `namespace` | string | 否 | 按 namespace 过滤 |
| `slot` | string | 否 | 按 slot 过滤；传入时必须同时提供 `namespace` |

### 响应 200

```json
{
  "data": [
    {
      "namespace": "game_state",
      "slot": "scene",
      "change_type": "changed",
      "left_floor_id": "floor_live_head_source",
      "right_floor_id": "floor_target",
      "left_present": true,
      "right_present": true,
      "left_value": {
        "kind": "first_party_scene_state",
        "schemaVersion": 1,
        "sessionId": "sess_xxx",
        "branchId": "main",
        "floorId": "floor_live_head_source",
        "runType": "respond",
        "generatedText": "...",
        "summaries": ["..."],
        "usage": {
          "inputTokens": 123,
          "outputTokens": 45,
          "totalTokens": 168
        },
        "toolExecutionIds": [],
        "updatedAt": 1700000000100
      },
      "right_value": {
        "kind": "first_party_scene_state",
        "schemaVersion": 1,
        "sessionId": "sess_xxx",
        "branchId": "main",
        "floorId": "floor_target",
        "runType": "respond",
        "generatedText": "...",
        "summaries": ["..."],
        "usage": {
          "inputTokens": 120,
          "outputTokens": 40,
          "totalTokens": 160
        },
        "toolExecutionIds": [],
        "updatedAt": 1700000000000
      }
    }
  ]
}
```

`change_type` 可能是：

- `added`
- `removed`
- `changed`
- `unchanged`

## 常见错误

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| `400` | `validation_error` | 请求参数不合法，例如 `slot` 未配套 `namespace`，或 `against=live` 时缺少 `branch_id` |
| `404` | `session_state_namespace_not_registered` | public write / delete 命中的 custom namespace 尚未在当前 session 下注册 |
| `404` | `not_found` | session / floor 不存在，或资源不归属当前账号 |
| `409` | `session_state_public_write_forbidden` | 试图对 built-in namespace 写入，或 namespace 当前不允许 client direct write |
| `409` | `session_state_namespace_reserved` | 注册时试图占用内建保留 namespace，例如 `game_state` |
| `409` | `session_state_namespace_already_registered` | 同一账号、同一 session 下重复注册了同名 custom namespace |
| `409` | `session_state_payload_too_large` | payload 超过当前 slot 的治理预算 |
| `503` | `feature_unavailable` | `enableClientData` 关闭时这组端点不可用；部分部署也可能直接返回 `404` |

## 设计参考

- 下一版设计草案：`.limcode/design/session-state-下一版客户端可写受治理状态空间设计草案.md`
- 当前实施计划：`.limcode/plans/session-state-下一版客户端可写受治理状态空间实施计划.md`
- 内部观察面：[`reference/api/session-state-observation.md`](./session-state-observation.md)
