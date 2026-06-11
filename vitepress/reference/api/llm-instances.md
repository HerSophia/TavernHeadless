---
outline: [2, 3]
---

# LLM Instances（LLM 实例配置）

LLM 实例配置用来控制每个生成槽位具体用哪个 LLM Profile、是否启用、额外的生成参数覆盖，以及可选的 `model_id_override`。

它和 LLM Profiles 的关系是：Profile 继续负责 provider、base URL、API Key 这类连接信息；Instance Config 负责"哪个槽位用哪个 Profile"，以及是否只把模型名改成别的值。

## 什么时候需要看这页

- 你要为某个会话单独指定 LLM 配置
- 你要调整某个槽位（例如 narrator、memory）的生成参数
- 你要查看当前生效的实例配置

## 一个简单例子

```bash
# 为某个会话的 narrator 槽位指定 LLM Profile，并覆盖模型名
curl -X PUT http://localhost:3000/llm-instances/narrator \
  -H 'Content-Type: application/json' \
  -d '{
    "scope": "session",
    "session_id": "sess_001",
    "preset_id": "llm_profile_001",
    "model_id_override": "gpt-4.1-mini",
    "enabled": true
  }'
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| instance slot | 生成槽位，例如 narrator、director、memory |
| scope | 配置生效范围：`global`（全局）或 `session`（某个会话） |
| fallback | 如果没有到精确匹配的配置，就向上找更通用的配置 |



## 实例槽位

| 槽位 | 说明 |
| ---- | ---- |
| `*` | 通配符，作为默认 fallback |
| `narrator` | 叙述生成 |
| `director` | Director 模块 |
| `verifier` | Verifier 模块 |
| `memory` | 记忆整合 |

## 作用域与优先级

配置按以下优先级解析（从高到低）：

1. `session(slot)` — 会话级指定槽位配置
2. `session(*)` — 会话级通配配置
3. `global(slot)` — 全局指定槽位配置
4. `global(*)` — 全局通配配置
5. `default` — 系统默认值（enabled=true, params=null）

这些解析结果会直接进入真实 turn 执行链路，不再只是只读观察值。

## Instance Config 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 配置记录 ID |
| `scope` | string | `global` / `session` |
| `scope_id` | string | 作用域 ID |
| `instance_slot` | string | 实例槽位 |
| `preset_id` | string \| null | 关联的 LLM Profile ID |
| `model_id_override` | string \| null | 仅覆盖模型名。`null` 表示继承 Profile 默认 `model_id` |
| `enabled` | boolean | 是否启用 |
| `params` | object \| null | 生成参数覆盖 |
| `capabilities` | object \| null | 实例能力声明，例如是否支持原生 function call |
| `created_at` | integer | 创建时间 |
| `updated_at` | integer | 更新时间 |

## 列出实例配置

```http
GET /llm-instances
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `scope` | string | 按作用域过滤：`global` / `session` |
| `session_id` | string | 按会话 ID 过滤（scope=session 时使用） |

### 响应 `200`

```json
{
  "data": [
    {
      "id": "ic_demo123",
      "scope": "global",
      "scope_id": "global",
      "instance_slot": "narrator",
      "preset_id": null,
      "model_id_override": "gpt-4.1-mini",
      "enabled": true,
      "params": { "temperature": 0.8, "max_output_tokens": 1024, "stop_sequences": ["DONE"] },
      "capabilities": {
        "supports_function_call": false,
        "supports_tool_choice": false,
        "supports_streaming_tool_call": false,
        "unsupported_generation_params": ["stopSequences"]
      },
      "created_at": 1735689600000,
      "updated_at": 1735689660000
    }
  ]
}
```

## 查询指定槽位配置

```http
GET /llm-instances/:slot
```

返回指定槽位的所有配置记录（可能包含不同 scope 的多条记录）。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `slot` | string | 实例槽位：`*` / `narrator` / `director` / `verifier` / `memory` |

