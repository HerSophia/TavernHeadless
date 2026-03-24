---
outline: [2, 3]
---

# Tools（工具调用）

工具调用系统允许 LLM 实例在 RP 回合中执行结构化操作（读写变量、掷骰、查询记忆等）。

## 内置工具

### 列出内置工具

```http
GET /tools/builtin
```

#### 响应 `200`

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

### 通用内置工具

当前内置 7 个通用工具：

| 工具名 | 说明 | 副作用级别 |
| ------ | ---- | ---------- |
| `get_variable` | 读取变量 | `none` |
| `set_variable` | 写入变量（page scope） | `sandbox` |
| `roll_dice` | 掷骰子 | `none` |
| `random_choice` | 从数组中随机选择 | `none` |
| `get_time` | 获取当前时间 | `none` |
| `query_memory` | 查询记忆条目 | `none` |
| `get_character_info` | 获取角色信息 | `none` |

### 资源管理工具

除上述 7 个通用内置工具外，引擎还提供 23 个资源管理工具，允许 LLM 在对话过程中读写角色卡、世界书、正则配置文件和预设。这些工具由 `ResourceToolProvider` 提供，`source` 同样为 `builtin`。

所有写入工具通过 `accountId` 进行多账户隔离，创建的资源 `source` 标记为 `tool`。

#### 角色卡工具

| 工具名 | 说明 | 副作用级别 |
| ------ | ---- | ---------- |
| `create_character` | 创建角色卡（含初始版本） | `irreversible` |
| `update_character` | 为已有角色卡创建新版本快照 | `irreversible` |
| `get_character` | 读取角色卡及其最新版本 | `none` |
| `list_characters` | 列出当前账户的角色卡 | `none` |
| `list_character_versions` | 列出角色卡版本历史 | `none` |

`create_character` 参数：

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | **是** | 角色名称 |
| `description` | string | 否 | 角色描述 |
| `personality` | string | 否 | 性格概要 |
| `scenario` | string | 否 | 场景设定 |
| `first_mes` | string | 否 | 首条（问候）消息 |
| `mes_example` | string | 否 | 对话示例 |

`update_character` 参数同上，额外必填 `character_id`。只传需要修改的字段，未传字段保留原值。

`list_character_versions` 参数：

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `character_id` | string | **是** | 角色 ID |
| `limit` | integer | 否 | 返回条数（默认 10，最大 50） |

#### 世界书工具

| 工具名 | 说明 | 副作用级别 |
| ------ | ---- | ---------- |
| `create_worldbook` | 创建空世界书 | `irreversible` |
| `create_worldbook_entry` | 在世界书中创建条目 | `irreversible` |
| `update_worldbook_entry` | 更新世界书条目 | `irreversible` |
| `get_worldbook` | 读取世界书及其所有条目 | `none` |
| `list_worldbooks` | 列出当前账户的世界书 | `none` |
| `list_worldbook_entries` | 列出世界书条目摘要（不含 content） | `none` |
| `get_worldbook_entry` | 读取世界书单个条目（含 content） | `none` |

`create_worldbook_entry` 参数：

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `worldbook_id` | string | **是** | 世界书 ID |
| `keys` | string[] | **是** | 触发关键词 |
| `content` | string | **是** | 条目内容 |
| `comment` | string | 否 | 注释 / 标签 |
| `keys_secondary` | string[] | 否 | 二级关键词（选择性模式） |
| `selective` | boolean | 否 | 启用选择性模式（默认 `true`） |
| `constant` | boolean | 否 | 常驻激活（默认 `false`） |
| `position` | number | 否 | 注入位置 0-6（默认 `0`） |
| `order` | number | 否 | 优先级（默认 `100`） |
| `depth` | number | 否 | 注入深度（默认 `4`） |
| `disable` | boolean | 否 | 禁用该条目（默认 `false`） |

`list_worldbook_entries` 只返回每个条目的 `id`、`uid`、`comment`、`keys`、`keys_secondary`、`order`、`disable`，不返回 `content`。用于浏览世界书索引后按需调用 `get_worldbook_entry` 读取完整内容。

`list_worldbook_entries` 参数：

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `worldbook_id` | string | **是** | 世界书 ID |
| `limit` | integer | 否 | 返回条数（默认 50，最大 200） |

`get_worldbook_entry` 参数：

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `worldbook_id` | string | **是** | 世界书 ID |
| `entry_id` | string | **是** | 条目 ID |

#### 正则配置文件工具

| 工具名 | 说明 | 副作用级别 |
| ------ | ---- | ---------- |
| `create_regex_profile` | 创建空的正则配置文件 | `irreversible` |
| `create_regex_rule` | 向正则配置文件追加规则 | `irreversible` |
| `update_regex_rule` | 按索引更新正则规则 | `irreversible` |
| `get_regex_profile` | 读取正则配置文件及其规则 | `none` |
| `list_regex_profiles` | 列出当前账户的正则配置文件 | `none` |
| `get_regex_rule` | 读取正则配置文件的单条规则 | `none` |

