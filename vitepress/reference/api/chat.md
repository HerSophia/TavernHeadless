---
outline: [2, 3]
---

# Chat（对话生成）

对话生成是 TavernHeadless 的核心功能。就是：发一条消息，模型回一条消息。

这组接口还提供了几种变化：

- 流式生成：一边生成一边输出，不需要等到全部生成完
- 重新生成：对最后一个回合重新生成一次
- 楼层重试：对已经提交的某个回合重新生成
- 编辑再生成：修改某条消息，然后基于修改后的内容重新生成
- 调试：只组装提示词，不真正调用模型

## 什么时候需要看这页

- 你要在前端接入聊天功能
- 你要排查某次生成为什么失败、为什么没有按预期回复
- 你要确认提示词组装是否正确
- 你要接入流式生成

## 一个简单例子

最基础的调用是 `POST /sessions/:id/respond`。传一条消息，拿回一条回复：

```bash
curl -X POST http://localhost:3000/sessions/sess_001/respond \
  -H 'Content-Type: application/json' \
  -d '{"message": "你好，请讲个故事"}'
```

如果要流式输出，换成 `POST /sessions/:id/respond/stream` 就行，请求体一样。

如果只是想看提示词怎么组装的，不想真的调用模型，用 `POST /sessions/:id/respond/dry-run`。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| floor | 一次对话回合的容器 |
| branch | 对话的分支线，默认是 `main` |
| dry-run | 只组装提示词，不调用模型 |
| SSE | 服务端推送事件流，用于流式输出 |
| regenerate | 对最后一个回合重新生成 |
| retry | 对指定楼层重新生成 |

## 补充阅读

如果你只需要对一段文本做宏预览，而不需要完整提示词组装，请改用 `POST /sessions/:id/prompt-runtime/preview`。它不会创建 floor，也不会调用模型。

如果你需要回看某个已提交楼层当时真正保存的提示词快照，而不是当前请求的调试结果，请使用 `GET /floors/:id/prompt-runtime/explain`。

如果你需要比较两个已提交楼层的提示词差异，请使用 `POST /sessions/:id/prompt-runtime/compare`。
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
| `session_state_writes` | object[] | 否 | 与本次 turn 一起提交的受治理 Session State 写入声明 |
| `session_state_writes[].namespace` | string | 是 | 已注册 custom namespace |
| `session_state_writes[].slot` | string | 是 | 目标 custom slot |
| `session_state_writes[].value` | any JSON | 条件必填 | 要写入的 opaque JSON value。与 `delete` 二选一 |
| `session_state_writes[].delete` | boolean | 条件必填 | 只允许 `true`。表示把当前值治理为 `present: false` |
| `debug_options` | object | 否 | live 最小观测开关，默认关闭 |
| `debug_options.include_prompt_snapshot` | boolean | 否 | 打开后在成功响应 `data` 中返回 `prompt_snapshot` |
| `debug_options.include_runtime_trace` | boolean | 否 | 打开后在成功响应 `data` 中返回 `runtime_trace` |
| `debug_options.include_worldbook_matches` | boolean | 否 | 只有在 `include_runtime_trace=true` 时才会展开 `runtime_trace.worldbook.matches` |

`session_state_writes` 的边界如下：

- 只允许 registered custom namespace
- 不允许客户端直接写 `game_state`
- 不接受 `branch_id` / `source_floor_id` / `write_mode` / `replay_safety` 之类底层治理字段
- branch 与 source floor 一律从当前 turn 上下文派生
- 只有在 `enableClientData === true && clientData` 时才可用；否则返回 `503 feature_unavailable`
- 写入会在生成成功后先 stage，并在当前 turn commit 成功时一并落地
- `delete: true` 的治理语义是写成 `present: false`
- 如果写入命中 Session State 的 managed storage 上限或 payload budget，上层会返回同一组 `session_state_*` 正式错误码，而不会把底层 `client_data_*` 错误直接暴露给调用方

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

如果这次运行把多个连续 `user floor` 归并成了一个有效 user turn，或者命中了 assistant floor 护栏诊断，`runtime_trace.history_normalization` 会返回原始 entry 数、有效 turn 数、归并来源和违规列表。

