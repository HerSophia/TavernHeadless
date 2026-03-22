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