---
outline: [2, 3]
---

# Project Inbox（项目收件箱）

Project Inbox 用来保存 Project 范围内的待处理建议或通知。它主要给 deriver 提交结果、解释、变更建议或人工确认请求。

接受 Inbox 条目只表示 owner 已经记录这次决策。它不会自动把 `payload` 合并到主 Session，
也不会自动写入 Variable、Memory 或 Session State。

## 什么时候需要看这页

- 你要让 deriver 向 Project owner 提交待确认事项。
- 你要让 owner 接受、拒绝或归档某条建议。
- 你需要保存建议的 JSON payload，但不希望它自动修改主聊天状态。
- 你需要理解 Inbox 决策事件和审计日志。

如果你要直接修改会话正文、变量、记忆或 Session State，请调用对应资源接口，不要把 Inbox 当作自动合并接口。

## 一个简单例子

Deriver 创建一个 Inbox 条目：

```bash
curl -X POST http://localhost:3000/projects/proj_main/inbox \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "derived_output.review",
    "title": "候选摘要待确认",
    "payload": {
      "derived_output_id": "dout_001",
      "suggested_action": "review"
    },
    "source_session_id": "sess_001"
  }'
```

Owner 接受该条目：

```bash
curl -X PATCH http://localhost:3000/projects/proj_main/inbox/pinbox_001 \
  -H 'Content-Type: application/json' \
  -d '{
    "decision": "accept",
    "note": "已记录。稍后由应用层决定是否写入主会话。"
  }'
```

这一步只更新 Inbox 状态，不会修改 Session。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| Inbox Item | Project 范围内的一条待处理建议或通知 |
| sender | 创建该 Inbox 条目的账号 |
| decision | owner 对条目的处理动作：`accept`、`reject` 或 `archive` |
| source | 可选来源引用，可以指向同一 Project 内的 Event、Session、Floor 或 Page |
| payload | 条目携带的 JSON 负载，默认最大 256 KiB |

## 权限与边界

| 角色 | 读取 | 创建 | 决策 |
| ---- | ---- | ---- | ---- |
| owner | 可以读取全部 | 可以 | 可以 |
| deriver | 只能读取自己发送的条目 | 可以 | 不可以 |
| observer | 不可以 | 不可以 | 不可以 |
| 非成员 | 不可见 | 不可见 | 不可见 |

补充规则：

- 非成员访问时，Project API 通常返回 `404 project_not_found`。
- Project 已归档时，接口返回 `409 project_archived`。
- `payload` 必须可以被 JSON 序列化，默认最大 256 KiB。
- `source_event_id` 必须属于当前 Project。
- 来源 Session、Floor、Page 必须属于当前 Project。
- Project Event 和 Operation Log 只记录 ID、状态、类型、来源引用和字节数，不记录完整 `payload`。

## 状态与决策

Inbox Item 有四个状态：

| 状态 | 说明 |
| ---- | ---- |
| `pending` | 待处理。创建后默认状态 |
| `accepted` | owner 已接受 |
| `rejected` | owner 已拒绝 |
| `archived` | 已归档 |

`PATCH /projects/:id/inbox/:item_id` 使用 `decision` 字段：

| decision | 目标状态 |
| ---- | ---- |
| `accept` | `accepted` |
| `reject` | `rejected` |
| `archive` | `archived` |

允许的状态流转：

- `pending -> accepted`
- `pending -> rejected`
- `pending -> archived`
- `accepted -> archived`
- `rejected -> archived`

对已经 `archived` 的条目再次执行 `archive` 会返回当前条目。

## 公共类型

### ProjectInboxItem

