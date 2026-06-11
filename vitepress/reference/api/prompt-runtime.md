---
outline: [2, 3]
---

# Prompt Runtime（提示词运行时）

Prompt Runtime 用来回答一个具体问题：**当前这次聊天，会按什么规则组装提示词。**

这一组接口按稳定的子路由族拆开：总览、mode、policy、assets、inspection、capabilities。

如果你只是正常发消息，请先看 [Chat（对话生成）](./chat)。只有在你需要排查提示词组装、确认当前模式来源、查看资源绑定、做只读检查或回看历史快照时，才需要看这里。

## 什么时候需要看这页

- 想快速了解 Prompt Runtime 有哪些稳定入口。
- 想知道当前问题应该去看 mode、policy、assets、inspection 还是 capabilities。
- 想先把整体边界看清楚，再进入细节页。

## 先理解几个词

这组页面的术语较多，先把最常用的几个对齐：

| 词 | 这里的意思 |
| ---- | ---- |
| mode | 提示词模式。决定走哪条组装路径：`compat_strict` / `compat_plus` / `native` |
| policy | 提示词组装策略。控制结构、投递、预算、来源选择和可见性，详见 [Policy](./prompt-runtime-policy) |
| assets | 当前会话绑定的预设、角色卡、世界书、正则配置 |
| prepared turn | 一次"已经准备好但还没发给模型"的完整请求内容，包括最终消息序列和组装轨迹 |
| committed truth | 楼层提交时持久化下来的组装真相快照。历史查询只读这份快照，不重算 |
| inspection | 只读检查入口的统称：`preview` / `inspect` / `explain` / `compare` |
| contributor | 在组装提示词之前向其中注入内容的来源单元，例如记忆投影 |
| Prompt Runtime Injection | 分两类：一类是随请求提交的 `prompt_runtime_injections`；另一类是持久化到 session / branch 的注入记录。两者都会进入运行时解析，并可通过 inspection 入口回看结果 |

## 路由族一览

| 路由族 | 主要入口 | 说明 | 文档 |
| ---- | ---- | ---- | ---- |
| overview | `GET /sessions/:id/prompt-runtime` | 当前会话 Prompt Runtime 总览，包含顶层 `mode` | 本页 |
| mode | `/prompt-runtime/mode` | 显式读取或写入 session 级 `prompt_mode` | [Mode](./prompt-runtime-mode) |
| policy | `/prompt-runtime/policy` | 查看和修改 Prompt Runtime policy | [Policy](./prompt-runtime-policy) |
| assets | `/prompt-runtime/assets` | 查看当前绑定的 Prompt Assets | [Assets](./prompt-runtime-assets) |
| injections | `/prompt-runtime/injections` 及 `/prompt-runtime/branches/:branchId/injections` | 管理 session / branch 持久注入记录 | 本页 |
| inspection | `preview` / `inspect` / `explain` / `compare` | 只读预览、请求期检查、历史解释和 committed truth 比较 | [Inspection](./prompt-runtime-inspection) |
| capabilities | `GET /prompt-runtime/capabilities` | 查看能力边界、默认值和公开 mode 目录 | [Capabilities](./prompt-runtime-capabilities) |

具体接口如下：

- `GET /sessions/:id/prompt-runtime`
- `GET /sessions/:id/prompt-runtime/mode`
- `PATCH /sessions/:id/prompt-runtime/mode`
- `GET /sessions/:id/prompt-runtime/policy`
- `PATCH /sessions/:id/prompt-runtime/policy`
- `GET /sessions/:id/prompt-runtime/branches/:branchId/policy`
- `PATCH /sessions/:id/prompt-runtime/branches/:branchId/policy`
- `GET /sessions/:id/prompt-runtime/assets`
- `GET /sessions/:id/prompt-runtime/injections`
- `POST /sessions/:id/prompt-runtime/injections`
- `PATCH /sessions/:id/prompt-runtime/injections/:injectionId`
- `DELETE /sessions/:id/prompt-runtime/injections/:injectionId`
- `GET /sessions/:id/prompt-runtime/branches/:branchId/injections`
- `POST /sessions/:id/prompt-runtime/branches/:branchId/injections`
- `PATCH /sessions/:id/prompt-runtime/branches/:branchId/injections/:injectionId`
- `DELETE /sessions/:id/prompt-runtime/branches/:branchId/injections/:injectionId`
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
| 想管理 session / branch 持久注入 | 本页的 injections 路由列表 |
| 不发起真实聊天，想看 preview / inspect / explain / compare | [Inspection](./prompt-runtime-inspection) |
| 想知道默认值、支持字段、公开 mode 目录 | [Capabilities](./prompt-runtime-capabilities) |

## 记忆字段的公开口径

inspection 入口对记忆相关字段的返回口径是分层固定的：

| 字段 | 含义 | 在哪些入口返回 |
| ---- | ---- | ---- |
| `memory_injection` | 原始记忆注入结果 | `preview`、`inspect` |
| `memory` | Prompt Runtime 统一记忆 trace | `preview`、`inspect`、`explain`（committed 版本） |
| `memory_summary` | 兼容投影，不再被视为唯一真相 | Chat 路由的 dry-run |

## 必须保持不变的边界

- `sessions.prompt_mode` 是唯一持久化真相。
- `prompt_mode` 不属于 policy：它不进入持久化 policy 对象、session policy patch、branch policy patch，也不进入请求期 policy override。
- 不提供 `PATCH /sessions/:id/prompt-runtime`。
- 不提供 `PATCH /sessions/:id/prompt-runtime/branches/:branchId/mode`。
- `inspect` 返回顶层 `mode`，但它只是无副作用的请求期检查。
- `explain` 不提供顶层 `mode`。历史模式真相由 `prompt_snapshot.prompt_mode` 表达。

## 一个简单例子

假设你在排查"为什么这个会话现在走的是 `native`，但数据库里 `sessions.prompt_mode` 是空的"。

可以按这个顺序看：

1. 先看 [Mode](./prompt-runtime-mode)，确认 `session_prompt_mode`、`effective_prompt_mode`、`source` 和 `legacy_fallback`。
2. 再看 [Policy](./prompt-runtime-policy)，确认问题不是 policy 在影响你对运行时的判断。
3. 如果还要看这次请求最终准备出来的 prepared turn，再看 [Inspection](./prompt-runtime-inspection) 里的 `inspect`。
4. 如果要了解公开 mode 目录和默认值，再看 [Capabilities](./prompt-runtime-capabilities)。
