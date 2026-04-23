---
outline: [2, 3]
---

# Tools（工具调用）

工具系统文档分为四层：

1. `/tools/builtin`：列出当前 `BuiltinToolProvider` 可公开的内置工具定义
2. `/tools/definitions*`：管理自定义工具定义
3. `/tool-executions` 与 `/floors/:id/tool-executions`：查询执行 journal
4. `/tools/call-records` 与 `/sessions/:id/tool-permissions`：查询旧调用记录与管理会话权限

`script` handler 目前被视为危险执行面。
Beta3 默认关闭它的创建、更新和执行。
只有服务端显式设置 `ENABLE_UNSAFE_SCRIPT_HANDLER=true` 时，definition-backed script tools 才会重新进入运行时目录。

## 概念区分

| 能力 | 路径 | 说明 |
| ---- | ---- | ---- |
| 内置工具定义列表 | `GET /tools/builtin` | 只返回当前 `BuiltinToolProvider` 可公开的工具定义，不等于完整运行时目录 |
| 会话运行时工具目录 | `GET /sessions/:id/tools/runtime` | 返回某个会话实际可见的完整运行时工具目录，可能包含 builtin、resource、MCP 工具，并标记 MCP 目录来自 `live` / `cached` / `unavailable` |
| 执行 journal（source of truth） | `GET /tool-executions` / `GET /floors/:id/tool-executions` | 返回**主执行审计记录**。新的工具审计只应读取这里，对应 `tool_execution_record`，承载所有新运行语义 |
| 调用记录（legacy 兼容投影） | `GET /tools/call-records` | 返回旧的页级调用记录，对应 `tool_call_record`；只作为 legacy-compatible projection 保留，不再承载新语义 |
| 会话权限 | `GET/PUT/PATCH /sessions/:id/tool-permissions` | 读取或修改单个会话的工具权限快照 |

## 执行真相源口径

工具执行只有一个主审计真相源：`tool_execution_record`。

- `GET /tool-executions` / `GET /floors/:id/tool-executions` 直接读取它，是 source of truth。
- `GET /tools/call-records` 是兼容投影，仅保留 `success | error | denied | queued | running` 五个兼容状态；不再承载 `timeout` / `uncertain` / `blocked`、lifecycle / commit outcome、`delivery_mode`、`runtime_job_id` 等主语义。
- 所有新业务语义（运行时作业绑定、deferred receipt、结构化 `executionStatus` 等）都只进入执行 journal。对外接入层如果需要这些字段，应直接使用 `/tool-executions`。

## 会话运行时工具目录

### 获取会话运行时工具目录

```http
GET /sessions/:id/tools/runtime
```

这个端点返回某个会话在当前权限、启用状态和 MCP 连接状态下真正可调用的工具集合。

- 它是**会话级**快照，不是全局静态目录
- MCP 工具 live 列举成功时，`catalog_source` 为 `live`
- MCP 工具 live 列举失败但已有快照时，`catalog_source` 为 `cached`
- MCP 工具 live 列举失败且本地没有快照时，`catalog_source` 为 `unavailable`；这时 `tools` 不应被理解成“MCP server 确认零工具”，而是“当前不可确认”
- 非 MCP 工具的 `catalog_source` 为 `null`
- 当 script handler 被服务端策略关闭时，历史 definition-backed tools 会继续出现在目录里，但 `availability = unavailable`

除了“值”本身，每个工具条目还会附带 **metadata basis** 字段，说明治理字段是怎么来的：

- `side_effect_level_basis`
- `allowed_slots_basis`
- `parameter_schema_basis`
- `replay_safety_basis`

basis 枚举：

- `tool_declared`：值直接来自本地明确定义或工具自身声明
- `server_default`：值来自 MCP server 级默认配置
- `platform_default`：值来自平台硬编码默认
- `inferred_from_execution_policy`：值由 replay / 副作用策略推导得出
- `shallow_schema_projection`：值由浅层 schema 投影得出

basis **不是** trust score。它只用于让上层知道字段是声明值还是推断值，不应据此直接判定工具是否可信。

#### 响应 `200`

```json
{
  "data": {
    "session_id": "sess_001",
    "generated_at": 1735689600000,
    "tools": [
      {
        "name": "github_create_issue",
        "provider_id": "mcp:mcp-1",
        "provider_type": "mcp",
        "source": "mcp",
        "side_effect_level": "irreversible",
        "allowed_slots": ["narrator"],
        "availability": "available",
        "availability_reason": null,
        "async_capability": "deferred_ok",
        "default_delivery_mode": "async_job",
        "catalog_source": "cached",
        "replay_safety": "never_auto_replay",
        "result_visibility": "deferred_receipt",
        "side_effect_level_basis": "server_default",
        "allowed_slots_basis": "platform_default",
        "parameter_schema_basis": "shallow_schema_projection",
        "replay_safety_basis": "inferred_from_execution_policy"
      }
    ],
    "conflicts": []
  }
}
```

#### 关键字段

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `availability` | string | `available` / `unavailable` / `conflict` |
| `availability_reason` | string \| null | 当前不可用或冲突时的原因 |
| `async_capability` | string | `inline_only` / `deferred_ok` |
| `default_delivery_mode` | string | `inline` / `async_job` |
| `catalog_source` | string \| null | MCP 目录来源：`live` / `cached` / `unavailable`；非 MCP 工具为 `null` |
| `replay_safety` | string | `safe` / `confirm_on_replay` / `never_auto_replay` / `uncertain` |
| `result_visibility` | string | `immediate` / `deferred_receipt` |
| `side_effect_level_basis` | string \| null | 字段来源依据，见 metadata basis 说明 |
| `allowed_slots_basis` | string \| null | 同上 |
| `parameter_schema_basis` | string \| null | 同上 |
| `replay_safety_basis` | string \| null | 同上 |

当前公开配置里的 `toolMode` 仍只有 `inline`。但 `inline` 回合内部并不等于“所有工具都同步完成”：当 `async_capability = deferred_ok` 且 `default_delivery_mode = async_job` 时，本轮会先返回 deferred receipt，再通过 `runtime_job_id` 继续后台执行。

## 内置工具

### 列出内置工具

```http
GET /tools/builtin
```

这个端点只列出系统内置的工具定义。

它**不是**聊天运行时的完整工具目录。

这个端点通常只返回不依赖会话上下文就能使用的内置工具，例如 `roll_dice`、`random_choice`、`get_time`、`get_character_info`。

`get_variable`、`set_variable`、`query_memory` 等需要会话上下文的内置工具，以及资源管理工具和 MCP 工具，不会出现在这里。

如果要查看某个会话在当前运行时真正可调用的工具，应使用 `GET /sessions/:id/tools/runtime`。

#### 响应 `200`

```json
{
  "data": [
    {
      "name": "roll_dice",
      "description": "Roll one or more dice and return the results. Example: sides=6, count=2 rolls two six-sided dice.",
      "parameters": {
        "type": "object",
        "properties": {
          "sides": { "type": "number", "description": "Number of sides per die (default: 6)" },
          "count": { "type": "number", "description": "Number of dice to roll (default: 1)" }
        }
      },
      "side_effect_level": "none",
      "allowed_slots": [],
      "source": "builtin"
    }
  ]
}
```

#### 字段说明

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `name` | string | 工具名 |
| `description` | string | 工具说明 |
| `parameters` | object | JSON Schema 风格的参数定义 |
| `side_effect_level` | string | 副作用级别：`none` / `sandbox` / `irreversible` |
| `allowed_slots` | string[] | 允许使用该工具的实例槽位；空数组表示不额外限制 |
| `source` | string | 当前固定为 `builtin` |

## 工具定义 CRUD

### 列出工具定义

```http
GET /tools/definitions
```

#### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| `source` | string | — | 按来源过滤：`preset` / `character` / `custom` |
| `source_id` | string | — | 按来源 ID 过滤 |
| `enabled` | boolean | — | 按启用状态过滤 |
| `sort_by` | string | `updated_at` | 排序字段：`updated_at` / `name` |
| `sort_order` | string | `desc` | 排序方向：`asc` / `desc` |
| `limit` | integer | `50` | 每页条数 |
| `offset` | integer | `0` | 偏移量 |

#### 响应 `200`

```json
{
  "data": [
    {
      "id": "tooldef_lookup_npc",
      "name": "lookup_npc",
      "description": "根据名字查找 NPC 信息",
      "parameters": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "description": "NPC 名字" }
        },
        "required": ["name"]
      },
      "side_effect_level": "none",
      "allowed_slots": ["narrator", "director"],
      "source": "custom",
      "source_id": null,
      "enabled": true,
      "handler_type": "script",
      "handler": {
        "script": "return { found: true, info: args.name };"
      },
      "created_at": 1735689600000,
      "updated_at": 1735689660000
    }
  ],
  "meta": {
    "total": 1,
    "limit": 50,
    "offset": 0,
    "has_more": false,
    "sort_by": "updated_at",
    "sort_order": "desc"
  }
}
```

### 获取工具定义

```http
GET /tools/definitions/:id
```

返回单个工具定义对象，字段与列表中的单项相同。

#### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 工具定义不存在 |

### 创建工具定义

```http
POST /tools/definitions
```

#### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | **是** | 工具名 |
| `description` | string | 否 | 工具说明，默认空字符串 |
| `parameters` | object | 否 | 参数 JSON Schema，默认 `{ "type": "object", "properties": {} }` |
| `side_effect_level` | string | 否 | 副作用级别，默认 `none` |
| `allowed_slots` | string[] | 否 | 允许使用该工具的槽位名数组 |
| `source` | string | 否 | 来源，默认 `custom` |
| `source_id` | string \| null | 否 | 来源对象 ID |
| `enabled` | boolean | 否 | 是否启用，默认 `true` |
| `handler_type` | string | 否 | 当前只公开 `script` |
| `handler` | object | 否 | `script` 处理器配置对象 |

默认情况下，服务端会拒绝新的 `script` handler 写入。
只有显式开启 `ENABLE_UNSAFE_SCRIPT_HANDLER=true` 的受信环境才允许创建。

工具定义的唯一性按账号空间计算。同一账号下，重复的 `(name, source, source_id)` 组合会返回稳定的冲突错误；不同账号可以创建同名 custom tool。

#### 请求示例

```json
{
  "name": "lookup_npc",
  "description": "根据名字查找 NPC 信息",
  "parameters": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "NPC 名字" }
    },
    "required": ["name"]
  },
  "side_effect_level": "none",
  "allowed_slots": ["narrator", "director"],
  "source": "custom",
  "handler_type": "script",
  "handler": {
    "script": "return { found: true, info: args.name };"
  }
}
```

#### 响应 `201`

返回创建后的完整工具定义对象。

#### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败 |
| `409` | `tool_definition_conflict` | 当前账号下已存在相同唯一身份的工具定义 |
| `403` | `tool_script_handler_disabled` | 服务端默认关闭了危险的 `script` handler 写入 |

### 更新工具定义

```http
PATCH /tools/definitions/:id
```

部分更新。至少传一个字段。

请求体字段与创建接口一致，但全部改为可选。

#### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败，或未提供任何更新字段 |
| `409` | `tool_definition_conflict` | 当前账号下已存在相同唯一身份的工具定义 |
| `403` | `tool_script_handler_disabled` | 服务端默认关闭了危险的 `script` handler 更新 |
| `404` | `not_found` | 工具定义不存在 |

### 删除工具定义

```http
DELETE /tools/definitions/:id
```

#### 响应 `200`

```json
{
  "data": {
    "id": "tooldef_lookup_npc",
    "deleted": true
  }
}
```

#### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 工具定义不存在 |

### 启用或禁用工具定义

```http
PATCH /tools/definitions/:id/toggle
```

#### 请求体

```json
{
  "enabled": false
}
```

#### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败 |
| `403` | `tool_script_handler_disabled` | 服务端默认关闭了危险的 `script` handler 重新启用 |
| `404` | `not_found` | 工具定义不存在 |

## 执行 journal

### 查询执行 journal

```http
GET /tool-executions
```

这个端点返回当前公开的主执行 journal。和旧的 `call-records` 相比，它会保留更多运行时字段，例如：

- `lifecycle_state`
- `commit_outcome`
- `delivery_mode`
- `runtime_job_id`
- `attempt_no`
- `replay_parent_execution_id`

`GET /tool-executions` 至少需要提供 `session_id`、`floor_id`、`run_id` 三者之一。

#### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| `session_id` | string | — | 按会话过滤 |
| `floor_id` | string | — | 按楼层过滤 |
| `run_id` | string | — | 按楼层运行 ID 过滤 |
| `caller_slot` | string | — | 按调用方槽位过滤：`narrator` / `director` / `verifier` / `memory` |
| `tool_name` | string | — | 按工具名过滤 |
| `status` | string | — | 按执行状态过滤：`running` / `queued` / `success` / `error` / `denied` / `timeout` / `uncertain` / `blocked` |
| `lifecycle_state` | string | — | 生命周期状态：`opened` / `finished` |
| `commit_outcome` | string | — | 提交结果：`pending` / `committed` / `discarded` / `replay_blocked` / `uncertain` |
| `provider_type` | string | — | provider 类型：`builtin` / `preset` / `mcp` / `unknown` |
| `sort_by` | string | `started_at` | 排序字段：`created_at` / `started_at` / `finished_at` |
| `sort_order` | string | `desc` | 排序方向：`asc` / `desc` |
| `limit` | integer | `50` | 每页条数 |
| `offset` | integer | `0` | 偏移量 |

#### 响应 `200`

```json
{
  "data": [
    {
      "id": "texec_001",
      "run_id": "floorrun_001",
      "floor_id": "floor_001",
      "page_id": null,
      "caller_slot": "narrator",
      "provider_id": "builtin",
      "provider_type": "builtin",
      "tool_name": "roll_dice",
      "args": { "sides": 20, "count": 1 },
      "result": { "data": { "results": [17], "total": 17 } },
      "status": "queued",
      "lifecycle_state": "opened",
      "commit_outcome": "pending",
      "side_effect_level": "none",
      "error_message": null,
      "duration_ms": 0,
      "started_at": 1735689600000,
      "finished_at": null,
      "delivery_mode": "async_job",
      "attempt_no": 1,
      "runtime_job_id": "runtime_job_001",
      "replay_parent_execution_id": null,
      "created_at": 1735689600000
    }
  ],
  "meta": {
    "total": 1,
    "limit": 50,
    "offset": 0,
    "has_more": false,
    "sort_by": "started_at",
    "sort_order": "desc"
  }
}
```

