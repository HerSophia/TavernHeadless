---
outline: [2, 3]
---

# Presets（预设管理）

管理通过 [导入接口](./imports#导入-preset) 导入的 SillyTavern 预设。预设有两种视图：原始数据视图和编辑器视图。

编辑器视图将 SillyTavern 原始格式（包括 legacy 格式）转换为统一的结构化数据模型，便于前端编辑。更新时系统自动将编辑器文档转回原始格式存储。

## 列出 Presets

```http
GET /presets
```

### 响应 `200`

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

## 获取 Preset 详情（原始数据）

```http
GET /presets/:id
```

返回原始 SillyTavern JSON 数据。

### 响应 `200`

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

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 预设不存在 |

## 获取 Preset 编辑器视图

```http
GET /presets/:id/editor
```

返回结构化的编辑器文档。系统会将原始 SillyTavern 格式（包括 legacy 格式）转换为统一的编辑器数据模型。

### 响应 `200`

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

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 预设不存在 |
| `422` | 预设数据无法转换为编辑器格式 |

## Editor Document 结构

编辑器文档由以下部分组成：

### entries（提示词条目数组）

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

### order_contexts（排序上下文数组）

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

### top_level（顶层参数）

`top_level` 是一个自由 key-value 对象，保存预设级的生成参数，如 `temperature`、`frequency_penalty` 等。

## 更新 Preset

```http
PUT /presets/:id
```

使用编辑器格式更新预设。系统会将编辑器文档转回 SillyTavern 原始格式存储。

支持乐观锁：传入 `expected_updated_at`，如果数据库中的 `updated_at` 不匹配则返回 `409`。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | **是** | 名称（至少 1 字符） |
| `editor` | EditorDocument | **是** | 编辑器文档 |
| `expected_updated_at` | integer | 否 | 乐观锁：期望的 `updated_at` 值 |

### 请求示例

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

### 响应 `200`

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

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `400` | 请求体校验失败 |
| `404` | 预设不存在 |
| `409` | 乐观锁冲突：`expected_updated_at` 不匹配 |

## 删除 Preset

```http
DELETE /presets/:id
```

### 响应 `204`

无响应体。