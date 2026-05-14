---
outline: [2, 3]
---

# Project Derived Outputs（项目派生结果）

Derived Output 用来保存 Project 范围内的派生 JSON 结果。它适合给 deriver 或 owner 记录分析结果、候选摘要、标注结果或其他外部计算产物。

它不会自动写入主 Session，也不会自动修改 Variable、Memory 或 Session State。需要把结果应用到聊天主链路时，接入方必须另外调用对应的正式接口。

## 什么时候需要看这页

- 你要让 deriver 为 Project 写入派生数据。
- 你要按 `domain`、来源 Session 或创建账号查询派生结果。
- 你要把派生结果作为审计和人工确认前的中间产物保存下来。
- 你需要理解 Derived Output 与主 Session 之间的边界。

如果你只是要修改会话正文、变量、记忆或 Session State，不应使用这组接口。

## 一个简单例子

先由 owner 给账号增加 deriver 身份：

```bash
curl -X POST http://localhost:3000/projects/proj_main/members \
  -H 'Content-Type: application/json' \
  -d '{
    "account_id": "acc_deriver",
    "role": "deriver"
  }'
```

然后 deriver 可以写入一个派生结果：

```bash
curl -X POST http://localhost:3000/projects/proj_main/derived-outputs \
  -H 'Content-Type: application/json' \
  -d '{
    "domain": "summary.candidate",
    "source_session_id": "sess_001",
    "value": {
      "summary": "篝火旁的谈话进入新的线索。"
    },
    "status": "draft"
  }'
```

owner、observer 和 deriver 都可以读取 Derived Output。deriver 只能修改自己创建的条目。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| Derived Output | Project 范围内的派生 JSON 结果 |
| deriver | 可以写入 Derived Output、创建 Inbox 条目，但不能改主 Session 的 Project 成员角色 |
| `domain` | 调用方自定义的结果分类，例如 `summary.candidate` |
| source | 可选来源引用，可以指向同一 Project 内的 Session、Floor 或 Page |
| `owner_account_id` | 创建该 Derived Output 的账号 |

## 权限与边界

| 角色 | 读取 | 创建 | 更新 | 归档 |
| ---- | ---- | ---- | ---- | ---- |
| owner | 可以 | 可以 | 可以 | 可以 |
| observer | 可以 | 不可以 | 不可以 | 不可以 |
| deriver | 可以 | 可以 | 只可更新自己创建的条目 | 只可归档自己创建的条目 |
| 非成员 | 不可见 | 不可见 | 不可见 | 不可见 |

补充规则：

- 非成员访问时，Project API 通常返回 `404 project_not_found`。
- Project 已归档时，接口返回 `409 project_archived`。
- `value` 必须可以被 JSON 序列化，默认最大 256 KiB。
- 来源 Session、Floor、Page 必须属于当前 Project，否则返回 `409 derived_output_source_scope_mismatch`。
- Project Event 和 Operation Log 只记录 ID、状态、来源引用和字节数，不记录完整 `value`。

## 状态流转

Derived Output 有三个状态：

| 状态 | 说明 |
| ---- | ---- |
| `draft` | 草稿。创建时默认状态 |
| `published` | 已发布。表示结果可以被消费方视为正式候选 |
| `archived` | 已归档。归档后不能再修改 `value` |

允许的状态流转：

- `draft -> published`
- `draft -> archived`
- `published -> archived`

创建时不能直接使用 `archived`。

## 公共类型

### DerivedOutput

```json
{
  "id": "dout_001",
  "workspace_id": "ws_default_acc_1",
  "project_id": "proj_main",
  "account_id": "acc_owner",
  "owner_account_id": "acc_deriver",
  "source_session_id": "sess_001",
  "source_floor_id": null,
  "source_page_id": null,
  "domain": "summary.candidate",
  "value": {
    "summary": "篝火旁的谈话进入新的线索。"
  },
  "status": "draft",
  "created_at": 1735689600000,
  "updated_at": 1735689600000
}
```

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Derived Output ID，格式通常为 `dout_` 前缀 |
| `workspace_id` | string | 所属 Workspace ID |
| `project_id` | string | 所属 Project ID |
| `account_id` | string | Project owner 账号 ID |
| `owner_account_id` | string | 创建该条目的账号 ID |
| `source_session_id` | string \| null | 来源 Session ID |
| `source_floor_id` | string \| null | 来源 Floor ID |
| `source_page_id` | string \| null | 来源 Page ID |
| `domain` | string | 调用方自定义分类 |
| `value` | unknown | JSON 值 |
| `status` | string | `draft`、`published` 或 `archived` |
| `created_at` | integer | 创建时间戳（ms） |
| `updated_at` | integer | 更新时间戳（ms） |

## GET /projects/:id/derived-outputs

列出 Project 下的 Derived Output。

### 列表路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Project ID |

### 列表查询参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- |
| `domain` | string | - | 按 `domain` 过滤 |
| `status` | string | - | `draft`、`published` 或 `archived` |
| `source_session_id` | string | - | 只返回某个来源 Session 的条目 |
| `owner_account_id` | string | - | 只返回某个创建账号的条目 |
| `limit` | integer | `50` | 每页数量，1-200 |
| `cursor` | string | - | 上一页返回的 `next_cursor` |

### 列表响应 `200`

```json
{
  "items": [
    {
      "id": "dout_001",
      "workspace_id": "ws_default_acc_1",
      "project_id": "proj_main",
      "account_id": "acc_owner",
      "owner_account_id": "acc_deriver",
      "source_session_id": "sess_001",
      "source_floor_id": null,
      "source_page_id": null,
      "domain": "summary.candidate",
      "value": {
        "summary": "篝火旁的谈话进入新的线索。"
      },
      "status": "draft",
      "created_at": 1735689600000,
      "updated_at": 1735689600000
    }
  ],
  "next_cursor": null
}
```

