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
    "final_state": "committed"
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 参数校验失败 |
| `404` | 会话不存在 |
| `409` | 会话状态冲突 |
| `500` | 生成过程内部错误 |

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

event: chunk
data: {"chunk":"The firelight wavers..."}

event: chunk
data: {"chunk":" as the next part"}

event: done
data: {"floor_id":"floor_12","floor_no":12,"branch_id":"main","generated_text":"...","summaries":[...],"total_usage":{...},"final_state":"committed"}
```

如果生成过程中出错：

```text
event: error
data: {"code":"LLM_ERROR","message":"..."}
```

客户端断开连接时，服务端会自动中止生成。

## Prompt Dry-run

```http
POST /sessions/:id/respond/dry-run
```

只组装 Prompt 并返回调试信息，不实际调用 LLM，无副作用。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `message` | string | **是** | 用户消息文本 |

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
    "assembly": {
      "mode": "preset",
      "preset_used": true,
      "worldbook_hits": 1,
      "regex_pre_rules": ["trim_whitespace"],
      "regex_post_rules": [],
      "memory_summary_injected": true,
      "preprocessed_user_message": "Please continue the campfire scene."
    }
  }
}
```

## 重新生成

```http
POST /sessions/:id/regenerate
```

重新生成会话最后一个楼层的 AI 回复。会创建新的消息页（page）。

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
    "final_state": "committed"
  }
}
```

## 楼层重试

```http
POST /floors/:id/retry
```

对指定楼层重试生成。与 regenerate 类似，但可以指定任意楼层。

### 请求体

同 regenerate 的请求体。

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
    "final_state": "committed"
  }
}
```

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

## 公共类型

### TurnConfig 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `enableDirector` | boolean | 是否启用 Director 模块 |
| `enableVerifier` | boolean | 是否启用 Verifier 模块 |
| `enableMemoryConsolidation` | boolean | 是否启用记忆整合 |
| `verifierFailStrategy` | string | Verifier 失败策略：`warn` / `block` / `retry` |
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