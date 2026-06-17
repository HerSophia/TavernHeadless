---
outline: [2, 3]
---

# Project Agent Bindings（Project 级 Agent 启用）

Agent Binding 是某个 Project 对某个 [Agent Type](./agent-types) 的启用记录。Agent Type 只是模板；只有创建了 Binding，这个 Agent 才在该 Project 中可用。

Binding 上可以做 override（覆盖），但只能收窄：Project 级配置只能比 Agent Type 默认更少，不能更多。

## 什么时候需要看这页

- 你已经有一个 Workspace 级 Agent Type，想在某个 Project 中启用它。
- 你要手动 run 一个 Agent Binding。
- 你要理解 override 只能收窄、不能扩大的规则。

## 一个简单例子

```bash
curl -X POST http://localhost:3000/projects/proj_main/agent-bindings \
  -H 'Content-Type: application/json' \
  -d '{
    "agent_type_id": "agt_world_sim",
    "scope_kind": "project",
    "event_subscriptions": [
      { "type": "floor.committed" }
    ],
    "grants": {
      "allowed_output_targets": ["derived_output"]
    }
  }'
```

然后手动 run：

```bash
curl -X POST http://localhost:3000/projects/proj_main/agent-bindings/agb_001/run \
  -H 'Content-Type: application/json' \
  -d '{
    "dry_run": true,
    "trigger_reason": "manual-review"
  }'
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| Agent Binding | 某个 Project 对某个 Agent Type 的启用记录 |
| 收窄 override | Binding 上的配置只能是 Agent Type 默认值的子集，不能新增 |
| run | 手动创建一个 `agent.run` 后台作业 |
| `dry_run` | 试运行标记，默认 `true`。改成 `false` 时后台 Agent会真实执行并写入派生输出 |
| dead letter | 后台作业多次重试失败后停止重试的终态 |

## 响应格式说明

这组接口不使用通用的 `data` 包裹。列表接口返回 `{ "items": [...] }`，详情和写接口直接返回 Binding 对象，run 接口返回作业回执。

## 收窄规则

Binding 的这些字段都只能收窄，不能扩大 Agent Type 的默认上限：

| 字段 | 扩大时的错误 |
| ---- | ---- |
| `grants` | `403 agent_override_expands_grants` |
| `grants.allowed_output_targets` | `403 agent_override_expands_output_targets` |
| `event_subscriptions` | `403 agent_override_expands_subscriptions` |
| `mcp_bindings` | `403 agent_override_expands_mcp` |

例如 Agent Type 默认允许写 `derived_output` 和 `project_inbox`，Binding 可以只保留 `derived_output`，但不能加上 `client_data`。

## Agent Binding 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Binding ID |
| `workspace_id` | string | 所属 Workspace |
| `project_id` | string | 所属 Project |
| `account_id` | string | 所属账号 |
| `agent_type_id` | string | 绑定的 Agent Type |
| `status` | string | `enabled` / `disabled` / `error` |
| `scope_kind` | string | `floor` / `session` / `project` / `workspace` |
| `llm_profile_id` | string \| null | LLM Profile 覆盖 |
| `tool_policy_id` | string \| null | Tool Policy 覆盖 |
| `mcp_bindings` | array | MCP 绑定覆盖，结构同 Agent Type defaults |
| `event_subscriptions` | array | 事件订阅覆盖 |
| `grants` | object | 授权范围覆盖 |
| `metadata` | object | 自定义元数据 |
| `created_at` | integer | 创建时间戳（ms） |
| `updated_at` | integer | 更新时间戳（ms） |

## 列出 Binding

```http
GET /projects/:id/agent-bindings
```

需要 `project.agent.read` 权限。

### 响应 `200`

```json
{
  "items": [
    {
      "id": "agb_001",
      "workspace_id": "ws_default_acc_1",
      "project_id": "proj_main",
      "account_id": "acc_1",
      "agent_type_id": "agt_world_sim",
      "status": "enabled",
      "scope_kind": "project",
      "llm_profile_id": null,
      "tool_policy_id": null,
      "mcp_bindings": [],
      "event_subscriptions": [
        { "type": "floor.committed", "filter_json": null }
      ],
      "grants": {
        "allowed_output_targets": ["derived_output"]
      },
      "metadata": {},
      "created_at": 1735689600000,
      "updated_at": 1735689600000
    }
  ]
}
```

## 读取单个 Binding

```http
GET /projects/:id/agent-bindings/:binding_id
```

需要 `project.agent.read` 权限。响应直接返回 [Agent Binding](#agent-binding-对象) 对象。

## 创建 Binding

```http
POST /projects/:id/agent-bindings
```

需要 `project.agent.manage` 权限。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `agent_type_id` | string | 是 | 要启用的 Agent Type |
| `scope_kind` | string | 否 | `floor` / `session` / `project` / `workspace`。省略时沿用 Agent Type |
| `llm_profile_id` | string \| null | 否 | LLM Profile 覆盖 |
| `tool_policy_id` | string \| null | 否 | Tool Policy 覆盖 |
| `mcp_bindings` | array | 否 | MCP 绑定覆盖。只能收窄 |
| `event_subscriptions` | array | 否 | 事件订阅覆盖。只能收窄 |
| `grants` | object | 否 | 授权范围覆盖。只能收窄 |
| `metadata` | object | 否 | 自定义元数据 |

### 响应 `201`

返回创建后的 [Agent Binding](#agent-binding-对象) 对象。

## 更新 Binding

```http
PATCH /projects/:id/agent-bindings/:binding_id
```

需要 `project.agent.manage` 权限。请求体字段与创建相同（去掉 `agent_type_id`，可加 `status`），只更新出现的字段。收窄规则同样适用。

```bash
curl -X PATCH http://localhost:3000/projects/proj_main/agent-bindings/agb_001 \
  -H 'Content-Type: application/json' \
  -d '{ "event_subscriptions": [] }'
