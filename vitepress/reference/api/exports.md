---
outline: [2, 3]
---

# Exports（导出）

提供各资源的标准化导出接口。导出结果为文件下载（`Content-Disposition: attachment`），前端不需要自行组装格式。

支持的资源类型：

| 资源 | 路由 | 输出格式 |
| ---- | ---- | -------- |
| 聊天会话 | `GET /export/chat/:id` | `.thchat`（原生）或 `.jsonl`（ST 兼容） |
| 预设 | `GET /export/preset/:id` | `.json`（ST 原始格式） |
| 世界书 | `GET /export/worldbook/:id` | `.json`（ST 格式） |
| 正则配置 | `GET /export/regex/:id` | `.json`（ST 格式） |
| 角色卡 | `GET /export/character/:id` | `.json`（ST Character Card V2） |

导入侧的对应接口见 [Imports（导入）](./imports)。

## 导出聊天会话

```http
GET /export/chat/:id
```

将一个会话导出为聊天文件。支持两种格式。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 会话 ID |

### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
| ---- | ---- | ------ | ---- |
| `format` | string | `thchat` | 导出格式：`thchat`（原生无损）或 `st_jsonl`（ST 兼容有损） |
| `include_variables` | string | `true` | 是否包含变量（仅 thchat 格式生效） |
| `include_memories` | string | `true` | 是否包含记忆（仅 thchat 格式生效） |

### 格式说明

#### thchat（原生格式）

`.thchat` 是 TavernHeadless 的原生聊天文件格式，结构为一个完整的 JSON 文件。特点：

- 无损导出完整的四层树结构（session → floors → pages → messages）
- 保留所有分支、非 main 分支、非 committed 楼层
- 保留 token 统计、校验摘要、楼层元数据
- 可选包含变量和记忆数据
- 导入时通过 `_original_id` 机制重建内部引用关系

文件信封结构：

```json
{
  "spec": "tavern_headless_chat",
  "spec_version": "1.0.0",
  "exported_at": 1735689600000,
  "export_source": "api",
  "export_app_version": "0.2.0-beta.2",
  "data": {
    "title": "Campfire Scene",
    "status": "active",
    "floors": [ ... ],
    "variables": [ ... ],
    "memories": { "items": [ ... ], "edges": [ ... ] }
  }
}
```

#### st_jsonl（SillyTavern 兼容格式）

`.jsonl` 格式与 SillyTavern 的聊天文件格式兼容。每行一个 JSON 对象，第一行为头部信息，后续每行为一条消息。

仅导出 `branch_id === "main"` 且 `state === "committed"` 的楼层。多版本消息页合并为 `swipes` 数组。

信息损失包括：非 main 分支、楼层元数据、token 统计、校验摘要、`content_format`、`narrator` 角色、变量、记忆、会话配置。

### 响应

**thchat 格式：**

- `Content-Type: application/json; charset=utf-8`
- `Content-Disposition: attachment; filename="{title}.thchat"`
- 响应体为上述 JSON 结构

**st_jsonl 格式：**

- `Content-Type: application/x-ndjson; charset=utf-8`
- `Content-Disposition: attachment; filename="{character_name}.jsonl"`
- 响应体为多行 JSONL 文本

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 会话不存在 |

### 示例

```bash
# 导出为原生格式
curl -O http://localhost:3000/export/chat/sess_abc123

# 导出为 ST 兼容格式，不含变量和记忆
curl -O "http://localhost:3000/export/chat/sess_abc123?format=st_jsonl"
```

## 导出预设

```http
GET /export/preset/:id
```

将预设导出为 SillyTavern 原始格式的 JSON 文件。导出内容与导入时的原始 JSON 一致，未经转换。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 预设 ID |

### 响应

- `Content-Type: application/json; charset=utf-8`
- `Content-Disposition: attachment; filename="{name}.json"`
- 响应体为 ST 预设 JSON（包含 `prompts`、`prompt_order` 等字段）

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 预设不存在 |

