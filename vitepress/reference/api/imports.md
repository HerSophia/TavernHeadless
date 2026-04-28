---
outline: [2, 3]
---

# Imports（导入）

导入接口负责把 SillyTavern 生态的资源文件转成 TavernHeadless 内部可以使用的资源。

导入时不执行宏，不做变量替换，只做解析和写入。

## 什么时候需要看这页

- 你要把已有的 SillyTavern 预设、角色卡或世界书导入进来
- 你要把一个聊天文件导入为新的会话
- 你要发起异步导入（适合较大的聊天文件）

## 一个简单例子

```bash
# 导入一个角色卡文件
curl -X POST http://localhost:3000/import/character \
  -H 'Content-Type: multipart/form-data' \
  -F 'file=@my_character.json'

# 导入一个预设
curl -X POST http://localhost:3000/import/preset \
  -H 'Content-Type: multipart/form-data' \
  -F 'file=@my_preset.json'
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| SillyTavern | 一个开源 AI 角色扮演前端，这里是兼容导入的目标 |
| 异步导入 | 把导入任务放到后台执行，通过作业接口轮询结果 |
| 宏 | 提示词里的双花括号占位符，导入时不展开 |



导入完成后，后续查看、编辑和删除应使用对应的资源接口：

- [Presets（预设管理）](./presets)
- [Worldbooks（世界书管理）](./worldbooks)
- [Regex Profiles（正则配置管理）](./regex-profiles)
- [Characters（角色卡管理）](./characters)

其中 `POST /import/preset`、`POST /import/worldbook`、`POST /import/regex` 和 `POST /import/character` 都遵循资源写入繁忙语义：当 SQLite 写入暂时繁忙且重试耗尽时，返回 `503 resource_busy`。

> 说明：异步聊天导入相关的 job 路由属于高级开发者特性。
> 它们主要用于长任务处理、自动化脚本、开发调试和运维排障。
> 普通交互式导入优先使用同步 `POST /import/chat`。

## 导入与宏执行边界

导入接口只负责把 SillyTavern 生态资源转换并写入 TavernHeadless 的资源表。

当前不会在导入阶段执行宏。

这条边界对 Preset、Worldbook、Regex Profile、Character 导入都成立：

```text
导入时不展开 `{{...}}` 宏
```

- 见下方示例说明
- 导入时不执行 `if` block
- 导入时不执行任何写宏
- 导入时不产生变量副作用

例如，导入的 Preset 或角色文本中即使包含：

```text
{{setvar::mood::happy}}
{{getvar::mood}}
{{if {{flag}}}}YES{{else}}NO{{/if}}
```

这些内容也只会作为资源文本保存下来。

只有在后续会话实际进行提示词装配，并走到 `compat_strict` 或 `compat_plus` 宏兼容路径时，相关宏才会进入求值流程。

如果需要查看运行时宏边界，请参考 [Macros](./macros) 与 [Chat](./chat)。


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
| `data` | object | **是** | 原始 SillyTavern 世界书 JSON 数据。主关键词字段使用 `key`，辅助关键词字段使用 `keysecondary` |

### 请求示例

```json
{
  "name": "Kingdom Lore",
  "data": {
    "name": "Kingdom Lore",
    "entries": [
      {
        "uid": 0,
        "key": ["kingdom"],
        "keysecondary": ["history"],
        "selective": true,
        "selectiveLogic": 0,
        "comment": "Kingdom basics",
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
      "findRegex": "\\s+$",
      "replaceString": "",
      "trimStrings": [],
      "placement": [2],
      "disabled": false
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
    "script_count": 1,
    "compat_report": {
      "stored_count": 1,
      "prompt_executable_count": 1,
      "persist_executable_count": 1,
      "display_only_count": 0,
      "unsupported_runtime_count": 0,
      "contains_prompt_only": 0,
      "contains_run_on_edit": 0,
      "contains_reasoning": 0,
      "contains_slash_command": 0
    }
  }
}
```

`compat_report` 用于说明：

- 规则总数
- 当前后端 prompt 链路可执行的规则数量
- 当前后端 persist 链路可执行的规则数量
- 仅保留但不执行的规则数量

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `import_parse_error` | 请求体校验失败，或正则规则数组无法解析 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |

## 导入角色卡

```http
POST /import/character
```

导入一个 SillyTavern 角色卡。当前支持 legacy 扁平卡、TavernCard V2，以及 Character Card V3 的最小导入兼容。

请求体大小限制是 **200KB**。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `payload` | object | **是** | SillyTavern Character Card JSON |
| `create_session` | boolean | 否 | 是否同时创建会话，默认 `true` |
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
      "mes_example": "<START>\n{{char}}: The tide is turning.",
      "alternate_greetings": [
        "The archive lamps are already lit.",
        "The charts waited for you."
      ],
      "system_prompt": "Stay in character as a moon archivist.",
      "post_history_instructions": "End replies with a soft invitation.",
      "creator_notes": "Imported example.",
      "tags": ["moon", "archive"],
      "creator": "Docs Example",
      "character_version": "2.1",
      "extensions": { "source_app": "docs" }
    }
  },
  "create_session": true,
  "title": "Luna Demo Session"
}
```

### 响应 `201`（当 `create_session=false` 时）

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

### 当前兼容范围说明

- 支持 legacy 扁平角色卡导入
- 支持 `spec === "chara_card_v2"` 的 TavernCard V2 导入
- 支持 `spec === "chara_card_v3"` 的最小导入兼容
- 当前 V3 导入会保留基础字段、多 greeting、关键提示字段、`character_book` 和 `extensions` 等数据，但本轮文档承诺仍以最小兼容为边界

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `import_parse_error` | 请求体校验失败，或角色卡无法解析 |
| `413` | `import_payload_too_large` | 请求体超过 `200KB` 限制 |
| `503` | `resource_busy` | 资源写入暂时繁忙，请稍后重试 |

## 导入聊天文件

```http
POST /import/chat
```

导入聊天文件。接口会自动识别两种格式：

- `.thchat`：TavernHeadless 原生 JSON 格式，要求 `spec === "tavern_headless_chat"`
- `.jsonl`：SillyTavern JSONL 格式

`.thchat` 中的记忆条目支持 Memory V2 元数据，例如 `summary_tier`、`lifecycle_status`、`source_job_id`、coverage 统计，以及扩展关系类型 `derived_from`、`compacts`、`resolves`。
`.thchat` 的楼层也支持 `superseded_at` 与 `superseded_by_floor_id_ref`，导入后会恢复 superseded 历史关系。

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `data` | string | **是** | 聊天文件文本内容（JSONL 或 JSON） |
| `character_id` | string | 否 | 绑定角色 ID；导入后会话会关联该角色，并按该角色当前最新 active 版本解析绑定快照 |
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
| `swipe_count` | integer | 导入的 swipe 数（仅 SillyTavern JSONL） |
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

- 当请求显式提供 `character_id` 时，系统会复用常规 session 绑定语义，选择该角色当前最新 active 版本，并把该版本的快照写入导入后的 session
- 当 `.thchat` 请求同时提供 `character_id` 时，文件内嵌的 `character_snapshot` 与 `character_sync_policy` 不再作为并行真相保留；导入后的 session 会使用解析出的绑定快照，并将 `character_sync_policy` 固定为 `pin`

### 当前分支快照限制

- 当前 ST JSONL 导入和 v1 `.thchat` 导入都会恢复普通变量条目，但不会为每个 imported floor 伪造 `branch_local_variable_snapshot`
- 这是因为现有导入格式只携带最终持久化变量行，不携带 source floor 当时精确的 local 兼容视图，服务端不能安全反推出该快照
- 因此，后续如果要从 imported / legacy floor 发起新的分支继承，例如对尚未物化的新 branch 调用 `POST /sessions/:id/prompt-runtime/preview` 并传入 `source_floor_id`，或在 `respond` / `edit-and-regenerate` 中从该 floor 分叉，服务端可能返回 `409 branch_local_snapshot_missing`

### 错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` / `import_parse_error` | 请求体校验失败，或文件内容无法解析 |
| `400` | `import_empty` | 聊天文件中没有可导入消息 |
| `400` | `import_unsupported_version` | `.thchat` 的 `spec_version` 主版本号不受支持 |
| `400` | `character_not_found` | 指定的 `character_id` 不存在或当前账号不可见 |

## 异步聊天导入作业（高级开发特性）

```http
POST /import/chat/jobs
```

这是一个面向平台接入、批处理和自动化脚本的高级开发特性，不属于普通聊天主流程接口。

该接口会把聊天导入请求写入 `Background Job Runtime`，立即返回 job 句柄，后续由后台 worker 执行。

适用场景：

- 大体积聊天文件
- 平台侧批量导入
- 自动化脚本
- 需要轮询进度与结果的后台任务

这个接口只负责：

1. 校验请求体
2. 按与同步导入一致的语义解析可选 `character_id` 绑定（最新 active 版本）
3. 把原始输入写入 artifact 存储
4. 创建对应后台作业

真正的解析、归一化和最终发布由独立 worker 完成。v1 的观测方式是轮询，不提供 WebSocket 进度推送。

作业状态查询、取消、重试和导出产物下载见 [Chat Transfer Jobs（聊天传输作业）](./chat-transfer-jobs)。

### 后续流程

1. 调用 `POST /import/chat/jobs` 创建作业
2. 通过 `GET /chat-transfer-jobs/:id` 轮询状态
3. 当作业成功时，从详情响应读取 `result_session_id` 和 `result`

### 请求体

请求体与同步 `POST /import/chat` 保持兼容，仍然使用 JSON：

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `data` | string | **是** | 聊天文件文本内容（JSONL 或 JSON） |
| `character_id` | string | 否 | 绑定角色 ID |
| `title` | string | 否 | 自定义会话标题 |

当前仍然没有 `multipart/form-data` 支持。

### 响应 `202`

```json
{
  "data": {
    "job_id": "chat-transfer-job:import_chat:abc123",
    "status": "pending",
    "job_kind": "import_chat",
    "format": null
  }
}
```

`format` 是入队时的快速检测结果。当前入队阶段只会提前识别 `.thchat`，其余情况返回 `null`：

- `thchat`
- `null`

最终是否成功导入，以作业详情为准。

### 大小限制

- 服务端配置项：`CHAT_IMPORT_MAX_BYTES`
- 路由默认回退值：`DEFAULT_CHAT_IMPORT_MAX_BYTES = 5_000_000`

### 错误

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| `400` | `validation_error` / `character_not_found` | 请求体非法，或指定角色不存在 |
| `413` | `import_payload_too_large` | 输入超过导入大小限制 |
| `503` | `resource_busy` | 入队写入遇到 SQLite 忙状态 |

### 处理说明

- 输入成功入队后，后续解析失败不会再回到这个接口返回 `400`，而是体现在作业状态，例如 `dead_letter`
- worker 会先读取原始 artifact，再构建归一化 manifest，最后以原子发布方式写入最终 session
- 异步 `.thchat` 导入在显式提供 `character_id` 时，也会覆盖文件内嵌的 `character_snapshot` / `character_sync_policy`，与同步导入保持一致
