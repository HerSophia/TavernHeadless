---
outline: [2, 3]
---

# LLM Instances（LLM 实例配置）

独立管理 LLM 实例槽位的配置。与 [LLM Profiles](./llm-profiles) 分离，专注于实例级的启用状态、预设绑定和生成参数覆盖。

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

## Instance Config 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 配置记录 ID |
| `scope` | string | `global` / `session` |
| `scope_id` | string | 作用域 ID |
| `instance_slot` | string | 实例槽位 |
| `preset_id` | string \| null | 关联预设 ID |
| `enabled` | boolean | 是否启用 |
| `params` | object \| null | 生成参数覆盖 |
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
      "enabled": true,
      "params": { "temperature": 0.8, "max_output_tokens": 1024 },
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

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 无效的槽位值 |

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
| `preset_id` | string \| null | 否 | 关联预设 ID |
| `enabled` | boolean | 否 | 是否启用（默认 `true`） |
| `params` | object \| null | 否 | 生成参数覆盖 |

`params` 可覆盖的字段：

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

### 请求示例

```json
{
  "scope": "global",
  "preset_id": null,
  "enabled": true,
  "params": { "temperature": 0.8, "max_output_tokens": 1024 }
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
    "enabled": true,
    "params": { "temperature": 0.8, "max_output_tokens": 1024 },
    "created_at": 1735689600000,
    "updated_at": 1735689660000
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 无效的槽位、缺少 session_id、参数校验失败 |

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

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 无效的槽位或缺少 session_id |
| `404` | 配置不存在 |

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
        "enabled": true,
        "params": { "temperature": 0.7 }
      },
      {
        "slot": "narrator",
        "source": "default",
        "scope": null,
        "config_id": null,
        "preset_id": null,
        "enabled": true,
        "params": null
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
