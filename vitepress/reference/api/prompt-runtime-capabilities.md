---
outline: [2, 3]
---

# Prompt Runtime Capabilities（能力目录）

这一页只讲：

```http
GET /prompt-runtime/capabilities
```

它是一个全局只读接口，返回 Prompt Runtime 当前公开的能力边界、默认值和 mode 目录。客户端可以用它做能力探测，而不是把这些值硬编码在自己代码里。

## 什么时候需要看这页

- 想知道 Prompt Runtime 当前公开了哪些稳定能力。
- 想知道默认 mode、公开 mode 目录和各个 mode 的定位。
- 想查看哪些 policy 字段支持持久化或请求期 override。
- 想确认 `preview` 和 `inspect` 的能力边界。

## 示例

```bash
curl http://localhost:3000/prompt-runtime/capabilities
```

## 响应结构

响应包裹在 `data` 中，顶层固定包含这些节：

| 节 | 说明 |
| ---- | ---- |
| `default_prompt_mode` | 当前系统默认 mode，现在固定为 `compat_strict` |
| `prompt_modes` | 公开 mode 目录 |
| `structure` | 支持的结构模式与默认值 |
| `delivery` | 投递约束默认值 |
| `budget` | 预算字段支持情况与裁剪原因码 |
| `source_selection` | 来源选择默认值、支持来源和排除原因码 |
| `governance` | session / branch policy 的 PATCH 语义声明 |
| `compare` | compare 接口的能力边界 |
| `observability` | live / dry_run / inspect / preview / explain / stream 各观察入口的边界 |
| `macro` | 宏系统在 Prompt Runtime 中的边界声明 |
| `unsupported` | 明确不提供的路由清单 |

### 响应示例（节选）

```json
{
  "data": {
    "default_prompt_mode": "compat_strict",
    "prompt_modes": [
      {
        "name": "compat_strict",
        "description": "Strict SillyTavern-compatible prompt assembly.",
        "agentic_scope": "none"
      },
      {
        "name": "compat_plus",
        "description": "Compatibility-first prompt assembly with light augmentation only.",
        "agentic_scope": "limited"
      },
      {
        "name": "native",
        "description": "Native prompt pipeline entry for richer NodeGraph and Agentic evolution.",
        "agentic_scope": "primary"
      }
    ],
    "structure": {
      "modes": ["default", "strict_alternating", "no_assistant", "flattened"],
      "defaults": {
        "mode": "default",
        "merge_adjacent_same_role": false,
        "preserve_system_messages": true
      }
    },
    "budget": {
      "defaults": {},
      "request_override_supported": true,
      "persistent_patch_supported": true,
      "supported_fields": ["maxInputTokens", "reservedCompletionTokens"]
    },
    "source_selection": {
      "defaults": {
        "history": { "mode": "full" },
        "memory": { "enabled": true },
        "worldbook": { "enabled": true },
        "examples": { "enabled": true }
      },
      "supported_sources": ["history", "memory", "worldbook", "examples"],
      "history_modes": ["full", "windowed"]
    },
    "observability": {
      "preview": {
        "enabled": true,
        "mode": "macro_text_preview",
        "returns_assembly_truth": false
      },
      "inspect": {
        "enabled": true,
        "mode": "prepared_turn",
        "returns_prepared_turn": true,
        "returns_governance": true,
        "returns_contributors": true,
        "returns_prepare_phase_trace": true
      }
    }
  }
}
```

完整字段以 `GET /openapi.json` 中该接口的响应 schema 为准。

## mode 目录字段

`prompt_modes` 每个条目固定包含：

| 字段 | 说明 |
| ---- | ---- |
| `name` | mode 名称 |
| `description` | 定位说明 |
| `agentic_scope` | 这个 mode 承载 Agentic / NodeGraph 演进的程度 |

### `agentic_scope` 的意思

| 值 | 说明 |
| ---- | ---- |
| `none` | 不承载 Agentic / NodeGraph 行为演进 |
| `limited` | 只允许轻量增强 |
| `primary` | 未来 richer NodeGraph / Agentic 演进的主要入口 |

## `observability.preview` 的固定边界

`preview` 固定为：

- `mode = "macro_text_preview"`
- `returns_assembly_truth = false`

这表示它只是单段文本宏预演，不会扩展成完整 prepared turn preview。

## `observability.inspect` 的固定边界

`inspect` 固定为：

- `mode = "prepared_turn"`
- `returns_prepared_turn = true`
- `returns_governance = true`
- `returns_contributors = true`
- `returns_prepare_phase_trace = true`

这表示它是一次真实 prepared turn 的只读视图，会返回 prepared turn 本体、governance、contributor 视图和 prepare phase trace。

## 使用提示

如果你想知道"当前会话现在实际在用哪个 mode"，不要只看 capabilities。capabilities 是全局能力目录，不带会话状态。请直接看 [Prompt Runtime Mode](./prompt-runtime-mode)。

## 相关页面

- 总览页：[Prompt Runtime](./prompt-runtime)
- mode 控制面：[Prompt Runtime Mode](./prompt-runtime-mode)
- inspection 路由族：[Prompt Runtime Inspection](./prompt-runtime-inspection)
