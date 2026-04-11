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
| `debug_options` | object | 否 | live 最小观测开关，默认关闭 |
| `debug_options.include_prompt_snapshot` | boolean | 否 | 打开后在成功响应 `data` 中返回 `prompt_snapshot` |
| `debug_options.include_runtime_trace` | boolean | 否 | 打开后在成功响应 `data` 中返回 `runtime_trace` |
| `debug_options.include_worldbook_matches` | boolean | 否 | 只有在 `include_runtime_trace=true` 时才会展开 `runtime_trace.worldbook.matches` |

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

如果请求里显式打开 `debug_options.include_prompt_snapshot`，成功响应的 `data` 里还会附带 `prompt_snapshot`。

如果请求里显式打开 `debug_options.include_runtime_trace`，成功响应的 `data` 里还会附带 `runtime_trace`。

如果本轮 prompt 组装实际命中了宏系统，`runtime_trace.macro` 会附带宏 warning、used names、mutation preview、staged mutations 和 trace。

这两个字段默认都关闭。未打开时，同步成功响应保持兼容。

### 常见错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `invalid_message_scope` | 参数校验失败，或消息作用域错误 |
| `404` | `not_found` | 会话不存在 |
| `409` | `session_archived` / `generation_conflict` / `commit_conflict` / `generation_target_stale` | 会话状态冲突、提交边界冲突，或排队请求等待期间目标上下文已经变化 |
| `503` | `secret_unavailable` / `commit_busy` / `generation_queue_timeout` | 密钥不可用，或生成 / 提交等待阶段已超时 |
| `504` | `generation_timeout` | LLM 执行超时 |
| `500` | `secret_invalid_format` / `orchestration_failed` / `turn_commit_failed` | 已保存的密文无法解密，或生成过程出现未分类内部错误 |

上表列出的是常见错误，不是穷尽列表。

当前聊天链路还可能返回：`source_floor_not_found`、`invalid_tool_mode`、`tool_replay_blocked`、`tool_replay_confirmation_required`、`profile_not_found`、`profile_disabled`、`instance_slot_disabled_required`、`tool_catalog_conflict`、`generation_cancelled`（`499`）等 code。客户端应按 `error.code` 做分支处理，而不应只依赖状态码。

这里的 `commit_busy` 是聊天提交链路专用错误，不复用资源写入路径上的 `resource_busy`。

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

如果请求里打开了 live debug 选项：

- `prompt_snapshot` 与 `runtime_trace` 只会出现在 `done` payload 中
- `start` / `run` / `chunk` / `tool` / `summary` / `error` 事件不变
- 不会新增新的 SSE 事件类型

第一版 live 路径不接受 request 级 `visibility` 覆盖，因此 live `runtime_trace` 不返回 `visibility`。

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

只组装 Prompt 并返回调试信息，不实际调用 LLM，无副作用。除了 `prompt_snapshot`，响应里的 `assembly` 还会返回 preset 兼容边界信息。

如果需要查看命中的世界书条目、来源、注入位置和首个命中位置，可以在请求体里打开 `debug_options.include_worldbook_matches`。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `message` | string | **是** | 用户消息文本 |
| `prompt_intent` | string | 否 | Prompt 运行意图：`normal` / `continue` / `impersonate` / `swipe` / `regenerate` / `quiet` |
| `debug_options` | object | 否 | dry-run 额外调试选项 |
| `debug_options.include_worldbook_matches` | boolean | 否 | 是否返回 `assembly.worldbook_matches`。默认 `false` |

