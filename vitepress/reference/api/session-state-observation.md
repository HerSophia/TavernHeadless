---
outline: [2, 3]
---

# Session-State 观察面（内部）

这组端点是 Session State 的内部排查接口。
它们完全只读，只用于观察状态是怎么变化的，
不用于日常前端展示。

::: warning 不是日常前端契约
官方 SDK 和 client-helpers **不会**封装这组端点。
日常前端展示请继续使用现有的会话 / 楼层 / 时间线接口。
如果你需要公开可接入的读接口，
请改看 [Session State（公开受治理 API）](./session-state)。
:::

这一层的设计依据在仓库内的 `.limcode/design/client-data-会话状态治理层-phase3-内部观察面.md`。

所有端点在 `enableClientData=false` 的部署下不可用。账号不匹配或路径指向其他账号的资源时一律返回 `404 not_found`，不会暴露资源是否存在。

## 什么时候需要看这页

- 你在排查某个 Session State 值为什么变成了现在这样。
- 你要回看某条状态变更记录到底来自哪个楼层、哪个回合、哪个写入模式。
- 你要对比 live 当前值和某个已提交楼层的快照值。

## 一个简单例子

假设你发现 `game_state.scene` 的当前值不对，可以按下面的顺序排查：

1. `GET /sessions/:sessionId/session-state/mutations`：先看最近有哪些状态变更记录。
2. `GET /sessions/:sessionId/session-state/live/:namespace/:slot`：再看当前 live 值到底是什么。
3. `GET /floors/:floorId/session-state/snapshots/:namespace/:slot`：如果怀疑是某个已提交楼层开始出现问题，再回看那个楼层的快照。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| mutation | 一次状态变更记录，记录写到了哪里、来自哪里、最后状态是什么 |
| live head | 当前分支上这个状态项最新生效的值 |
| snapshot | 某个已提交楼层当时看到的状态值 |
| observation | 只读观察，不改数据 |

## 通用语义

- 列表端点默认**不返回完整 value**，只返回元数据 + `payload_preview` 与 `payload_size_bytes`
- 单条端点返回完整 value
- diff 端点默认不返回 value，`include_values=true` 时才返回
- 所有鉴权通过既有的 `AUTH_MODE` 走；账号与 session / floor 不归属时返回 `404 not_found`
- `state_namespace` 未在 slot registry 注册时返回 `409 session_state_namespace_not_registered`

## 列出某 session 下的受管 domain 绑定

```http
GET /sessions/:sessionId/session-state/bindings
```

### 响应 200

```json
{
  "data": [
    {
      "domain_id": "dom_xxx",
      "account_id": "account-1",
      "manager_kind": "session_state",
      "host_type": "session",
      "host_id": "sess_xxx",
      "state_namespace": "game_state",
      "require_caller_owner": true,
      "allow_auto_create_collection": false,
      "created_at": 1700000000000,
      "updated_at": 1700000000000
    }
  ]
}
```

## 列出某 session 下的 mutation 治理日志

```http
GET /sessions/:sessionId/session-state/mutations
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `branch_id` | string | 否 | 按 branch 过滤 |
| `status` | string | 否 | `staged` / `applied` / `discarded` / `blocked` / `uncertain` |
| `source_floor_id` | string | 否 | 按来源 floor 过滤 |
| `run_id` | string | 否 | 按 run 过滤 |
| `target_slot` | string | 否 | 按 slot 过滤（例如 `scene`） |
| `state_namespace` | string | 否 | 按 namespace 过滤 |
| `write_mode` | string | 否 | `direct` / `commit_bound` |
| `replay_safety` | string | 否 | `safe` / `confirm_on_replay` / `never_auto_replay` / `uncertain` |
| `created_after` | number | 否 | 起始时间戳（ms） |
| `created_before` | number | 否 | 结束时间戳（ms） |
| `limit` | number | 否 | 1..100，默认 20 |
| `offset` | number | 否 | 默认 0 |
| `sort_order` | string | 否 | `asc` / `desc`，默认 `desc`，按 `created_at` 排序 |

### 响应 200

```json
{
  "data": [
    {
      "id": "mut_xxx",
      "state_namespace": "game_state",
      "target_slot": "scene",
      "session_id": "sess_xxx",
      "branch_id": "main",
      "source_floor_id": "floor_xxx",
      "source_snapshot_floor_id": "floor_xxx",
      "visibility_mode": "fork_on_branch",
      "write_mode": "commit_bound",
      "status": "applied",
      "replay_safety": "safe",
      "request_id": null,
      "run_id": "first-party-scene:respond:floor_xxx",
      "live_head_key": "live:game_state:scene:branch:main",
      "discard_reason": null,
      "blocked_reason": null,
      "payload_size_bytes": 1234,
      "payload_present": true,
      "payload_preview": "{\"kind\":\"first_party_scene_state\",...",
      "created_at": 1700000000000,
      "updated_at": 1700000000000,
      "applied_at": 1700000000100
    }
  ],
  "meta": {
    "total": 42,
    "limit": 20,
    "offset": 0,
    "has_more": true,
    "sort_by": "created_at",
    "sort_order": "desc"
  }
}
```

`payload_preview` 是 `payload_json` 的前 256 字节截断字符串，用于在列表里快速判断内容。列表端点不返回完整 `payload.value`；要看完整内容请走下一节的单条端点。

## 读取单条 mutation 的完整 payload

```http
GET /sessions/:sessionId/session-state/mutations/:mutationId
```

路径里的 `sessionId` 与 mutation 的 `session_id` 不一致时返回 `404 not_found`。

### 响应 200

响应在列表形状的基础上补充 `payload`：

```json
{
  "data": {
    "id": "mut_xxx",
    "state_namespace": "game_state",
    "target_slot": "scene",
    "...": "...（其余字段同列表端点）",
    "payload": {
      "present": true,
      "value": { "kind": "first_party_scene_state", "...": "..." }
    }
  }
}
```

## 列出 session 下的 live head 元数据

```http
GET /sessions/:sessionId/session-state/live
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `branch_id` | string | 否 | 按 branch 过滤 |
| `state_namespace` | string | 否 | 按 namespace 过滤 |