当 mutation value 是对象时，`runtime_trace.macro.mutation_preview` 和 `runtime_trace.macro.staged_mutations` 会返回稳定 JSON 字符串，而不是 `[object Object]`。

当 `structure.mode=flattened` 时，`runtime_trace.structure` 还会附带 `transcriptized`、`transcript_message_count` 与 `assistant_prefill_transcriptized`。如果 assistant prefill 被转写进 transcript，`runtime_trace.delivery.assistant_prefill_strategy` 会返回 `transcript_append`。

这两个字段默认都关闭。未打开时，同步成功响应保持兼容。

当 live 生成成功并越过 commit 边界后，服务端还会在同一同步事务内写入 `prompt_runtime_explain_snapshot`。后续 `GET /floors/:id/prompt-runtime/explain` 和 `POST /sessions/:id/prompt-runtime/compare` 都以这份 committed snapshot 为主，不会事后重算 prompt 组装、宏展开、budget 或 source selection。

### 常见错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `invalid_message_scope` | 参数校验失败、消息作用域错误，或 `session_state_writes` 同时传入 `value` 和 `delete: true` / 两者都未传 |
| `404` | `not_found` / `session_state_namespace_not_registered` | 会话不存在，或 turn 内声明的 custom namespace 尚未注册 |
| `409` | `session_archived` / `generation_conflict` / `commit_conflict` / `generation_target_stale` / `branch_local_snapshot_missing` / `session_state_public_write_forbidden` / `session_state_namespace_item_limit_exceeded` / `session_state_namespace_byte_limit_exceeded` / `session_state_account_item_limit_exceeded` / `session_state_account_byte_limit_exceeded` / `session_state_payload_too_large` | 会话状态冲突、提交边界冲突、排队请求等待期间目标上下文已经变化、新分支所依赖的 source floor 缺少精确 local snapshot，或 turn 内 Session State 写入不被允许、命中规模限制或超出 payload budget |
| `503` | `feature_unavailable` / `commit_busy` / `generation_queue_timeout` | client-data 未启用，或生成 / 提交等待阶段已超时 |
| `504` | `generation_timeout` | LLM 执行超时 |
| `500` | `orchestration_failed` / `turn_commit_failed` / `session_state_stage_failed` | 生成过程出现未分类内部错误，或 turn 内 session-state staging 失败 |

上表列出的是常见错误，不是穷尽列表。

当前 turn model 解析在遇到无法解密的 stored profile binding，或服务端当前没有可用主密钥时，会跳过该 binding，继续尝试更低优先级 binding；如果没有可用 Profile，则回退到 env。因此，旧 binding 或损坏密文通常不会再单独阻断 `/sessions/:id/respond`。

当前聊天链路还可能返回：`source_floor_not_found`、`invalid_tool_mode`、`tool_replay_blocked`、`tool_replay_confirmation_required`、`session_state_replay_blocked`、`session_state_replay_confirmation_required`、`replay_confirmation_required`、`profile_not_found`、`profile_disabled`、`instance_slot_disabled_required`、`tool_catalog_conflict`、`generation_cancelled`（`499`）等 code。客户端应按 `error.code` 做分支处理，而不应只依赖状态码。

如果 `respond` 或 `edit-and-regenerate` 要从一个尚未物化的新分支继承 source floor 的 local 兼容视图，但该 source floor 缺少 `branch_local_variable_snapshot`，服务端现在会直接返回 `409 branch_local_snapshot_missing`，不再退回到当前可见 branch/chat 值。

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

一旦 SSE 连接已经建立，运行期错误会通过 `error` 事件返回，不再切换 HTTP 状态码。`code` 可能为 `generation_conflict`、`generation_queue_timeout`、`generation_timeout`、`commit_busy`、`commit_conflict` 等值。资源写入路径上的 `resource_busy` 不会通过这里复用。

客户端断开连接时，服务端会自动中止生成。

如果客户端需要恢复当前候选输出，应读取 `run` 事件里的 `pending_output.text`，不要只依赖本地累积的 `chunk`。

`tool` 事件的主要字段包括：`execution_id`、`tool_name`、`provider_id`、`provider_type`、`side_effect_level`、`phase`、`message`、`duration_ms`、`replay_safety`。

