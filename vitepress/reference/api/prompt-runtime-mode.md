---
outline: [2, 3]
---

# Prompt Runtime Mode（提示词模式控制面）

这一页只讲 Prompt Runtime 的 **mode 控制面**。

它解决的是“当前这次会话到底在用哪种提示词模式，以及这个模式来自哪里”。

## 什么时候需要看这页

- 想确认当前会话在用 `compat_strict`、`compat_plus` 还是 `native`。
- 想知道当前模式来自 session 显式值、legacy metadata fallback，还是系统默认值。
- 想在不经过 Sessions 通用更新面的前提下，直接清空或设置 `sessions.prompt_mode`。

## 必须先记住的边界

- 公开枚举只保留：`compat_strict`、`compat_plus`、`native`。
- `native_pipeline` 只允许作为说明词，不进入公开枚举。
- `sessions.prompt_mode` 是唯一持久化真相。
- 这组接口是 session 级控制面，不支持 branch mode override，也不支持 request-time mode override。

## GET /sessions/:id/prompt-runtime/mode

读取当前会话的 mode 视图。

### 响应 `200`

```json
{
  "data": {
    "prompt_mode": "compat_plus",
    "session_prompt_mode": null,
    "effective_prompt_mode": "compat_plus",
    "default_prompt_mode": "compat_strict",
    "legacy_fallback": true,
    "source": "legacy_metadata"
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `prompt_mode` | string | 当前 mode 控制面的主显示值。当前实现中等于 `effective_prompt_mode` |
| `session_prompt_mode` | string \| null | `sessions.prompt_mode` 当前持久化值 |
| `effective_prompt_mode` | string | 现行 fallback 链解析后的真实生效 mode |
| `default_prompt_mode` | string | 当前系统默认 mode。现在固定为 `compat_strict` |
| `legacy_fallback` | boolean | 当前是否正在使用 legacy metadata fallback |
| `source` | string | 当前 mode 来源：`session` / `legacy_metadata` / `default` |

## PATCH /sessions/:id/prompt-runtime/mode

直接写入或清空 `sessions.prompt_mode`。

### 请求体

```json
{
  "prompt_mode": "native"
}
```

或者清空：

```json
{
  "prompt_mode": null
}
```

### 请求字段

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `prompt_mode` | `string \| null` | 是 | 写入 session 显式 mode。`null` 表示清空 |

### 清空语义

当你发送：

```json
{
  "prompt_mode": null
}
```

系统会：

1. 把 `sessions.prompt_mode` 清空为 `null`
2. 再按现有 fallback 链继续解析 `effective_prompt_mode`
3. 在响应里明确返回新的 `session_prompt_mode`、
   `effective_prompt_mode`、`source`、`legacy_fallback`

这意味着：**清空 session 显式值，不等于当前 effective mode 一定变成 `compat_strict`。**
如果 legacy metadata 里仍然带着旧值，effective mode 仍可能来自 `legacy_metadata`。

## Mode 来源说明

| `source` | 说明 |
| ---- | ---- |
| `session` | 直接来自 `sessions.prompt_mode` |
| `legacy_metadata` | `sessions.prompt_mode` 为空，因此回退到 legacy metadata |
| `default` | session 和 legacy metadata 都没有值，因此回退到系统默认值 |

这里的 legacy metadata 具体指：

- `metadata.promptMode`
- `metadata.prompt_mode`

## 这组接口和 Sessions 通用更新面的关系

`PATCH /sessions/:id` 仍然可以更新 `prompt_mode`。

本轮设计接受两条写入口：

- Sessions 通用更新面上的 `prompt_mode`
- `PATCH /sessions/:id/prompt-runtime/mode`

但这只是 **双入口，不是双真相**。底层真相仍然只有一份：`sessions.prompt_mode`。

## 相关页面

- 总览页：[Prompt Runtime](./prompt-runtime)
- Policy 边界：[Prompt Runtime Policy](./prompt-runtime-policy)
- 能力目录：[Prompt Runtime Capabilities](./prompt-runtime-capabilities)
