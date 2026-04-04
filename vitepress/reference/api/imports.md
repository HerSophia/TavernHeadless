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

其中 `POST /import/preset`、`POST /import/worldbook`、`POST /import/regex` 和 `POST /import/character` 都遵循资源写入繁忙语义：当 SQLite 写入暂时繁忙且重试耗尽时，返回 `503 resource_busy`。

> 说明：异步聊天导入相关的 job 路由属于高级开发者特性。
> 它们主要用于长任务处理、自动化脚本、开发调试和运维排障。
> 普通交互式导入优先使用同步 `POST /import/chat`。

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

导入一个 SillyTavern 角色卡。当前优先支持 TavernCard V2。

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
      "mes_example": "<START>\n{{char}}: The tide is turning."
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
2. 解析可选的 `character_id` 绑定
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
