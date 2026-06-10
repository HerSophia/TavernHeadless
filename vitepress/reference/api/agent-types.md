---
outline: [2, 3]
---

# Agent Types（Workspace 级 Agent 类型）

Agent Type 是 Workspace 级的 Agent 模板。它定义一类 Agent 的默认 LLM、默认工具策略、默认 MCP 绑定、默认事件订阅和默认 grants（授权范围）。它本身不会运行；要真正启用，必须再到某个 Project 下创建 [Agent Binding](./project-agent-bindings)。

## 什么时候需要看这页

- 你要在某个 Workspace 下定义一个可被多个 Project 复用的 Agent 模板。
- 你要理解 Agent Type 和 Project Agent Binding 的分工。
- 你要确认 Agent 当前的安全输出边界。

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
| Agent Type | Workspace 级 Agent 模板，定义默认能力和默认配置 |
| `key` | Workspace 内唯一的模板标识，例如 `world.sim` |
| `scope_kind` | 这类 Agent 的作用域级别：`floor` / `session` / `project` / `workspace` |
| `defaults` | 模板默认值：默认 LLM、默认 Tool Policy、默认 MCP、默认事件订阅和默认 grants |
| grants | 授权范围。自由结构 JSON，其中 `allowed_output_targets` 和 `reads` 两个键由服务端校验 |
| `allowed_output_targets` | Agent 允许写到哪些安全目标。当前只允许安全目标，不允许写主叙事 |
| 禁用 | Agent Type 不再允许新启用或继续运行。当前不开放 DELETE，只允许 enable / disable |

## 响应格式说明

这组接口不使用通用的 `data` 包裹。列表接口返回 `{ "items": [...] }`，详情和写接口直接返回 Agent Type 对象。

## 安全边界

Agent 不能直接写主叙事正史。以下输出目标被硬性禁止：

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

在 `defaults.grants.allowed_output_targets` 中包含禁止目标时，服务端返回 `403 agent_allowed_output_target_forbidden`。

## Agent Type 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Agent Type ID |
| `workspace_id` | string | 所属 Workspace |
| `account_id` | string | 所属账号 |
| `key` | string | Workspace 内唯一标识，最长 120 字符 |
| `name` | string | 显示名称，最长 200 字符 |
| `scope_kind` | string | `floor` / `session` / `project` / `workspace` |
| `status` | string | `active` 或 `disabled` |
| `defaults` | object | 模板默认值，结构见下表 |
| `created_at` | integer | 创建时间戳（ms） |
| `updated_at` | integer | 更新时间戳（ms） |

### defaults

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `llm_profile_id` | string \| null | 默认 LLM Profile |
| `tool_policy_id` | string \| null | 默认 Tool Policy |
| `mcp_bindings` | array | 默认 MCP 绑定列表 |
| `mcp_bindings[].mcp_server_id` | string | MCP Server ID |
| `mcp_bindings[].allowed_tools` | string[] \| null | 允许的工具名列表。`null` 表示不限定 |
| `mcp_bindings[].config_override_json` | object \| null | MCP 配置覆盖 |
| `event_subscriptions` | array | 默认事件订阅列表 |
| `event_subscriptions[].type` | string | 事件类型，例如 `floor.committed` |
| `event_subscriptions[].filter_json` | object \| null | 订阅过滤条件 |
| `grants` | object | 授权范围。自由结构，`allowed_output_targets` 和 `reads` 由服务端校验 |
| `metadata` | object | 自定义元数据 |

## 列出 Agent Type

```http
GET /workspaces/:id/agent-types
```

### 响应 `200`

```json
{
  "items": [
    {
      "id": "agt_world_sim",
      "workspace_id": "ws_default_acc_1",
      "account_id": "acc_1",
      "key": "world.sim",
      "name": "World Sim",
      "scope_kind": "project",
      "status": "active",
      "defaults": {
        "llm_profile_id": null,
        "tool_policy_id": null,
        "mcp_bindings": [],
        "event_subscriptions": [
          { "type": "floor.committed", "filter_json": null }
        ],
        "grants": {
          "allowed_output_targets": ["derived_output", "project_inbox"]
        },
        "metadata": {}
      },
      "created_at": 1735689600000,
      "updated_at": 1735689600000
    }
  ]
}
```

## 读取单个 Agent Type

```http
GET /workspaces/:id/agent-types/:agent_type_id
```

### 响应 `200`

直接返回 [Agent Type](#agent-type-对象) 对象。

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `404` | `agent_type_not_found` | Agent Type 不存在或不属于当前账号 |

## 创建 Agent Type

```http
POST /workspaces/:id/agent-types
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `key` | string | 是 | Workspace 内唯一标识，1 - 120 字符 |
| `name` | string | 是 | 显示名称，1 - 200 字符 |
| `scope_kind` | string | 是 | `floor` / `session` / `project` / `workspace` |
| `defaults` | object | 否 | 模板默认值，结构同 [defaults](#defaults)。省略字段使用空默认值 |

### 请求示例

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

### 响应 `201`

返回创建后的 [Agent Type](#agent-type-对象) 对象。

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `403` | `agent_allowed_output_target_forbidden` | `defaults` 中包含禁止的输出目标 |
| `409` | `agent_type_key_conflict` | 同一 Workspace 下 `key` 冲突 |

## 更新 Agent Type

```http
PATCH /workspaces/:id/agent-types/:agent_type_id
```

### 请求体

三个字段都是可选的，只更新出现的字段：

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | 否 | 新名称 |
| `status` | string | 否 | `active` 或 `disabled` |
| `defaults` | object | 否 | 整体替换 defaults。注意这不是字段级合并 |

### 请求示例

```bash
curl -X PATCH http://localhost:3000/workspaces/ws_default_acc_1/agent-types/agt_world_sim \
  -H 'Content-Type: application/json' \
  -d '{ "name": "World Sim v2" }'
```

### 响应 `200`

返回更新后的 [Agent Type](#agent-type-对象) 对象。

## 禁用与启用

```http
POST /workspaces/:id/agent-types/:agent_type_id/disable
POST /workspaces/:id/agent-types/:agent_type_id/enable
```

两个接口都不需要请求体，成功时返回更新后的 Agent Type 对象。

仍有处于 enabled 状态的 Project Agent Binding 在使用时，禁用会失败并返回 `409 agent_type_in_use`。

## 权限

这组接口只允许账号身份调用：

- 账号身份（account actor）：允许
- Client 身份（client actor）：`403 agent_type_account_only`

## 错误码汇总

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `403` | `agent_type_account_only` | Workspace 级 Agent Type 管理只允许账号身份 |
| `403` | `agent_allowed_output_target_forbidden` | defaults 中包含禁止的输出目标 |
| `404` | `agent_type_not_found` | Agent Type 不存在 |
| `409` | `agent_type_key_conflict` | 同一 Workspace 下 `key` 冲突 |
| `409` | `agent_type_in_use` | 仍有 enabled 的 Project Agent Binding 正在使用，不能禁用 |

## 当前能力说明

- Agent Type 只是定义模板，不会直接执行。
- 具体 Agent Processor 还没有实现。
- 即使创建了 runtime job，占位 Processor 也会进入 dead letter（多次重试失败后停止重试的终态）。

## 相关页面

- 路由族总览：[Workspace / Project](./workspace-project)
- Project 级启用：[Project Agent Bindings](./project-agent-bindings)
- 生效配置视图：[Effective Config](./effective-config)
