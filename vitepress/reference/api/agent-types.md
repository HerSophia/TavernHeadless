---
outline: [2, 3]
---

# Agent Types（Workspace 级 Agent 类型）

## 什么时候需要看这页

- 你要在某个 Workspace 下定义一个可被多个 Project 复用的 Agent 模板。
- 你要理解 Agent Type 和 Project Agent Binding 的分工。
- 你要确认阶段五 Agent 的安全边界。

如果你只是想在某个 Project 中启用已经存在的 Agent，请优先看 [Project Agent Bindings](./project-agent-bindings)。

## 一个简单例子

先在 Workspace 下注册一个 Agent Type：

```bash
curl -X POST http://localhost:3000/workspaces/ws_default_acc_1/agent-types \
  -H 'Content-Type: application/json' \
  -d '{
    "key": "world.sim",
    "name": "World Sim",
    "scope_kind": "project",
    "defaults": {
      "event_subscriptions": [
        { "type": "floor.committed" }
      ],
      "grants": {
        "allowed_output_targets": ["derived_output", "project_inbox"]
      }
    }
  }'
```

成功后，它还不会运行。要真正启用，必须再到某个 Project 下创建 Agent Binding。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| Agent Type | Workspace 级 Agent 模板，定义默认能力和默认配置。 |
| defaults | Agent Type 的默认 LLM、默认 Tool Policy、默认 MCP、默认事件订阅和默认 grants。 |
| allowed_output_targets | Agent 允许写到哪些安全目标。阶段五只允许安全目标，不允许写主叙事。 |
| 禁用 | Agent Type 不再允许新启用或继续运行。阶段五不开放 DELETE，只允许 enable/disable。 |

## 安全边界

阶段五 Agent 不能直接写主叙事正史。以下输出目标被硬性禁止：

- `session_messages`
- `floor`
- `page_active`
- `variable_live`
- `memory_live`
- `session_state_live_head`

当前允许的安全输出目标是：

- `page_staged_write`
- `derived_output`
- `project_inbox`
- `session_state_proposal`
- `client_data`
- `plugin_data`

## 接口

### GET /workspaces/:id/agent-types

列出某个 Workspace 下的 Agent Type。

### GET /workspaces/:id/agent-types/:agent_type_id

读取单个 Agent Type。

### POST /workspaces/:id/agent-types

创建 Agent Type。

#### 请求体

```json
{
  "key": "world.sim",
  "name": "World Sim",
  "scope_kind": "project",
  "defaults": {
    "llm_profile_id": null,
    "tool_policy_id": null,
    "mcp_bindings": [],
    "event_subscriptions": [
      { "type": "floor.committed" }
    ],
    "grants": {
      "allowed_output_targets": ["derived_output", "project_inbox"]
    },
    "metadata": {}
  }
}
```

### PATCH /workspaces/:id/agent-types/:agent_type_id

更新名称、状态或 defaults。

### POST /workspaces/:id/agent-types/:agent_type_id/disable

禁用 Agent Type。

### POST /workspaces/:id/agent-types/:agent_type_id/enable

重新启用 Agent Type。

## 权限

这组接口只允许账号 actor 调用。

- account actor：允许
- client actor：`403 agent_type_account_only`

## 常见错误码

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| `403` | `agent_type_account_only` | Workspace 级 Agent Type 管理只允许账号 actor |
| `404` | `agent_type_not_found` | Agent Type 不存在 |
| `409` | `agent_type_key_conflict` | 同一 Workspace 下 `key` 冲突 |
| `409` | `agent_type_in_use` | 仍有 enabled 的 Project Agent Binding 正在使用，不能禁用 |
| `403` | `agent_allowed_output_target_forbidden` | defaults 中包含禁止的输出目标 |

## 当前阶段说明

- Agent Type 只是定义模板，不会直接执行。
- 具体 Agent Processor 还没有实现。
- 后续即使创建了 runtime job，占位 Processor 也会进入 dead letter。