## Prompt Dry-run

```http
POST /sessions/:id/respond/dry-run
```

只组装 Prompt 并返回调试信息，不实际调用 LLM，无副作用。除了 `prompt_snapshot`，响应里的 `assembly` 还会返回 preset 兼容边界信息。

dry-run 不会写入 `prompt_runtime_explain_snapshot`。这份 explain snapshot 只会在 live 聊天链成功 commit 时产生。

因为 dry-run 明确没有副作用，所以它也不接受 `session_state_writes`。

如果需要查看命中的世界书条目、来源、注入位置和首个命中位置，可以在请求体里打开 `debug_options.include_worldbook_matches`。

如果只想对单段文本做宏 preview，而不需要 `messages`、`assembly` 和 `prompt_snapshot`，请使用 `POST /sessions/:id/prompt-runtime/preview`。preview 与 dry-run 共享同一条宏求值主线，但 preview 只返回单段文本和 `runtime_trace`。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `message` | string | **是** | 用户消息文本 |
| `prompt_intent` | string | 否 | Prompt 运行意图：`normal` / `continue` / `impersonate` / `swipe` / `regenerate` / `quiet` |
| `debug_options` | object | 否 | dry-run 额外调试选项 |
| `debug_options.include_worldbook_matches` | boolean | 否 | 是否返回 `assembly.worldbook_matches`。默认 `false` |

当前 dry-run 使用独立请求契约。除 `message`、`prompt_intent`、`debug_options` 外，还支持：

- `budget`：当前首轮支持 `max_input_tokens`、`reserved_completion_tokens`
- `source_selection`：当前首轮支持 `history` / `memory` / `worldbook` / `examples`
- 不接受 `session_state_writes`；传入时会走 `validation_error`

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
    "memory": {
      "summary_injected": true,
      "runtime_mode": "async_primary",
      "requested_write": false,
      "effective_write": false,
      "strategy": "dual_summary",
      "summary_text": "[Memory]\n- Bob still holds the vault key.\n- Alice had started to distrust Bob.",
      "summary_text_hash": "sha256:8b210f3247804d17f0e22171db253f411f4ca9bb9da6c69b75837b086d11c2fa",
      "selected_items": [
        {
          "memory_id": "memory-branch-fact-1",
          "scope": "branch",
          "scope_id": "memscope:session-1:main",
          "branch_id": "main",
          "kind": "fact",
          "source": "store",
          "score": 0.82,
          "token_count": 18,
          "selected_reason": null
        }
      ],
      "token_stats": {
        "budget": 500,
        "used": 64,
        "micro_summary": 14,
        "macro_summary": 0,
        "direct_items": 50
      },
      "scope_resolution": {
        "mode": "branch_aware",
        "requested_scopes": ["global", "branch"],
        "resolved_scopes": ["global", "branch"],
        "requested_branch_id": "main",
        "resolved_branch_id": "main",
        "fallback_reason": null
      }
    },
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

这里需要区分两层记忆字段：

- `memory`：结构化 Prompt Runtime 记忆真相，适合调试、回放、契约消费和 SDK 映射。
- `memory_summary`：兼容投影，便于旧界面继续读取单段文本摘要。

当前 dry-run 不返回原始 `memory_injection`。
在这条接口上，稳定结构化记忆面是顶层 `memory`。

如果需要请求期原始注入结果，请改用：

- `POST /sessions/:id/prompt-runtime/preview`
- `POST /sessions/:id/prompt-runtime/inspect`

`prompt_snapshot.regex_pre_rule_names` 和 `prompt_snapshot.regex_post_rule_names` 当前表示本轮装配时启用并写入快照的规则名列表。
它们适合做资源版本比对和调试展示，不应被解释为逐条精确命中或逐条实际执行结果。

### 宏系统调试字段

当当前会话的提示词里命中了 ST 宏兼容层时，当前稳定的外部宏诊断面是 `runtime_trace.macro`。

`assembly` 与 `prompt_snapshot` 不再公开以下内部宏运行诊断字段：`macro_warnings`、`macro_used_names`、`macro_mutation_preview`、`macro_staged_mutations`、`macro_traces`。

当前稳定可见的调试字段包括：

