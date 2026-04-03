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
      "updated_at": 1735689660000,
      "version": 3
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
    "updated_at": 1735689660000,
    "version": 3
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 预设不存在 |

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
    "updated_at": 1735689660000,
    "version": 3
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `preset_not_found` | 预设不存在 |
| `422` | `preset_unsupported_shape` | 预设数据无法转换为编辑器格式 |

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

此接口要求提供并发控制字段：

- 新接入应优先传 `expected_version`
- 现有主资源 `PUT` 路由仍兼容 `expected_updated_at`
- 如果两者都不传，会返回 `400`

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `name` | string | **是** | 名称（至少 1 字符） |
| `editor` | EditorDocument | **是** | 编辑器文档 |
| `expected_version` | integer | 否 | 推荐的乐观锁字段；期望的 `version` 值 |
| `expected_updated_at` | integer | 否 | 兼容字段；仅用于已有主资源 `PUT` 调用方 |

### 请求示例

```json
{
  "name": "Story Preset",
  "expected_version": 3,
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
    "updated_at": 1735690000000,
    "version": 4
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体校验失败，或未提供 `expected_version` / `expected_updated_at` |
| `404` | `preset_not_found` | 预设不存在 |
| `409` | `preset_conflict` | 版本基线过期，或兼容字段 `expected_updated_at` 不匹配 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |

## 删除 Preset

```http
DELETE /presets/:id
```

删除时推荐通过 query string 传入 `expected_version`。此接口不使用 `DELETE` 请求体。

当省略 `expected_version` 时，当前实现走**无前置条件的幂等 `204` 删除路径**；即使目标资源不存在，也仍然返回 `204`。只有显式提供 `expected_version` 时，服务端才会先加载资源并在缺失时返回 `404 preset_not_found`。

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `expected_version` | integer | 否 | 推荐的版本前置条件；不传时保留无前置条件删除行为 |

### 请求示例

```http
DELETE /presets/preset_story?expected_version=4
```

### 响应 `204`

无响应体。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 查询参数校验失败 |
| `404` | `preset_not_found` | 仅在提供 `expected_version` 时，目标预设不存在 |
| `409` | `preset_conflict` | `expected_version` 与服务端当前版本不一致 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |

---

## Preset Entries（提示词条目管理）

对预设中的单个提示词条目进行增删改查和批量操作，无需通过编辑器视图操作整个预设。

所有条目端点都挂载在 `/presets/:preset_id/entries` 下。

### 写入并发控制

以下写入端点都支持 `expected_version`：

- `POST /presets/:preset_id/entries`
- `PATCH /presets/:preset_id/entries/:identifier`
- `PUT /presets/:preset_id/entries/reorder`
- `PATCH /presets/:preset_id/entries/batch/update`
- `POST /presets/:preset_id/entries/batch/delete`

其中 `DELETE /presets/:preset_id/entries/:identifier` 使用 query string `expected_version`，其他写入端点通过 JSON body 传递 `expected_version`。当版本基线过期时返回 `409 preset_conflict`；当 SQLite 写入暂时繁忙时返回 `503 resource_busy`。

::: tip 存储方式
预设条目存储在 `preset.data_json` 的 JSON blob 内（即 SillyTavern 原始格式中的 `prompts[]` 和 `prompt_order[]`），通过 read-modify-write 模式操作。不同于世界书条目的独立表存储。这保证了与 SillyTavern 预设格式的无损兼容。
:::

## 条目字段说明

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `identifier` | string | 条目唯一标识（`[a-zA-Z0-9_-]`，1–64 字符） |
| `name` | string | 显示名称 |
| `role` | string | 角色：`system` / `user` / `assistant` |
| `content` | string | 提示词内容 |
| `system_prompt` | boolean | 是否为系统提示 |
| `marker` | boolean | 是否为标记条目（如 `chatHistory`、`newChat`） |
| `injection_position` | integer | 注入位置 |
| `injection_depth` | integer | 注入深度（可选） |
| `injection_order` | integer | 注入顺序（可选） |
| `forbid_overrides` | boolean | 是否禁止覆盖（可选） |
| `injection_trigger` | array | 注入触发条件（可选） |
| `enabled` | boolean | 是否在默认排序上下文中启用 |
| `extra` | object | 额外字段（透传 SillyTavern 未来新增的属性，保证前向兼容） |

## 列出条目

```http
GET /presets/:preset_id/entries
```

返回按默认排序上下文（`prompt_order[0]`）排列的所有条目。

### 查询参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `enabled` | string | 按启用状态过滤：`"true"` / `"false"` |
| `marker` | string | 按标记状态过滤：`"true"` / `"false"` |

### 响应 `200`

```json
{
  "data": {
    "preset_id": "preset_story",
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
      },
      {
        "identifier": "chatHistory",
        "name": "Chat History",
        "role": "system",
        "content": "",
        "system_prompt": false,
        "marker": true,
        "injection_position": 0,
        "enabled": true,
        "extra": {}
      }
    ]
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 预设不存在 |

## 创建条目

