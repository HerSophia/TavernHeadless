---
outline: [2, 3]
---

# Imports（导入）

提供 SillyTavern 生态的兼容导入接口。将 SillyTavern 原始 JSON 解析后存入数据库。

导入完成后，通过各资源的独立管理接口进行查看、编辑和删除：

- [Presets（预设管理）](./presets)
- [Worldbooks（世界书管理）](./worldbooks)
- [Regex Profiles（正则配置管理）](./regex-profiles)
- [Characters（角色卡管理）](./characters)

## 导入 Preset

```http
POST /import/preset
```

导入一个 SillyTavern 格式的预设（Preset）。系统会自动解析 `prompts`、`prompt_order` 等字段。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | 否 | 自定义名称，不传则从数据中提取 |
| `data` | object | **是** | SillyTavern 预设 JSON 数据（包含 `prompts`、`prompt_order` 等） |

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

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败或数据格式错误 |

## 导入 Worldbook

```http
POST /import/worldbook
```

导入一个 SillyTavern 格式的世界书。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | 否 | 自定义名称 |
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

## 导入 Regex 规则

```http
POST /import/regex
```

导入一组 SillyTavern 格式的正则替换规则。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | **是** | 规则集名称（正则脚本本身没有名称字段，必须提供） |
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

## 导入角色卡

```http
POST /import/character
```

导入一个 SillyTavern Character Card V2 格式的角色卡。可选同时创建会话。

请求体大小限制：**200KB**。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `payload` | object | **是** | SillyTavern Character Card V2 JSON |
| `create_session` | boolean | 否 | 是否同时创建会话（默认 `false`） |
| `title` | string | 否 | 会话标题（`create_session=true` 时使用），1-200 字符 |

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

### 响应 `201`

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
    "character_id": "char_luna",
    "character_version_id": "charver_luna_1",
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

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败或角色卡格式错误 |
| `413` | 请求体超过 200KB 限制 |

## 导入聊天文件

```http
POST /import/chat
```

导入一个聊天文件。支持两种格式的自动识别：

- **TavernHeadless 原生格式（`.thchat`）**：JSON 文件，信封字段 `spec === "tavern_headless_chat"`
- **SillyTavern JSONL 格式（`.jsonl`）**：每行一个 JSON 对象，第一行为头部信息

系统通过 `JSON.parse` 尝试解析整个内容，如果成功且 `spec` 字段为 `"tavern_headless_chat"`，则走原生格式导入路径；否则按 ST JSONL 格式处理。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `data` | string | **是** | 聊天文件的文本内容（JSONL 或 JSON） |
| `character_id` | string | 否 | 绑定角色 ID，导入后会话关联该角色 |
| `title` | string | 否 | 自定义会话标题，不传则从文件中推断 |

### 请求示例

```json
{
  "data": "{\"user_name\":\"Player\",\"character_name\":\"Luna\",\"chat_metadata\":{}}\n{\"name\":\"Player\",\"is_user\":true,\"mes\":\"Hello!\"}\n{\"name\":\"Luna\",\"is_user\":false,\"mes\":\"Hi there!\"}",
  "character_id": "char_luna",
  "title": "Imported Chat"
}
```

### 响应 `200`

**ST JSONL 格式导入响应：**

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

**TavernHeadless 原生格式导入响应：**

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

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `session_id` | string | 创建的会话 ID |
| `title` | string | 会话标题 |
| `floor_count` | integer | 导入的楼层数 |
| `message_count` | integer | 导入的消息数 |
| `swipe_count` | integer | 导入的 swipe（多版本消息页）数 |
| `skipped_lines` | integer | 跳过的无法解析的行数（仅 ST JSONL） |
| `import_source` | string | 导入来源标识 |
| `format` | string | 检测到的格式：`thchat` 或 `sillytavern_jsonl` |
| `page_count` | integer | 消息页总数（仅 thchat） |
| `variable_count` | integer | 导入的变量数（仅 thchat） |
| `memory_item_count` | integer | 导入的记忆条目数（仅 thchat） |
| `memory_edge_count` | integer | 导入的记忆关系边数（仅 thchat） |

### ST JSONL 格式处理细节

**消息分组规则：**

- 用户消息（`is_user: true`）开始一个新楼层，对应 `pageKind: "input"`
- 助手消息（`is_user: false`）归入当前楼层，对应 `pageKind: "output"`
- 开头的助手消息（没有前置用户消息）映射为 floor 0（greeting）
- `is_system: true` 的消息标记为 `isHidden: true`

**Swipe 处理：**

- 消息的 `swipes` 数组中的每个条目创建为独立的 `message_page`，`version` 递增
- `swipe_id` 指定的版本标记为 `isActive: true`

**时间解析：**

- `send_date` 支持数值（Unix 毫秒）、ISO 8601 字符串、人类可读字符串
- 无法解析时回退到 `Date.now()`

**容错处理：**

- 空行和无法解析的行跳过而非报错
- Chub Chat 格式的对象型 `mes` 字段自动展平

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败、文件内容为空、头部缺少必需字段 |
| `400` | thchat 格式版本不兼容（主版本号不匹配） |