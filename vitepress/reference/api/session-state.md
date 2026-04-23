---
outline: [2, 3]
---

# Session-State 观察面

这组端点是 session-state 治理层的**内部观察面**，完全只读，按账号严格鉴权。

::: warning 不是日常前端契约
官方 SDK 和 client-helpers **不会**封装这组端点。日常前端展示请继续使用现有的会话 / 楼层 / 时间线接口。OpenAPI 会生成这组路由的定义，但 `@tavern/sdk` / `@tavern/client-helpers` 不会新增对应资源方法。如果你确实需要对接，请基于 OpenAPI 自行封装，并接受该契约在 session-state 迭代时可能变化。
:::

这一层的设计依据在仓库内的 `.limcode/design/client-data-会话状态治理层-phase3-内部观察面.md`。


所有端点在 `enableClientData=false` 的部署下不可用。账号不匹配或路径指向其他账号的资源时一律返回 `404 not_found`，不会暴露资源是否存在。

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
