---
outline: [2, 3]
---

# Prompt Runtime（提示词运行时）

Prompt Runtime 用来回答一个具体问题：**当前这次聊天，会按什么规则组装提示词。**

这一组接口现在按稳定的子路由族拆开：总览、mode、policy、assets、inspection、capabilities。

如果你只是正常发消息，请先看 [Chat（对话生成）](./chat)。只有在你需要排查提示词组装、确认当前模式来源、查看资源绑定、做只读检查或回看历史快照时，才需要看这里。

当前这一组接口里的记忆公开面也已经分层固定：`preview` / `inspect` 返回原始 `memory_injection` 与统一 `memory` trace，historical `explain` 返回 committed `memory`，`dry-run` 则在 Chat 路由下返回顶层 `memory` 与兼容 `memory_summary`。

## 什么时候需要看这页

- 想快速了解 Prompt Runtime 现在有哪些稳定入口。
- 想知道当前问题应该去看 mode、policy、assets、inspection 还是 capabilities。
- 想先把整体边界看清楚，再进入细节页。

## 路由族一览

| 路由族 | 主要入口 | 说明 | 文档 |
| ---- | ---- | ---- | ---- |
| overview | `GET /sessions/:id/prompt-runtime` | 当前会话 Prompt Runtime 总览。现在包含顶层 `mode`。 | [总览](./prompt-runtime) |
| mode | `/prompt-runtime/mode` | 显式读取或写入 session 级 `prompt_mode`。 | [Mode](./prompt-runtime-mode) |
| policy | `/prompt-runtime/policy` | 查看和修改 Prompt Runtime policy。 | [Policy](./prompt-runtime-policy) |
| assets | `/prompt-runtime/assets` | 查看当前绑定的 Prompt Assets。 | [Assets](./prompt-runtime-assets) |
| inspection | `preview` / `inspect` / `explain` / `compare` | 做只读预览、请求期检查、历史解释和 committed truth 比较。 | [Inspection](./prompt-runtime-inspection) |
| capabilities | `GET /prompt-runtime/capabilities` | 查看能力边界、默认值和公开 mode 目录。 | [Capabilities](./prompt-runtime-capabilities) |

具体接口如下：

- `GET /sessions/:id/prompt-runtime`
- `GET /sessions/:id/prompt-runtime/mode`
- `PATCH /sessions/:id/prompt-runtime/mode`
- `GET /sessions/:id/prompt-runtime/policy`
- `PATCH /sessions/:id/prompt-runtime/policy`
- `GET /sessions/:id/prompt-runtime/branches/:branchId/policy`
- `PATCH /sessions/:id/prompt-runtime/branches/:branchId/policy`
- `GET /sessions/:id/prompt-runtime/assets`
- `POST /sessions/:id/prompt-runtime/preview`
- `POST /sessions/:id/prompt-runtime/inspect`
- `GET /floors/:id/prompt-runtime/explain`
- `POST /sessions/:id/prompt-runtime/compare`
- `GET /prompt-runtime/capabilities`

## 先看哪一页

| 你要解决的问题 | 先看 |
| ---- | ---- |
| 当前到底在用哪种提示词模式 | [Mode](./prompt-runtime-mode) |
| 当前 policy 是什么，哪些字段可持久化 | [Policy](./prompt-runtime-policy) |
| 当前绑了哪些 Prompt Assets | [Assets](./prompt-runtime-assets) |
| 不发起真实聊天，想看 preview / inspect / explain / compare | [Inspection](./prompt-runtime-inspection) |
| 想知道默认值、支持字段、公开 mode 目录 | [Capabilities](./prompt-runtime-capabilities) |

## 必须保持不变的边界

- `sessions.prompt_mode` 是唯一持久化真相。
- `prompt_mode` 不进入 `PromptRuntimePersistentPolicy`、
  `PromptRuntimeResolvedPolicy`、session policy patch、branch policy patch，
  也不进入 request-time Prompt Runtime policy overlay。
- 不提供 `PATCH /sessions/:id/prompt-runtime`。
- 不提供 `PATCH /sessions/:id/prompt-runtime/branches/:branchId/mode`。
- `inspect` 现在新增了顶层 `mode`，但它仍然只是无副作用请求期检查。
- `explain` 不新增新的顶层 `mode`。历史真相继续由 `prompt_snapshot.prompt_mode` 表达。

## 一个简单例子

假设你在排查“为什么这个会话现在走的是 `native`，但数据库里 `sessions.prompt_mode` 是空的”。

可以按这个顺序看：

1. 先看 [Mode](./prompt-runtime-mode)，确认 `session_prompt_mode`、
   `effective_prompt_mode`、`source` 和 `legacy_fallback`。
2. 再看 [Policy](./prompt-runtime-policy)，确认问题不是 policy 在影响
   你对运行时的判断。
3. 如果还要看这次请求最终准备出来的 prepared turn，
   再看 [Inspection](./prompt-runtime-inspection) 里的 `inspect`。
4. 如果要了解公开 mode 目录和默认值，再看 [Capabilities](./prompt-runtime-capabilities)。
