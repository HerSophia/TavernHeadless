---
outline: [2, 3]
---

# Prompt Runtime Capabilities（能力目录）

这一页只讲：

```http
GET /prompt-runtime/capabilities
```

## 什么时候需要看这页

- 想知道 Prompt Runtime 当前公开了哪些稳定能力。
- 想知道默认 mode、公开 mode 目录和各个 mode 的定位。
- 想查看哪些 policy 字段支持持久化或请求期 override。

## 本轮新增字段

### `default_prompt_mode`

当前系统默认 mode。现在固定为：

- `compat_strict`

### `prompt_modes`

当前公开 mode 目录。每个条目固定包含：

- `name`
- `description`
- `agentic_scope`

当前 `prompt_modes` 至少会返回三项：

| `name` | `description` | `agentic_scope` |
| ---- | ---- | ---- |
| `compat_strict` | 严格兼容 SillyTavern 的提示词组装路径 | `none` |
| `compat_plus` | 兼容优先，只允许轻量增强 | `limited` |
| `native` | richer NodeGraph / Agentic 演进的主要入口 | `primary` |

## `agentic_scope` 的意思

| 值 | 说明 |
| ---- | ---- |
| `none` | 不承载 Agentic / NodeGraph 行为演进 |
| `limited` | 只允许轻量增强 |
| `primary` | 未来 richer NodeGraph / Agentic 演进的主要入口 |

## 其余能力目录仍然保留

除了 mode 目录，这个接口仍会继续返回：

- `structure`
- `delivery`
- `budget`
- `source_selection`
- `governance`
- `compare`
- `observability`
- `macro`
- `unsupported`

如果你想知道“当前会话现在实际在用哪个 mode”，不要只看 capabilities。请直接看 [Prompt Runtime Mode](./prompt-runtime-mode)。

## 相关页面

- 总览页：[Prompt Runtime](./prompt-runtime)
- mode 控制面：[Prompt Runtime Mode](./prompt-runtime-mode)
- inspection 路由族：[Prompt Runtime Inspection](./prompt-runtime-inspection)
