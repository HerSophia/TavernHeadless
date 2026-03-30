---
outline: [2, 3]
---

# Imports（导入）

提供 SillyTavern 生态的兼容导入接口。系统会解析原始数据，然后写入 TavernHeadless 的资源表。

导入完成后，后续查看、编辑和删除应使用对应的资源接口：

- [Presets（预设管理）](./presets)
- [Worldbooks（世界书管理）](./worldbooks)
- [Regex Profiles（正则配置管理）](./regex-profiles)
- [Characters（角色卡管理）](./characters)

其中 `POST /import/preset` 和 `POST /import/worldbook` 现在也会遵循资源写入繁忙语义：当 SQLite 写入暂时繁忙且重试耗尽时，返回 `503 resource_busy`。

## 导入 Preset

```http
POST /import/preset
```

导入一个 SillyTavern 格式的预设。系统会解析 `prompts`、`prompt_order` 等字段，然后写入 `preset` 资源。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | 否 | 自定义名称；不传时默认使用 `Unnamed Preset` |
| `data` | object | **是** | SillyTavern 预设 JSON 数据 |

### 请求示例

```json
{
  "name": "Story Preset",
  "data": {
    "prompts": [],
    "prompt_order": []
  }
}
```

### 响应 `201`

```json
{
  "data": {
    "id": "preset_story",
    "name": "Story Preset",
    "source": "sillytavern"
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `import_parse_error` | 请求体校验失败，或预设 JSON 无法解析 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |

## 导入 Worldbook

```http
POST /import/worldbook
```

导入一个 SillyTavern 格式的世界书。系统会解析世界书全局配置和条目数据，然后分别写入 `worldbook` 与 `worldbook_entry`。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | 否 | 自定义名称；不传时优先使用世界书内名称，否则使用 `Unnamed Worldbook` |
| `data` | object | **是** | SillyTavern 世界书 JSON 数据 |

### 请求示例

```json
{
  "name": "Kingdom Lore",
  "data": {
    "entries": [
      {
        "keys": ["kingdom"],
        "content": "The kingdom is recovering from a long war."
      }
    ]
  }
}
```

### 响应 `201`

```json
{
  "data": {
    "id": "wb_kingdom",
    "name": "Kingdom Lore",
    "source": "sillytavern"
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `import_parse_error` | 请求体校验失败，或世界书 JSON 无法解析 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |

## 导入 Regex 规则

```http
POST /import/regex
```

导入一组 SillyTavern 正则替换脚本。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | **是** | 规则集名称 |
| `data` | object[] | **是** | SillyTavern 正则规则数组 |

### 请求示例

```json
{
  "name": "Safety Filters",
  "data": [
    {
      "scriptName": "trim_whitespace",
      "find": "\\s+$",
      "replace": ""
    }
  ]
}
```

### 响应 `201`

```json
{
  "data": {
    "id": "regex_safe",
    "name": "Safety Filters",
    "source": "sillytavern",
    "script_count": 1
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `import_parse_error` | 请求体校验失败，或正则规则数组无法解析 |

## 导入角色卡

```http
POST /import/character
```

导入一个 SillyTavern 角色卡。当前优先支持 TavernCard V2。

请求体大小限制是 **200KB**。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `payload` | object | **是** | SillyTavern Character Card JSON |
| `create_session` | boolean | 否 | 是否同时创建会话，默认 `false` |
| `title` | string | 否 | 当 `create_session=true` 时使用的会话标题 |

### 请求示例

```json
{
  "payload": {
    "spec": "chara_card_v2",
    "spec_version": "2.0",
    "data": {
      "name": "Luna",
      "description": "A moon priestess who keeps watch at night.",
      "personality": "Calm and precise",
      "scenario": "Night watch at the city wall",
      "first_mes": "The moon is bright tonight.",
      "mes_example": "<START>\n{{char}}: The tide is turning."
    }
  },
  "create_session": true,
  "title": "Luna Demo Session"
}
```

### 响应 `201`（仅导入角色）

```json
{
  "data": {
    "create_session": false,
    "character": {
      "name": "Luna",
      "description": "A moon priestess who keeps watch at night.",
      "personality": "Calm and precise",
      "scenario": "Night watch at the city wall",
      "first_mes": "The moon is bright tonight.",
      "mes_example": "<START>\n{{char}}: The tide is turning."
    },
    "character_id": "char_luna",
    "character_version_id": "charver_luna_1"
  }
}
```

### 响应 `201`（导入角色并创建会话）

```json
{
  "data": {
    "create_session": true,
    "character": {
      "name": "Luna",
      "description": "A moon priestess who keeps watch at night.",
      "personality": "Calm and precise",
      "scenario": "Night watch at the city wall",
      "first_mes": "The moon is bright tonight.",
      "mes_example": "<START>\n{{char}}: The tide is turning."
    },
    "session": {
      "id": "sess_luna",
      "title": "Luna Demo Session",
      "status": "active",
      "character_binding": {
        "character_id": "char_luna",
        "character_version_id": "charver_luna_1",
        "sync_policy": "pin",
        "snapshot_summary": {
          "name": "Luna",
          "has_greeting": true
        }
      },
      "created_at": 1735689600000,
      "updated_at": 1735689660000
    }
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `import_parse_error` | 请求体校验失败，或角色卡无法解析 |
| `413` | `import_payload_too_large` | 请求体超过 `200KB` 限制 |

## 导入聊天文件

```http
POST /import/chat
```

导入聊天文件。接口会自动识别两种格式：

- `.thchat`：TavernHeadless 原生 JSON 格式，要求 `spec === "tavern_headless_chat"`
- `.jsonl`：SillyTavern JSONL 格式

`.thchat` 中的记忆条目支持 Memory V2 元数据，例如 `summary_tier`、`lifecycle_status`、`source_job_id`、coverage 统计，以及扩展关系类型 `derived_from`、`compacts`、`resolves`。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `data` | string | **是** | 聊天文件文本内容（JSONL 或 JSON） |
| `character_id` | string | 否 | 绑定角色 ID；导入后会话会关联该角色 |
| `title` | string | 否 | 自定义会话标题；不传时从文件推断 |

### 请求示例

```json
{
  "data": "{\"user_name\":\"Player\",\"character_name\":\"Luna\",\"chat_metadata\":{}}\n{\"name\":\"Player\",\"is_user\":true,\"mes\":\"Hello!\"}\n{\"name\":\"Luna\",\"is_user\":false,\"mes\":\"Hi there!\"}",
  "character_id": "char_luna",
  "title": "Imported Chat"
}
```

### 响应 `201`（SillyTavern JSONL）

```json
{
  "data": {
    "session_id": "sess_import_001",
    "title": "Luna",
    "floor_count": 1,
    "message_count": 2,
    "swipe_count": 0,
    "skipped_lines": 0,
    "import_source": "sillytavern_jsonl",
    "format": "sillytavern_jsonl"
  }
}
```

### 响应 `201`（`.thchat`）

```json
{
  "data": {
    "session_id": "sess_import_002",
    "title": "Campfire Scene",
    "floor_count": 5,
    "message_count": 10,
    "swipe_count": 3,
    "skipped_lines": 0,
    "import_source": "thchat",
    "format": "thchat",
    "page_count": 13,
    "variable_count": 2,
    "memory_item_count": 4,
    "memory_edge_count": 1
  }
}
```

### 返回字段说明

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `session_id` | string | 创建的会话 ID |
| `title` | string | 会话标题 |
| `floor_count` | integer | 导入的楼层数 |
| `message_count` | integer | 导入的消息数 |
| `swipe_count` | integer | 导入的 swipe 数 |
| `skipped_lines` | integer | 跳过的无法解析行数（仅 ST JSONL） |
| `import_source` | string | 导入来源标识 |
| `format` | string | 检测到的格式：`thchat` 或 `sillytavern_jsonl` |
| `page_count` | integer | 消息页总数（仅 `.thchat`） |
| `variable_count` | integer | 导入的变量数（仅 `.thchat`） |
| `memory_item_count` | integer | 导入的记忆条目数（仅 `.thchat`） |
| `memory_edge_count` | integer | 导入的记忆关系边数（仅 `.thchat`） |

### 处理细节

**消息分组规则：**

- `is_user: true` 的消息会开启一个新的楼层，对应 `pageKind: "input"`
- `is_user: false` 的消息会归入当前楼层，对应 `pageKind: "output"`
- 如果文件开头就是助手消息，会映射到 greeting 楼层
- `is_system: true` 的消息会标记为隐藏消息

**Swipe 处理：**

- `swipes` 数组中的每个条目都会生成独立的 `message_page`
- `swipe_id` 指定的版本会标记为活动页

**时间解析：**

- `send_date` 支持 Unix 毫秒、ISO 8601 字符串和常见文本时间格式
- 无法解析时回退到 `Date.now()`

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `import_parse_error` | 请求体校验失败，或文件内容无法解析 |
| `400` | `import_empty` | 聊天文件中没有可导入消息 |
| `400` | `import_unsupported_version` | `.thchat` 的 `spec_version` 主版本号不受支持 |
| `400` | `character_not_found` | 指定的 `character_id` 不存在或当前账号不可见 |