### 示例

```bash
curl -O http://localhost:3000/export/preset/preset_001
```

## 导出世界书

```http
GET /export/worldbook/:id
```

将世界书导出为 SillyTavern 格式的 JSON 文件。条目以对象形式存储（key 为 uid），同时包含 `extensions` 嵌套字段以兼容 ST V2 格式。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 世界书 ID |

### 响应

- `Content-Type: application/json; charset=utf-8`
- `Content-Disposition: attachment; filename="{name}.json"`

响应体示例：

```json
{
  "name": "Kingdom Lore",
  "entries": {
    "0": {
      "uid": 0,
      "key": ["kingdom"],
      "keysecondary": [],
      "secondary_keys": [],
      "comment": "Main kingdom entry",
      "content": "The kingdom is recovering from a long war.",
      "selective": false,
      "selectiveLogic": 0,
      "constant": false,
      "position": 0,
      "order": 100,
      "depth": 4,
      "role": null,
      "disable": false,
      "enabled": true,
      "extensions": {
        "position": 0,
        "selectiveLogic": 0,
        "depth": 4
      }
    }
  }
}
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 世界书不存在 |

### 示例

```bash
curl -O http://localhost:3000/export/worldbook/wb_001
```

## 导出正则配置

```http
GET /export/regex/:id
```

将正则配置导出为 SillyTavern 格式的 JSON 数组。导入时被省略的三个字段（`markdownOnly`、`promptOnly`、`runOnEdit`）会以 `false` 补回。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 正则配置 ID |

### 响应

- `Content-Type: application/json; charset=utf-8`
- `Content-Disposition: attachment; filename="{name}.json"`

响应体示例：

```json
[
  {
    "id": "regex_001",
    "scriptName": "trim_whitespace",
    "findRegex": "\\s+$",
    "replaceString": "",
    "placement": ["AI_OUTPUT"],
    "disabled": false,
    "markdownOnly": false,
    "promptOnly": false,
    "runOnEdit": false,
    "substituteRegex": 0,
    "minDepth": null,
    "maxDepth": null
  }
]
```

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 正则配置不存在 |

### 示例

```bash
curl -O http://localhost:3000/export/regex/regex_001
```

## 导出角色卡

```http
GET /export/character/:id
```

将角色卡导出为 SillyTavern Character Card V2 格式的 JSON 文件。

默认导出最新版本。可通过 `version_id` 查询参数指定特定版本。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 角色 ID |

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `version_id` | string | 否 | 导出指定版本 ID，不传则导出最新版本 |

### 响应

- `Content-Type: application/json; charset=utf-8`
- `Content-Disposition: attachment; filename="{name}.json"`

响应体示例：

```json
{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "Luna",
    "description": "A moon priestess who keeps watch at night.",
    "personality": "Calm and precise",
    "scenario": "Night watch at the city wall",
    "first_mes": "The moon is bright tonight.",
    "mes_example": "<START>\n{{char}}: The tide is turning.",
    "creator_notes": "",
    "system_prompt": "",
    "post_history_instructions": "",
    "alternate_greetings": [],
    "tags": [],
    "creator": "",
    "character_version": "",
    "extensions": {}
  }
}
```

::: tip 信息损失
TavernHeadless 内部使用 `CharacterSnapshot` 格式存储角色数据，仅保留核心 6 个字段（name, description, personality, scenario, greeting, exampleDialogue）。导出为 V2 格式时，`creator_notes`、`system_prompt`、`post_history_instructions`、`alternate_greetings`、`tags` 等 ST 扩展字段填充为空值。
:::

### 错误

| 状态码 | 说明 |
| ------ | ---- |
| `404` | 角色不存在或版本不存在 |

### 示例

```bash
# 导出最新版本
curl -O http://localhost:3000/export/character/char_001

# 导出指定版本
curl -O "http://localhost:3000/export/character/char_001?version_id=cv_003"
```