```http
POST /presets/:preset_id/entries
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `expected_version` | integer | 否 | 期望的父预设 `version` 值 |
| `identifier` | string | **是** | 唯一标识（`[a-zA-Z0-9_-]`，1–64 字符） |
| `name` | string | 否 | 显示名称，默认 `""` |
| `role` | string | 否 | 角色，默认 `"system"` |
| `content` | string | 否 | 提示词内容，默认 `""` |
| `system_prompt` | boolean | 否 | 默认 `false` |
| `marker` | boolean | 否 | 默认 `false` |
| `injection_position` | integer | 否 | 默认 `0` |
| `injection_depth` | integer | 否 | 可选 |
| `injection_order` | integer | 否 | 可选 |
| `forbid_overrides` | boolean | 否 | 可选 |
| `injection_trigger` | array | 否 | 可选 |
| `enabled` | boolean | 否 | 默认 `true` |
| `extra` | object | 否 | 额外字段，默认 `{}` |

### 请求示例

```json
{
  "expected_version": 4,
  "identifier": "worldInfo",
  "name": "World Info Injection",
  "role": "system",
  "content": "[World context will be injected here]",
  "enabled": true
}
```

### 响应 `201`

返回创建的完整条目对象（格式同列表中的单个条目）。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `preset_validation_error` | 请求体校验失败，或写回后的预设结构校验失败 |
| `404` | `not_found` | 预设不存在 |
| `409` | `identifier_conflict` / `preset_conflict` | `identifier` 已存在，或 `expected_version` 过期 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |

## 获取条目

```http
GET /presets/:preset_id/entries/:identifier
```

### 响应 `200`

```json
{
  "data": {
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
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` / `entry_not_found` | 预设不存在，或目标条目不存在 |

## 更新条目

```http
PATCH /presets/:preset_id/entries/:identifier
```

部分更新，只传需要修改的字段。至少传一个字段。

请求体可选传入 `expected_version`，用于校验父预设版本。

### 请求示例

```json
{
  "expected_version": 4,
  "content": "You are a helpful AI assistant in a fantasy world.",
  "enabled": true
}
```

### 响应 `200`

返回更新后的完整条目对象。

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `preset_validation_error` | 请求体校验失败、未传任何更新字段，或写回后的预设结构校验失败 |
| `404` | `not_found` / `entry_not_found` | 预设或条目不存在 |
| `409` | `preset_conflict` | `expected_version` 过期 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |

## 删除条目

```http
DELETE /presets/:preset_id/entries/:identifier
```

从 `prompts[]` 和所有 `prompt_order` 上下文中移除该条目。

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `expected_version` | integer | 否 | 期望的父预设 `version` 值 |

### 响应 `200`

```json
{
  "data": {
    "identifier": "worldInfo",
    "deleted": true
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` / `entry_not_found` | 预设或条目不存在 |
| `409` | `preset_conflict` | `expected_version` 过期 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |

## 重排序条目

```http
PUT /presets/:preset_id/entries/reorder
```

按传入的 `identifiers` 顺序重排默认排序上下文和 `prompts[]` 数组。未在列表中的条目会追加到末尾。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `expected_version` | integer | 否 | 期望的父预设 `version` 值 |
| `identifiers` | string[] | **是** | 条目标识数组，表示期望的顺序 |

### 请求示例

```json
{
  "expected_version": 4,
  "identifiers": ["main", "chatHistory", "worldInfo"]
}
```

### 响应 `200`

返回重排后的完整条目列表（格式同列出条目）。

```json
{
  "data": {
    "preset_id": "preset_story",
    "default_character_id": 100000,
    "entries": [
      { "identifier": "main", "..." : "..." },
      { "identifier": "chatHistory", "..." : "..." },
      { "identifier": "worldInfo", "..." : "..." }
    ]
  }
}
```

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `preset_validation_error` | 请求体校验失败，或写回后的预设结构校验失败 |
| `404` | `not_found` | 预设不存在 |
| `409` | `preset_conflict` | `expected_version` 过期 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |

## 批量更新条目

```http
PATCH /presets/:preset_id/entries/batch/update
```

对多个条目应用相同的字段更新。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `expected_version` | integer | 否 | 期望的父预设 `version` 值 |
| `identifiers` | string[] | **是** | 条目标识数组 |
| `fields` | object | **是** | 要更新的字段（同更新条目的请求体） |

### 请求示例

```json
{
  "expected_version": 4,
  "identifiers": ["main", "worldInfo"],
  "fields": {
    "enabled": false
  }
}
```

### 响应 `200`

```json
{
  "data": {
    "results": [
      {
        "index": 0,
        "identifier": "main",
        "action": "updated",
        "data": { "...完整条目对象..." }
      },
      {
        "index": 1,
        "identifier": "worldInfo",
        "action": "not_found"
      }
    ],
    "meta": {
      "total": 2,
      "updated": 1,
      "not_found": 1
    }
  }
}
```

## 批量删除条目

```http
POST /presets/:preset_id/entries/batch/delete
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `expected_version` | integer | 否 | 期望的父预设 `version` 值 |
| `identifiers` | string[] | **是** | 条目标识数组 |

### 请求示例

```json
{
  "expected_version": 4,
  "identifiers": ["worldInfo", "customPrompt"]
}
```

### 响应 `200`

```json
{
  "data": {
    "results": [
      { "index": 0, "identifier": "worldInfo", "action": "deleted" },
      { "index": 1, "identifier": "customPrompt", "action": "not_found" }
    ],
    "meta": {
      "total": 2,
      "deleted": 1,
      "not_found": 1
    }
  }
}
```

### 错误（所有批量端点通用）

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `preset_validation_error` | 请求体校验失败，或写回后的预设结构校验失败 |
| `404` | `not_found` | 预设不存在 |
| `409` | `preset_conflict` | `expected_version` 过期 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |
