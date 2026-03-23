---
outline: [2, 3]
---

# Tools（工具调用）

工具调用系统允许 LLM 实例在 RP 回合中执行结构化操作（读写变量、掷骰、查询记忆等）。

## 内置工具

### GET /tools/builtin

列出引擎内置的工具。

**响应**

```json
{
  "data": [
    {
      "name": "roll_dice",
      "description": "掷骰子，返回随机结果",
      "sideEffectLevel": "none",
      "allowedSlots": [],
      "source": "builtin",
      "parameters": {
        "type": "object",
        "properties": {
          "sides": { "type": "number", "description": "骰子面数" },
          "count": { "type": "number", "description": "骰子个数" }
        }
      }
    }
  ]
}
```

当前内置 7 个工具：

| 工具名 | 说明 | 副作用级别 |
| ------ | ---- | ---------- |
| `get_variable` | 读取变量 | `none` |
| `set_variable` | 写入变量（page scope） | `sandbox` |
| `roll_dice` | 掷骰子 | `none` |
| `random_choice` | 从数组中随机选择 | `none` |
| `get_time` | 获取当前时间 | `none` |
| `query_memory` | 查询记忆条目 | `none` |
| `get_character_info` | 获取角色信息 | `none` |

## 工具定义 CRUD

### GET /tools/definitions

列出自定义工具定义。

**查询参数**

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `source` | string | 按来源过滤（`preset \| character \| custom`） |
| `source_id` | string | 按来源 ID 过滤 |
| `enabled` | boolean | 按启用状态过滤 |
| `limit` | integer | 每页条数 |
| `offset` | integer | 偏移量 |

### GET /tools/definitions/:id

获取单个工具定义。

### POST /tools/definitions

创建自定义工具。

**请求体**

```json
{
  "name": "lookup_npc",
  "description": "根据名字查找 NPC 信息",
  "parameters_json": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "description": "NPC 名字" }
    },
    "required": ["name"]
  },
  "side_effect_level": "none",
  "allowed_slots_json": ["narrator", "director"],
  "source": "custom",
  "handler_type": "script",
  "handler_json": { "script": "return { found: true, info: args.name }" }
}
```

### PATCH /tools/definitions/:id

更新工具定义（部分更新）。

### DELETE /tools/definitions/:id

删除工具定义。

### PATCH /tools/definitions/:id/toggle

启用或禁用工具。

**请求体**

```json
{
  "enabled": false
}
```

## 调用记录

### GET /tools/call-records

查询工具调用记录。至少需要提供 `page_id` 或 `floor_id` 之一。

**查询参数**

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `page_id` | string | 按消息页 ID 过滤 |
| `floor_id` | string | 按楼层 ID 过滤（查询该楼层下所有页的记录） |
| `caller_slot` | string | 按调用方实例过滤 |
| `status` | string | 按状态过滤（`success \| error \| denied`） |
| `limit` | integer | 每页条数 |
| `offset` | integer | 偏移量 |

**响应**

```json
{
  "data": [
    {
      "id": "tc_abc123",
      "page_id": "page_xyz",
      "seq": 0,
      "caller_slot": "narrator",
      "tool_name": "roll_dice",
      "args_json": { "sides": 20, "count": 1 },
      "result_json": { "data": { "rolls": [17], "total": 17 } },
      "status": "success",
      "duration_ms": 2,
      "created_at": 1719400000000
    }
  ],
  "meta": { "total": 1, "limit": 20, "offset": 0, "has_more": false }
}
```

## 会话工具权限

工具权限存储在会话的 `metadata_json.tool_permissions` 中。

### GET /sessions/:id/tool-permissions

获取会话的工具权限配置。

**响应**

```json
{
  "data": {
    "allowIrreversible": false,
    "maxCallsPerTurn": 10,
    "maxStepsPerGeneration": 5,
    "slotAllowList": {
      "narrator": ["roll_dice", "get_variable"]
    },
    "slotDenyList": {
      "verifier": ["set_variable"]
    }
  }
}
```

### PUT /sessions/:id/tool-permissions

整体替换会话的工具权限。

### PATCH /sessions/:id/tool-permissions

合并更新会话的工具权限。`slotAllowList` 和 `slotDenyList` 按槽位键级别合并，其他字段直接覆盖。

**请求体**

```json
{
  "maxCallsPerTurn": 20,
  "slotAllowList": {
    "director": ["get_time"]
  }
}
```

合并后，原有的 `narrator` 白名单保留，新增 `director` 白名单。
