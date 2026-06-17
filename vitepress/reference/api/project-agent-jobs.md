---
outline: [2, 3]
---

# Project Agent Jobs（后台 Agent 作业看板）

这组接口用于查看和管理某个 Project 下的后台 Agent 作业（`agent.run`）。它是面向高级开发者的运维视图，不是普通聊天界面接口。

后台 Agent 作业由两种方式产生：事件自动触发（见 [Agent Bindings](./project-agent-bindings)）或手动 run。作业进入 Background Job Runtime 串行执行，这组接口让你按 Project 维度查询作业状态、错误，以及取消尚未运行的作业。

## 什么时候需要看这页

- 你触发了后台 Agent，想确认它执行到哪一步、是否成功。
- 某个作业失败进入 dead letter，你要查看错误原因。
- 你要取消一个尚未运行的后台作业。

如果你只是想启用 Agent 或手动 run，先看 [Agent Bindings](./project-agent-bindings)。

## 一个简单例子

列出某个 Project 的后台 Agent 作业：

```bash
curl http://localhost:3000/projects/proj_main/agent-jobs \
  -H 'x-api-key: <your-key>'
```

查看单个作业：

```bash
curl http://localhost:3000/projects/proj_main/agent-jobs/<job_id> \
  -H 'x-api-key: <your-key>'
```

取消一个尚未运行的作业：

```bash
curl -X POST http://localhost:3000/projects/proj_main/agent-jobs/<job_id>/cancel \
  -H 'x-api-key: <your-key>'
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| 后台 Agent 作业 | 一条 `agent.run` 类型的后台作业记录 |
| `dry_run` | 试运行标记。`true` 只演练不写输出，`false` 真实执行并写派生输出 |
| dead letter | 作业因配置非法、权限越界或多次重试失败而停止的终态 |
| scope | 作业的串行域，后台 Agent 使用 `${workspace_id}:${project_id}:${agent_type_id}` |
| 派生输出 | Agent 产出的 `derived_output` 等非主叙事数据 |

## 响应格式说明

这组接口不使用通用的 `data` 包裹。列表接口返回 `{ "items": [...], "total": <number> }`，详情和取消接口直接返回作业对象。

## Agent Job 对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 作业 ID |
| `status` | string | 作业状态，见下方枚举 |
| `phase` | string \| null | 作业内部阶段标识 |
| `attempt_count` | integer | 已尝试次数 |
| `max_attempts` | integer | 最大尝试次数 |
| `available_at` | integer \| null | 下次可执行时间戳（ms） |
| `started_at` | integer \| null | 开始执行时间戳（ms） |
| `finished_at` | integer \| null | 结束时间戳（ms） |
| `last_error` | string \| null | 最近一次错误信息 |
| `last_error_code` | string \| null | 最近一次错误码 |
| `last_error_class` | string \| null | 错误分类，如 `fatal` / `retryable` / `uncertain` |
| `created_at` | integer | 创建时间戳（ms） |
| `updated_at` | integer | 更新时间戳（ms） |
| `agent_type_id` | string \| null |触发作业的 Agent Type |
| `agent_binding_id` | string \| null | 触发作业的 Agent Binding |
| `source_event_id` | string \| null | 触发作业的事件 ID（手动 run 时为 `null`） |
| `trigger_type` | string \| null | 触发方式，如 `event` / `manual` |
| `dry_run` | boolean | 是否试运行 |
| `delivery_targets` | array | 作业声明的输出目标列表 |
| `result` | object \| null | 作业结果摘要 |

### 状态枚举

`"pending"` | `"leased"` | `"running"` | `"retry_waiting"` | `"succeeded"` | `"dead_letter"` | `"cancelled"`

## 列出 Agent 作业

```http
GET /projects/:id/agent-jobs
```

需要 `project.agent.read` 权限。只返回属于该 Project 的后台 Agent作业。

### 查询参数

| 参数 |类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `status` | string | 否 | - | 按状态过滤，取值见状态枚举 |
| `limit` | integer | 否 | 服务端默认 | 返回数量上限，最大 100 |
| `offset` | integer | 否 | `0` | 偏移量 |

### 响应 `200`

```json
{
  "items": [
    {
      "id": "runtime-job:agent.run:...",
      "status": "succeeded",
      "phase": null,
  "attempt_count": 1,
      "max_attempts": 5,
      "available_at": null,
      "started_at": 1735689600000,
      "finished_at": 1735689601000,
      "last_error": null,
      "last_error_code": null,
      "last_error_class": null,
      "created_at": 1735689600000,
      "updated_at": 1735689601000,
      "agent_type_id": "agt_world_sim",
      "agent_binding_id": "agb_001",
      "source_event_id": "evt_123",
      "trigger_type": "event",
      "dry_run": false,
      "delivery_targets": ["derived_output"],
      "result": null
    }
  ],
  "total": 1
}
```

## 读取单个作业

```http
GET /projects/:id/agent-jobs/:job_id
```

需要 `project.agent.read` 权限。响应直接返回 [Agent Job](#agent-job-对象) 对象。作业不属于该 Project 时返回 `404`。

## 取消作业

```http
POST /projects/:id/agent-jobs/:job_id/cancel
```

需要 `project.agent.run` 权限。只能取消尚未运行的作业（`pending` 或 `retry_waiting`）。不需要请求体，成功时返回更新后的作业对象，`status` 变为 `cancelled`。

已经在运行、已成功或已进入 dead letter 的作业不能取消，会返回 `409`。

## 权限

| 操作 | 所需权限 | owner | observer | deriver |
| ---- | ---- | ---- | ---- | ---- |
| 列表、详情 | `project.agent.read` | 可以 | 可以 | 可以 |
| 取消 | `project.agent.run` | 可以 | 不可以 | 不可以 |

## 错误码汇总

| 状态码 | `error.code` |说明 |
| ---- | ---- | ---- |
| `403` | `project_access_denied` | 当前 Project 角色没有权限 |
| `404` | `project_not_found` | Project 不存在或不可见 |
| `404` | `project_agent_job_not_found` | 作业不存在或不属于该 Project |
| `409` |`project_agent_job_invalid_state` | 作业当前状态不允许取消 |

## 相关页面

- 启用与手动 run：[Agent Bindings](./project-agent-bindings)
- 模板定义：[Agent Types](./agent-types)
- 数据模型：[数据库结构](../database)