```json
{
  "id": "pinbox_001",
  "workspace_id": "ws_default_acc_1",
  "project_id": "proj_main",
  "account_id": "acc_owner",
  "sender_account_id": "acc_deriver",
  "type": "derived_output.review",
  "title": "候选摘要待确认",
  "payload": {
    "derived_output_id": "dout_001"
  },
  "source_event_id": "evt_001",
  "source_session_id": "sess_001",
  "source_floor_id": null,
  "source_page_id": null,
  "status": "pending",
  "decided_by_account_id": null,
  "decided_at": null,
  "created_at": 1735689600000,
  "updated_at": 1735689600000
}
```

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Inbox Item ID，格式通常为 `pinbox_` 前缀 |
| `workspace_id` | string | 所属 Workspace ID |
| `project_id` | string | 所属 Project ID |
| `account_id` | string | Project owner 账号 ID |
| `sender_account_id` | string | 发送该条目的账号 ID |
| `type` | string | 条目类型，1-128 个字符 |
| `title` | string \| null | 可选标题，最多 200 个字符 |
| `payload` | unknown | JSON 负载 |
| `source_event_id` | string \| null | 来源 Project Event ID |
| `source_session_id` | string \| null | 来源 Session ID |
| `source_floor_id` | string \| null | 来源 Floor ID |
| `source_page_id` | string \| null | 来源 Page ID |
| `status` | string | `pending`、`accepted`、`rejected` 或 `archived` |
| `decided_by_account_id` | string \| null | 决策账号 ID |
| `decided_at` | integer \| null | 决策时间戳（ms） |
| `created_at` | integer | 创建时间戳（ms） |
| `updated_at` | integer | 更新时间戳（ms） |

## GET /projects/:id/inbox

列出 Project Inbox 条目。

### 列表路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Project ID |

### 列表查询参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- |
| `status` | string | - | `pending`、`accepted`、`rejected` 或 `archived` |
| `type` | string | - | 按条目类型过滤 |
| `sender_account_id` | string | - | 按发送账号过滤。deriver 只能查询自己 |
| `source_session_id` | string | - | 只返回某个来源 Session 的条目 |
| `limit` | integer | `50` | 每页数量，1-200 |
| `cursor` | string | - | 上一页返回的 `next_cursor` |

### 列表响应 `200`

```json
{
  "items": [
    {
      "id": "pinbox_001",
      "workspace_id": "ws_default_acc_1",
      "project_id": "proj_main",
      "account_id": "acc_owner",
      "sender_account_id": "acc_deriver",
      "type": "derived_output.review",
      "title": "候选摘要待确认",
      "payload": {
        "derived_output_id": "dout_001"
      },
      "source_event_id": "evt_001",
      "source_session_id": "sess_001",
      "source_floor_id": null,
      "source_page_id": null,
      "status": "pending",
      "decided_by_account_id": null,
      "decided_at": null,
      "created_at": 1735689600000,
      "updated_at": 1735689600000
    }
  ],
  "next_cursor": null
}
```

## POST /projects/:id/inbox

创建 Project Inbox 条目。owner 和 deriver 可以调用。

### 创建请求体