### 查询单个楼层的执行 journal

```http
GET /floors/:id/tool-executions
```

这个端点会把路径参数 `:id` 作为楼层过滤主键。查询时不需要再传 `floor_id`。

#### 路径参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `id` | string | **是** | 楼层 ID |

#### 查询参数

支持以下过滤字段：`run_id`、`caller_slot`、`tool_name`、`status`、`lifecycle_state`、`commit_outcome`、`provider_type`、`sort_by`、`sort_order`、`limit`、`offset`。

返回结构与 `GET /tool-executions` 相同。

## 调用记录（legacy-compatible projection）

### 查询调用记录

```http
GET /tools/call-records
```

至少需要提供 `page_id` 或 `floor_id` 之一。

::: warning
这个端点是**兼容投影（legacy-compatible projection）**，不是执行真相源。

- 状态只保留 `success` / `error` / `denied` / `queued` / `running` 五个兼容枚举。
- `timeout` / `uncertain` / `blocked` 等新状态会在此处被压缩为 `error`；`blocked` 与 `denied` 也会合并为 `denied`。
- 不会承载 `delivery_mode` / `runtime_job_id` / `lifecycle_state` / `commit_outcome` / `attempt_no` / `replay_parent_execution_id` / `side_effect_level` / `provider_type` 等主语义字段。

**新的工具审计只应读取 `GET /tool-executions`。**
:::

#### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| `page_id` | string | — | 按消息页 ID 过滤 |
| `floor_id` | string | — | 按楼层 ID 过滤，返回该楼层下所有页的记录 |
| `caller_slot` | string | — | 按调用方实例过滤 |
| `status` | string | — | 按状态过滤：`success` / `error` / `denied` / `queued` / `running` |
| `sort_by` | string | `seq` | 排序字段：`seq` / `created_at` |
| `sort_order` | string | `desc` | 排序方向：`asc` / `desc` |
| `limit` | integer | `50` | 每页条数 |
| `offset` | integer | `0` | 偏移量 |

#### 响应 `200`

```json
{
  "data": [
    {
      "id": "tc_abc123",
      "page_id": "page_xyz",
      "seq": 0,
      "caller_slot": "narrator",
      "tool_name": "roll_dice",
      "args": { "sides": 20, "count": 1 },
      "result": { "data": { "results": [17], "total": 17 } },
      "status": "success",
      "duration_ms": 2,
      "created_at": 1719400000000
    }
  ],
  "meta": {
    "total": 1,
    "limit": 50,
    "offset": 0,
    "has_more": false,
    "sort_by": "seq",
    "sort_order": "desc"
  }
}
```

#### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 未提供 `page_id` / `floor_id`，或查询参数不合法 |

## 会话工具权限

工具权限保存在 session 的 `metadata_json.tool_permissions` 中。

### 字段说明

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `enabled` | boolean | 是否整体启用工具 |
| `max_calls_per_turn` | integer | 单回合最大工具调用数 |
| `max_steps_per_generation` | integer | 单次生成允许的最大工具步数 |
| `allow_irreversible` | boolean | 是否允许不可逆工具 |
| `slot_allow_list` | object | 各槽位的白名单映射 |
| `slot_deny_list` | object | 各槽位的黑名单映射 |

### 获取工具权限

```http
GET /sessions/:id/tool-permissions
```

#### 响应 `200`

```json
{
  "data": {
    "allow_irreversible": false,
    "max_calls_per_turn": 10,
    "max_steps_per_generation": 5,
    "slot_allow_list": {
      "narrator": ["roll_dice", "get_time"]
    },
    "slot_deny_list": {
      "verifier": ["set_variable"]
    }
  }
}
```

### 替换工具权限

```http
PUT /sessions/:id/tool-permissions
```

整体替换会话的工具权限对象。请求体字段使用上面的同一组 `snake_case` 名称。

### 合并更新工具权限

```http
PATCH /sessions/:id/tool-permissions
```

`PATCH` 会按以下规则合并：

- `slot_allow_list`、`slot_deny_list` 按槽位键级别合并
- 其他顶层字段直接覆盖旧值

#### 请求示例

```json
{
  "max_calls_per_turn": 20,
  "slot_allow_list": {
    "director": ["get_time"]
  }
}
```

合并后，原有的 `narrator` 白名单会保留，并新增 `director` 白名单。

#### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败 |
| `404` | `not_found` | 会话不存在 |