## POST /projects/:id/derived-outputs

创建 Derived Output。owner 和 deriver 可以调用。

### 创建请求体

```json
{
  "domain": "summary.candidate",
  "source_session_id": "sess_001",
  "source_floor_id": null,
  "source_page_id": null,
  "value": {
    "summary": "篝火旁的谈话进入新的线索。"
  },
  "status": "draft"
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `domain` | string | 是 | - | 1-128 个字符 |
| `source_session_id` | string | 否 | `null` | 来源 Session，必须属于当前 Project |
| `source_floor_id` | string | 否 | `null` | 来源 Floor，必须属于当前 Project |
| `source_page_id` | string | 否 | `null` | 来源 Page，必须属于当前 Project |
| `value` | unknown | 否 | `{}` | JSON 值，默认最大 256 KiB |
| `status` | string | 否 | `draft` | 只能是 `draft` 或 `published` |

### 创建响应 `201`

```json
{
  "item": {
    "id": "dout_001",
    "workspace_id": "ws_default_acc_1",
    "project_id": "proj_main",
    "account_id": "acc_owner",
    "owner_account_id": "acc_deriver",
    "source_session_id": "sess_001",
    "source_floor_id": null,
    "source_page_id": null,
    "domain": "summary.candidate",
    "value": {
      "summary": "篝火旁的谈话进入新的线索。"
    },
    "status": "draft",
    "created_at": 1735689600000,
    "updated_at": 1735689600000
  }
}
```

## GET /projects/:id/derived-outputs/:item_id

读取单个 Derived Output。

### 单项路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | Project ID |
| `item_id` | string | Derived Output ID |

### 单项响应 `200`

返回 `{ "item": DerivedOutput }`。

## PATCH /projects/:id/derived-outputs/:item_id

更新 Derived Output 的 `value` 或 `status`。请求体至少要包含一个字段。

### 更新请求体

```json
{
  "value": {
    "summary": "更新后的候选摘要。"
  },
  "status": "published"
}
```

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `value` | unknown | 否 | 新 JSON 值，默认最大 256 KiB |
| `status` | string | 否 | `draft`、`published` 或 `archived` |

### 更新响应 `200`

返回 `{ "item": DerivedOutput }`。

## DELETE /projects/:id/derived-outputs/:item_id

归档 Derived Output。该接口不会删除数据库行，只会把状态改为 `archived`。

### 归档响应 `200`

返回 `{ "item": DerivedOutput }`。

## Project Event 与 Operation Log

成功写入会产生 Operation Log 和 Project Event。它们与业务写入在同一个数据库事务中提交。SSE 推送发生在事务提交之后，推送失败不会回滚业务写入。

| 动作 | Operation Log action | Project Event type |
| ---- | ---- | ---- |
| 创建 | `derived_output.create` | `derived_output.created` |
| 更新 | `derived_output.update` | `derived_output.updated` |
| 归档 | `derived_output.archive` | `derived_output.archived` |

事件 `payload` 只包含：

```json
{
  "derived_output_id": "dout_001",
  "domain": "summary.candidate",
  "status": "published",
  "owner_account_id": "acc_deriver",
  "source_session_id": "sess_001",
  "source_floor_id": null,
  "source_page_id": null,
  "changed_fields": ["status"]
}
```

`value` 不会进入事件负载。Operation Log 的 `metadata` 会记录 `value_byte_count`，不会记录完整 `value`。

## 错误码

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| `400` | `validation_error` | 请求参数或请求体不符合 schema |
| `400` | `invalid_cursor` | 分页 cursor 无效 |
| `400` | `derived_output_invalid_status` | 状态值或状态流转无效 |
| `400` | `derived_output_payload_invalid` | `value` 不能被 JSON 序列化 |
| `403` | `derived_output_write_denied` | 当前角色不能写入 Derived Output |
| `403` | `derived_output_forbidden_for_role` | deriver 尝试修改不属于自己的条目 |
| `404` | `project_not_found` | Project 不存在，或当前账号不可见 |
| `404` | `derived_output_not_found` | Derived Output 不存在 |
| `404` | `session_not_found` | 来源 Session 不存在 |
| `404` | `floor_not_found` | 来源 Floor 不存在 |
| `404` | `page_not_found` | 来源 Page 不存在 |
| `409` | `project_archived` | Project 已归档 |
| `409` | `derived_output_archived_immutable` | 已归档条目不能修改 `value` |
| `409` | `derived_output_source_scope_mismatch` | 来源对象不属于当前 Project |
| `413` | `derived_output_payload_too_large` | `value` 超过大小上限 |

## 与官方 SDK 的关系

`@tavern/sdk` 已封装这组接口：

```ts
const created = await client.projects.derivedOutputs.create(
  "proj_main",
  {
    domain: "summary.candidate",
    sourceSessionId: "sess_001",
    value: { summary: "篝火旁的谈话进入新的线索。" },
    status: "draft",
  },
  { accountId: "acc_deriver" },
);

const page = await client.projects.derivedOutputs.list("proj_main", {
  accountId: "acc_owner",
  domain: "summary.candidate",
});

const published = await client.projects.derivedOutputs.update(
  "proj_main",
  created.id,
  { status: "published" },
  { accountId: "acc_deriver" },
);

await client.projects.derivedOutputs.archive("proj_main", published.id, {
  accountId: "acc_deriver",
});
```
