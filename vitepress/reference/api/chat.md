---
outline: [2, 3]
---

# Chat（对话生成）

对话生成是 TavernHeadless 的核心功能。支持同步生成、SSE 流式生成、Prompt dry-run 调试、重新生成、楼层重试和编辑再生成。

## 发送消息并生成回复

```http
POST /sessions/:id/respond
```

向会话发送用户消息，触发 AI 回复生成。返回完整的生成结果。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 会话 ID |

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `message` | string | **是** | 用户消息文本 |
| `config` | [TurnConfig](#turnconfig-对象) | 否 | 回合配置覆盖 |
| `generation_params` | [GenerationParams](#generationparams-对象) | 否 | 生成参数覆盖 |
| `branch_id` | string | 否 | 指定分支 ID |
| `source_floor_id` | string | 否 | 从指定楼层开始（用于在中途插入） |

### 响应 `200`

```json
{
  "data": {
    "floor_id": "floor_12",
    "floor_no": 12,
    "branch_id": "main",
    "generated_text": "The firelight wavers as the next part of the story begins.",
    "summaries": ["The group resumes the campfire planning scene."],
    "total_usage": {
      "prompt_tokens": 320,
      "completion_tokens": 128,
      "total_tokens": 448
    },
    "memory": {
      "mode": "sync",
      "status": "applied",
      "job_id": null
    },
    "final_state": "committed"
  }
}
```

如果当前会话启用了记忆持久化，响应里会额外返回 `memory`：

- `mode = "sync"` 且 `status = "applied"`：记忆写入已在本次提交内完成
- `mode = "async"` 且 `status = "queued"`：记忆写入已进入后台队列，`job_id` 对应 `runtime_job.id`

如果当前部署没有启用记忆持久化，这个字段可以省略。

### 常见错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `invalid_message_scope` | 参数校验失败，或消息作用域错误 |
| `404` | `not_found` | 会话不存在 |
| `409` | `session_archived` / `generation_conflict` / `commit_conflict` | 会话状态冲突，或提交边界冲突 |
| `503` | `secret_unavailable` / `commit_busy` / `generation_queue_timeout` | 密钥不可用，或生成 / 提交等待阶段已超时 |
| `504` | `generation_timeout` | LLM 执行超时 |
| `500` | `secret_invalid_format` / `orchestration_failed` / `turn_commit_failed` | 已保存的密文无法解密，或生成过程出现未分类内部错误 |

上表列出的是常见错误，不是穷尽列表。

当前聊天链路还可能返回：`source_floor_not_found`、`invalid_tool_mode`、`tool_replay_blocked`、`tool_replay_confirmation_required`、`profile_not_found`、`profile_disabled`、`instance_slot_disabled_required`、`tool_catalog_conflict`、`generation_cancelled`（`499`）等 code。客户端应按 `error.code` 做分支处理，而不应只依赖状态码。

这里的 `commit_busy` 是聊天提交链路专用错误，不复用资源写入路径上的 `resource_busy`。

当前默认服务配置使用单实例内存协调器，且 `GENERATION_QUEUE_MODE=reject`。因此同一 `session + branch` 的并发生成通常直接返回 `generation_conflict`。只有部署方显式启用 `GENERATION_QUEUE_MODE=queue` 时，才可能看到 `generation_queue_timeout`；`GENERATION_QUEUE_TIMEOUT_MS` 用于控制 queue 模式下的等待超时。即便如此，排队也只在当前进程内生效，不提供跨实例共享锁。

## SSE 流式生成

```http
POST /sessions/:id/respond/stream
```

与 `/respond` 相同的请求体，但以 SSE (Server-Sent Events) 格式返回流式结果。

### 响应格式

`Content-Type: text/event-stream`

```text
event: start
data: {"floor_id":"floor_12","floor_no":12,"branch_id":"main"}

event: run
data: {"floor_id":"floor_12","run_id":"run_12","run_type":"respond","status":"running","phase":"page_generating","public_phase":"generating","phase_seq":5,"attempt_no":1,"started_at":1735689720000,"updated_at":1735689720300,"completed_at":null,"pending_output":{"temp_id":"temp_12","attempt_no":1,"state":"streaming","text":"The firelight wavers...","started_at":1735689720100,"updated_at":1735689720300,"error":null},"verifier":null,"error":null}

event: chunk
data: {"chunk":"The firelight wavers..."}

event: tool
data: {"execution_id":"tool_exec_12","tool_name":"roll_dice","provider_id":"builtin","provider_type":"builtin","side_effect_level":"none","phase":"success","message":"Rolled 1d20","duration_ms":2,"replay_safety":"safe"}

event: chunk
data: {"chunk":" as the next part"}

event: summary
data: {"summaries":["The group resumes the campfire planning scene."]}

event: done
data: {"floor_id":"floor_12","floor_no":12,"branch_id":"main","generated_text":"...","summaries":[...],"total_usage":{...},"memory":{"mode":"sync","status":"applied","job_id":null},"final_state":"committed"}
```

当前 SSE 事件集包括：

- `start`
- `run`
- `chunk`
- `tool`（按条件出现，表示工具执行过程）
- `summary`（按条件出现，表示提交前摘要结果）
- `done`
- `error`

如果生成过程中出错：

```text
event: error
data: {"code":"generation_timeout","message":"Turn orchestration failed: LLM request timed out after 60000ms"}
```

一旦 SSE 连接已经建立，运行期错误会通过 `error` 事件返回，不再切换 HTTP 状态码。`code` 可能为 `generation_conflict`、`generation_queue_timeout`、`generation_timeout`、`commit_busy`、`commit_conflict`、`secret_invalid_format` 等值。资源写入路径上的 `resource_busy` 不会通过这里复用。

客户端断开连接时，服务端会自动中止生成。

如果客户端需要恢复当前候选输出，应读取 `run` 事件里的 `pending_output.text`，不要只依赖本地累积的 `chunk`。

`tool` 事件的主要字段包括：`execution_id`、`tool_name`、`provider_id`、`provider_type`、`side_effect_level`、`phase`、`message`、`duration_ms`、`replay_safety`。

## Prompt Dry-run

```http
POST /sessions/:id/respond/dry-run
```

只组装 Prompt 并返回调试信息，不实际调用 LLM，无副作用。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `message` | string | **是** | 用户消息文本 |
| `config` | [TurnConfig](#turnconfig-对象) | 否 | 兼容 `/respond` 的输入形状 |
| `generation_params` | [GenerationParams](#generationparams-对象) | 否 | 兼容 `/respond` 的输入形状 |
| `branch_id` | string | 否 | 兼容 `/respond` 的输入形状 |
| `source_floor_id` | string | 否 | 兼容 `/respond` 的输入形状 |

当前 route schema 与 `/sessions/:id/respond` 保持兼容，但服务当前只实际读取 `message`。其余字段可以通过校验，但不会改变 dry-run 结果。

### 响应 `200`

```json
{
  "data": {
    "messages": [
      { "role": "system", "content": "Stay in character and keep the tone warm." },
      { "role": "user", "content": "Please continue the campfire scene." }
    ],
    "token_estimate": 512,
    "available_for_reply": 1536,
    "memory_summary": "The party recently agreed to search the northern pass.",
    "prompt_snapshot": {
      "preset_id": "preset_001",
      "preset_updated_at": 1735689600000,
      "preset_version": 4,
      "worldbook_id": "wb_001",
      "worldbook_updated_at": 1735689605000,
      "worldbook_version": 2,
      "regex_profile_id": null,
      "regex_profile_updated_at": null,
      "regex_profile_version": null,
      "worldbook_activated_entry_uids": [0],
      "regex_pre_rule_names": ["trim_whitespace"],
      "regex_post_rule_names": [],
      "prompt_mode": "compat_strict",
      "prompt_digest": "sha256:demo",
      "token_estimate": 512
    },
    "assembly": {
      "mode": "preset",
      "preset_used": true,
      "worldbook_hits": 1,
      "regex_pre_rules": ["trim_whitespace"],
      "regex_post_rules": [],
      "memory_summary_injected": true,
      "reserved_variable_collisions": [],
      "preprocessed_user_message": "Please continue the campfire scene."
    }
  }
}
```

## 重新生成

```http
POST /sessions/:id/regenerate
```

重新生成会话最后一个楼层的 AI 回复。当前实现会创建一个新的 floor，并把旧 floor 标记为 superseded 保留。旧楼层不会出现在默认时间线和分支视图中，但仍可按 ID 审计读取。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `config` | TurnConfig | 否 | 回合配置覆盖 |
| `generation_params` | GenerationParams | 否 | 生成参数覆盖 |

### 响应 `200`

```json
{
  "data": {
    "floor_id": "floor_13",
    "floor_no": 13,
    "previous_floor_id": "floor_12",
    "generated_text": "...",
    "summaries": [],
    "total_usage": { "prompt_tokens": 320, "completion_tokens": 128, "total_tokens": 448 },
    "memory": {
      "mode": "sync",
      "status": "applied",
      "job_id": null
    },
    "final_state": "committed"
  }
}
```

其中 `previous_floor_id` 指向被替代的旧楼层。除“没有可重新生成的楼层”这类资源状态错误外，其余生成期错误语义与 `/sessions/:id/respond` 一致，包括 `commit_busy`（`503`）和 `generation_timeout`（`504`）。

## 楼层重试

```http
POST /floors/:id/retry
```

对指定楼层重试生成。与 regenerate 类似，但可以指定任意楼层。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `config` | TurnConfig | 否 | 回合配置覆盖 |
| `generation_params` | GenerationParams | 否 | 生成参数覆盖 |
| `confirmed_execution_ids` | string[] | 否 | 确认允许 replay 的工具执行 ID 列表 |

当目标楼层包含需要人工确认的工具回放时，服务端会返回 `409 tool_replay_confirmation_required`。此时应把允许继续回放的 execution id 放入 `confirmed_execution_ids` 后重试。

### 响应 `200`

```json
{
  "data": {
    "floor_id": "floor_05",
    "floor_no": 5,
    "branch_id": "main",
    "generated_text": "...",
    "summaries": [],
    "total_usage": { "prompt_tokens": 200, "completion_tokens": 80, "total_tokens": 280 },
    "memory": {
      "mode": "sync",
      "status": "applied",
      "job_id": null
    },
    "final_state": "committed"
  }
}
```

除楼层自身不存在或状态不允许外，其余生成期错误语义与 `/sessions/:id/respond` 一致，包括 `commit_busy`（`503`）和 `generation_timeout`（`504`）。

## 编辑并重新生成

```http
POST /messages/:id/edit-and-regenerate
```

修改指定消息的内容，然后基于修改后的上下文重新生成 AI 回复。可选择在新分支上操作。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `content` | string | **是** | 修改后的消息内容 |
| `branch_id` | string | 否 | 指定分支 ID（可创建新分支） |
| `config` | TurnConfig | 否 | 回合配置覆盖 |
| `generation_params` | GenerationParams | 否 | 生成参数覆盖 |

### 响应 `200`

```json
{
  "data": {
    "floor_id": "floor_12",
    "floor_no": 12,
    "branch_id": "alt-branch",
    "source_floor_id": "floor_11",
    "source_message_id": "msg_21",
    "generated_text": "...",
    "summaries": [],
    "total_usage": { "prompt_tokens": 300, "completion_tokens": 100, "total_tokens": 400 },
    "final_state": "committed"
  }
}
```

除源消息不存在等资源错误外，其余生成期错误语义与 `/sessions/:id/respond` 一致，包括 `commit_busy`（`503`）和 `generation_timeout`（`504`）。

## 公共类型

### TurnConfig 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `enableTools` | boolean | 是否启用工具调用 |
| `enableDirector` | boolean | 是否启用 Director 模块 |
| `enableVerifier` | boolean | 是否启用 Verifier 模块 |
| `enableMemoryConsolidation` | boolean | 是否启用记忆整合 |
| `verifierFailStrategy` | string | Verifier 失败策略：`warn` / `block` / `retry` |
| `toolMode` | string | 工具模式：`inline` / `standalone` / `both` |
| `maxRetries` | integer | 最大重试次数，0-5 |

### GenerationParams 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `temperature` | number | 温度，0-2 |
| `max_output_tokens` | integer | 最大输出 token 数 |
| `top_p` | number | Top-P，0-1 |
| `top_k` | integer | Top-K，>=1 |
| `frequency_penalty` | number | 频率惩罚 |
| `presence_penalty` | number | 存在惩罚 |
| `stop_sequences` | string[] | 停止序列 |
| `stream` | boolean | 是否流式 |
| `reasoning_effort` | string | 推理力度：`low` / `medium` / `high` |
