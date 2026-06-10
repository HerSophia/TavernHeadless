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

但 I1 里的 `prompt_runtime_injections` 是一个例外：

- `preview` 会接收 `prompt_runtime_injections`
- `preview` 不会把这些 injection 注入 `text`
- `preview` 只会在 `runtime_trace.injection` 里回显解析结果

`inspect` 则继续表示一次真实 prepared turn 的只读视图。

## 结构化记忆真相边界

这组 inspection 入口现在统一遵守下面这条口径：

- `memory_injection`：原始 `MemoryInjectionResult`，只在 `preview` 和 `inspect` 返回
- `memory`：Prompt Runtime 统一记忆 trace，`preview`、`inspect`、historical `explain` 都可返回
- `memory_summary`：兼容投影，不再被视为唯一真相

其中 `memory_injection.scope_resolution` 的外层字段是 snake_case，
但内部 `scope_refs[].scopeId` 与 `explicit_scope.scopeId` 继续保持 `scopeId`。
这是当前公开契约的一部分。

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

`inspect` 的 `prepared_turn` 现在还会返回三组新增字段：

- `memory_injection`
- `memory`
- `memory_summary`
- `contributors`
- `prepare_phase_trace`
- `runtime_trace.injection`

同时，`inspect` 顶层还会返回：

- `injections`

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
- `injection`
- `pre_response`
- `assemble`
- `materialize`
- `inspect`

它用于说明这次 prepared turn 是如何被准备出来的。

它不是 persisted explain truth，也不是可恢复执行检查点。

### `runtime_trace.injection` 与顶层 `injections`

I1 现在新增了请求级 Prompt Runtime Injection 观测面。

这组字段只对应本次请求里的 `prompt_runtime_injections`，不做持久化。

`preview`：

- 只在 `runtime_trace.injection.items` 中回显解析结果
- 不会把 injection 注入 `text`

`inspect`：

- 顶层 `injections` 返回完整条目列表
- `prepared_turn.runtime_trace.injection.items` 返回同一组结构化结果
- `prepared_turn.prepare_phase_trace` 里会新增 `phase="injection"`

每个 injection 条目至少包含：

- `request_index`
- `source_kind`
- `scope`
- `placement_requested`
- `order_requested`
- `title`
- `content_length`
- `applied`
- `placement_resolved`
- `not_applied_reason`

当前 I1 公开边界固定为：

- `source_kind` 只允许 `client_injection`
- `scope` 只允许 `request`
- `order` 只影响同一 placement 内部顺序，默认 `100`

`not_applied_reason` 当前可能为：

- `placement_not_available_in_mode`
- `unknown_placement`
- `empty_title_or_content`
- `prompt_section_absent`

可用 placement 为：

- `before_system_prompt` / `after_system_prompt`
- `before_character` / `after_character`
- `before_persona` / `after_persona`
- `before_worldbook` / `after_worldbook`
- `before_memory` / `after_memory`
- `before_examples` / `after_examples`
- `before_history` / `after_history`
- `before_current_user_input` / `after_current_user_input`
- `before_output_instruction`
- `before_assistant_prefill`

这组字段用于回答两个问题：

1. 客户端请求里提交了哪些 injection
2. 这些 injection 最终是否生效，落在了什么语义锚点上

## generation_params_resolution

`preview` 的 `runtime_trace` 和 `inspect` 的
`prepared_turn.runtime_trace` 现在都可能返回
`generation_params_resolution`。

这组字段用于解释每个生成参数在本次请求里的最终去向。

每个条目至少包含：

- `name`
- `final_state`
- `origin`

按情况还会包含：

- `cancelled_at`
- `value_from`

你可以这样理解：

- `final_state="sent"`：这个参数最终进入了运行期结果
- `final_state="absent"`：这个参数最终没有值
- `final_state="cancelled"`：某一层显式传入了 `null`，把它取消了

其中：

- `origin` 表示最终结果来自哪一层，或表示它最终缺省
- `cancelled_at` 表示是哪一层执行了显式取消
- `value_from` 表示最终值来自哪一层

这组字段主要用于排查下面这类问题：

- profile 已经配了参数，为什么本次请求没有生效
- instance 覆盖后，为什么最后仍然缺省
- request 里传了 `null` 之后，为什么默认值没有再补回

它不改变 preview / inspect 的既有边界，只增加参数解析的可观察性。

## tool_transport

`preview` 的 `runtime_trace` 和 `inspect` 的
`prepared_turn.runtime_trace` 现在也可能返回
`tool_transport`。

这组字段用于说明本次请求期工具调用走的是哪条 transport 路径，
以及 text protocol 路径里的注入与解析事实。

至少会返回：

- `selection.transport`
- `selection.reason_code`

按情况还会返回：

- `selection.reason_detail`
- `tool_list`
- `parsing`

其中：

- `tool_list.injected` 表示本次是否注入了工具目录文本
- `tool_list.contributor_id` 表示注入来源 contributor
- `tool_list.tool_count` 表示注入时的工具数量
- `parsing.block_count` / `accepted_count` / `rejected_count` 表示 text protocol 解析统计
- `parsing.diagnostics` 会给出 `call_id`、`tool_name`、`reason` 和 `excerpt`

它不改变 preview / inspect 的既有边界，只增加工具调用 transport 的可观察性。

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

它继续返回 committed `memory` trace，
但不会补回请求期原始 `memory_injection`。

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