`create_regex_profile` 参数：

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | **是** | 配置文件名称 |

`create_regex_rule` 参数：

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `profile_id` | string | **是** | 正则配置文件 ID |
| `find_regex` | string | **是** | 匹配用的正则表达式 |
| `replace_string` | string | **是** | 替换字符串 |
| `script_name` | string | 否 | 规则名称 |
| `trim_strings` | string[] | 否 | 需要修剪的字符串 |
| `placement` | number[] | 否 | 应用位置（默认 `[2]`，即 AI 输出） |
| `disabled` | boolean | 否 | 禁用该规则（默认 `false`） |

`get_regex_rule` 参数：

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `profile_id` | string | **是** | 正则配置文件 ID |
| `rule_index` | integer | **是** | 规则索引（0-based） |

#### 预设工具

| 工具名 | 说明 | 副作用级别 |
| ------ | ---- | ---------- |
| `list_presets` | 列出当前账户的预设 | `none` |
| `get_preset` | 读取预设详情（含条目列表） | `none` |
| `get_preset_entry` | 读取预设的单个条目 | `none` |
| `create_preset_entry` | 在预设中创建提示词条目 | `irreversible` |
| `update_preset_entry` | 更新预设中的条目 | `irreversible` |

`create_preset_entry` 参数：

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `preset_id` | string | **是** | 预设 ID |
| `identifier` | string | **是** | 条目唯一标识符 |
| `name` | string | 否 | 显示名称 |
| `role` | string | 否 | 消息角色（`system` / `assistant` / `user`，默认 `system`） |
| `content` | string | 否 | 提示词文本 |
| `system_prompt` | boolean | 否 | 是否为系统提示词（默认 `false`） |
| `marker` | boolean | 否 | 是否为标记条目（默认 `false`） |
| `injection_position` | integer | 否 | 注入位置（默认 `0`） |
| `enabled` | boolean | 否 | 是否启用（默认 `true`） |

`update_preset_entry` 参数同上，`identifier` 用于定位要更新的条目，���传需要修改的字段。

`get_preset_entry` 参数：

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `preset_id` | string | **是** | 预设 ID |
| `identifier` | string | **是** | 条目标识符 |

::: tip MCP 工具
除内置工具外，还支持通过 [MCP 服务器](./mcp) 注册外部工具。MCP 工具通过 `ToolProvider` 接口注册，对上层透明，行为与内置工具一致。详见 [MCP Servers](./mcp)。
:::

## 工具定义 CRUD

管理自定义工具定义。自定义工具允许用户创建自己的工具逻辑，绑定到预设、角色或全局使用。

### 列出工具定义

```http
GET /tools/definitions
```

#### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `source` | string | 按来源过滤（`preset` \| `character` \| `custom`） |
| `source_id` | string | 按来源 ID 过滤 |
| `enabled` | boolean | 按启用状态过滤 |
| `limit` | integer | 每页条数 |
| `offset` | integer | 偏移量 |

### 获取工具定义

```http
GET /tools/definitions/:id
```

### 创建工具定义

```http
POST /tools/definitions
```

#### 请求体

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

### 更新工具定义

```http
PATCH /tools/definitions/:id
```

部分更新。

### 删除工具定义

```http
DELETE /tools/definitions/:id
```

### 启用/禁用工具

```http
PATCH /tools/definitions/:id/toggle
```

#### 请求体

```json
{
  "enabled": false
}
```

## 调用记录

### 查询调用记录

```http
GET /tools/call-records
```

至少需要提供 `page_id` 或 `floor_id` 之一。

#### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `page_id` | string | 按消息页 ID 过滤 |
| `floor_id` | string | 按楼层 ID 过滤（查询该楼层下所有页的记录） |
| `caller_slot` | string | 按调用方实例过滤 |
| `status` | string | 按状态过滤（`success` \| `error` \| `denied`） |
| `limit` | integer | 每页条数 |
| `offset` | integer | 偏移量 |

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

### 获取工具权限

```http
GET /sessions/:id/tool-permissions
```

#### 响应 `200`

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

### 替换工具权限

```http
PUT /sessions/:id/tool-permissions
```

整体替换会话的工具权限。

### 合并更新工具权限

```http
PATCH /sessions/:id/tool-permissions
```

`slotAllowList` 和 `slotDenyList` 按槽位键级别合并，其他字段直接覆盖。

#### 请求体

```json
{
  "maxCallsPerTurn": 20,
  "slotAllowList": {
    "director": ["get_time"]
  }
}
```

合并后，原有的 `narrator` 白名单保留，新增 `director` 白名单。
