---
outline: [2, 3]
---

# Session State 最小联调清单

这份清单用于验证当前 `Session State` 的真实路由面是否已经能支撑一个真实客户端接入。

这里关注三层内容：

1. public `Session State` routes：`/sessions/:sessionId/state/*`
2. turn API 中的 `session_state_writes`
3. internal observation routes：`/sessions/:sessionId/session-state/*` 与 `/floors/:floorId/session-state/*`

这不是完整回归方案。

它只回答一个问题：

> 一个真实客户端，是否已经能按当前正式路由面走通最小闭环。

## 联调前提

开始前，请先确认：

- 部署已开启 `enableClientData === true`
- 当前账号可以访问目标 session
- 已有一个可用 session
- 如果要验证 turn-bound write，目标 session 需要能正常执行 `respond`

如果部署关闭了 `enableClientData`：

- `/sessions/:sessionId/state/*` 这组 public route family 默认不会注册，通常直接返回 `404`
- `/sessions/:sessionId/session-state/*` 与 `/floors/:floorId/session-state/*` 这组 observation route family 默认也不会注册，通常直接返回 `404`
- turn API 如果带了 `session_state_writes`，会返回 `503 feature_unavailable`

## 约定一个最小测试 namespace

建议联调时统一使用一组简单数据，便于排查：

- namespace：`quest_flags`
- slot：`companion`
- sample value：

```json
{
  "mood": "ally"
}
```

## 步骤 1：注册 custom namespace

```http
POST /sessions/:sessionId/state/namespaces
```

请求体示例：

```json
{
  "namespace": "quest_flags",
  "logical_owner_type": "plugin",
  "logical_owner_id": "quest-plugin"
}
```

期望结果：

- 返回 `201`
- `data.namespace === "quest_flags"`
- `owner_kind === "custom"`
- `slots` 初始为空数组

如果这里失败，需要先排查：

- namespace 是否命中了 built-in 保留名或前缀
- owner 字段是否符合当前 identity contract
- 当前账号是否有权访问该 session

## 步骤 2：确认 discovery 已纳入 custom namespace

```http
GET /sessions/:sessionId/state/namespaces
```

期望结果：

- 返回 `200`
- 结果里能看到 `game_state`
- 结果里也能看到刚注册的 `quest_flags`
- 在第一次 value write 之前，`quest_flags.slots` 可以仍然为空数组

同时确认：

- 当前公开稳定的 built-in slot 仍然只有 `game_state.scene` 与 `game_state.world`
- `inventory` 与 `combat` 不应出现在 public stable discovery 中

## 步骤 3：执行一次 direct write

```http
POST /sessions/:sessionId/state/values/write
```

请求体示例：

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

期望结果：

- 返回 `200`
- 返回体是单 slot current-effective view
- `present === true`
- `value.mood === "ally"`

## 步骤 4：确认 resolve 已能读到当前值

```http
GET /sessions/:sessionId/state/resolve?branch_id=main&namespace=quest_flags
```

期望结果：

- 返回 `200`
- `data` 里能看到 `quest_flags.companion`
- `source === "live_head"`
- `present === true`
- `value.mood === "ally"`

此时再回看一次：

```http
GET /sessions/:sessionId/state/namespaces
```

期望结果：

- `quest_flags.slots` 里现在应出现 `companion`
- 说明 custom slot 已 materialize，并进入 discovery

## 步骤 5：执行一次 turn-bound write

选择任意一个支持 `session_state_writes` 的 turn API。最简单的是：

```http
POST /sessions/:sessionId/respond
```

请求体示例：

```json
{
  "message": "Continue the quest.",
  "session_state_writes": [
    {
      "namespace": "quest_flags",
      "slot": "companion",
      "value": {
        "mood": "trusted"
      }
    },
    {
      "namespace": "quest_flags",
      "slot": "expired_hint",
      "delete": true
    }
  ]
}
```

期望结果：

- turn 本身成功提交
- turn 失败、取消或 commit 失败时，不应留下 applied mutation
- turn 成功后，新的 session-state mutation 会进入既有治理链路

这里要同时确认两件事：

1. `session_state_writes` 只接受 `namespace`、`slot`、以及 `value | delete`
2. 客户端不能在这里自带 `branch_id`、`source_floor_id`、`write_mode`、`replay_safety`

## 步骤 6：确认 turn-bound write 已生效

turn 成功后，再次读取：

```http
GET /sessions/:sessionId/state/resolve?branch_id=main&namespace=quest_flags
```

期望结果：

- `quest_flags.companion` 的值已经变成新值
- 如果有 `delete: true` 的 slot，则对应值表现为 `present === false`

再做一次差异确认：

```http
GET /sessions/:sessionId/state/diff?floor_id=<source-floor-id>&against=live&branch_id=main&namespace=quest_flags
```

期望结果：

- 返回 `200`
- 能看到 `companion` 或其他目标 slot 的变化
- diff 反映的是治理后的真实状态，而不是临时请求体回显

## 步骤 7：用 observation 面检查真实真相源

先查 mutation 列表：

```http
GET /sessions/:sessionId/session-state/mutations
```

期望结果：

- 列表端点只返回摘要，不直接返回完整 value
- 能看到本轮 direct write 或 turn-bound write 对应的 mutation 记录

再查 live head：

```http
GET /sessions/:sessionId/session-state/live
GET /sessions/:sessionId/session-state/live/quest_flags/companion?branch_id=main
```

期望结果：

- 列表端点只返回元数据
- 单条端点返回完整 value

如果本轮 turn 产生了 committed floor，再查 snapshot：

```http
GET /floors/:floorId/session-state/snapshots
GET /floors/:floorId/session-state/snapshots/quest_flags/companion
```

期望结果：

- 列表端点只返回元数据
- 单条端点返回完整 snapshot value

## 步骤 8：验证一条负路径

至少选择下面一条负路径做确认。

### 负路径 A：built-in 写入拒绝

尝试对 `game_state.scene` 做 public write 或 turn write。

期望结果：

- 返回 `409 session_state_public_write_forbidden`

### 负路径 B：未注册 namespace 写入拒绝

不注册 custom namespace，直接写值。

期望结果：

- public write 返回 `404 session_state_namespace_not_registered`
- turn write 也应按同一治理边界被拒绝

### 负路径 C：dry-run 不接受 `session_state_writes`

```http
POST /sessions/:sessionId/respond/dry-run
```

请求体带上 `session_state_writes`。

期望结果：

- 返回 `400 validation_error`
- 因为 dry-run 明确没有副作用

## 记录项

完成一轮联调后，建议至少记录下面这些信息：

- sessionId
- 使用的 branchId
- direct write 的请求与响应
- turn-bound write 的请求与响应
- resolve / diff / snapshot 的返回摘要
- observation 里对应 mutation id
- 失败路径返回的 `status` 与 `error.code`

## 完成标准

满足下面这些条件，可以认为当前这组真实路由面已经完成最小联调：

1. custom namespace 可以注册
2. direct write 可以成功，并且 resolve 可读
3. turn-bound write 可以随回合成功提交，并且提交后真实生效
4. diff / snapshot / resolve 三组 public truth read 能互相对上
5. observation 面可以看到 mutation、live head 与 snapshot 真相源
6. built-in 写入拒绝边界没有漂移
7. dry-run 仍然没有副作用，也不接受 `session_state_writes`

如果这七条有任意一条不能稳定满足，就不应继续把重点放到新增更多 built-in 或更多内部域上，而应先修正当前真实路由面的契约或观测问题。
