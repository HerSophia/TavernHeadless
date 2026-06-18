---
outline: [2, 3]
---

# Prompt Runtime Injections（注入与高级位置）

这一页讲 Prompt Runtime Injection 的写入面：怎么把一段文本，在指定的语义位置注入到提示词里。

注入分两类。一类是随请求临时提交的 `prompt_runtime_injections`，只在本次请求内生效，由 Chat 与 Inspection 入口接收。另一类是持久注入，提前写入 session 或 branch，之后每次组装提示词都会参与解析。本页只讲持久注入的增删改查，以及两类注入共用的 `placement` 与 `placement_params` 规则。

如果你只想确认某条注入最终是否生效、落在了什么位置，请看 [Inspection（预览与检查）](./prompt-runtime-inspection) 里的 `runtime_trace.injection` 与顶层 `injections`。本页只负责"怎么写"，Inspection 页负责"怎么看结果"。

## 什么时候需要看这页

- 想给某个会话或分支预先挂一段固定提示词，并控制它出现的位置。
- 想用高级位置，比如插到某个楼层前后、世界书内部、作者注顶部。
- 想知道 `placement` 有哪些取值，以及哪些位置需要额外的 `placement_params`。
- 想知道持久注入的创建、更新、删除接口和错误码。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| 注入（injection） | 一段带标题和正文的文本，会被放进提示词的某个位置 |
| 请求级注入 | 随请求提交的 `prompt_runtime_injections`，只在本次请求生效，不落库 |
| 持久注入 | 提前写入 session 或 branch 的注入记录，之后每次组装都参与 |
| `placement` | 注入的目标位置，例如 `before_history`、`after_persona` |
| `placement_params` | 高级位置需要的参数，字段固定为 `floor_no`、`offset`、`depth` |
| `mode_scope` | 限定这条注入只在某个 prompt mode 下生效，为 `null` 表示不限制 |
| `order` | 同一 placement 内部的排序值，默认 `100`，越小越靠前 |

## 一个简单例子

假设你想让某个会话在每次组装提示词时，都在历史之前插入一段固定提醒。

1. 调 `POST /sessions/:id/prompt-runtime/injections`，`placement` 填 `before_history`，写好 `title` 和 `content`。
2. 之后正常发消息，这条注入会自动参与组装。
3. 想确认它确实生效了，去 [Inspection](./prompt-runtime-inspection) 用 `inspect`，在顶层 `injections` 里找到这条记录，看 `applied` 和 `placement_resolved`。

```bash
curl -X POST http://localhost:3000/sessions/sess_001/prompt-runtime/injections \
  -H 'Content-Type: application/json' \
  -d '{
    "source_kind": "client_injection",
    "title": "History guard",
    "content": "Keep the north pass in focus.",
    "placement": "before_history"
  }'
```

## 路由一览

