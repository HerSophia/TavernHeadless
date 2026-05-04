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

## explain 的真相边界

`GET /floors/:id/prompt-runtime/explain` 仍然只读取 **历史 committed truth**。

这条边界不变：

- explain 不新增新的顶层 `mode`
- 历史 mode 真相继续使用 `prompt_snapshot.prompt_mode`
- explain 不会重跑 prompt assembly、宏展开、预算分配或来源选择

## compare 的真相边界

`POST /sessions/:id/prompt-runtime/compare` 继续只比较 committed truth。

本轮没有为 compare 新增新的 mode 专用字段。
如果你要看当前会话的显式 mode，请回到 [Mode](./prompt-runtime-mode)。

## 相关页面

- 总览页：[Prompt Runtime](./prompt-runtime)
- mode 控制面：[Prompt Runtime Mode](./prompt-runtime-mode)
- capabilities 目录：[Prompt Runtime Capabilities](./prompt-runtime-capabilities)