| 字段 | 位置 | 类型 | 说明 |
| ---- | ---- | ---- | ---- |
| `runtime_trace.macro.warnings` | `runtime_trace` | array | 宏求值 warning 列表 |
| `runtime_trace.macro.used_names` | `runtime_trace` | string[] | 本轮实际使用到的宏名 |
| `runtime_trace.macro.mutation_preview` | `runtime_trace` | array | preview / dry-run 下的 would-write 列表 |
| `runtime_trace.macro.staged_mutations` | `runtime_trace` | array | assemble 阶段冻结的 staged mutation |
| `runtime_trace.macro.traces` | `runtime_trace` | array | 宏求值 trace 列表 |
| `runtime_trace.budgets.trim_reasons` | `runtime_trace` | array | 结构化 trim 原因。当前首轮主要覆盖 token budget 裁剪 |
| `runtime_trace.source_selection.excluded_sources` | `runtime_trace` | array | 结构化 source exclusion 原因。当前首轮覆盖 history / memory / worldbook / examples 级说明 |

当前 `runtime_trace.macro.traces` 中已经包含最小调试元数据，典型字段包括：

- `macro_name`
- `raw_text`
- `resolved_text`
- `phase`
- `source_kind`
- `selected_branch`

其中：

- `phase` 用于区分 `preview`、`dry_run`、`assemble`、`commit_consume` 等阶段
- `source_kind` 用于区分 `macro`、`if`、`raw` 等来源
- `runtime_trace.macro.used_names` 记录的是本轮实际参与求值的宏名
- `selected_branch` 当前主要用于 `if` block，可能是 `then`、`else` 或 `raw`

### 宏系统行为边界

Prompt dry-run 与提示词调试场景对宏系统采用只读执行边界：

- 只读宏会正常求值
- 写宏只进入 preview mutation，不会写库
- dry-run 不会触发 turn commit
- 单段文本 preview 也不会触发 turn commit，且 `runtime_trace.macro.staged_mutations` 固定为空
- dry-run 与 live 都会基于真实主链汇总宏诊断
- 对外调试时应优先查看 `runtime_trace.macro`
- staged mutation 只在 respond / regenerate / retry / generateForFloor 的 assemble 阶段冻结，并在 commit 阶段消费

Phase 2 首轮里，`runtime_trace` 新增两类更正式的 explain 输出：

- `budgets.trim_reasons`：回答“为什么被裁剪”
- `source_selection.excluded_sources`：回答“为什么没有进入 prompt”
- `history_normalization`：回答“连续 user floor 是怎样归并的，以及是否出现了跨 floor 的连续 assistant 段”

这里需要区分两层名字：

- `budgets.by_group[].group` 与 `budgets.trim_reasons[].group` 是 budget group 标签，可以出现具体 section 标签，例如 `section:main`
- `source_selection.excluded_sources[].source` 仍只使用公开 source kind；当前保持 `history`、`memory`、`worldbook`、`examples`

### `if` 条件块支持范围

当前宏系统支持以下 `if` 条件子集：

- truthy / falsy
- `==`
- `!=`
- `>`
- `<`
- `>=`
- `<=`
- `and`
- `or`
- `not`
- `contains`
- `startsWith`
- 括号分组

当前固定语义如下：

- `==` / `!=`：两侧都能解析为有限数字时按数字比较，否则按字符串比较
- `>` / `<` / `>=` / `<=`：只做数值比较
- `contains` / `startsWith`：按区分大小写的字符串谓词处理
- `and` / `or`：按短路语义求值
- 未命中分支和短路未求值一侧不会执行写宏

遇到以下情况时：

- 不会回退成普通 truthy 判断
- 会保留原始 `if` block 文本
- 会返回对应 warning：
  - 不支持语法 -> `macro_condition_unsupported`
  - 结构无法解析 -> `macro_parse_failed`
  - 数值比较类型不合法 -> `macro_arg_type_invalid`

### 变量宏与作用域兼容视图

当前 ST 变量宏在运行时会区分 local / global 兼容视图，而不是共用同一张扁平 map：