持久注入分 session 级和 branch 级两套，结构相同。branch 级只对已经物化的分支可用。

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/sessions/:id/prompt-runtime/injections` | 列出 session 级注入 |
| POST | `/sessions/:id/prompt-runtime/injections` | 创建 session 级注入 |
| PATCH | `/sessions/:id/prompt-runtime/injections/:injectionId` | 修改一条 session 级注入 |
| DELETE | `/sessions/:id/prompt-runtime/injections/:injectionId` | 删除一条 session 级注入 |
| GET | `/sessions/:id/prompt-runtime/branches/:branchId/injections` | 列出 branch 级注入 |
| POST | `/sessions/:id/prompt-runtime/branches/:branchId/injections` | 创建 branch 级注入 |
| PATCH | `/sessions/:id/prompt-runtime/branches/:branchId/injections/:injectionId` | 修改一条 branch 级注入 |
| DELETE | `/sessions/:id/prompt-runtime/branches/:branchId/injections/:injectionId` | 删除一条 branch 级注入 |

## 创建注入

```http
POST /sessions/:id/prompt-runtime/injections
POST /sessions/:id/prompt-runtime/branches/:branchId/injections
```

### 请求体

```json
{
  "source_kind": "client_injection",
  "title": "History guard",
  "content": "Keep the north pass in focus.",
  "placement": "before_history",
  "placement_params": { "floor_no": 12 },
  "order": 100,
  "enabled": true,
  "mode_scope": null,
  "ttl_ms": null
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `source_kind` | `string` | 是 | - | 当前只允许 `"client_injection"` |
| `title` | `string` | 是 | - | 注入标题，去除首尾空白后不能为空，最多 256 字符 |
| `content` | `string` | 是 | - | 注入正文，去除首尾空白后不能为空，最多 8000 字符 |
| `placement` | `string` | 是 | - | 目标位置，取值见下文 [placement 取值](#placement-取值) |
| `placement_params` | `object` | 否 | `null` | 高级位置参数。字段固定为 `floor_no`、`offset`、`depth`，均为可选非负整数 |
| `order` | `integer` | 否 | `100` | 同一 placement 内部排序，越小越靠前 |
| `enabled` | `boolean` | 否 | `true` | 是否启用 |
| `mode_scope` | `string \| null` | 否 | `null` | 限定生效的 prompt mode：`compat_strict` / `compat_plus` / `native`。`null` 表示不限制 |
| `ttl_ms` | `integer \| null` | 否 | `null` | 存活时长（毫秒）。`null` 表示不过期 |

I4 阶段的持久作用域上限为：session 级最多 128 条，branch 级最多 128 条。超过上限时创建会返回 `injection_scope_quota_exceeded`。

## 可见性与 trace 字段

阶段 6 起，注入 trace 会明确返回来源可见性和预算状态。

| `source_kind` | `visibility` | 是否受限 | 默认裁剪行为 |
| ---- | ---- | ---- | ---- |
| `client_injection` | `client` | 否 | 始终完整可见 |
| `agent_injection` | `agent_private` | 是 | 默认裁剪 `title` 与 `source_chain` |
| `debug_injection` | `debug` | 是 | 默认裁剪 `title` 与 `source_chain` |
| `system_override` | `system` | 是 | 默认裁剪 `title` 与 `source_chain`，且不允许客户端声明 |

`runtime_trace.injection.items[]` 会返回 `visibility`、`placement_requested`、`anchor_resolved`、`not_applied_reason`、`source_chain`、`budget_group`、`budget_status`、`restricted` 等字段。`budget_status` 为 `within_budget`、`rejected_by_item_limit` 或 `rejected_by_total_limit`。

可见性裁剪规则（阶段 6）：

- 受限来源（`agent_private` / `debug` / `system`）默认裁剪敏感正文，`title` 返回 `null`、`source_chain` 返回 `null`，并把 `restricted` 置为 `true`。
- 结构性可观察字段始终保留：`visibility`、`scope`、`placement_requested`、`placement_resolved`、`anchor_resolved`、`applied`、`not_applied_reason`、`budget_status`、`token_count`、`content_length`、`order_requested`。任何注入都不会被静默吞掉。
- `client` 来源永不裁剪，`restricted` 恒为 `false`。
- 在 `inspect` 中可显式传 `include_restricted_injection_content: true` 取回受限来源完整正文（owner 调试用途）。`chat` 运行响应与 `preview` 始终裁剪受限来源，不开放完整正文。

持久注入写入接口仍只允许 `client_injection`。内部来源不会通过本页的写入接口开放。


### 成功响应 `201`

```json
{
  "data": {
    "id": "inj_1",
    "scope": "session",
    "source_kind": "client_injection",
    "title": "History guard",
    "content": "Keep the north pass in focus.",
    "placement": "before_history",
    "placement_params": { "floor_no": 12 },
    "order": 100,
    "enabled": true,
    "mode_scope": null,
    "ttl_ms": null,
    "created_by": "user-1",
    "created_at": 1710000004600,
    "updated_at": 1710000004700
  }
}
```

## 列出注入

```http
GET /sessions/:id/prompt-runtime/injections
GET /sessions/:id/prompt-runtime/branches/:branchId/injections
```

### 成功响应 `200`

```json
{
  "data": [
    {
      "id": "inj_1",
      "scope": "session",
      "source_kind": "client_injection",
      "title": "History guard",
      "content": "Keep the north pass in focus.",
      "placement": "before_history",
      "placement_params": { "floor_no": 12 },
      "order": 100,
      "enabled": true,
      "mode_scope": null,
      "ttl_ms": null,
      "created_by": "user-1",
      "created_at": 1710000004600,
      "updated_at": 1710000004700
    }
  ]
}
```

## 修改注入

```http
PATCH /sessions/:id/prompt-runtime/injections/:injectionId
PATCH /sessions/:id/prompt-runtime/branches/:branchId/injections/:injectionId
```

请求体的字段与创建时相同，但全部可选，至少要传一个可变字段。

`placement_params` 在 PATCH 里允许显式传 `null`，表示清掉之前设置的参数。

```json
{
  "enabled": false,
  "mode_scope": "native",
  "ttl_ms": 60000
}
```

成功返回 `200`，结构与创建响应一致，返回更新后的完整记录。

## 删除注入

```http
DELETE /sessions/:id/prompt-runtime/injections/:injectionId
DELETE /sessions/:id/prompt-runtime/branches/:branchId/injections/:injectionId
```

成功返回 `200`，`data` 是被删除的注入记录。

## 响应字段说明

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | `string` | 注入记录 ID |
| `scope` | `string` | `"session"` 或 `"branch"` |
| `source_kind` | `string` | 当前固定为 `"client_injection"` |
| `title` | `string` | 注入标题 |
| `content` | `string` | 注入正文 |
| `placement` | `string` | 目标位置 |
| `placement_params` | `object \| null` | 高级位置参数，未设置时为 `null` |
| `order` | `integer` | 同一 placement 内部排序 |
| `enabled` | `boolean` | 是否启用 |
| `mode_scope` | `string \| null` | 限定生效的 prompt mode，`null` 表示不限制 |
| `ttl_ms` | `integer \| null` | 存活时长（毫秒），`null` 表示不过期 |
| `created_by` | `string \| null` | 创建者 |
| `created_at` | `integer` | 创建时间戳（ms） |
| `updated_at` | `integer` | 更新时间戳（ms） |

## placement 取值

`placement` 分两类。通用结构位置三种 prompt mode 都开放；高级位置可能需要 `placement_params`，或只在部分 mode 下可用。

### 通用结构位置

三种 prompt mode（`compat_strict` / `compat_plus` / `native`）都开放：

- `before_system_prompt` / `after_system_prompt`
- `before_character` / `after_character`
- `before_persona` / `after_persona`
- `before_worldbook` / `after_worldbook`
- `before_memory` / `after_memory`
- `before_examples` / `after_examples`
- `before_history` / `after_history`
- `before_current_user_input` / `after_current_user_input`
- `before_output_instruction`
- `before_assistant_prefill`

### 高级位置

需要 `placement_params`，或受 prompt mode 限制：

- 楼层相对位置（三种 mode 都开放，实际生效仍受历史窗口约束）：
  - `before_floor` / `after_floor`：需要 `placement_params.floor_no`
  - `before_floor_from_end` / `after_floor_from_end`：需要 `placement_params.offset`，`0` 表示历史窗口最后一条楼层
- 世界书细分位置（仅 `compat_plus` / `native`）：
  - `worldbook_depth`：需要 `placement_params.depth`
  - `worldbook_before` / `worldbook_after`：落到世界书整体内容内部前 / 后
  - `worldbook_author_note_top`：落到作者注顶部
- native 专属位置（仅 `native`）：
  - `before_contributor_block` / `after_contributor_block`

## placement_params 规则

`placement_params` 的字段集合固定为 `floor_no`、`offset`、`depth`，均为可选非负整数。

- 需要参数的 placement 在缺参数或参数非法时不会生效。
- 楼层位置越出历史窗口时同样不生效。
- 这两种情况都不会抛错，也不会被静默丢弃，而是在 Inspection 的 `not_applied_reason` 给出明确原因，例如 `missing_placement_params`、`invalid_placement_params`、`floor_no_out_of_history_window`、`floor_offset_out_of_history_window`。

注入是否生效、落在了什么语义锚点上，统一在 [Inspection](./prompt-runtime-inspection) 里回看。本页只声明可写的字段与规则。

## TTL 与清理

设置了 `ttl_ms` 的持久注入在 `created_at + ttl_ms` 到达后视为过期。过期注入不会参与 prepared builder，也不会进入本轮 Prompt 组装。

通用运行时维护任务启用后，会调用过期清理路径删除这些记录，并写入 `prompt_injection.cleanup_expired` operation log。日志只记录清理数量、时间和耗时，不记录注入正文。

## 错误

错误响应结构为 `{ "error": { "code": "...", "message": "..." } }`。

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| 400 | `invalid_injection_payload` | 请求体字段非法，例如 `placement_params` 不是非负整数、`source_kind` 不是 `client_injection`、`title` 或 `content` 去空白后为空，或标题 / 正文超过长度上限 |
| 400 | `injection_scope_quota_exceeded` | session 或 branch 持久作用域超过 128 条上限 |
| 403 | - | 当前账号对该会话所在项目没有写权限 |
| 404 | `session_not_found` | 会话不存在或不属于当前账号 |
| 404 | `branch_not_found` | 分支不存在（仅 branch 级路由） |
| 404 | `injection_not_found` | 注入记录不存在（仅 PATCH / DELETE） |
| 404 | `not_found` | 注入入口未启用 |
| 500 | - | 服务内部错误 |

## 相关页面

- 总览页：[Prompt Runtime](./prompt-runtime)
- 注入结果观测：[Prompt Runtime Inspection](./prompt-runtime-inspection)
- 在请求里临时提交注入：[Chat（对话生成）](./chat)
