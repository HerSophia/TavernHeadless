---
outline: [2, 3]
---

# LLM Profiles（LLM 配置）

LLM Profile 存的是连接一个 AI 模型所需的信息：供应商、模型名、API 地址、API Key。

一个 Profile 可以被多个实例槽位和多个会话共用。API Key 在数据库里是加密存储的，不会在接口返回明文。

## 什么时候需要看这页

- 你要添加新的模型连接配置
- 你要查看、修改或删除已有的 LLM Profile
- 你要测试某个模型是否能正常连接
- 你要发现某个供应商下有哪些可用模型

## 一个简单例子

```bash
# 创建一个 LLM Profile
curl -X POST http://localhost:3000/llm-profiles \
  -H 'Content-Type: application/json' \
  -d '{
    "preset_name": "My OpenAI",
    "provider": "openai",
    "model_id": "gpt-4o",
    "api_key_name": "openai-key-1"
  }'

# 列出所有 LLM Profile
curl http://localhost:3000/llm-profiles
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| provider | 模型供应商，例如 openai、anthropic、deepseek |
| API Key | 连接模型所需的密钥，在数据库里加密存储 |
| instance slot | 生成槽位，具体哪个槽位用哪个 Profile 由 LLM Instances 决定 |



## 支持的供应商

`openai` / `anthropic` / `google` / `deepseek` / `xai` / `openai-compatible`

## 实例槽位

| 槽位 | 说明 |
| ---- | ---- |
| `*` | 通配符，作为默认 fallback |
| `narrator` | 叙述生成 |
| `director` | Director 模块 |
| `verifier` | Verifier 模块 |
| `memory` | 记忆整合 |

## LLM Profile 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Profile ID |
| `preset_name` | string | 配置名称 |
| `provider` | string | 供应商 |
| `model_id` | string | 模型 ID |
| `base_url` | string \| null | 自定义 API base URL |
| `api_key_name` | string \| null | Key 标签名 |
| `api_key_masked` | string | 脱敏后的 API Key |
| `status` | string | `active` / `disabled` / `deleted` |
| `last_used_at` | integer \| null | 最后使用时间 |
| `created_at` | integer | 创建时间 |
| `updated_at` | integer | 更新时间 |

> 注意：API 响应中永远不会返回明文 API Key，只返回 `api_key_masked`。

## 创建 Profile

```http
POST /llm-profiles
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `preset_name` | string | **是** | 配置名称 |
| `provider` | string | **是** | 供应商 |
| `model_id` | string | **是** | 模型 ID |
| `api_key` | string | **是** | API Key（明文，存储时加密） |
| `base_url` | string | 否 | 自定义 base URL |
| `api_key_name` | string | 否 | Key 标签名 |

### 响应 `201`

返回 `{ "data": LLMProfile }` 。

> 如果请求中提供 `base_url`，服务端会在保存前执行与模型探测接口相同的 URL Guard。默认拒绝私网、本地回环和其他保留地址。若部署确实需要保存这类地址，必须在服务端设置 `ALLOW_PRIVATE_BASE_URL=true`。
> `POST /llm-profiles` 不接受 `allow_private_network` 请求字段。是否允许私网地址，只由服务端环境变量策略决定。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `ssrf_blocked` | 请求体校验失败，或 `base_url` 被 URL Guard 拒绝 |
| `409` | `profile_conflict` | Profile 名称冲突 |
| `503` | `secret_unavailable` | 服务端未配置 `APP_SECRETS_MASTER_KEY`，无法保存加密 API Key |

## 列出 Profiles

```http
GET /llm-profiles
```

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `include_deleted` | boolean | 是否包含已删除（默认 `false`） |
| `status` | string | 按状态过滤 |

### 响应 `200`

返回 `{ "data": LLMProfile[] }` 。

> 注意：LLM Profiles 列表接口不使用分页，直接返回全部。

## 获取 Profile 详情