- `.name` / `getvar::name` / `hasvar::name` 读取 local 兼容视图
- `$name` / `getglobalvar::name` / `hasglobalvar::name` 读取 global 兼容视图
- `setvar`、`addvar`、`incvar`、`decvar`、`deletevar` 只写 local overlay
- `setglobalvar`、`addglobalvar`、`incglobalvar`、`decglobalvar`、`deleteglobalvar` 只写 global overlay

当前也支持结构化变量路径，例如：

```text
{{getvar::资产.金币}}
{{.资产.金币}}
{{setvar::资产.金币::3}}
{{deletevar::资产.银币}}
{{.资产.金币=3}}
{{$账户.余额=100}}
{{.计数++}}
{{.计数--}}
{{varexists::资产.金币}}
{{flushvar::资产.银币}}
```

兼容规则固定为：

- 先按完整 flat key 查找
- 找不到完整 key 时，再按路径语义读取或写入
- `varexists` / `globalvarexists` 分别归一化到 `hasvar` / `hasglobalvar`
- `flushvar` / `flushglobalvar` 分别归一化到 `deletevar` / `deleteglobalvar`
- 当前只支持 shorthand 写入子集：`.name=value`、`$name=value`、`.name++`、`.name--`
- 当前仍不支持：`$name++`、`$name--`、`||=`、`??=`、`==`

这意味着同轮 assemble 中：

- local staged 值不会污染 global 读取结果
- global staged 值也不会污染 local 读取结果

如需完整说明，请参考 [Macros](./macros)。

`assembly` 继续只承担 dry-run 兼容摘要职责，不再承载宏运行诊断。当前可把它理解成两类字段：

- **兼容 / 摘要字段**：`mode`、`prompt_intent`、`preset_used`、`reserved_variable_collisions`、`selected_prompt_order_character_id`、`unsupported_preset_fields`、`preset_warnings` 等，用来说明当前预设兼容边界和 dry-run 摘要。
- **可与 `runtime_trace` 对齐的事实**：`assistant_prefill_*`、`regex_*`、`worldbook_hits`、`worldbook_matches`、`memory_summary_injected`、`continue_nudge_*`、`names_behavior_applied` 等。

如果同一事实同时出现在 `assembly` 和 `runtime_trace`，应优先把 `runtime_trace` 视为更稳定的结构化观测面。典型映射包括：`assistant_prefill_* -> runtime_trace.delivery`、`regex_* / preprocessed_user_message -> runtime_trace.regex`、`worldbook_hits / worldbook_matches -> runtime_trace.worldbook`、`memory_summary_injected -> runtime_trace.memory`。

`worldbook_matches` 只有在 `debug_options.include_worldbook_matches=true` 时才返回。它按命中的世界书条目逐条列出来源、注入位置和首个命中位置，适合做调试面板或高亮定位。

顶层 `token_estimate`、顶层 `available_for_reply` 与 `prompt_snapshot.token_estimate` 当前仍同时保留。它们来自同一条已物化消息投影路径：前两者适合直接消费，`prompt_snapshot.token_estimate` 更适合和 `prompt_snapshot` 一起做快照展示、持久化比对或历史解释联读。

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
| `confirmed_execution_ids` | string[] | 否 | 确认允许 replay 的工具执行 ID 列表 |
| `confirmed_session_state_mutation_ids` | string[] | 否 | 确认允许 replay 的 session-state mutation ID 列表 |
| `session_state_writes` | object[] | 否 | 与 `/sessions/:id/respond` 相同的 turn-embedded commit-bound Session State 写入声明 |
| `debug_options` | object | 否 | live 最小观测开关，默认关闭 |
| `debug_options.include_prompt_snapshot` | boolean | 否 | 成功响应 `data` 中返回 `prompt_snapshot` |
| `debug_options.include_runtime_trace` | boolean | 否 | 成功响应 `data` 中返回 `runtime_trace` |
| `debug_options.include_worldbook_matches` | boolean | 否 | 只有在 `include_runtime_trace=true` 时才会展开世界书命中详情 |

这组 `session_state_writes` 的字段边界、删除语义和常见错误，与 `/sessions/:id/respond` 一致。

如果目标楼层关联的历史工具执行或 session-state mutation 需要人工确认，服务端会返回 `409 tool_replay_confirmation_required`、`409 session_state_replay_confirmation_required` 或 `409 replay_confirmation_required`。