### 查询参数

同列出接口。

### 响应 `200`

返回 `{ "data": InstanceConfig[] }`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `invalid_slot` | 路径参数或查询参数校验失败，或 `slot` 不属于实例槽位枚举 |

## 创建或更新实例配置

```http
PUT /llm-instances/:slot
```

按 `(account_id, scope, scope_id, instance_slot)` 唯一约束执行 upsert。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `slot` | string | 实例槽位 |

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `scope` | string | 否 | `global`（默认）/ `session` |
| `session_id` | string | 条件 | 当 scope=session 时必填 |
| `preset_id` | string \| null | 否 | 关联 LLM Profile ID |
| `model_id_override` | string \| null | 否 | 仅覆盖模型名。传 `null` 表示清除覆盖 |
| `enabled` | boolean | 否 | 是否启用（默认 `true`） |
| `params` | object \| null | 否 | 生成参数覆盖 |
| `capabilities` | object \| null | 否 | 实例能力声明 |

字段省略语义：

- 省略 `enabled`：会按请求 schema 默认值 `true` 处理；对于已存在配置，这等价于把它重新写成 `enabled=true`
- 省略 `preset_id`：如果目标配置已存在，则保留原有 `preset_id`；首次创建时写入 `null`
- 省略 `model_id_override`：如果目标配置已存在，则保留原有覆盖值
- 显式传 `model_id_override: null`：清空实例级模型名覆盖，回退到 Profile 默认 `model_id`
- 省略 `params`：如果目标配置已存在，则保留原有 `params`
- 显式传 `params: null`：清空原有 `params` 覆盖
- 省略 `capabilities`：如果目标配置已存在，则保留原有能力声明；首次创建时写入 `null`
- 显式传 `capabilities: null`：清空实例能力声明，回退到系统保守默认

运行时语义说明：

- `enabled=false` 且 `slot=narrator` 时，真实聊天执行会返回 `409 instance_slot_disabled_required`，不会再回退到环境变量 narrator。
- `enabled=false` 且 `slot=director` / `verifier` / `memory` 时，对应子流程会在本轮 turn 中被强制跳过。
- `preset_id` 在当前实现中作为 narrator Prompt 组装阶段的显式覆盖值；当它为非空字符串时，优先于 `session.presetId`。
- `model_id_override` 只影响最终使用的模型名，不会改动 provider、base URL、API Key 这类 Profile 连接信息。
- `model_id_override` 只有在当前槽位最终解析到 active profile 时才生效；如果没有 active profile，它不会单独把环境变量 fallback 模型替换掉。
- `params` 采用浅层 merge，同名键覆盖。当前槽位原有参数（包括 Profile 绑定参数和默认运行参数）先建立基线，再由 `llm_instance_config.params` 覆盖同名字段。
- `params` 内部某个字段传 `null` 时，表示显式取消该字段，不再沿用上游同名参数，也不会再套用该字段的默认填充值。
- `capabilities` 用来声明实例运行时能力。例如 `supports_function_call=false` 时，服务端会把工具调用 transport 解析到 `text_protocol`，并在 Prompt Runtime trace / effective-config 中公开原因。
- 如果你需要查看“Profile 解析结果”，使用 `/llm-profiles/runtime`；如果你需要查看“实例侧 enabled / preset_id / model_id_override / params / capabilities 的最终解析结果”，应使用 `/llm-instances/resolved`。

