---
outline: [2, 3]
---

# Workspace / Project（工作区与项目）

Workspace 和 Project 是账号下的两层组织边界。
Workspace 用于归拢资产、配置和插件；Project 用于把一组会话、事件和 observer 只读访问圈在一起。

当前处于阶段二：已经有 Project Event、Project observer 和 Project 读取接口，但仍不开放完整 Workspace 成员体系，也不开放 Project CRUD 管理 API。

如果你只想搞清楚普通聊天流程里哪些地方会接触到 Workspace / Project，直接看[兼容规则](#兼容规则)。

## 什么时候需要看这页

- 你是高级接入方，想按 Project 查看会话。
- 你需要读取 Project Event，或用 SSE 订阅 Project Event。
- 你需要给某个账号增加 observer，让它只读查看 Project。
- 你需要理解 owner、observer 和非成员的访问差异。
- 你需要在调用 `POST /sessions` 时把新会话放入一个已知的 Project。

## 一个简单例子

普通客户端创建会话时仍然不需要传任何 Workspace / Project 字段：

```bash
curl -X POST http://localhost:3000/sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Campfire",
    "character_id": "char_001",
    "user_id": "usr_001",
    "preset_id": "preset_001"
  }'
```

服务端会自动使用当前账号默认 Workspace，并为这个 Session 创建 `session_default` Project。

如果你已经知道目标 Project，可以传 `project_id`：

```bash
curl -X POST http://localhost:3000/sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Campfire",
    "character_id": "char_001",
    "user_id": "usr_001",
    "preset_id": "preset_001",
    "project_id": "proj_main"
  }'
```

之后可以读取这个 Session 的归属：

```bash
curl http://localhost:3000/sessions/sess_001/scope
```

也可以读取 Project 事件：

```bash
curl 'http://localhost:3000/projects/proj_main/events?after=0&limit=100'
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| Workspace | 账号下的资产管理边界。每个账号有且只有一个默认 Workspace。 |
| Project | 工作区内的会话联动边界。一个 Project 下可以有多个 Session。 |
| owner | Project 所属账号。可以读写 Project 下资源。 |
| observer | Project 观察者。只能读取，不能写入。 |
| Project Event | Project 范围内的事件摘要日志，可通过 HTTP 查询或 SSE 订阅。 |
| `project` visibility | owner 和 observer 都可见的 Project Event。 |
| `owner` visibility | 只有 owner 可见的 Project Event。 |
| `internal` visibility | 内部保留事件，不通过普通 Project 读取接口返回。 |
| `session_default` | 普通会话自动创建的默认 Project 类型。 |

补充说明：

- owner 可以看到 `visibility=project` 和 `visibility=owner` 的 Project Event。
- observer 只能看到 `visibility=project` 的 Project Event。
- observer 不能修改 Session、Floor、Page、Message、Variable、Memory 等 Project 下资源。
- 非成员访问 Project 下资源时，服务端继续隐藏资源存在性。Project API 通常返回 `404 project_not_found`，旧资源路由通常返回 `404 not_found`。

## 当前公开边界

当前公开面如下：

- `POST /sessions` 请求体增加可选 `project_id`。
- `GET /sessions/:id/scope` 读取 Session 的 Workspace / Project 归属。
- `GET /projects` 列出当前账号可访问的 Project。
- `GET /projects/:id` 读取 Project 详情。
- `GET /projects/:id/sessions` 列出 Project 下的 Session 摘要。
- `GET /projects/:id/events` 查询 Project Event。
- `GET /projects/:id/events/stream` 通过 SSE 订阅 Project Event。
- `GET /projects/:id/members` 列出 Project 成员。
- `POST /projects/:id/members` 增加 observer。
- `DELETE /projects/:id/members/:account_id` 移除 observer。

阶段二明确不做：

- 完整 Workspace 成员体系。
- 完整 `GET/POST/PATCH /workspaces` 管理 API。
- 完整 `POST/PATCH/DELETE /projects` 管理 API。
- Project 级 LLM、MCP、Tool 策略覆盖。
- client identity、deriver、derived output 或插件启用系统。

## 公共类型

### Project

```json
{
  "id": "proj_main",
  "workspace_id": "ws_default_acc_1",
  "account_id": "acc_1",
  "name": "Main Project",
  "description": null,
  "kind": "session_default",
  "status": "active",
  "role": "owner",
  "settings_override": {},
  "created_at": 1735689600000,
  "updated_at": 1735689600000
}
```

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Project ID |
| `workspace_id` | string | 所属 Workspace ID |
| `account_id` | string | Project owner 账号 ID |
| `name` | string | Project 名称 |
| `description` | string \| null | Project 描述 |
| `kind` | string | `session_default` 或 `manual` |
| `status` | string | `active` 或 `archived` |
| `role` | string | 当前请求账号在该 Project 中的角色：`owner` 或 `observer` |
| `settings_override` | object | Project 设置覆盖。阶段二暂不开放完整管理能力 |
| `created_at` | integer | 创建时间戳（ms） |
| `updated_at` | integer | 更新时间戳（ms） |

### ProjectSessionSummary

```json
{
  "id": "sess_001",
  "workspace_id": "ws_default_acc_1",
  "project_id": "proj_main",
  "title": "Campfire",
  "status": "active",
  "created_at": 1735689600000,
  "updated_at": 1735689700000
}
```

### ProjectEvent

```json
{
  "id": "evt_001",
  "workspace_id": "ws_default_acc_1",
  "project_id": "proj_main",
  "sequence": 1,
  "type": "session.created",
  "visibility": "project",
  "source": "api",
  "actor_account_id": "acc_1",
  "session_id": "sess_001",
  "branch_id": null,
  "floor_id": null,
  "page_id": null,
  "message_id": null,
  "operation_log_id": "op_001",
  "correlation_id": null,
  "causation_event_id": null,
  "payload": {
    "session_id": "sess_001"
  },
  "created_at": 1735689600000
}
```

### ProjectMember

```json
{
  "id": "pmem_001",
  "workspace_id": "ws_default_acc_1",
  "project_id": "proj_main",
  "account_id": "acc_observer",
  "role": "observer",
  "status": "active",
  "created_by_account_id": "acc_1",
  "created_at": 1735689600000,
  "updated_at": 1735689600000
}
```

## GET /projects

列出当前账号可访问的 Project。owner 和 observer 都会出现在结果中。

### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- |
| `role` | string | - | 可选，`owner` 或 `observer` |
| `status` | string | `active` | `active` 或 `archived` |
| `limit` | integer | `50` | 每页数量，1-200 |
| `cursor` | string | - | 上一页返回的 `next_cursor` |

### 响应 `200`

```json
{
  "items": [
    {
      "id": "proj_main",
      "workspace_id": "ws_default_acc_1",
      "account_id": "acc_1",
      "name": "Main Project",
      "description": null,
      "kind": "session_default",
      "status": "active",
      "role": "owner",
      "settings_override": {},
      "created_at": 1735689600000,
      "updated_at": 1735689600000
    }
  ],
  "next_cursor": null
}
```

## GET /projects/:id

读取 Project 详情。Project 成员可读。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Project ID |

### 响应 `200`

返回一个 `Project` 对象。

## GET /projects/:id/sessions

列出 Project 下的 Session 摘要。Project 成员可读。

### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- |
| `status` | string | - | 可选，`active` 或 `archived` |
| `limit` | integer | `50` | 每页数量，1-200 |
| `cursor` | string | - | 上一页返回的 `next_cursor` |

### 响应 `200`

```json
{
  "items": [
    {
      "id": "sess_001",
      "workspace_id": "ws_default_acc_1",
      "project_id": "proj_main",
      "title": "Campfire",
      "status": "active",
      "created_at": 1735689600000,
      "updated_at": 1735689700000
    }
  ],
  "next_cursor": null
}
```

## GET /sessions/:id/scope

读取 Session 的 Workspace / Project 归属。owner 和 observer 都可以读取自己可访问 Project 下的 Session scope。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Session ID |

### 响应 `200`

```json
{
  "session_id": "sess_001",
  "workspace_id": "ws_default_acc_1",
  "project_id": "proj_main"
}
```

## GET /projects/:id/events

查询 Project Event。Project owner 可见 `project` 和 `owner` 事件；observer 只可见 `project` 事件。

### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- |
| `after` | integer \| string | `0` | 只返回 sequence 大于该值的事件 |
| `types` | string | - | 逗号分隔的事件类型，最多 20 个 |
| `session_id` | string | - | 只返回某个 Session 相关的事件。该 Session 必须属于当前 Project |
| `limit` | integer | `100` | 每页数量，1-500 |

### 响应 `200`

```json
{
  "items": [
    {
      "id": "evt_001",
      "workspace_id": "ws_default_acc_1",
      "project_id": "proj_main",
      "sequence": 1,
      "type": "session.created",
      "visibility": "project",
      "source": "api",
      "actor_account_id": "acc_1",
      "session_id": "sess_001",
      "branch_id": null,
      "floor_id": null,
      "page_id": null,
      "message_id": null,
      "operation_log_id": "op_001",
      "correlation_id": null,
      "causation_event_id": null,
      "payload": { "session_id": "sess_001" },
      "created_at": 1735689600000
    }
  ],
  "next_after": 1,
  "has_more": false
}
```

## GET /projects/:id/events/stream

通过 SSE 订阅 Project Event。

### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- |
| `after` | integer \| string | `0` | 只推送 sequence 大于该值的事件 |
| `types` | string | - | 逗号分隔的事件类型，最多 20 个 |
| `session_id` | string | - | 只推送某个 Session 相关事件 |

### 请求头

| Header | 必填 | 说明 |
| ---- | ---- | ---- |
| `Accept: text/event-stream` | 建议 | 表示客户端希望读取 SSE |
| `Last-Event-ID` | 否 | 当未传 `after` 时，可用它恢复上次 sequence 之后的事件 |

### SSE 帧

服务端使用事件类型作为 SSE event 名称，使用 sequence 作为 SSE id：

```text
id: 1
event: session.created
data: {"id":"evt_001","project_id":"proj_main","sequence":1,"type":"session.created"}

: heartbeat

```

说明：

- `data` 是一个 `ProjectEvent` JSON。
- 心跳使用 SSE comment：`: heartbeat`。
- 如果服务端在流内发生错误，会发送 `event: error`。

## GET /projects/:id/members

列出 Project 成员。Project 成员可读。

### 响应 `200`

```json
{
  "items": [
    {
      "id": "pmem_001",
      "workspace_id": "ws_default_acc_1",
      "project_id": "proj_main",
      "account_id": "acc_observer",
      "role": "observer",
      "status": "active",
      "created_by_account_id": "acc_1",
      "created_at": 1735689600000,
      "updated_at": 1735689600000
    }
  ]
}
```

## POST /projects/:id/members

增加 Project observer。只有 owner 可以调用。阶段二只支持新增 observer，不支持新增其他角色。

### 请求体

```json
{
  "account_id": "acc_observer",
  "role": "observer"
}
```

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `account_id` | string | 是 | 要加入的账号 ID |
| `role` | string | 是 | 阶段二只支持 `observer` |

### 响应 `201`

```json
{
  "item": {
    "id": "pmem_001",
    "workspace_id": "ws_default_acc_1",
    "project_id": "proj_main",
    "account_id": "acc_observer",
    "role": "observer",
    "status": "active",
    "created_by_account_id": "acc_1",
    "created_at": 1735689600000,
    "updated_at": 1735689600000
  }
}
```

## DELETE /projects/:id/members/:account_id

移除 Project observer。只有 owner 可以调用。阶段二不支持移除 owner。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Project ID |
| `account_id` | string | 要移除的成员账号 ID |

### 响应 `200`

```json
{
  "item": {
    "id": "pmem_001",
    "workspace_id": "ws_default_acc_1",
    "project_id": "proj_main",
    "account_id": "acc_observer",
    "role": "observer",
    "status": "removed",
    "created_by_account_id": "acc_1",
    "created_at": 1735689600000,
    "updated_at": 1735689700000
  }
}
```

## 错误码

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| `400` | `invalid_cursor` | Project 或 Project Session 分页 cursor 无效 |
| `400` | `invalid_event_cursor` | Project Event cursor 不是非负整数 |
| `400` | `project_member_role_not_supported` | 阶段二只支持新增 observer |
| `400` | `project_member_owner_remove_not_supported` | 阶段二不支持移除 owner |
| `400` | `session_project_mismatch` | `session_id` 不属于当前 Project |
| `403` | `project_access_denied` | 当前账号是成员，但角色不允许执行该动作，如 observer 写入 |
| `404` | `project_not_found` | Project 不存在，或对当前账号不可见 |
| `404` | `not_found` | 兼容旧账号隔离时隐藏资源存在性 |
| `409` | `project_archived` | Project 已归档，不能执行需要 active Project 的动作 |
| `503` | `feature_unavailable` | Project Event SSE 在当前服务实例不可用 |

## 与官方 SDK 的关系

`@tavern/sdk` 已经封装 Project 相关方法：

```ts
const projects = await client.projects.list({ role: "observer" });
const project = await client.projects.get({ projectId: "proj_main" });
const sessions = await client.projects.listSessions({ projectId: "proj_main" });
const scope = await client.sessions.getScope({ sessionId: "sess_001" });

const events = await client.projects.listEvents({
  projectId: "proj_main",
  after: 0,
  types: ["session.created", "message.updated"],
});

let cursor = events.nextAfter;
await client.projects.streamEvents({
  projectId: "proj_main",
  lastEventId: cursor ?? undefined,
  onEvent(event) {
    cursor = event.sequence;
  },
});

await client.projects.addObserver({
  projectId: "proj_main",
  observerAccountId: "acc_observer",
});

await client.projects.removeMember({
  projectId: "proj_main",
  memberAccountId: "acc_observer",
});
```

`@tavern/client-helpers` 提供 Project Event 纯函数辅助：

```ts
import {
  applyProjectEventCursor,
  dedupeProjectEvents,
  getProjectEventCursor,
  isProjectEvent,
} from "@tavern/client-helpers";
```

这些 helper 不发请求，也不绑定 Vue、React、Pinia 或 TanStack Query。

## 兼容规则

以下规则保证旧客户端和旧脚本继续可用：

- 普通客户端创建和使用会话时，不需要传 `workspace_id` 或 `project_id`。
- `POST /sessions` 不传 `project_id` 时，服务端使用当前账号默认 Workspace，并为新 Session 创建 `session_default` Project。
- Session 的默认响应不新增 `workspace_id` 和 `project_id` 字段。
- Prompt Asset、LLM、MCP、Tool 旧配置 API 不传 `workspace_id` 时默认写当前账号默认 Workspace。
- 旧 `global` 配置语义保持不变：表示当前账号默认 Workspace 的默认配置。
- 不因为 Session 归属于某个 Project 而隐式双写 Project 级配置。
- 不因为当前请求来自某个 Session 上下文而隐式改变资产、配置的读写目标作用域。

如果只需要普通聊天能力，可以继续忽略 Workspace / Project。若需要了解引入工作区的设计动机，可以看 [为什么需要工作区？](/ideas/why-workspace)。
