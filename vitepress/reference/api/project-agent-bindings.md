---
outline: [2, 3]
---

# Project Agent Bindings（Project 级 Agent 启用）

## 什么时候需要看这页

- 你已经有一个 Workspace 级 Agent Type，想在某个 Project 中启用它。
- 你要手动 run 一个 Agent Binding。
- 你要理解阶段五 override 只能收窄，不能扩大。

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
| Agent Binding | 某个 Project 对某个 Agent Type 的启用记录。 |
| 收窄 override | Project 级配置只能比 Agent Type 默认更少，不能更多。 |
| dry_run | 阶段五默认 `true`。即使改成 `false`，当前占位 Processor 也不会真正执行。 |
| run | 手动创建一个 `agent.run` runtime job。 |

## 收窄规则

Project Binding 的这些字段都只能收窄：

- `grants`
- `allowed_output_targets`
- `event_subscriptions`
- `mcp_bindings`

不能扩大 Workspace Agent Type 的默认上限。

## 接口

### GET /projects/:id/agent-bindings

列出 Project 下所有 Agent Binding。

### GET /projects/:id/agent-bindings/:binding_id

读取单个 Agent Binding。

### POST /projects/:id/agent-bindings

创建 Agent Binding。

### PATCH /projects/:id/agent-bindings/:binding_id

更新 Agent Binding。

### POST /projects/:id/agent-bindings/:binding_id/disable

禁用 Agent Binding。

### POST /projects/:id/agent-bindings/:binding_id/enable

启用 Agent Binding。

### POST /projects/:id/agent-bindings/:binding_id/run

手动触发 Agent Binding，创建一个 `agent.run` 后台作业。

#### run 请求体

```json
{
  "trigger_reason": "manual-review",
  "dry_run": true,
  "input_json": {
    "source": "api"
  }
}
```

#### run 响应

```json
{
  "job_id": "runtime-job:agent.run:...",
  "created": true,
  "agent_binding_id": "agb_001",
  "dedupe_key": null
}
```

## 权限

- `GET /projects/:id/agent-bindings*` 需要 `project.agent.read`
- `POST/PATCH/disable/enable` 需要 `project.agent.manage`
- `POST .../run` 需要 `project.agent.run`

角色矩阵：

- owner：可读、可管理、可 run
- observer：只可读
- deriver：只可读

## 常见错误码

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| `404` | `binding_not_found` | Agent Binding 不存在 |
| `409` | `binding_disabled` | Binding 已禁用，不能 run |
| `409` | `agent_type_disabled` | 绑定的 Agent Type 已禁用 |
| `409` | `agent_type_workspace_mismatch` | 作用域或 Workspace 不匹配 |
| `403` | `agent_override_expands_output_targets` | 输出目标扩大了默认上限 |
| `403` | `agent_override_expands_grants` | grants 扩大了默认上限 |
| `403` | `agent_override_expands_subscriptions` | 事件订阅扩大了默认上限 |
| `403` | `agent_override_expands_mcp` | MCP 绑定扩大了默认上限 |
| `403` | `project_access_denied` | 当前 Project 角色没有权限 |

## 当前阶段说明

- `enqueueManual` 默认 `dry_run = true`。
- 当前 Agent Processor 还是占位实现。
- Worker 处理 `agent.run` 时会进入 dead letter。
- 这组接口是为后续自动化调度做准备，不代表 Agent 已具备真实执行能力。