`params` 可覆盖的字段：

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `max_context_tokens` | integer \| null | 最大上下文 token。传 `null` 表示显式取消 |
| `max_output_tokens` | integer \| null | 最大输出 token。传 `null` 表示显式取消 |
| `temperature` | number \| null | 温度 0-2。传 `null` 表示显式取消 |
| `top_p` | number \| null | 0-1。传 `null` 表示显式取消 |
| `top_k` | integer \| null | >=0。传 `null` 表示显式取消 |
| `frequency_penalty` | number \| null | -2 到 2。传 `null` 表示显式取消 |
| `presence_penalty` | number \| null | -2 到 2。传 `null` 表示显式取消 |
| `stream` | boolean \| null | 是否流式。传 `null` 表示显式取消 |
| `timeout_ms` | integer \| null | 超时毫秒。传 `null` 表示显式取消 |
| `max_retries` | integer \| null | 最大重试 0-10。传 `null` 表示显式取消 |
| `reasoning_effort` | string \| null | `low` / `medium` / `high`。传 `null` 表示显式取消 |
| `stop_sequences` | string[] \| null | 停止词列表。传 `null` 表示显式取消 |

### 请求示例

```json
{
  "scope": "global",
  "preset_id": null,
  "model_id_override": "gpt-4.1-mini",
  "enabled": true,
  "params": { "temperature": 0.8, "max_output_tokens": 1024, "stop_sequences": ["DONE"] },
  "capabilities": {
    "supports_function_call": false,
    "unsupported_generation_params": ["stopSequences"]
  }
}
```

### 响应 `200`

```json
{
  "data": {
    "id": "ic_demo123",
    "scope": "global",
    "scope_id": "global",
    "instance_slot": "narrator",
    "preset_id": null,
    "model_id_override": "gpt-4.1-mini",
    "enabled": true,
    "params": { "temperature": 0.8, "max_output_tokens": 1024, "stop_sequences": ["DONE"] },
    "capabilities": {
      "supports_function_call": false,
      "supports_tool_choice": false,
      "supports_streaming_tool_call": false,
      "unsupported_generation_params": ["stopSequences"]
    },
    "created_at": 1735689600000,
    "updated_at": 1735689660000
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `invalid_slot` / `invalid_params` | 请求体或路径参数校验失败（包括 `scope=session` 但缺少 `session_id`）、`slot` 非法，或 `params` 归一化失败 |

## 删除实例配置

```http
DELETE /llm-instances/:slot
```

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `slot` | string | 实例槽位 |

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `scope` | string | `global`（默认）/ `session` |
| `session_id` | string | 当 scope=session 时必填 |

### 响应 `200`

```json
{
  "data": {
    "instance_slot": "narrator",
    "scope": "global",
    "deleted": true
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `invalid_slot` / `missing_session_id` | 路径参数或查询参数校验失败、`slot` 非法，或 `scope=session` 但缺少 `session_id` |
| `404` | `config_not_found` | 目标配置不存在 |

## 解析实例配置

```http
GET /llm-instances/resolved
```

按优先级规则解析当前各槽位的实际生效配置。

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `session_id` | string | 指定会话上下文（可选） |

### 响应 `200`

```json
{
  "data": {
    "session_id": null,
    "slots": [
      {
        "slot": "*",
        "source": "global_config",
        "scope": "global",
        "config_id": "ic_abc",
        "preset_id": null,
        "model_id_override": "gpt-4.1-mini",
        "enabled": true,
        "params": { "temperature": 0.7, "stop_sequences": ["DONE"] },
        "capabilities": {
          "supports_function_call": false,
          "supports_tool_choice": false,
          "supports_streaming_tool_call": false,
          "unsupported_generation_params": ["stopSequences"]
        }
      },
      {
        "slot": "narrator",
        "source": "default",
        "scope": null,
        "config_id": null,
        "preset_id": null,
        "model_id_override": null,
        "enabled": true,
        "params": null,
        "capabilities": {
          "supports_function_call": true,
          "supports_tool_choice": false,
          "supports_streaming_tool_call": false,
          "unsupported_generation_params": []
        }
      }
    ]
  }
}
```

`source` 可能的值：

| 值 | 说明 |
| -- | ---- |
| `session_config` | 来自会话级配置 |
| `global_config` | 来自全局配置 |
| `default` | 无配置，使用系统默认值 |
