---
outline: [2, 3]
---

# Imports（导入与资源管理）

提供 SillyTavern 生态的兼容导入，以及 Preset、Worldbook、Regex Profile 的 CRUD 管理。

导入接口将 SillyTavern 原始 JSON 解析后存入数据库，后续通过各资源的管理接口进行查看、编辑和删除。

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

---

## Presets 管理

所有导入的预设通过以下接口管理。预设有两种视图：原始数据视图（`data`）和编辑器视图（`editor`）。

### Resource 列表项

所有资源（Preset、Worldbook、Regex Profile）共享统一的列表项结构：

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 资源 ID |
| `name` | string | 名称 |
| `source` | string | 来源（如 `sillytavern`） |
| `created_at` | integer | 创建时间 |
| `updated_at` | integer | 更新时间 |

### 列出 Presets

```http
GET /presets
```

#### 响应 `200`

```json
{
  "data": [
    {
      "id": "preset_story",
      "name": "Story Preset",
      "source": "sillytavern",
      "created_at": 1735689600000,
      "updated_at": 1735689660000
    }
  ]
}
```

### 获取 Preset 详情（原始数据）

```http
GET /presets/:id
```

返回原始 SillyTavern JSON 数据。

#### 响应 `200`

```json
{
  "data": {
    "id": "preset_story",
    "name": "Story Preset",
    "source": "sillytavern",
    "data": {
      "prompts": [],
      "prompt_order": []
    },
    "created_at": 1735689600000,
    "updated_at": 1735689660000
  }
}
```

#### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 预设不存在 |

### 获取 Preset 编辑器视图

```http
GET /presets/:id/editor
```

返回结构化的编辑器文档。系统会将原始 SillyTavern 格式（包括 legacy 格式）转换为统一的编辑器数据模型。

#### 响应 `200`

```json
{
  "data": {
    "id": "preset_story",
    "name": "Story Preset",
    "source": "sillytavern",
    "editor": {
      "default_character_id": 100000,
      "entries": [
        {
          "identifier": "main",
          "name": "System Guidance",
          "role": "system",
          "content": "Stay in character and keep the tone warm.",
          "system_prompt": true,
          "marker": false,
          "injection_position": 0,
          "enabled": true,
          "extra": {}
        }
      ],
      "order_contexts": [
        {
          "character_id": 100000,
          "order": [
            { "identifier": "main", "enabled": true }
          ],
          "extra": {}
        }
      ],
      "top_level": {
        "temperature": 0.7
      }
    },
    "created_at": 1735689600000,
    "updated_at": 1735689660000
  }
}
```

#### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 预设不存在 |
| `422` | 预设数据无法转换为编辑器格式 |

### Preset Editor Document 结构

编辑器文档由以下部分组成：

#### entries（提示词条目数组）

| 字段 | 类型 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| `identifier` | string | - | 条目唯一标识（必填） |
| `name` | string | `""` | 显示名称 |
| `role` | string | `"system"` | 角色：`system` / `user` / `assistant` |
| `content` | string | `""` | 提示词内容 |
| `system_prompt` | boolean | `false` | 是否为系统提示 |
| `marker` | boolean | `false` | 是否为标记条目 |
| `injection_position` | integer | `0` | 注入位置 |
| `injection_depth` | integer | - | 注入深度（可选） |
| `injection_order` | integer | - | 注入顺序（可选） |
| `forbid_overrides` | boolean | - | 是否禁止覆盖（可选） |
| `injection_trigger` | array | - | 注入触发条件（可选） |
| `enabled` | boolean | `true` | 是否启用 |
| `extra` | object | `{}` | 额外字段（透传未知属性） |

#### order_contexts（排序上下文数组）

| 字段 | 类型 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| `character_id` | integer | - | 角色 ID（SillyTavern 内部编号，默认 `100000`） |
| `order` | OrderItem[] | `[]` | 条目排序列表 |
| `extra` | object | `{}` | 额外字段 |

每个 OrderItem：

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `identifier` | string | 条目标识 |
| `enabled` | boolean | 是否启用 |

#### top_level（顶层参数）

`top_level` 是一个自由 key-value 对象，保存预设级的生成参数，如 `temperature`、`frequency_penalty` 等。

### 更新 Preset

```http
PUT /presets/:id
```

使用编辑器格式更新预设。系统会将编辑器文档转回 SillyTavern 原始格式存储。