```

## 禁用与启用

```http
POST /projects/:id/agent-bindings/:binding_id/disable
POST /projects/:id/agent-bindings/:binding_id/enable
```

需要 `project.agent.manage` 权限。不需要请求体，成功时返回更新后的 Binding 对象。

## 手动 run

```http
POST /projects/:id/agent-bindings/:binding_id/run
```

需要 `project.agent.run` 权限。创建一个 `agent.run` 后台作业。

### 请求体

请求体可以省略。提供时：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `trigger_reason` | string \| null | 否 | `null` | 触发原因备注 |
| `dry_run` | boolean | 否 | `true` | 试运行标记 |
| `input_json` | object | 否 | - | 传给作业的输入数据 |

### 请求示例

```json
{
  "trigger_reason": "manual-review",
  "dry_run": true,
  "input_json": {
    "source": "api"
  }
}
```

### 响应 `202`

```json
{
  "job_id": "runtime-job:agent.run:...",
  "created": true,
  "agent_binding_id": "agb_001",
  "dedupe_key": null
}
```

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `job_id` | string | 后台作业 ID |
| `created` | boolean | `false` 表示命中去重，复用了已有作业 |
| `agent_binding_id` | string | 触发的 Binding |
| `dedupe_key` | string \| null | 去重键 |

## 权限

| 操作 | 所需权限 | owner | observer | deriver |
| ---- | ---- | ---- | ---- | ---- |
| 读取 | `project.agent.read` | 可以 | 可以 | 可以 |
| 创建、更新、禁用、启用 | `project.agent.manage` | 可以 | 不可以 | 不可以 |
| run | `project.agent.run` | 可以 | 不可以 | 不可以 |

## 错误码汇总

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `403` | `project_access_denied` | 当前 Project 角色没有权限 |
| `403` | `agent_override_expands_output_targets` | 输出目标扩大了默认上限 |
| `403` | `agent_override_expands_grants` | grants 扩大了默认上限 |
| `403` | `agent_override_expands_subscriptions` | 事件订阅扩大了默认上限 |
| `403` | `agent_override_expands_mcp` | MCP 绑定扩大了默认上限 |
| `404` | `binding_not_found` | Binding 不存在 |
| `404` | `project_not_found` | Project 不存在或不可见 |
| `409` | `binding_disabled` | Binding 已禁用，不能 run |
| `409` | `agent_type_disabled` | 绑定的 Agent Type 已禁用 |
| `409` | `agent_type_workspace_mismatch` | 作用域或 Workspace 不匹配 |

## 当前能力说明

- 手动 run 默认 `dry_run = true`，保持保守、可回退。
- 后台 Agent Processor 已可真实执行。`dry_run = false` 时会在 project / workspace scope 下执行并写入派生输出（如 `derived_output`）。
- 后台 Agent 不写主叙事正史，所有持久输出都经过受控的输出目标校验。
- run 之后的作业状态、错误与取消，可通过 [Agent Jobs（后台作业看板）](./project-agent-jobs) 查询。

## 相关页面

- 模板定义：[Agent Types](./agent-types)
- 后台作业看板：[Agent Jobs](./project-agent-jobs)
- 路由族总览：[Workspace / Project](./workspace-project)
- 生效配置视图：[Effective Config](./effective-config)
