---
outline: [2, 3]
---

# Projects（项目基础接口）

这一页只讲 Project 的基础读取面和成员管理面：列出 Project、读取详情、列出会话、查询事件、订阅事件流、维护成员。

Project 级的派生结果、收件箱、Agent 启用和设置覆盖各有自己的页面，请从[总览](./workspace-project)进入。

## 什么时候需要看这页

- 你要列出当前账号可访问的 Project。
- 你要查看某个 Project 下有哪些会话。
- 你要按顺序查询 Project Event，或用 SSE 持续订阅。
- 你要给 Project 增加或移除 observer、deriver 成员。

如果你只是普通聊天接入，不需要看这页。普通客户端创建会话时不需要传任何 Project 字段。

如果你要基于某个 Project 开一个不污染主叙事的研究、整理或候选起草容器，请看 [Temporary Conversations](./temporary-conversations)。那组接口会通过 `POST /projects/:id/temporary-conversations` 创建临时对话。

## 一个简单例子

```bash
# 列出当前账号可访问的 Project
curl 'http://localhost:3000/projects?status=active&limit=20'

# 读取某个 Project 下的会话
curl 'http://localhost:3000/projects/proj_main/sessions'

# 从头开始查询 Project Event
curl 'http://localhost:3000/projects/proj_main/events?after=0&limit=100'
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| Project | 工作区内的会话联动边界。一个 Project 下可以有多个 Session |
| `session_default` | 服务端为单个 Session 自动创建的 Project，区别于手动创建的 `manual` |
| Project Event | Project 范围内的事件摘要日志，带单调递增的 `sequence` |
| `after` | 事件查询游标。只返回 `sequence` 大于该值的事件 |
| observer | 只读成员。能看 Project、Session 摘要、事件和派生结果，不能写 |
| deriver | 派生成员。能写派生结果和收件箱条目，不能改主 Session |
| subject | 成员主体。可以是一个账号（`account`），也可以是一个 Client（`client`） |

## 响应格式说明

这组接口不使用通用的 `data` 包裹。列表接口返回 `items` 加游标字段，详情接口直接返回对象，成员写接口返回 `{ "item": ... }`。这是这组路由的既有契约，本页示例以实际响应为准。

## 公共类型

### Project

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Project ID |
| `workspace_id` | string | 所属 Workspace |
| `account_id` | string | 所属账号（owner） |
| `name` | string | 名称 |
| `description` | string \| null | 描述 |
| `kind` | string | `session_default` 或 `manual` |
| `status` | string | `active` 或 `archived` |
| `role` | string | 当前调用方在这个 Project 中的角色：`owner` / `observer` / `deriver` |
| `settings_override` | any | Project 级设置覆盖的原始 JSON |
| `created_at` | integer | 创建时间戳（ms） |
| `updated_at` | integer | 更新时间戳（ms） |

### Project Event

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 事件 ID |
| `workspace_id` | string | 所属 Workspace |
| `project_id` | string | 所属 Project |
| `sequence` | integer | Project 内单调递增序号，从 1 开始。查询和断点续传都用它 |
| `type` | string | 事件类型，例如 `floor.committed` |
| `visibility` | string | `project` / `owner` / `internal` |
| `source` | string | `api` / `runtime_job` / `migration` / `system` |
| `actor_account_id` | string \| null | 触发事件的账号 |
| `actor_client_id` | string \| null | 触发事件的 Client |
| `session_id` | string \| null | 关联会话 |
| `branch_id` | string \| null | 关联分支 |
| `floor_id` | string \| null | 关联楼层 |
| `page_id` | string \| null | 关联消息页 |
| `message_id` | string \| null | 关联消息 |
| `operation_log_id` | string \| null | 关联操作日志 |
| `correlation_id` | string \| null | 业务关联 ID |
| `causation_event_id` | string \| null | 引发本事件的上游事件 ID |
| `payload` | any | 事件摘要数据，不含完整正文 |
| `created_at` | integer | 创建时间戳（ms） |

事件可见性按角色过滤：owner 能看到 `project` 和 `owner` 两档，observer 和 deriver 只能看到 `project` 一档。`internal` 不对外返回。

### Project Member

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 成员记录 ID |
| `workspace_id` | string | 所属 Workspace |
| `project_id` | string | 所属 Project |
| `account_id` | string | 成员归属账号 |
| `role` | string | `owner` / `observer` / `deriver` |
| `status` | string | `active` 或 `removed` |
| `subject_type` | string | `account` 或 `client` |
| `subject_id` | string | 成员主体 ID |
| `client_id` | string \| null | 当主体是 Client 时的 Client ID |
| `created_by_account_id` | string \| null | 操作者账号 |
| `created_by_client_id` | string \| null | 操作者 Client |
| `created_at` | integer | 创建时间戳（ms） |
| `updated_at` | integer | 更新时间戳（ms） |

## 列出 Project

```http
GET /projects
```

### 查询参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `role` | string | 否 | - | 按角色过滤：`owner` / `observer` / `deriver` |
| `status` | string | 否 | `active` | `active` 或 `archived` |
| `limit` | integer | 否 | `50` | 每页条数，最大 `200` |
| `cursor` | string | 否 | - | 上一页返回的 `next_cursor` |

### 响应 `200`

```json
{
  "items": [
    {
      "id": "proj_main",
      "workspace_id": "ws_default_default-admin",
      "account_id": "default-admin",
      "name": "Campfire Project",
      "description": null,
      "kind": "manual",
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

`next_cursor` 不为 `null` 时，把它作为下一次请求的 `cursor` 即可翻页。

### 示例

```bash
curl 'http://localhost:3000/projects?role=observer'
```

## 读取 Project 详情

```http
GET /projects/:id
```

需要 `project.read` 权限。owner、observer、deriver 都可以读。

### 响应 `200`

直接返回 [Project](#project) 对象。

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `403` | `project_access_denied` | 当前角色没有读取权限 |
| `404` | `project_not_found` | Project 不存在，或当前调用方不是成员 |
| `409` | `project_archived` | Project 已归档 |

非成员访问时统一返回 `404 project_not_found`，不暴露资源存在性。

## 列出 Project 下的会话

```http
GET /projects/:id/sessions
```

### 查询参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `status` | string | 否 | - | `active` 或 `archived` |
| `limit` | integer | 否 | `50` | 每页条数，最大 `200` |
| `cursor` | string | 否 | - | 上一页返回的 `next_cursor` |

### 响应 `200`

```json
{
  "items": [
    {
      "id": "sess_001",
      "workspace_id": "ws_default_default-admin",
      "project_id": "proj_main",
      "title": "Campfire",
      "status": "active",
      "created_at": 1735689600000,
      "updated_at": 1735689600000
    }
  ],
  "next_cursor": null
}
```

这里返回的是会话摘要，不包含会话完整配置。需要完整会话对象时，再调用 `GET /sessions/:id`。

## 查询 Project Event

```http
GET /projects/:id/events
```

需要 `project.observe` 权限。

### 查询参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `after` | integer | 否 | `0` | 只返回 `sequence` 大于该值的事件 |
| `types` | string | 否 | - | 事件类型过滤，逗号分隔，例如 `floor.committed,session.archived` |
| `session_id` | string | 否 | - | 只看某个会话的事件。该会话必须属于这个 Project |
| `limit` | integer | 否 | `100` | 每页条数，最大 `500` |

### 响应 `200`

```json
{
  "items": [
    {
      "id": "pev_001",
      "workspace_id": "ws_default_default-admin",
      "project_id": "proj_main",
      "sequence": 12,
      "type": "floor.committed",
      "visibility": "project",
      "source": "api",
      "actor_account_id": "default-admin",
      "actor_client_id": null,
      "session_id": "sess_001",
      "branch_id": "main",
      "floor_id": "floor_012",
      "page_id": null,
      "message_id": null,
      "operation_log_id": "op_034",
      "correlation_id": null,
      "causation_event_id": null,
      "payload": { "floor_no": 12 },
      "created_at": 1735689600000
    }
  ],
  "next_after": 12,
  "has_more": false
}
```

轮询时把上一次的 `next_after` 作为下一次的 `after` 即可，不会漏也不会重。

### 示例

```bash
curl 'http://localhost:3000/projects/proj_main/events?after=12&types=floor.committed'
```

## 订阅 Project Event 流

```http
GET /projects/:id/events/stream
```

以 SSE（Server-Sent Events，服务器持续向客户端推送文本事件的 HTTP 长连接）返回事件。需要 `project.observe` 权限。

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `after` | integer | 否 | 断点续传游标。也可以改用 `Last-Event-ID` 请求头传同样的值 |
| `types` | string | 否 | 事件类型过滤，逗号分隔 |
| `session_id` | string | 否 | 只订阅某个会话的事件 |

### 流格式

连接建立后，服务端先补发 `after` 之后的全部历史事件，再切换到实时推送。每个事件块为：

```text
id: 13
event: floor.committed
data: {"id":"pev_002","sequence":13, ...}
```

- `id` 行是事件 `sequence`。客户端断线重连时把最后收到的值通过 `Last-Event-ID` 带回即可续传。
- `data` 行是与 `GET /projects/:id/events` 相同结构的事件 JSON。
- 服务端每 15 秒发送一行 `: heartbeat` 注释保持连接。
- 流内部出错时会发送 `event: error`，`data` 为 `{ "code", "message" }`。

### 示例

```bash
curl -N 'http://localhost:3000/projects/proj_main/events/stream?after=0'
```

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `404` | `project_not_found` | Project 不存在或不可见 |
| `503` | `feature_unavailable` | 服务端未启用事件流 |

## 列出成员

```http
GET /projects/:id/members
```

### 响应 `200`

```json
{
  "items": [
    {
      "id": "pm_001",
      "workspace_id": "ws_default_default-admin",
      "project_id": "proj_main",
      "account_id": "acc_observer",
      "role": "observer",
      "status": "active",
      "subject_type": "account",
      "subject_id": "acc_observer",
      "client_id": null,
      "created_by_account_id": "default-admin",
      "created_by_client_id": null,
      "created_at": 1735689600000,
      "updated_at": 1735689600000
    }
  ]
}
```

## 添加成员

```http
POST /projects/:id/members
```

只有 owner 可以调用。通过成员接口只能添加 `observer` 和 `deriver`，owner 身份由 Project 归属决定，不通过这组接口授予。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `role` | string | 是 | `observer` 或 `deriver` |
| `account_id` | string | 二选一 | 以账号为主体添加。等价于 `subject_type=account` |
| `subject_type` | string | 二选一 | `account` 或 `client`，与 `subject_id` 一起使用 |
| `subject_id` | string | 二选一 | 主体 ID |

`account_id` 与 `subject_type` + `subject_id` 必须提供其中一组。

### 请求示例

```bash
curl -X POST http://localhost:3000/projects/proj_main/members \
  -H 'Content-Type: application/json' \
  -d '{
    "account_id": "acc_observer",
    "role": "observer"
  }'
```

### 响应 `200`

```json
{
  "item": {
    "id": "pm_001",
    "project_id": "proj_main",
    "account_id": "acc_observer",
    "role": "observer",
    "status": "active",
    "subject_type": "account",
    "subject_id": "acc_observer",
    "client_id": null,
    "workspace_id": "ws_default_default-admin",
    "created_by_account_id": "default-admin",
    "created_by_client_id": null,
    "created_at": 1735689600000,
    "updated_at": 1735689600000
  }
}
```

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `400` | `project_member_role_not_supported` | 成员接口只支持 `observer` 和 `deriver` |
| `400` | `project_member_owner_role_conflict` | 不能把 owner 添加为成员，也不能降级 owner |
| `400` | `project_member_subject_invalid` | `subject_type` 不是 `account` 或 `client` |
| `400` | `project_member_default_client_owner_conflict` | owner 的默认 Client 不能再作为成员添加 |
| `404` | `project_member_client_not_found` | 主体 Client 不存在 |
| `409` | `project_member_role_conflict` | 该主体已经持有成员角色 |
| `409` | `project_member_client_not_found` | 主体 Client 已被禁用 |

## 移除成员

```http
DELETE /projects/:id/members/:subject_type/:subject_id
```

`subject_type` 为 `account` 或 `client`。另有一条旧路径继续可用：

```http
DELETE /projects/:id/members/:account_id
```

旧路径等价于 `subject_type=account`。

### 响应 `200`

```json
{
  "item": {
    "id": "pm_001",
    "role": "observer",
    "status": "removed",
    "subject_type": "account",
    "subject_id": "acc_observer",
    "project_id": "proj_main",
    "workspace_id": "ws_default_default-admin",
    "account_id": "acc_observer",
    "client_id": null,
    "created_by_account_id": "default-admin",
    "created_by_client_id": null,
    "created_at": 1735689600000,
    "updated_at": 1735689700000
  }
}
```

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `400` | `project_member_owner_remove_not_supported` | 不能通过成员接口移除 owner |
| `404` | `project_member_not_found` | 成员不存在 |

## 相关页面

- 路由族总览：[Workspace / Project](./workspace-project)
- 派生结果：[Project Derived Outputs](./projects-derived-outputs)
- 收件箱：[Project Inbox](./projects-inbox)
- Agent 启用：[Project Agent Bindings](./project-agent-bindings)
- 设置覆盖：[Project Settings](./project-settings)
