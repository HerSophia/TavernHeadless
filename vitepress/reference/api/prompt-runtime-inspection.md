---
outline: [2, 3]
---

# Prompt Runtime Inspection（预览、检查、历史解释与比较）

这一页承接 Prompt Runtime 的 inspection 路由族。

## 什么时候需要看这页

- 想做单段文本宏预览。
- 想在不调用模型、不创建 floor 的前提下，看一次完整 prepared turn。
- 想回看某个已提交楼层在 commit 时真正保存下来的 Prompt Runtime 真相。
- 想比较两个已提交楼层的 Prompt Runtime 差异。

## 路由列表

| 接口 | 用途 |
| ---- | ---- |
| `POST /sessions/:id/prompt-runtime/preview` | 单段文本宏预览 |
| `POST /sessions/:id/prompt-runtime/inspect` | 无副作用 prepared turn 检查 |
| `GET /floors/:id/prompt-runtime/explain` | 读取 committed truth |
| `POST /sessions/:id/prompt-runtime/compare` | 比较两个 committed floor 的差异 |

## preview 和 inspect 的区别

| 接口 | 是否完整 prepared turn | 是否调用模型 | 是否创建 floor | 是否写 committed truth |
| ---- | ---- | ---- | ---- | ---- |
| `preview` | 否，只做单段文本 `macro_text_preview` | 否 | 否 | 否 |
| `inspect` | 是 | 否 | 否 | 否 |

`preview` 的边界仍然保持不变。

它不承诺：

- 完整 assemble
- budget allocation
- materialize
- contributor resolve
- prepare phase trace

`inspect` 则继续表示一次真实 prepared turn 的只读视图。

## inspect 新增的 mode 视图

`POST /sessions/:id/prompt-runtime/inspect` 现在会在顶层返回 `mode`。

它和 `GET /sessions/:id/prompt-runtime/mode` 使用同一套字段：

- `prompt_mode`
- `session_prompt_mode`
- `effective_prompt_mode`
- `default_prompt_mode`
- `legacy_fallback`
- `source`

这让你在请求期检查时，可以同时看到：

1. 本次 prepared turn 的 policy / source map
2. 当前会话提示词模式的来源和 fallback 情况

## inspect 中新增的 prepared turn 观测字段

`inspect` 的 `prepared_turn` 现在还会返回两组新增字段：

- `contributors`
- `prepare_phase_trace`

### `contributors`

这是 pre-response contributor 的稳定视图。

当前只返回裁剪后的只读字段，不返回内部 raw payload。

每个 contributor 项至少包含：

- `id`
- `kind`
- `source_kind`
- `mode_scope`
- `prompt_renderable`
- `deterministic`
- `cache_scope`

其中：

- `prompt_renderable` 只在该 contributor 有可注入文本时出现
- `mode_scope` 用来说明该 contributor 面向 `compat_plus` 还是 `native`
- `cache_scope` 现在用于表达该结果是否适合按 floor 或 page 复用

### `prepare_phase_trace`

这是 prepared turn 在准备阶段的顺序化轨迹。

当前 phase 固定为：

- `conversation_resolve`
- `source_resolve`
- `pre_response`
- `assemble`
- `materialize`
- `inspect`

它用于说明这次 prepared turn 是如何被准备出来的。

它不是 persisted explain truth，也不是可恢复执行检查点。

## capabilities 中对应的 inspect 能力声明

`GET /prompt-runtime/capabilities` 的 `observability.inspect` 现在会明确声明：

- `returns_prepared_turn`
- `returns_governance`
- `returns_contributors`
- `returns_prepare_phase_trace`

这几项能力共同说明：

- `inspect` 仍然是 prepared-turn inspect
- 它可以返回治理视图
- 它现在也可以返回 contributor 视图和 prepare phase trace

## explain 的真相边界

`GET /floors/:id/prompt-runtime/explain` 仍然只读取 **历史 committed truth**。

这条边界不变：

- explain 不新增新的顶层 `mode`
- 历史 mode 真相继续使用 `prompt_snapshot.prompt_mode`
- explain 不会重跑 prompt assembly、宏展开、预算分配或来源选择
- explain 也不会补写 contributor raw payload

## compare 的真相边界

`POST /sessions/:id/prompt-runtime/compare` 继续只比较 committed truth。

本轮没有为 compare 新增新的 mode 专用字段。
如果你要看当前会话的显式 mode，请回到 [Mode](./prompt-runtime-mode)。

## 相关页面

- 总览页：[Prompt Runtime](./prompt-runtime)
- mode 控制面：[Prompt Runtime Mode](./prompt-runtime-mode)
- capabilities 目录：[Prompt Runtime Capabilities](./prompt-runtime-capabilities)