### 响应 200

不含完整 value：

```json
{
  "data": [
    {
      "state_namespace": "game_state",
      "slot": "scene",
      "branch_id": "main",
      "visibility_mode": "fork_on_branch",
      "schema_version": 1,
      "present": true,
      "source_floor_id": "floor_xxx",
      "last_mutation_id": "mut_xxx",
      "updated_at": 1700000000000,
      "payload_size_bytes": 1234
    }
  ]
}
```

## 解析单个 slot 的 live 值

```http
GET /sessions/:sessionId/session-state/live/:namespace/:slot
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `branch_id` | string | 是 | 目标分支 |
| `source_floor_id` | string | 否 | 传入后按 source floor snapshot 解析 |

直接走 `SessionStateService.resolveLiveValue(...)`，返回完整 value：

```json
{
  "data": {
    "state_namespace": "game_state",
    "slot": "scene",
    "source": "live_head",
    "visibility_mode": "fork_on_branch",
    "schema_version": 1,
    "present": true,
    "value": { "kind": "first_party_scene_state", "...": "..." },
    "session_id": "sess_xxx",
    "branch_id": "main",
    "floor_id": "floor_xxx",
    "source_mutation_ids": ["mut_xxx"],
    "updated_at": 1700000000000
  }
}
```

## 列出 floor 下的 snapshot 元数据

```http
GET /floors/:floorId/session-state/snapshots
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `state_namespace` | string | 否 | 按 namespace 过滤 |

### 响应 200

不含完整 value：

```json
{
  "data": [
    {
      "state_namespace": "game_state",
      "slot": "scene",
      "visibility_mode": "fork_on_branch",
      "schema_version": 1,
      "present": true,
      "session_id": "sess_xxx",
      "branch_id": "main",
      "floor_id": "floor_xxx",
      "source_mutation_ids": ["mut_xxx"],
      "committed_at": 1700000000000,
      "payload_size_bytes": 1234
    }
  ]
}
```

## 读取单个 slot 的 floor snapshot 完整值

```http
GET /floors/:floorId/session-state/snapshots/:namespace/:slot
```

走 `SessionStateService.getFloorSnapshot(...)`，返回完整 value。

## 评估 floor 的 session-state replay 阻断

```http
GET /floors/:floorId/session-state/replay-safety
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `confirmed_mutation_ids` | string | 否 | 预演确认通过的 mutation id 列表，用逗号分隔 |

### 响应 200

直接映射 `SessionStateService.evaluateReplaySafetyForFloor(...)`：

```json
{
  "data": {
    "allowed": false,
    "blockers": [
      {
        "mutation_id": "mut_xxx",
        "state_namespace": "game_state",
        "target_slot": "scene",
        "replay_safety": "confirm_on_replay",
        "status": "applied",
        "reason": "confirmation_required"
      }
    ]
  }
}
```

## Diff 一个 floor 与另一个对象

```http
GET /floors/:floorId/session-state/diff
```

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `against` | string | 是 | `floor:<id>` 或 `live` |
| `branch_id` | string | `against=live` 时必填 | live 侧的 branch |
| `state_namespace` | string | 否 | 按 namespace 过滤 |
| `include_values` | boolean | 否 | 默认 `false`；`true` 时响应里才会有 `left_value` / `right_value` |

### 响应 200

默认只包含 change_type 与定位元数据：

```json
{
  "data": [
    {
      "state_namespace": "game_state",
      "slot": "scene",
      "change_type": "changed",
      "left_floor_id": "floor_a",
      "right_floor_id": "floor_b",
      "left_present": true,
      "right_present": true
    }
  ]
}
```

`include_values=true` 时每条还会补 `left_value` 与 `right_value`。这是 Phase 3 里唯一一个批量返回 value 的端点，明确需要调用方显式打开。

## 常见错误

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| 400 | `validation_error` | 查询参数不合法（如 `against` 格式错、`status` 不在枚举中） |
| 404 | `not_found` | session / floor / mutation 不存在，或不归属当前账号 |
| 409 | `session_state_namespace_not_registered` | 访问未在 slot registry 注册的 namespace/slot |
| 503 | `feature_unavailable` | `enableClientData` 关闭时端点不可用（或直接 404，由部署决定） |

## 设计参考

- 设计文档：`.limcode/design/client-data-会话状态治理层-phase3-内部观察面.md`
- 实施计划：`.limcode/plans/client-data-会话状态治理层-phase3-内部观察面-implementation-plan.md`