```json
{
  "type": "derived_output.review",
  "title": "候选摘要待确认",
  "payload": {
    "derived_output_id": "dout_001",
    "suggested_action": "review"
  },
  "source_event_id": "evt_001",
  "source_session_id": "sess_001",
  "source_floor_id": null,
  "source_page_id": null
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `type` | string | 是 | - | 1-128 个字符 |
| `title` | string \| null | 否 | `null` | 可选标题，最多 200 个字符 |
| `payload` | unknown | 否 | `{}` | JSON 负载，默认最大 256 KiB |
| `source_event_id` | string | 否 | `null` | 来源 Project Event，必须属于当前 Project |
| `source_session_id` | string | 否 | `null` | 来源 Session，必须属于当前 Project |
| `source_floor_id` | string | 否 | `null` | 来源 Floor，必须属于当前 Project |
| `source_page_id` | string | 否 | `null` | 来源 Page，必须属于当前 Project |

### 创建响应 `201`

返回 `{ "item": ProjectInboxItem }`。

## GET /projects/:id/inbox/:item_id

读取单个 Inbox 条目。

### 单项路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Project ID |
| `item_id` | string | Inbox Item ID |

### 单项响应 `200`

返回 `{ "item": ProjectInboxItem }`。

## PATCH /projects/:id/inbox/:item_id

决定 Inbox 条目。只有 owner 可以调用。

### 决策请求体

```json
{
  "decision": "accept",
  "note": "已确认，但不会自动合并到主会话。"
}
```

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `decision` | string | 是 | `accept`、`reject` 或 `archive` |
| `note` | string \| null | 否 | 决策备注，最多 500 个字符，只进入 Operation Log metadata |

### 决策响应 `200`

返回 `{ "item": ProjectInboxItem }`。

## Project Event 与 Operation Log

成功写入会产生 Operation Log 和 Project Event。它们与业务写入在同一个数据库事务中提交。SSE 推送发生在事务提交之后，推送失败不会回滚业务写入。

| 动作 | Operation Log action | Project Event type |
| ---- | ---- | ---- |
| 创建 | `project_inbox_item.create` | `project_inbox.item.created` |
| 接受 | `project_inbox_item.decide` | `project_inbox.item.accepted` |
| 拒绝 | `project_inbox_item.decide` | `project_inbox.item.rejected` |
| 归档 | `project_inbox_item.decide` | `project_inbox.item.archived` |

创建事件 `payload` 只包含小型摘要：

```json
{
  "inbox_item_id": "pinbox_001",
  "type": "derived_output.review",
  "title": "候选摘要待确认",
  "status": "pending",
  "sender_account_id": "acc_deriver",
  "source_event_id": "evt_001",
  "source_session_id": "sess_001",
  "source_floor_id": null,
  "source_page_id": null
}
```

决策事件 `payload` 不包含完整 `payload`，也不包含备注正文：

```json
{
  "inbox_item_id": "pinbox_001",
  "type": "derived_output.review",
  "status": "accepted",
  "decision": "accept",
  "sender_account_id": "acc_deriver",
  "decided_by_account_id": "acc_owner",
  "source_event_id": "evt_001",
  "source_session_id": "sess_001",
  "source_floor_id": null,
  "source_page_id": null
}
```

Operation Log 的 `metadata` 会记录 `payload_byte_count`，不会记录完整 `payload`。

## 错误码

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| `400` | `validation_error` | 请求参数或请求体不符合 schema |
| `400` | `invalid_cursor` | 分页 cursor 无效 |
| `400` | `project_inbox_payload_invalid` | `payload` 不能被 JSON 序列化 |
| `403` | `project_inbox_read_denied` | 当前角色不能读取 Inbox |
| `403` | `project_inbox_write_denied` | 当前角色不能创建 Inbox 条目 |
| `403` | `project_inbox_decide_denied` | 当前角色不能决定 Inbox 条目 |
| `404` | `project_not_found` | Project 不存在，或当前账号不可见 |
| `404` | `project_inbox_item_not_found` | Inbox 条目不存在，或 deriver 访问了非自己发送的条目 |
| `404` | `session_not_found` | 来源 Session 不存在 |
| `404` | `floor_not_found` | 来源 Floor 不存在 |
| `404` | `page_not_found` | 来源 Page 不存在 |
| `409` | `project_archived` | Project 已归档 |
| `409` | `project_inbox_invalid_transition` | 决策或状态流转无效 |
| `409` | `project_inbox_source_scope_mismatch` | 来源对象不属于当前 Project |
| `413` | `project_inbox_payload_too_large` | `payload` 超过大小上限 |

## 与官方 SDK 的关系

`@tavern/sdk` 已封装这组接口：

```ts
const item = await client.projects.inbox.create(
  "proj_main",
  {
    type: "derived_output.review",
    title: "候选摘要待确认",
    payload: { derivedOutputId: "dout_001" },
    sourceSessionId: "sess_001",
  },
  { accountId: "acc_deriver" },
);

const ownInbox = await client.projects.inbox.list("proj_main", {
  accountId: "acc_deriver",
  status: "pending",
});

const accepted = await client.projects.inbox.accept("proj_main", item.id, {
  accountId: "acc_owner",
  note: "已确认。",
});

await client.projects.inbox.archive("proj_main", accepted.id, {
  accountId: "acc_owner",
});
```