- `error.details.blocking_executions` 列出需要确认的工具执行
- `error.details.blocking_session_state_mutations` 列出需要确认的 session-state mutation

确认后应把允许继续 replay 的 ID 分别写入 `confirmed_execution_ids` 与 `confirmed_session_state_mutation_ids` 后重试。

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

对一个**已 commit** 的楼层执行原地重试（in-place retry）。目标楼层的 state 必须为 `committed`，服务端会清空当前 output page / assistant message，然后在该楼层上重新生成。

这个接口**不是**用来恢复 `failed` 楼层的。如果目标楼层的 state 不是 `committed`，接口返回 `409` 且错误消息为 `Floor is not committed`。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `config` | TurnConfig | 否 | 回合配置覆盖 |
| `generation_params` | GenerationParams | 否 | 生成参数覆盖 |
| `confirmed_execution_ids` | string[] | 否 | 确认允许 replay 的工具执行 ID 列表 |
| `confirmed_session_state_mutation_ids` | string[] | 否 | 确认允许 replay 的 session-state mutation ID 列表 |
| `session_state_writes` | object[] | 否 | 与 `/sessions/:id/respond` 相同的 turn-embedded commit-bound Session State 写入声明 |
| `debug_options` | object | 否 | live 最小观测开关，默认关闭 |
| `debug_options.include_prompt_snapshot` | boolean | 否 | 成功响应 `data` 中返回 `prompt_snapshot` |
| `debug_options.include_runtime_trace` | boolean | 否 | 成功响应 `data` 中返回 `runtime_trace` |
| `debug_options.include_worldbook_matches` | boolean | 否 | 只有在 `include_runtime_trace=true` 时才会展开世界书命中详情 |

这组 `session_state_writes` 的字段边界、删除语义和常见错误，与 `/sessions/:id/respond` 一致。

当目标楼层包含需要人工确认的历史 replay blocker 时，服务端会返回：

- `409 tool_replay_confirmation_required`
- `409 session_state_replay_confirmation_required`
- `409 replay_confirmation_required`

其中：

- `error.details.blocking_executions` 对应工具回放 blocker
- `error.details.blocking_session_state_mutations` 对应 session-state 回放 blocker

此时应把允许继续回放的 ID 分别放入 `confirmed_execution_ids` 与 `confirmed_session_state_mutation_ids` 后重试。若遇到 `tool_replay_blocked` 或 `session_state_replay_blocked`，则表示对应 blocker 不能通过确认直接自动继续。

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
| `confirmed_execution_ids` | string[] | 否 | 确认允许 replay 的工具执行 ID 列表 |
| `confirmed_session_state_mutation_ids` | string[] | 否 | 确认允许 replay 的 session-state mutation ID 列表 |
| `session_state_writes` | object[] | 否 | 与 `/sessions/:id/respond` 相同的 turn-embedded commit-bound Session State 写入声明 |
| `debug_options` | object | 否 | live 最小观测开关，默认关闭 |
| `debug_options.include_prompt_snapshot` | boolean | 否 | 成功响应 `data` 中返回 `prompt_snapshot` |
| `debug_options.include_runtime_trace` | boolean | 否 | 成功响应 `data` 中返回 `runtime_trace` |
| `debug_options.include_worldbook_matches` | boolean | 否 | 只有在 `include_runtime_trace=true` 时才会展开世界书命中详情 |

这组 `session_state_writes` 的字段边界、删除语义和常见错误，与 `/sessions/:id/respond` 一致。

如果源楼层关联的历史工具执行或 session-state mutation 需要人工确认，服务端会返回 `409 tool_replay_confirmation_required`、`409 session_state_replay_confirmation_required` 或 `409 replay_confirmation_required`。

- `error.details.blocking_executions` 列出工具回放 blocker
- `error.details.blocking_session_state_mutations` 列出 session-state 回放 blocker

确认后应把允许继续 replay 的 ID 分别写入 `confirmed_execution_ids` 与 `confirmed_session_state_mutation_ids`。若返回 `tool_replay_blocked` 或 `session_state_replay_blocked`，则表示该 blocker 不能通过确认自动继续。

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