当前 dry-run 使用独立请求契约。它只接受 `message`、`prompt_intent` 和 `debug_options`。

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
      "prompt_intent": "continue",
      "assistant_prefill_applied": true,
      "assistant_prefill_strategy": "assistant_message_fallback",
      "preset_used": true,
      "selected_prompt_order_character_id": 100000,
      "ignored_prompt_order_character_ids": [200001],
      "continue_nudge_applied": true,
      "continue_nudge_text": "[Continue your last message without repeating its original content.]",
      "names_behavior_applied": "always",
      "trigger_filtered_entry_ids": ["quietPrompt"],
      "in_chat_inserted_entry_ids": ["continueHint"],
      "worldbook_hits": 1,
      "regex_pre_rules": ["trim_whitespace"],
      "regex_post_rules": [],
      "memory_summary_injected": true,
      "reserved_variable_collisions": [],
      "unsupported_preset_fields": [],
      "ignored_preset_fields": [],
      "unresolved_preset_markers": [],
      "preset_warnings": [
        "检测到 2 条 prompt_order 上下文轨道；当前运行时只会使用 character_id=100000 的 active 轨道。"
      ],
      "preprocessed_user_message": "Please continue the campfire scene.",
      "worldbook_matches": [
        {
          "uid": 7,
          "comment": "Campfire Lore",
          "content_preview": "The northern pass is watched by old sentries.",
          "order": 100,
          "source": {
            "kind": "session_worldbook",
            "worldbook_id": "wb_001",
            "worldbook_name": "Campfire Worldbook"
          },
          "insertion": {
            "position": "before"
          },
          "activation": {
            "mode": "triggered",
            "recursion_level": 0,
            "first_match": {
              "source_kind": "message",
              "message_index_from_latest": 0,
              "matched_key": "campfire",
              "matched_key_scope": "primary",
              "matched_key_type": "plain",
              "char_start": 20,
              "char_end": 28,
              "excerpt": "Please continue the campfire scene."
            }
          }
        }
      ]
    }
  }
}
```

`prompt_snapshot.regex_pre_rule_names` 和 `prompt_snapshot.regex_post_rule_names` 当前表示本轮装配时启用并写入快照的规则名列表。
它们适合做资源版本比对和调试展示，不应被解释为逐条精确命中或逐条实际执行结果。

### 宏系统调试字段

当当前会话的提示词里命中了 ST 宏兼容层时，`prompt_snapshot` 与 `assembly` 调试信息中还可能出现宏系统字段。

当前稳定可见的字段包括：

| 字段 | 位置 | 类型 | 说明 |
| ---- | ---- | ---- | ---- |
| `macro_warnings` | `assembly` | array | 宏求值 warning 列表 |
| `macro_used_names` | `assembly` | string[] | 本轮实际使用到的宏名 |
| `macro_mutation_preview` | `assembly` | array | preview / dry-run 下的 would-write 列表 |
| `macro_staged_mutations` | `assembly` | array | assemble 阶段冻结的 staged mutation |
| `macro_traces` | `assembly` | array | 宏求值 trace 列表 |

当前 `macro_traces` 中已经包含最小调试元数据，典型字段包括：

- `macro_name`
- `raw_text`
- `resolved_text`
- `phase`
- `source_kind`
- `selected_branch`

其中：

- `phase` 用于区分 `preview`、`dry_run`、`assemble`、`commit_consume` 等阶段
- `source_kind` 用于区分 `macro`、`if`、`raw` 等来源
- `selected_branch` 当前主要用于 `if` block，可能是 `then`、`else` 或 `raw`

### 宏系统行为边界

Prompt dry-run 与提示词调试场景对宏系统采用只读执行边界：

- 只读宏会正常求值
- 写宏只进入 preview mutation，不会写库
- dry-run 不会触发 turn commit
- dry-run 与 live 都会基于真实主链汇总宏诊断
- 对外调试时优先查看 `runtime_trace.macro`
- staged mutation 只在 respond / regenerate 的 assemble 阶段冻结，并在 commit 阶段消费

### `if` 条件块支持范围

当前宏系统只支持最小 `if` 条件子集：

- truthy / falsy
- `==`
- `!=`

以下表达式当前不支持：

- `>`
- `<`
- `>=`
- `<=`
- `and`
- `or`
- `not`
- `contains`
- `startsWith`

遇到不支持表达式时：

- 不会回退成普通 truthy 判断
- 会保留原始 `if` block 文本
- 会返回 `macro_condition_unsupported` warning

### 变量宏与作用域兼容视图

当前 ST 变量宏在运行时会区分 local / global 兼容视图，而不是共用同一张扁平 map：

- `.name` / `getvar::name` / `hasvar::name` 读取 local 兼容视图
- `$name` / `getglobalvar::name` / `hasglobalvar::name` 读取 global 兼容视图
- `setvar`、`addvar`、`incvar`、`decvar`、`deletevar` 只写 local overlay
- `setglobalvar`、`addglobalvar`、`incglobalvar`、`decglobalvar`、`deleteglobalvar` 只写 global overlay

这意味着同轮 assemble 中：

- local staged 值不会污染 global 读取结果
- global staged 值也不会污染 local 读取结果

如需完整说明，请参考 [Macros](./macros)。


`assembly` 中的字段分两类：

- **兼容边界**：`selected_prompt_order_character_id`、`unsupported_preset_fields`、`preset_warnings` 等，说明当前预设的哪些功能生效了、哪些被降级或忽略。
- **运行语义**：`prompt_intent`、`assistant_prefill_applied`、`continue_nudge_applied`、`names_behavior_applied` 等，说明本轮提示词组装时各项功能是否真正执行。

`worldbook_matches` 只有在 `debug_options.include_worldbook_matches=true` 时才返回。它按命中的世界书条目逐条列出来源、注入位置和首个命中位置，适合做调试面板或高亮定位。

各字段的含义见[官方集成层 - assembly 字段说明](/guide/integration-kit#assembly提示词组装的运行结果)。

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
| `debug_options` | object | 否 | live 最小观测开关，默认关闭 |
| `debug_options.include_prompt_snapshot` | boolean | 否 | 成功响应 `data` 中返回 `prompt_snapshot` |
| `debug_options.include_runtime_trace` | boolean | 否 | 成功响应 `data` 中返回 `runtime_trace` |
| `debug_options.include_worldbook_matches` | boolean | 否 | 只有在 `include_runtime_trace=true` 时才会展开世界书命中详情 |

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

其中 `previous_floor_id` 指向被替代的旧楼层。

如果打开 `debug_options.include_prompt_snapshot` / `debug_options.include_runtime_trace`，成功响应 `data` 中会按需附带 `prompt_snapshot` / `runtime_trace`。

如果服务端启用了 queue 模式，而请求在排队期间会话的最新 committed floor 已经变化，接口会返回 `409 generation_target_stale`。除此之外，其余生成期错误语义与 `/sessions/:id/respond` 一致，包括 `commit_busy`（`503`）和 `generation_timeout`（`504`）。

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
| `debug_options` | object | 否 | live 最小观测开关，默认关闭 |
| `debug_options.include_prompt_snapshot` | boolean | 否 | 成功响应 `data` 中返回 `prompt_snapshot` |
| `debug_options.include_runtime_trace` | boolean | 否 | 成功响应 `data` 中返回 `runtime_trace` |
| `debug_options.include_worldbook_matches` | boolean | 否 | 只有在 `include_runtime_trace=true` 时才会展开世界书命中详情 |

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

如果打开 `debug_options.include_prompt_snapshot` / `debug_options.include_runtime_trace`，成功响应 `data` 中会按需附带 `prompt_snapshot` / `runtime_trace`。

如果服务端启用了 queue 模式，而目标 floor 在等待期间的结构化上下文已经变化（例如 `branch_id` 或 `floor_no` 被修改），接口会返回 `409 generation_target_stale`。

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
| `debug_options` | object | 否 | live 最小观测开关，默认关闭 |
| `debug_options.include_prompt_snapshot` | boolean | 否 | 成功响应 `data` 中返回 `prompt_snapshot` |
| `debug_options.include_runtime_trace` | boolean | 否 | 成功响应 `data` 中返回 `runtime_trace` |
| `debug_options.include_worldbook_matches` | boolean | 否 | 只有在 `include_runtime_trace=true` 时才会展开世界书命中详情 |

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

如果打开 `debug_options.include_prompt_snapshot` / `debug_options.include_runtime_trace`，成功响应 `data` 中会按需附带 `prompt_snapshot` / `runtime_trace`。

如果服务端启用了 queue 模式，而源消息对应的 floor 上下文在等待期间已经变化，接口会返回 `409 generation_target_stale`。

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