支持乐观锁：传入 `expected_updated_at`，如果数据库中的 `updated_at` 不匹配则返回 `409`。

#### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | **是** | 名称（至少 1 字符） |
| `editor` | EditorDocument | **是** | 编辑器文档 |
| `expected_updated_at` | integer | 否 | 乐观锁：期望的 `updated_at` 值 |

#### 请求示例

```json
{
  "name": "Story Preset",
  "expected_updated_at": 1735689660000,
  "editor": {
    "default_character_id": 100000,
    "entries": [
      {
        "identifier": "main",
        "name": "System Guidance",
        "role": "system",
        "content": "Stay in character and keep the tone warm.",
        "system_prompt": true,
        "marker": false,
        "injection_position": 0,
        "enabled": true,
        "extra": {}
      }
    ],
    "order_contexts": [
      {
        "character_id": 100000,
        "order": [{ "identifier": "main", "enabled": true }],
        "extra": {}
      }
    ],
    "top_level": {
      "temperature": 0.7
    }
  }
}
```

#### 响应 `200`

```json
{
  "data": {
    "id": "preset_story",
    "name": "Story Preset",
    "source": "sillytavern",
    "created_at": 1735689600000,
    "updated_at": 1735690000000
  }
}
```

#### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败 |
| `404` | 预设不存在 |
| `409` | 乐观锁冲突：`expected_updated_at` 不匹配 |

### 删除 Preset

```http
DELETE /presets/:id
```

#### 响应 `204`

无响应体。

---

## Worldbooks 管理

### 列出 Worldbooks

```http
GET /worldbooks
```

#### 响应 `200`

```json
{
  "data": [
    {
      "id": "wb_kingdom",
      "name": "Kingdom Lore",
      "source": "sillytavern",
      "created_at": 1735689600000,
      "updated_at": 1735689660000
    }
  ]
}
```

### 获取 Worldbook 详情

```http
GET /worldbooks/:id
```

返回完整的世界书数据。

#### 响应 `200`

```json
{
  "data": {
    "id": "wb_kingdom",
    "name": "Kingdom Lore",
    "source": "sillytavern",
    "data": {
      "entries": [
        {
          "keys": ["kingdom"],
          "content": "The kingdom is recovering from a long war."
        }
      ]
    },
    "created_at": 1735689600000,
    "updated_at": 1735689660000
  }
}
```

#### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 世界书不存在 |

### 更新 Worldbook

```http
PUT /worldbooks/:id
```

支持乐观锁。

#### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | **是** | 名称（至少 1 字符） |
| `data` | object | **是** | 世界书 JSON 数据 |
| `expected_updated_at` | integer | 否 | 乐观锁 |

#### 请求示例

```json
{
  "name": "Kingdom Lore v2",
  "data": {
    "entries": [
      {
        "keys": ["kingdom", "realm"],
        "content": "The kingdom has entered a new era of peace."
      }
    ]
  },
  "expected_updated_at": 1735689660000
}
```

#### 响应 `200`

```json
{
  "data": {
    "id": "wb_kingdom",
    "name": "Kingdom Lore v2",
    "source": "sillytavern",
    "created_at": 1735689600000,
    "updated_at": 1735690000000
  }
}
```

#### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败 |
| `404` | 世界书不存在 |
| `409` | 乐观锁冲突 |

### 删除 Worldbook

```http
DELETE /worldbooks/:id
```

#### 响应 `204`

无响应体。

---

## Regex Profiles 管理

### 列出 Regex Profiles

```http
GET /regex-profiles
```

#### 响应 `200`

```json
{
  "data": [
    {
      "id": "regex_safe",
      "name": "Safety Filters",
      "source": "sillytavern",
      "created_at": 1735689600000,
      "updated_at": 1735689660000
    }
  ]
}
```

### 获取 Regex Profile 详情

```http
GET /regex-profiles/:id
```

返回完整的正则规则数据。

#### 响应 `200`

```json
{
  "data": {
    "id": "regex_safe",
    "name": "Safety Filters",
    "source": "sillytavern",
    "data": [
      {
        "scriptName": "trim_whitespace",
        "find": "\\s+$",
        "replace": ""
      }
    ],
    "created_at": 1735689600000,
    "updated_at": 1735689660000
  }
}
```

#### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 正则配置不存在 |

### 删除 Regex Profile

```http
DELETE /regex-profiles/:id
```

#### 响应 `204`

无响应体。