```http
GET /llm-profiles/:id
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `profile_not_found` | Profile 不存在 |

## 更新 Profile

```http
PATCH /llm-profiles/:id
```

至少提供一个字段。可更新：`preset_name`、`provider`、`model_id`、`base_url`、`api_key_name`、`api_key`、`status`（`active` / `disabled`）。

如果更新 `base_url`，服务端会执行同样的 URL Guard。`PATCH /llm-profiles/:id` 也不接受 `allow_private_network` 请求字段；是否允许私网地址，仍由服务端 `ALLOW_PRIVATE_BASE_URL` 控制。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `ssrf_blocked` | 请求体为空、请求体校验失败，或 `base_url` 被 URL Guard 拒绝 |
| `404` | `profile_not_found` | Profile 不存在 |
| `409` | `profile_conflict` / `profile_inactive` | Profile 名称冲突，或目标 Profile 已处于不可更新状态 |
| `503` | `secret_unavailable` | 服务端未配置 `APP_SECRETS_MASTER_KEY`，无法保存新的加密 API Key |

## 删除 Profile

```http
DELETE /llm-profiles/:id
```

软删除，将状态设为 `deleted`。

### 响应 `200`

```json
{
  "data": {
    "id": "lp_narrator",
    "deleted": true
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `profile_not_found` | Profile 不存在 |
| `409` | `profile_in_use` | Profile 仍被现有 binding 引用，无法删除 |

## 激活 Profile

```http
POST /llm-profiles/:id/activate
```

将 Profile 绑定到指定的作用域和实例槽位。

当前端点是对 `(scope, scope_id, instance_slot)` 的 **binding upsert**。如果目标 binding 已存在，服务端会覆盖 `profile_id`，并按下面的 `params` 规则决定是否保留或清空原有参数覆盖。

当 `scope="session"` 时，服务端除了校验 `session_id` 字段存在，还会校验该 session 真实存在；若不存在，返回 `404 session_scope_not_found`。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `scope` | string | 否 | `global`（默认）/ `session` |
| `session_id` | string | 条件 | 当 scope=session 时必填 |
| `instance_slot` | string | 否 | 实例槽位（默认 `*`） |
| `params` | object \| null | 否 | 生成参数覆盖 |

`params` 可覆盖的字段：

- 省略 `params`：保留已有 binding 的 `params`
- 显式传 `params: null`：清空已有 binding 的 `params`

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `max_context_tokens` | integer | 最大上下文 token |
| `max_output_tokens` | integer | 最大输出 token |
| `temperature` | number | 温度 0-2 |
| `top_p` | number | 0-1 |
| `top_k` | integer | >=0 |
| `frequency_penalty` | number | -2 到 2 |
| `presence_penalty` | number | -2 到 2 |
| `stream` | boolean | 是否流式 |
| `timeout_ms` | integer | 超时毫秒 |
| `max_retries` | integer | 最大重试 0-10 |
| `reasoning_effort` | string | `low` / `medium` / `high` |

### 响应 `200`

```json
{
  "data": {
    "profile_id": "lp_narrator",
    "scope": "session",
    "scope_id": "sess_demo",
    "instance_slot": "director",
    "params": { "max_output_tokens": 512, "temperature": 0.7 },
    "activated": true
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `invalid_params` | 请求体校验失败，或 `params` 归一化失败 |
| `404` | `profile_not_found` / `session_scope_not_found` | Profile 不存在，或 session 作用域不存在 |
| `409` | `profile_inactive` | 目标 Profile 不是可激活状态 |

## 解绑 Profile 绑定

```http
DELETE /llm-profiles/bindings/:slot
```

按 `scope + scope_id + instance_slot` 解绑一个已有 binding。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `slot` | string | 实例槽位：`*` / `narrator` / `director` / `verifier` / `memory` |

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `scope` | string | 否 | `global`（默认）/ `session` |
| `session_id` | string | 条件 | 当 `scope=session` 时必填 |

### 响应 `200`

```json
{
  "data": {
    "scope": "session",
    "scope_id": "sess_demo",
    "instance_slot": "director",
    "unbound": true
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 路径参数或查询参数校验失败 |
| `404` | `binding_not_found` / `session_scope_not_found` | 目标 binding 不存在，或 session 作用域不存在 |

## 运行时解析

```http
GET /llm-profiles/runtime
```

获取当前各实例槽位的实际解析结果，显示每个槽位使用的 Profile 和配置来源。当前实现会始终返回五个槽位：`*`、`narrator`、`director`、`verifier`、`memory`。

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `session_id` | string | 指定会话上下文（可选） |

### 响应 `200`

```json
{
  "data": {
    "session_id": "sess_demo",
    "slots": [
      {
        "slot": "*",
        "source": "env",
        "scope": null,
        "profile_id": null,
        "params": null,
        "preset_name": null,
        "provider": "openai-compatible",
        "model_id": "gpt-4o-mini"
      },
      {
        "slot": "director",
        "source": "session_profile",
        "scope": "session",
        "profile_id": "lp_director",
        "params": { "max_output_tokens": 512, "temperature": 0.7 },
        "preset_name": "Claude Director",
        "provider": "anthropic",
        "model_id": "claude-sonnet-4-20250514"
      }
    ]
  }
}
```

当 `source = "env"` 时，`scope`、`profile_id`、`preset_name`、`params` 都为 `null`。

`source` 可能的值：`env`（环境变量 fallback）、`global_profile`、`session_profile`。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 查询参数校验失败 |
| `500` | `secret_invalid_format` | 数据库中的密文无法解密，通常表示主密钥不匹配或数据已损坏 |
| `503` | `secret_unavailable` | 服务端未配置 `APP_SECRETS_MASTER_KEY` |

这个接口描述的是 **Profile 侧** 的 provider / model 解析结果。若还需要查看实例侧的 `enabled`、`preset_id`、`params` 最终解析，应再查询 `GET /llm-instances/resolved`。

## 发现可用模型

```http
POST /llm-profiles/models/discover
```

通过指定的 provider 和 API Key 查询可用的模型列表。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `provider` | string | **是** | 供应商 |
| `api_key` | string | **是** | API Key |
| `base_url` | string | 否 | 自定义 base URL |
| `allow_private_network` | boolean | 否 | 是否允许私有网络 |

### 响应 `200`

```json
{
  "data": [
    { "id": "gpt-4o-mini", "label": "gpt-4o-mini" },
    { "id": "gpt-4.1-mini", "label": "gpt-4.1-mini" }
  ]
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `ssrf_blocked` | 请求体校验失败，或 `base_url` 被 URL Guard 拒绝 |
| `502` | `model_discovery_failed` / `model_discovery_invalid_response` | 上游模型发现请求失败，或返回了无效响应 |

## 测试模型连通性

```http
POST /llm-profiles/models/test
```

向指定模型发送一条测试消息，验证连通性。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `provider` | string | **是** | 供应商 |
| `model_id` | string | **是** | 模型 ID |
| `api_key` | string | **是** | API Key |
| `base_url` | string | 否 | 自定义 base URL |
| `reasoning_effort` | string | 否 | 推理力度 |
| `allow_private_network` | boolean | 否 | 是否允许私有网络 |

### 响应 `200`

```json
{
  "data": {
    "request_text": "Hello",
    "response_text": "Hello! How can I help you today?"
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `ssrf_blocked` | 请求体校验失败，或 `base_url` 被 URL Guard 拒绝 |
| `502` | `model_test_failed` / `model_test_invalid_response` | 上游模型测试请求失败，或返回了无效响应 |

另外，session 删除时服务端会同步清理该 session 对应的 `llm_profile_binding`；`DELETE /llm-profiles/:id` 也会在判定前自动清理失效的 session 绑定，避免历史脏数据长期阻塞 Profile 删除。
