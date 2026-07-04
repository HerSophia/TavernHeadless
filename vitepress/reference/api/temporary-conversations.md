---
outline: [2, 3]
---

# Temporary Conversations（临时对话）

临时对话是一组正式的高级资源。

它用来承载不污染主叙事的短期草稿、多轮辅助推理、候选输出整理和 Project 级研究协作。底层仍然复用 `session / floor / message_page / message` 这套模型，但资源载体固定为 `sessions.kind = temporary`，并且不会出现在普通 `sessions` 列表和详情接口里。

## 什么时候需要看这页

- 你要基于一个已有会话开一个隔离的草稿对话。
- 你要基于一个 Project 开一个临时研究或整理容器。
- 你要给这类临时对话追加消息、继续生成或读取 transcript。
- 你要把临时对话结果显式导出到 `page_staged_write`。
- 你要区分 `finalize`、`discard`、`cancel`、`expired` 这些生命周期语义。

如果你只是普通聊天接入，继续看 [Sessions](./sessions) 和 [Chat](./chat) 即可。

## 一个简单例子

```bash
# 1) 基于现有 Session 创建临时对话
curl -X POST http://localhost:3000/sessions/sess_main/temporary-conversations \
  -H 'Content-Type: application/json' \
  -d '{
    "purpose": "draft-reply",
    "retention_policy": "ttl",
    "ttl_seconds": 1800
  }'

# 2) 在临时对话里继续生成
curl -X POST http://localhost:3000/temporary-conversations/temp_001/respond \
  -H 'Content-Type: application/json' \
  -d '{
    "input_message": {
      "role": "user",
      "content": "请给我三个不同语气的候选回复。"
    }
  }'

# 3) 把候选结果显式导出到正式页面的 staged write ledger
curl -X POST http://localhost:3000/temporary-conversations/temp_001/export \
  -H 'Content-Type: application/json' \
  -d '{
    "target": "page_staged_write",
    "target_page_id": "page_target_1",
    "reason": "候选草稿"
  }'
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| temporary conversation | 一种独立资源，底层仍复用会话模型，但默认不进入主叙事正史 |
| source session | 临时对话的来源会话。基于 Session 创建时会从这里派生快照 |
| source project | 临时对话的来源 Project。基于 Project 创建时会从这里读取生效配置 |
| `return_inline` | 默认结果出口。`respond` 只把结果作为当前请求返回，不自动写回正式页面 |
| `page_staged_write` | 候选写入 ledger。它不是 commit，也不会自动激活 page |
| `client_visible` | 公共资源面可见的临时对话 |
| `internal` | 只供内部调用方使用的临时对话；公共 API 按不存在处理 |
| retention policy | 终态后的保留策略。当前只有 `delete_on_finalize`、`ttl`、`keep_for_debug` |

## 边界与生命周期

这组资源有几条固定边界：

- 不提供 list、search、branch、edit-and-regenerate。
- T2 阶段固定只在分支 `main` 上运行。
- 普通 `sessions` 列表和详情不会返回它们。
- 公共 API 只返回 `visibility = client_visible` 的资源；`internal` 会返回 `404 conversation_not_found`。
- `respond` 的 JSON 模式和 SSE 模式都默认只返回 inline 结果，不自动写入主叙事。
- 显式导出目标当前只有 `page_staged_write`。
- TTL 过期是惰性检查：下一次读写入口触发时，资源会原子转成 `expired`。

### 生命周期状态

| 状态 | 说明 |
| ---- | ---- |
| `active` | 可继续追加消息、生成、读取 transcript、导出和终止 |
| `finalized` | 正常结束，进入终态 |
| `discarded` | 明确放弃结果，进入终态 |
| `cancelled` | 主动中止，进入终态 |
| `expired` | TTL 到期后惰性转入的终态 |

### 保留策略

| 策略 | 说明 |
| ---- | ---- |
| `delete_on_finalize` | 默认策略。进入终态后即可被保留清理（在审计宽限期后清理正文） |
| `ttl` | 创建时必须提供 `ttl_seconds`；到期后转为 `expired`，随后可被保留清理 |
| `keep_for_debug` | 终态后继续保留 detail / transcript 与正文，不被普通保留清理删除，供授权调用方按 id 读取 |

### 保留清理（治理）

临时对话的保留清理由通用运行时维护任务（`ENABLE_RUNTIME_MAINTENANCE=true`）周期执行，分两步：

- **TTL 过期扫描**：把 `expires_at` 已过、仍处于 `active` 的 TTL 临时对话转为 `expired`。这一步是惰性过期之外的兜底，确保即使无人访问也会过期。
- **终态正文清理**：对终态（`finalized` / `discarded` / `cancelled` / `expired`）且策略为 `delete_on_finalize` 或 `ttl` 的临时对话，在审计宽限期（`TEMPORARY_CONVERSATION_CLEANUP_GRACE_MS`）之后删除其消息正文，并写入 `cleaned_at`。会话行、floor / page 结构与生命周期时间戳保留，供审计；`keep_for_debug` 永不被这一步清理。

清理动作只写入 `temporary_conversation.cleanup` 操作日志摘要（数量与去重统计），不写入任何正文。

| 开关 | 默认 | 说明 |
| ---- | ---- | ---- |
| `ENABLE_RUNTIME_MAINTENANCE` | `false` | 启用通用运行时维护任务 |
| `ENABLE_TEMPORARY_CONVERSATION_CLEANUP` | `true` | 维护任务中是否执行临时对话 TTL 过期与终态正文清理 |
| `TEMPORARY_CONVERSATION_CLEANUP_GRACE_MS` | `0` | 进入终态到正文清理之间保留的审计宽限期（毫秒） |

## 响应格式说明

这组路由沿用普通 REST 资源的 `data` 包裹：

```json
{
  "data": {}
}
```

即使创建入口挂在 `/projects/:id/...` 下面，它也不使用 Project 路由族常见的 `items` / `item` 格式。

## 公共类型

### TemporaryConversationResource

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | `string` | 临时对话 ID |
| `workspace_id` | `string \| null` | 所属 Workspace |
| `project_id` | `string \| null` | 所属 Project |
| `source_session_id` | `string \| null` | 来源会话 ID。基于 Project 创建时可为空 |
| `branch_id` | `string` | 当前固定为 `main` |
| `kind` | `"temporary"` | 资源类型 |
| `title` | `string \| null` | 可选标题 |
| `purpose` | `string \| null` | 用途短标签 |
| `status` | `TemporaryConversationStatus` | 生命周期状态 |
| `retention_policy` | `TemporaryConversationRetentionPolicy` | 保留策略 |
| `visibility` | `"client_visible" \| "internal"` | 可见性 |
| `created_at` | `integer` | 创建时间戳（ms） |
| `updated_at` | `integer` | 最近更新时间戳（ms） |
| `last_activity_at` | `integer` | 最近一次消息、生成、导出或终止动作时间（ms） |
| `expires_at` | `integer \| null` | TTL 到期时间 |
| `finalized_at` | `integer \| null` | finalize 时间 |
| `discarded_at` | `integer \| null` | discard 时间 |
| `cancelled_at` | `integer \| null` | cancel 时间 |
| `cleaned_at` | `integer \| null` | 终态保留清理时间。非空表示正文已被维护任务清理，仅保留结构与审计摘要 |

### TemporaryConversationTranscript

返回结构保持 floor / page / message 三层：

- `floors[].floor_no`
- `floors[].pages[].page_no`
- `floors[].pages[].messages[].seq`

消息层会返回 `role`、`content`、`content_format`、`is_hidden`、`source`、`created_at`。

### TemporaryConversationExportResult

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `conversation_id` | `string` | 临时对话 ID |
| `target` | `"page_staged_write"` | 导出目标 |
| `staged_write_id` | `string` | 新写入的 staged write 记录 ID |
| `target_page_id` | `string` | 目标正式页面 ID |
| `source_page_id` | `string` | 临时对话里被导出的输出页 ID |
| `created_at` | `integer` | 导出时间戳（ms） |
| `status` | `"staged"` | 候选写入状态 |

## 创建临时对话（基于 Session）

```http
POST /sessions/:id/temporary-conversations
```

从一个已有 Session 的快照派生出临时对话。适合围绕当前剧情上下文做候选草稿或短期辅助推理。

### 路径参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `id` | `string` | 是 | 来源 Session ID |

### 请求体

```json
{
  "title": "候选回复草稿",
  "purpose": "draft-reply",
  "retention_policy": "ttl",
  "ttl_seconds": 1800
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `title` | `string` | 否 | - | 可选标题，1-200 字符 |
| `purpose` | `string` | 是 | - | 用途短标签，1-120 字符 |
| `retention_policy` | `string` | 否 | `delete_on_finalize` | `delete_on_finalize` / `ttl` / `keep_for_debug` |
| `ttl_seconds` | `integer` | 条件必填 | - | 仅在 `retention_policy = ttl` 时允许，范围 `1-86400` |

### 成功响应 `201`

```json
{
  "data": {
    "id": "temp_001",
    "workspace_id": "ws_default_default-admin",
    "project_id": "proj_main",
    "source_session_id": "sess_main",
    "branch_id": "main",
    "kind": "temporary",
    "title": "候选回复草稿",
    "purpose": "draft-reply",
    "status": "active",
    "retention_policy": "ttl",
    "visibility": "client_visible",
    "created_at": 1735689600000,
    "updated_at": 1735689600000,
    "last_activity_at": 1735689600000,
    "expires_at": 1735691400000,
    "finalized_at": null,
    "discarded_at": null,
    "cancelled_at": null,
    "cleaned_at": null
  }
}
```

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `400` | `validation_error` / `invalid_retention_policy` / `ttl_required` / `invalid_ttl_seconds` | 请求体不合法，或 TTL 相关字段不满足约束 |
| `403` | `project_access_denied` | 当前账号能看见来源范围，但没有写权限 |
| `404` | `conversation_not_found` / `source_session_not_found` | 来源 Session 不存在，或按权限规则对当前账号隐藏 |
| `409` | `project_archived` | 来源 Session 所在 Project 已归档 |

### 示例

```bash
curl -X POST http://localhost:3000/sessions/sess_main/temporary-conversations \
  -H 'Content-Type: application/json' \
  -d '{"purpose":"draft-reply","retention_policy":"ttl","ttl_seconds":1800}'
```

## 创建临时对话（基于 Project）

```http
POST /projects/:id/temporary-conversations
```

从一个 Project 的生效配置派生出临时对话。适合资料整理、候选起草和 Project 级研究。

### 路径参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `id` | `string` | 是 | 来源 Project ID |

### 请求体

与上一个基于 Session 的创建接口相同。

### 成功响应 `201`

响应结构同 `TemporaryConversationResource`。

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `400` | `validation_error` / `invalid_retention_policy` / `ttl_required` / `invalid_ttl_seconds` | 请求体不合法 |
| `403` | `project_access_denied` | 当前账号能看见该 Project，但没有写权限 |
| `404` | `project_not_found` / `source_project_not_found` | Project 不存在，或按成员规则对当前账号隐藏 |
| `409` | `project_archived` | Project 已归档 |

### 示例

```bash
curl -X POST http://localhost:3000/projects/proj_main/temporary-conversations \
  -H 'Content-Type: application/json' \
  -d '{"purpose":"research-note","retention_policy":"keep_for_debug"}'
```

## 读取详情

```http
GET /temporary-conversations/:id
```

读取临时对话元数据，不返回完整 transcript。

### 路径参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `id` | `string` | 是 | 临时对话 ID |

### 成功响应 `200`

返回 `TemporaryConversationResource`。

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `403` | `project_access_denied` | 当前账号能看见来源范围，但没有读取权限 |
| `404` | `conversation_not_found` | 临时对话不存在，或 `visibility = internal`，或按成员规则对当前账号隐藏 |
| `409` | `project_archived` | 关联 Project 已归档 |

### 示例

```bash
curl http://localhost:3000/temporary-conversations/temp_001
```

## 追加消息

```http
POST /temporary-conversations/:id/messages
```

只负责向临时对话追加一条消息，不触发生成。

### 请求体

```json
{
  "role": "user",
  "content": "请先给我一个克制版。"
}
```

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `role` | `"user" \| "assistant" \| "system"` | 是 | 消息角色 |
| `content` | `string` | 是 | 消息正文，不能为空 |

### 成功响应 `200`

```json
{
  "data": {
    "conversation_id": "temp_001",
    "floor_id": "floor_001",
    "page_id": "page_001",
    "message_id": "msg_001",
    "seq": 3,
    "role": "user"
  }
}
```

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `400` | `validation_error` / `invalid_message_role` / `empty_message_content` | 请求体不合法 |
| `403` | `project_access_denied` | 没有继续写入权限 |
| `404` | `conversation_not_found` | 资源不存在，或对当前账号隐藏 |
| `409` | `conversation_not_active` / `project_archived` | 资源已经进入终态，或关联 Project 已归档 |

### 示例

```bash
curl -X POST http://localhost:3000/temporary-conversations/temp_001/messages \
  -H 'Content-Type: application/json' \
  -d '{"role":"user","content":"请先给我一个克制版。"}'
```

## 生成回复（JSON / SSE）

```http
POST /temporary-conversations/:id/respond
```

这一个接口同时承担非流式和流式两种模式：

- 默认返回 JSON。
- 当 `Accept: text/event-stream` 时返回 SSE。

`input_message` 是可选字段。传入时，服务会先把这条消息原子追加进 transcript，再执行本次生成。

`dynamic_context` 是可选字段。调用方可以传入按当前上下文求值生成的本回合动态上下文文本；服务会把它作为一条仅本回合有效的注入参与 prompt 组装，不写入 transcript。空串或纯空白视为未提供。

`generation_params` 是可选字段，用于覆盖本回合的生成参数。未传的字段不会下发，由后端/模型默认值生效。各字段含义：

- `reasoning_effort`：推理（思维链）强度。预设三档 `low` / `medium` / `high`，也可传入模型支持的更强档位（例如 `xhigh`），最长 64 字符。是否真正产出 reasoning 取决于模型本身；模型不返回时，结果按「无 reasoning」处理，不臆造。
- `temperature`：采样温度，取值范围 `[0, 2]`。
- `top_p`：Top-P 采样，取值范围 `[0, 1]`。
- `max_output_tokens`：最大输出 token 数，正整数。
- `max_context_tokens`：最大上下文token 数，正整数。主要用于 prompt 组装阶段的 token 预算（历史裁剪），不是下发给模型的上下文窗口设置。

`tool_transport_preference` 是可选字段，选择本回合的工具调用协议（仅对图助手会话 `purpose=graph-assistant` 生效，其他会话忽略）。缺省视为 `auto`：

- `auto`：按所选模型能力自动选——支持原生 function calling 则走原生，否则走文本协议。
- `native`：强制原生 function calling；所选模型不支持时后端安全回退到文本协议，不报错，回退由工具传输 trace 体现。
- `text_protocol`：强制文本协议。

### 请求体

```json
{
  "input_message": {
    "role": "user",
"content": "请给我三个不同语气的候选回复。"
  },
  "dynamic_context": "当前画布：3 个节点，2 条连线；选中节点：intro。",
  "generation_params": {
    "reasoning_effort": "medium",
  "temperature": 1,
    "top_p": 0.5,
    "max_output_tokens": 8192,
    "max_context_tokens": 300000
  },
  "tool_transport_preference": "auto"
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `input_message` | `object` | 否 | - | 本回合要追加的用户消息，含 `role` 与 `content` |
| `dynamic_context` | `string` | 否 | - | 本回合动态上下文文本，仅本回合注入 prompt，不写入 transcript；最大 200000 字符 |
| `generation_params` | `object` | 否 | - | 本回合生成参数覆盖 |
| `generation_params.reasoning_effort` | `string` | 否 | - | 推理（思维链）强度，预设 `low` / `medium` / `high`，也可传模型支持的更强档位；最长 64 字符 |
| `generation_params.temperature` | `number` | 否 | - | 采样温度，取值 `[0, 2]` |
| `generation_params.top_p` | `number` | 否 | - | Top-P 采样，取值 `[0, 1]` |
| `generation_params.max_output_tokens` | `integer` | 否 | - | 最大输出 token 数，≥ 1 |
| `generation_params.max_context_tokens` | `integer` | 否 | - | 最大上下文 token 数，≥ 1；用于 prompt 组装阶段的 token 预算 |
| `tool_transport_preference` | `string` | 否 | `auto` | 工具调用协议偏好，枚举 `auto` / `native` / `text_protocol`；仅图助手会话生效 |

### JSON 成功响应 `200`

```json
{
  "data": {
    "conversation_id": "temp_001",
    "branch_id": "main",
    "floor_id": "floor_002",
    "floor_no": 2,
    "page_id": "page_002",
    "generated_text": "这里是候选回复正文",
    "total_usage": {
      "prompt_tokens": 321,
      "completion_tokens": 144,
      "total_tokens": 465
    },
    "final_state": "stop"
  }
}
```

### SSE 响应

请求头：

| Header | 值 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `Accept` | `text/event-stream` | 是 | 开启 SSE 模式 |

SSE 事件序列会复用现有聊天流的基本习惯：

- `start`：本次生成开始，返回 `floor_id`、`floor_no`、`branch_id`
- `chunk`：文本增量，字段是 `chunk`
- `reasoning`：推理（思维链）增量，字段是 `delta`；仅当模型在生成过程中产出 reasoning 时下发，模型不返回时不出现
- `tool`：运行时工具事件摘要
- `run`：楼层运行快照摘要
- `done`：最终结果，包含 `conversation_id`、`page_id`、`generated_text`、`total_usage`、`final_state`
- `error`：流式错误

一个简化示例：

```text
event: start
data: {"floor_id":"floor_002","floor_no":2,"branch_id":"main"}

event: reasoning
data: {"delta":"先分析一下需求……"}

event: chunk
data: {"chunk":"第一段文本"}

event: done
data: {"conversation_id":"temp_001","branch_id":"main","floor_id":"floor_002","floor_no":2,"page_id":"page_002","generated_text":"完整文本","summaries":[],"total_usage":{"prompt_tokens":321,"completion_tokens":144,"total_tokens":465},"final_state":"stop"}
```

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `400` | `validation_error` / `invalid_message_role` / `empty_message_content` | 请求体不合法 |
| `403` | `project_access_denied` | 没有继续写入权限 |
| `404` | `conversation_not_found` | 资源不存在，或对当前账号隐藏 |
| `409` | `conversation_not_active` / `conversation_busy` / `no_pending_input` / `missing_effective_user_tail` / `project_archived` | 资源不可写、正在忙、上下文不满足生成前提，或关联 Project 已归档 |

### 示例

```bash
curl -X POST http://localhost:3000/temporary-conversations/temp_001/respond \
  -H 'Content-Type: application/json' \
  -d '{"input_message":{"role":"user","content":"请给我三个不同语气的候选回复。"}}'
```

```bash
curl -X POST http://localhost:3000/temporary-conversations/temp_001/respond \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{"input_message":{"role":"user","content":"请给我三个不同语气的候选回复。"}}'
```

## 楼层重试（JSON / SSE）

```http
POST /temporary-conversations/:id/retry
```

对临时对话中一个**已提交**的楼层整轮重试。它在目标楼层上新增一个 output page version（保留旧页历史），以新页承载本次重试输出，不原地清空旧页。

同样支持 JSON 与 SSE 两种模式，出口规则与 `respond` 一致（默认 JSON，`Accept: text/event-stream` 时走 SSE）。

### 请求体

```json
{
  "floor_id": "floor_002",
  "dynamic_context": "当前画布：3 个节点。",
  "generation_params": { "temperature": 1 }
}
```

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `floor_id` | `string` | **是** | 目标楼层 ID，必须已提交 |
| `dynamic_context` | `string` | 否 | 本回合动态上下文文本，仅本回合注入 prompt，不写入 transcript；最大 200000 字符 |
| `generation_params` | `object` | 否 | 本回合生成参数覆盖，字段同 `respond` |
| `confirmed_execution_ids` | `string[]` | 否 | 确认允许 replay 的工具执行 ID 列表 |
| `confirmed_session_state_mutation_ids` | `string[]` | 否 | 确认允许 replay 的 session-state mutation ID 列表 |

### JSON 成功响应 `200`

```json
{
  "data": {
    "conversation_id": "temp_001",
    "branch_id": "main",
    "floor_id": "floor_002",
    "floor_no": 2,
    "page_id": "page_003",
    "generated_text": "重试后的正文",
    "total_usage": { "prompt_tokens": 321, "completion_tokens": 144, "total_tokens": 465 },
    "final_state": "stop"
  }
}
```

SSE 事件序列与 `respond` 一致，`done` 事件返回同样的结果字段。

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `400` | `validation_error` | 请求体不合法 |
| `403` | `project_access_denied` | 没有继续写入权限 |
| `404` | `conversation_not_found` / `retry_target_not_found` | 会话不存在，或目标楼层不存在 |
| `409` | `conversation_not_active` / `conversation_busy` / `missing_effective_user_tail` / `project_archived` | 资源不可写、正在忙、上下文不满足生成前提，或关联 Project 已归档 |

## 楼层 Step 级重试（JSON / SSE）

```http
POST /temporary-conversations/:id/retry-step
```

对临时对话中一个**已提交**的楼层，从指定的某个 LLM 生成步开始重试。保留起点步之前已成功的工具往返结果并原样回放，只把起点步及其之后的内容重新生成，输出同样落在新的 output page version 上。

起点约束与主会话 `/floors/:id/retry-step` 一致：`from_step_index` 指向的那一步，其工具必须没有写类副作用，否则返回 `409 step_retry_blocked_side_effect`。起点之前已产生的写类副作用不会回滚，在响应的 `irreversible_side_effects` 中列出。

### 请求体

在「楼层重试」请求体基础上，额外要求 `from_step_index`：

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `floor_id` | `string` | **是** | 目标楼层 ID，必须已提交 |
| `from_step_index` | `integer` | **是** | 从哪一步开始重生成，1-based，≥ 1 |
| `dynamic_context` | `string` | 否 | 同「楼层重试」 |
| `generation_params` | `object` | 否 | 同「楼层重试」 |
| `confirmed_execution_ids` | `string[]` | 否 | 同「楼层重试」 |
| `confirmed_session_state_mutation_ids` | `string[]` | 否 | 同「楼层重试」 |

### JSON 成功响应 `200`

在「楼层重试」响应的基础上，额外返回 `discarded_from_step_index` 与 `irreversible_side_effects`：

```json
{
  "data": {
    "conversation_id": "temp_001",
    "branch_id": "main",
    "floor_id": "floor_002",
    "floor_no": 2,
    "page_id": "page_004",
    "generated_text": "从第 3 步重生成的正文",
    "total_usage": { "prompt_tokens": 210, "completion_tokens": 96, "total_tokens": 306 },
    "final_state": "stop",
   "discarded_from_step_index": 3,
    "irreversible_side_effects": [
      {
        "execution_id": "exec_01",
        "tool_name": "write_file",
        "side_effect_level": "external",
        "started_at": 1735689600000,
        "generation_step_no": 2
      }
    ]
  }
}
```

| 字段 | 类型 | 说明 |
| ----| ---- | ---- |
| `discarded_from_step_index` | number | 实际被丢弃并重生成的起点步号 |
| `irreversible_side_effects` | object[] | 起点之前已产生、不会回滚的写类副作用摘要（`execution_id` / `tool_name` / `side_effect_level` / `started_at` / `generation_step_no`） |

SSE 模式下，`done` 事件同样携带上述额外字段。

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `409` | `step_retry_blocked_side_effect` |起点步的工具带写类副作用，不能作为重试起点 |

其余错误语义与「楼层重试」一致。

## 读取 transcript

```http
GET /temporary-conversations/:id/transcript
```

返回结构化 transcript，按 floor / page / message 三层展开。

每个 floor 还带一个 `reasoning_text` 字段，表示该楼层提交时捕获的推理（思维链）文本。模型未返回 reasoning 或楼层尚未提交时为 `null`。

```json
{
  "data": {
    "conversation_id": "temp_001",
    "branch_id": "main",
    "floors": [
      {
        "id": "floor_001",
        "floor_no": 1,
        "branch_id": "main",
        "parent_floor_id": null,
        "state": "committed",
        "token_in": 0,
        "token_out": 0,
        "created_at": 1735689600000,
        "updated_at": 1735689600000,
        "reasoning_text": null,
        "pages": [
          {
            "id": "page_001",
            "page_no": 1,
            "page_kind": "mixed",
            "is_active": true,
            "version": 1,
            "checksum": null,
            "created_at": 1735689600000,
            "updated_at": 1735689600000,
            "messages": [
              {
                "id": "msg_001",
                "seq": 1,
                "role": "user",
                "content": "请先给我一个克制版。",
                "content_format": "text",
                "is_hidden": false,
                "source": null,
                "created_at": 1735689600000
              }
            ]
          }
        ]
      }
    ]
  }
}
```

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `403` | `project_access_denied` | 没有读取权限 |
| `404` | `conversation_not_found` | 资源不存在，或对当前账号隐藏 |
| `409` | `project_archived` | 关联 Project 已归档 |

### 示例

```bash
curl http://localhost:3000/temporary-conversations/temp_001/transcript
```

## 调试 inspect（治理 / 审计）

```http
GET /temporary-conversations/:id/inspect
```

面向调试、审计与运维的聚合视图。它在一次请求里返回临时对话的元数据、来源快照引用、Agent 来源血缘、导出记录、保留清理状态和带可见性分层的 transcript。

与公共详情 / transcript 不同，这个入口允许授权调用方查看 `visibility = internal` 的 agent-private 临时对话；普通详情 / transcript 入口仍对它们返回 `404`。

### 可见性分层

- 默认裁剪：当临时对话是 agent-private（`visibility = internal`，或带 Agent 来源血缘）时，transcript 的 `content` 会被裁剪为 `null`，并把消息标记 `restricted: true`；floor 的 `reasoning_text` 同样被脱敏为 `null`；`agent_origin` 也返回 `null`。结构性字段（role、seq、page、floor、`content_length`）始终保留。
- 显式取回：`include_agent_private=true` 仅在调用方对该临时对话拥有 `project.write`（owner）权限时生效，此时返回完整正文与 `agent_origin`，并写入 `temporary_conversation.transcript_inspect` 审计日志。权限不足时该参数被忽略，正文保持裁剪。
- 非 agent-private（`client_visible` 且无 Agent 来源）的临时对话不裁剪。

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `include_agent_private` | `"true" \| "false" \| "1" \| "0"` | 否 | 请求取回 agent-private 正文与来源血缘；仅在拥有 `project.write` 时生效 |

### 成功响应 `200`

```json
{
  "data": {
    "conversation": { "id": "temp_001", "kind": "temporary", "status": "finalized", "cleaned_at": null },
    "agent_private": true,
    "transcript_restricted": true,
    "source_snapshot": {
      "digest": "sha256:...",
      "source_session_id": "sess_main"
    },
    "agent_origin": null,
    "cleanup": {
      "cleaned": false,
      "cleaned_at": null,
      "retention_policy": "delete_on_finalize"
    },
    "transcript": {
      "conversation_id": "temp_001",
      "branch_id": "main",
      "floors": [
        {
          "id": "floor_001",
          "floor_no": 1,
          "state": "committed",
          "reasoning_text": null,
          "pages": [
            {
              "id": "page_001",
              "page_kind": "mixed",
              "messages": [
                {
                  "id": "msg_001",
                  "seq": 0,
                  "role": "user",
                  "content": null,
                  "content_length": 12,
                  "content_format": "text",
                  "is_hidden": false,
                  "source": null,
                  "restricted": true,
                  "created_at": 1735689600000
                }
              ]
            }
          ]
        }
      ]
    },
    "exports": [
      {
        "staged_write_id": "stw_001",
        "delivery_target": "page_staged_write",
        "target_session_id": "sess_main",
        "target_page_id": "page_target_1",
        "source_page_id": "page_tmp_output_1",
        "status": "staged",
        "reason": "候选草稿",
        "created_at": 1735689600000,
        "updated_at": 1735689600000,
        "applied_at": null,
        "discarded_at": null
      }
    ]
  }
}
```

`conversation` 字段沿用 `TemporaryConversationResource`（含 `cleaned_at`），示例里只展示了关键字段。

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `403` | `project_access_denied` | 没有读取权限 |
| `404` | `conversation_not_found` | 资源不存在，或按成员规则对当前账号隐藏 |
| `409` | `project_archived` | 关联 Project 已归档 |

### 示例

```bash
curl 'http://localhost:3000/temporary-conversations/temp_001/inspect?include_agent_private=true'
```

## finalize

```http
POST /temporary-conversations/:id/finalize
```

把临时对话标记为正常结束。

### 成功响应 `200`

返回更新后的 `TemporaryConversationResource`，其中 `status = finalized`，并写入 `finalized_at`。

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `403` | `project_access_denied` | 没有终止权限 |
| `404` | `conversation_not_found` | 资源不存在，或对当前账号隐藏 |
| `409` | `conversation_not_active` / `project_archived` | 资源已经不在 `active`，或关联 Project 已归档 |

### 示例

```bash
curl -X POST http://localhost:3000/temporary-conversations/temp_001/finalize
```

## discard

```http
POST /temporary-conversations/:id/discard
```

把临时对话标记为放弃结果。

### 成功响应 `200`

返回更新后的 `TemporaryConversationResource`，其中 `status = discarded`，并写入 `discarded_at`。

### 错误

与 `finalize` 相同，只是终态改为 `discarded`。

### 示例

```bash
curl -X POST http://localhost:3000/temporary-conversations/temp_001/discard
```

## cancel

```http
POST /temporary-conversations/:id/cancel
```

把临时对话标记为主动中止。

### 成功响应 `200`

返回更新后的 `TemporaryConversationResource`，其中 `status = cancelled`，并写入 `cancelled_at`。

### 错误

与 `finalize` 相同，只是终态改为 `cancelled`。

### 示例

```bash
curl -X POST http://localhost:3000/temporary-conversations/temp_001/cancel
```

## 导出到 page staged write

```http
POST /temporary-conversations/:id/export
```

把临时对话的一个输出页显式导出到正式页面的 staged write ledger。

这个动作只会写入候选记录，不会：

- 激活目标 page
- commit floor
- 写入变量 durable truth
- 写入记忆真相层
- 写入 `session_state_live_head`

如果没有显式提供 `source_output_page_id`，服务会自动选择该临时对话最近一次可导出的助手输出页。

### 请求体

```json
{
  "target": "page_staged_write",
  "target_page_id": "page_target_1",
  "source_output_page_id": "page_tmp_output_1",
  "reason": "候选草稿"
}
```

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `target` | `"page_staged_write"` | 是 | 当前唯一允许的导出目标 |
| `target_page_id` | `string` | 是 | 正式页面 ID |
| `source_output_page_id` | `string` | 否 | 指定要导出的临时输出页 |
| `reason` | `string` | 否 | 导出原因，1-500 字符 |

### 成功响应 `200`

```json
{
  "data": {
    "conversation_id": "temp_001",
    "target": "page_staged_write",
    "staged_write_id": "stw_001",
    "target_page_id": "page_target_1",
    "source_page_id": "page_tmp_output_1",
    "created_at": 1735689600000,
    "status": "staged"
  }
}
```

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `400` | `validation_error` / `unsupported_export_target` / `invalid_source_output_page` | 请求体不合法，或来源页不是可导出的输出页 |
| `403` | `project_access_denied` | 没有临时对话写权限，或没有目标页面的 staged write 写权限 |
| `404` | `conversation_not_found` / `source_output_page_not_found` / `target_page_not_found` | 临时对话、来源输出页或目标页面不存在，或按权限规则对当前账号隐藏 |
| `409` | `conversation_not_active` / `project_archived` | 资源已经不在 `active`，或关联 Project 已归档 |

### 示例

```bash
curl -X POST http://localhost:3000/temporary-conversations/temp_001/export \
  -H 'Content-Type: application/json' \
  -d '{"target":"page_staged_write","target_page_id":"page_target_1","reason":"候选草稿"}'
```

## 审计与 SDK 对应

这组路由会写入最小操作审计。当前公开动作包括：

- `temporary_conversation.created`
- `temporary_conversation.message_appended`
- `temporary_conversation.responded`
- `temporary_conversation.finalized`
- `temporary_conversation.discarded`
- `temporary_conversation.cancelled`
- `temporary_conversation.exported`
- `temporary_conversation.expired`
- `temporary_conversation.transcript_inspect`（仅在 inspect 取回 agent-private 正文时写入）
- `temporary_conversation.cleanup`（保留清理维护任务写入的摘要）

第一方 SDK 对应入口如下：

- `client.sessions.createTemporaryConversation(...)`
- `client.projects.createTemporaryConversation(...)`
- `client.temporaryConversations.getDetail(...)`
- `client.temporaryConversations.appendMessage(...)`
- `client.temporaryConversations.respond(...)`
- `client.temporaryConversations.respondStream(...)`
- `client.temporaryConversations.retry(...)`
- `client.temporaryConversations.retryStream(...)`
- `client.temporaryConversations.retryStep(...)`
- `client.temporaryConversations.retryStepStream(...)`
- `client.temporaryConversations.getTranscript(...)`
- `client.temporaryConversations.inspect(...)`
- `client.temporaryConversations.finalize(...)`
- `client.temporaryConversations.discard(...)`
- `client.temporaryConversations.cancel(...)`
- `client.temporaryConversations.exportToPageStagedWrite(...)`
