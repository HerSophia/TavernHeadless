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

> 说明：异步聊天导出相关的 job 路由属于高级开发者特性。
> 它们主要用于长任务处理、自动化脚本、开发调试和运维排障。
> 普通小规模导出优先使用同步 `GET /export/chat/:id`。

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
- 保留 token 统计、校验摘要、楼层元数据，以及 `superseded_at` / `superseded_by_floor_id_ref` 楼层历史关系
- 记忆条目会保留 Memory V2 元数据，例如 `summary_tier`、`lifecycle_status`、`source_job_id`、token / coverage 统计，以及完整的记忆关系枚举
- 可选包含变量和记忆数据
- 导入时通过 `_original_id` 机制重建内部引用关系

文件信封结构：

```json
{
  "spec": "tavern_headless_chat",
  "spec_version": "1.0.0",
  "exported_at": 1735689600000,
  "export_source": "api",
  "export_app_version": "0.2.0-beta.3",
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

仅导出 `branch_id === "main"`、`state === "committed"` 且未被 supersede 的 live 楼层。多版本消息页合并为 `swipes` 数组。

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

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 会话不存在 |
| `409` | `export_requires_async` | 当前部署对同步导出设置了消息量阈值，当前会话只能改用异步导出 |

### 示例

```bash
# 导出为原生格式
curl -O http://localhost:3000/export/chat/sess_abc123

# 导出为 ST 兼容格式，不含变量和记忆
curl -O "http://localhost:3000/export/chat/sess_abc123?format=st_jsonl"
```

## 异步聊天导出作业（高级开发特性）

```http
POST /export/chat/:id/jobs
```

这是一个面向平台接入、批处理和自动化脚本的高级开发特性，不属于普通聊天主流程接口。

该接口会把聊天导出请求写入 `Background Job Runtime`，立即返回 job 句柄，后续由后台 worker 生成导出文件。

适用场景：

- 长会话或大体积会话导出
- 平台侧批量导出
- 自动化脚本
- 需要轮询进度并在稍后下载文件的后台任务

### 何时需要异步导出

同步 `GET /export/chat/:id` 仍然保留。

只有在部署方设置了 `CHAT_EXPORT_SYNC_MAX_MESSAGES`，并且当前会话消息数超过该阈值时，同步导出才会返回：

- `409`
- `code: "export_requires_async"`

这时应改用异步导出作业。

### 请求体

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `format` | string | 否 | `thchat` | `thchat` 或 `st_jsonl` |
| `include_variables` | boolean | 否 | `true` | 是否包含变量，仅 `thchat` 生效 |
| `include_memories` | boolean | 否 | `true` | 是否包含记忆，仅 `thchat` 生效 |

### 响应 `202`

```json
{
  "data": {
    "job_id": "chat-transfer-job:export_chat:abc123",
    "status": "pending",
    "job_kind": "export_chat",
    "format": "thchat",
    "requested_session_id": "sess_demo"
  }
}
```

### 后续流程

1. 轮询 [Chat Transfer Jobs（聊天传输作业）](./chat-transfer-jobs) 中的 `GET /chat-transfer-jobs/:id`
2. 当作业 `status === "succeeded"` 时，调用 `GET /chat-transfer-jobs/:id/file` 下载文件

### 产物过期

导出 artifact 受 `CHAT_EXPORT_ARTIFACT_TTL_MS` 控制。

如果 `output_expires_at` 已过期，`GET /chat-transfer-jobs/:id/file` 会返回：

- `410`
- `code: "artifact_expired"`

当前 v1 只在下载时强制过期检查，还没有后台文件垃圾回收。

### 错误

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| `400` | `validation_error` | 请求体非法 |
| `404` | `session_not_found` | 会话不存在 |
| `503` | `resource_busy` | 入队写入遇到 SQLite 忙状态 |

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

将正则配置导出为 SillyTavern 格式的 JSON 数组。当前会尽量保留导入后保存下来的兼容字段值；如果历史旧数据缺失这些字段，导出时会使用安全默认值补齐。

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
    "placement": [2],
    "disabled": false,
    "markdownOnly": true,
    "promptOnly": true,
    "runOnEdit": true,
    "substituteRegex": 0,
    "minDepth": 0,
    "maxDepth": 0
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

将角色卡导出为 SillyTavern Character Card V2 或 Character Card V3 格式的 JSON 文件。

默认导出最新版本。可通过 `version_id` 查询参数指定特定版本。可通过 `format` 查询参数指定导出格式。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 角色 ID |

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `format` | string | 否 | 导出格式：`v2`（默认）或 `v3` |
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
    "creator_notes": "Imported example.",
    "system_prompt": "Stay in character as a moon archivist.",
    "post_history_instructions": "End replies with a soft invitation.",
    "alternate_greetings": [
      "The archive lamps are already lit.",
      "The charts waited for you."
    ],
    "tags": ["moon", "archive"],
    "creator": "Docs Example",
    "character_version": "2.1",
    "extensions": {
      "source_app": "docs"
    }
  }
}
```

当 `format=v3` 时，响应体示例：

```json
{
  "spec": "chara_card_v3",
  "spec_version": "3.0",
  "data": {
    "name": "Luna",
    "description": "A moon priestess who keeps watch at night.",
    "personality": "Calm and precise",
    "scenario": "Night watch at the city wall",
    "first_mes": "The moon is bright tonight.",
    "alternate_greetings": [
      "The archive lamps are already lit.",
      "The charts waited for you."
    ],
    "group_only_greetings": [],
    "mes_example": "<START>\n{{char}}: The tide is turning.",
    "creator_notes": "Imported example.",
    "system_prompt": "Stay in character as a moon archivist.",
    "post_history_instructions": "End replies with a soft invitation.",
    "tags": ["moon", "archive"],
    "creator": "Docs Example",
    "character_version": "2.1",
    "extensions": {
      "source_app": "docs"
    }
  }
}
```

::: tip 当前边界
TavernHeadless 当前内部已保存 richer 角色快照。导出 V2 / V3 时会优先回填真实的 `creator_notes`、`system_prompt`、`post_history_instructions`、`alternate_greetings`、`tags`、`creator`、`character_version`、`extensions` 等字段。

当前仍属于最小兼容边界的部分包括：

- `group_only_greetings` 的运行时语义
- `assets` 等 V3 richer 资源字段的导出面
- `assets`、`nickname`、`source`、时间戳等 V3 可选字段，只有快照中存在时才会导出
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
