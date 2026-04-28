---
outline: [2, 3]
---

# Prompt Runtime（提示词运行时）

Prompt Runtime 用来回答一个很具体的问题：**当前这次聊天，会按什么规则组装提示词。**

这里可以查看会话当前绑定了哪些提示词资源，当前 session 和 branch 生效的策略是什么，也可以做少量只读调试。

它不是发送消息的接口，也不会替代现有的 Chat 主链路。

如果你只需要普通聊天，先看 [Chat（对话生成）](./chat) 即可。只有在你需要排查提示词组装、预览宏结果、或比较两个已提交楼层的提示词快照时，才需要看这一页。

## 什么时候需要看这页

- 想确认当前会话绑定了哪些提示词资源，例如预设、角色卡、世界书、正则。
- 想查看 session 或 branch 当前真正生效的提示词策略。
- 想预览一小段文本里的宏会被展开成什么结果，但又不想真的发起一次聊天。
- 想回看某个已提交楼层在当时真正落库的提示词快照，或者比较两个已提交楼层之间的差异。

## 一个简单例子

假设你在排查“为什么这个会话最近发给模型的提示词变短了”。可以按下面的顺序看：

1. `GET /sessions/:id/prompt-runtime`：先看当前绑定了哪些提示词资源，当前预算和来源选择规则是什么。
2. `POST /sessions/:id/prompt-runtime/preview`：拿一小段包含宏的文本做预览，确认宏展开结果是否符合预期。
3. `GET /floors/:id/prompt-runtime/explain`：如果问题只出现在某个已提交楼层，再回看当时真正落库的解释快照。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| Prompt Assets | 组成提示词的资源，例如预设、角色卡、世界书、正则配置 |
| policy | 提示词组装规则，例如结构、投递方式、预算、来源选择 |
| preview | 只对一小段文本做预览，不发起真实聊天，不创建 floor |
| explain | 读取某个已提交楼层当时真正保存下来的提示词解释快照 |
| compare | 比较两个已提交楼层的提示词快照差异 |

当前还提供一个**单段文本宏预览**入口：`POST /sessions/:id/prompt-runtime/preview`。它只处理一段 `text`，不会创建第二条执行链，也不会真正发起一次聊天。

这个入口的正式能力名是 `macro_text_preview`。它不是“完整提示词预览”：不会执行完整 prompt 组装、不会分配预算、不会生成最终投递内容，返回的 `runtime_trace` 也只会投影 `macro`、`source_selection`、`visibility` 这三个子字段。

## 设计边界
当前 Prompt Runtime 对外公开的是只读控制面，以及单段文本预览入口。下面这些边界不会变：

- 不创建第二条执行链，真实聊天仍走 `respond` / `regenerate` / `retry` / `edit-and-regenerate`。
- `character_card` 仍然属于 Prompt Assets。
- 当前不提供 `GET /sessions/:id/prompt-runtime/macros`。
- 当前不提供 `GET /sessions/:id/prompt-runtime/run`。
- preview 只提供 `POST /sessions/:id/prompt-runtime/preview`，一次只处理一段文本。它的正式能力名是 `macro_text_preview`。
- preview 不调用模型、不创建楼层、不写 `prompt_snapshot`、不提交副作用。它也不做完整提示词组装、预算分配和最终投递内容生成，`returns_assembly_truth` 固定为 `false`。
- preview 返回的 `runtime_trace` 只包含三个子字段：`macro`、`source_selection`、`visibility`。完整的预算、投递和结构信息，请读取 `policy` 与 `source_map`。
- `GET /sessions/:id/prompt-runtime` 的 `branch_id` 只能查已经存在的分支；未创建的分支会返回 `404 branch_not_found`。
- branch 策略也只对已经存在的分支生效；不能对还没创建的分支预先写入策略。
- session 与 branch 的策略现在都支持持久化管理：`structure`、`delivery`、`budget`、`source_selection`、`visibility`。
- 策略写入后统一包裹一层 envelope（`version`、`updated_at`、`updated_by`、`value`）。读取侧会继续兼容旧的裸对象格式。
- 一次真实聊天在成功提交后，会把 `prompt_runtime_explain_snapshot` 与助理消息、楼层状态、`prompt_snapshot`、提交结果等数据一起写入同一个数据库事务。
- `GET /floors/:id/prompt-runtime/explain` 和 `POST /sessions/:id/prompt-runtime/compare` 只读取已持久化的真相，不会重新组装提示词、重新展开宏、重新计算预算或来源选择。
- 对于没有 committed snapshot 的旧楼层，会显式返回 `snapshot_available: false` 和结构化 `limitations`，不会试图用启发式方法补数据。
- compare 在第一版只支持同一个会话内的两个已提交楼层，不支持 preview 与楼层混合比较。
- 内建只读宏值不会被持久化。ST 的 `local` / `global` 兼容快照和 `runKind` 也不会被持久化。
- 宏诊断仍然属于统一的观测面，不会另外开一组独立的诊断接口。



## 认证

这组接口遵循全局认证规则。路径和响应中的 JSON 字段仍然使用 `snake_case`。

## 公共对象

### AssetSummary

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 资源 ID |
| `name` | string \| null | 资源名称。资源已解绑或原资源已不存在时可能为 `null` |

### ResolvedStructurePolicy

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `mode` | string | `default` / `strict_alternating` / `no_assistant` / `flattened` |
| `merge_adjacent_same_role` | boolean | 是否合并相邻同角色消息 |
| `preserve_system_messages` | boolean | 是否保留 system 消息 |
| `assistant_rewrite_strategy` | string | 可选。`to_system` / `to_user_transcript` |

### ResolvedDeliveryPolicy

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `allow_assistant_prefill` | boolean | 是否允许 assistant prefill |
| `require_last_user` | boolean | 是否要求最后一条消息是 user |
| `no_assistant` | boolean | 是否禁止 assistant 消息直接进入最终发送消息列 |

### BudgetPolicy

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `max_input_tokens` | integer | 可选。当前首轮用于显式约束 prompt 输入预算 |
| `reserved_completion_tokens` | integer | 可选。当前首轮用于显式预留 completion 预算 |

### SourceSelectionPolicy

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `history.mode` | string | `full` / `windowed` |
| `history.max_messages` | integer | 可选。当前首轮按消息数收紧 history 窗口 |
| `memory.enabled` | boolean | 是否允许 memory summary 进入本次 prompt / preview 解释面 |
| `worldbook.enabled` | boolean | 是否允许世界书参与本次 prompt 组装 |
| `examples.enabled` | boolean | 是否允许 example dialogue 进入本次 prompt 组装 |

### DebugPolicy

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `include_prompt_snapshot` | boolean | live 最小观测是否允许请求级打开 `prompt_snapshot` |
| `include_runtime_trace` | boolean | live 最小观测是否允许请求级打开 `runtime_trace` |
| `include_worldbook_matches` | boolean | live 最小观测是否允许请求级展开 `worldbook.matches` |

### PersistentPolicy

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `structure` | object | 可选。session 级持久化结构策略 |
| `structure.mode` | string | `default` / `strict_alternating` / `no_assistant` / `flattened`。当前结构对象存在时必填 |
| `structure.merge_adjacent_same_role` | boolean | 可选 |
| `structure.assistant_rewrite_strategy` | string | 可选。`to_system` / `to_user_transcript` |
| `structure.preserve_system_messages` | boolean | 可选 |
| `delivery` | object | 可选。session 级持久化投递策略 |
| `delivery.allow_assistant_prefill` | boolean | 可选 |
| `delivery.require_last_user` | boolean | 可选 |
| `delivery.no_assistant` | boolean | 可选 |
| `budget` | object | 可选。session / branch 级持久化 budget 策略 |
| `budget.max_input_tokens` | integer | 可选。输入预算上限 |
| `budget.reserved_completion_tokens` | integer | 可选。为回复预留的 completion 预算 |
| `source_selection` | object | 可选。session / branch 级持久化 source selection 策略 |
| `source_selection.history.mode` | string | `full` / `windowed` |
| `source_selection.history.max_messages` | integer | 可选。history 窗口上限 |
| `source_selection.memory.enabled` | boolean | 可选 |
| `source_selection.worldbook.enabled` | boolean | 可选 |
| `source_selection.examples.enabled` | boolean | 可选 |

### PersistentPolicyEnvelope

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `version` | integer | envelope 版本号。每次成功写入都会递增 |
| `updated_at` | integer | 最近一次成功写入时间戳（ms） |
| `updated_by` | string \| null | 最近一次写入者标识。通常来自认证主体 |
| `value` | [PersistentPolicy](#persistentpolicy) | 实际持久化策略值 |

### SectionStat

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `section_name` | string | prompt 区段名 |
| `token_count` | integer | 该区段的 token 统计值 |

`section_name` 是后端真实写入的 IR section 名称。当前已知稳定命名：

- `history`、`main` 等 preset-driven section 继续沿用预设中定义的名称。
- 记忆相关 section 在 `compat_plus` 与 `native` 两条装配路径下统一为 `memory`。
- `compat` 路径下记忆仍以后置 `system` 消息形式注入，不会产生 `memory` section，`section_stats` 中也不会出现对应条目。

### DiffEntry

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `path` | string | 结构化差异路径。compare 响应中的路径固定使用 `snake_case` |
| `change_type` | string | `added` / `removed` / `changed` |
| `left` | any | 左侧值。仅在有值时返回 |
| `right` | any | 右侧值。仅在有值时返回 |

### AssetsView

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `preset` | [AssetSummary](#assetsummary) \| null | 绑定的预设 |
| `character_card` | [AssetSummary](#assetsummary) \| null | 绑定的角色卡 |
| `worldbook` | [AssetSummary](#assetsummary) \| null | 绑定的世界书 |
| `regex_profile` | [AssetSummary](#assetsummary) \| null | 绑定的正则配置 |

### ResolvedState

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `scope` | object | 当前 resolved state 所对应的 branch 作用域 |
| `scope.session_id` | string | 会话 ID |
| `scope.target_branch_id` | string | 当前 resolved state 面向的目标 branch |
| `scope.branch_exists` | boolean | 当前 branch 是否已物化。对这个接口恒为 `true` |
| `scope.source_floor_id` | string \| null | 当前 resolved state 不做新 branch 物化，因此通常为 `null` |
| `scope.history_source_branch_id` | string | 历史真正读取自哪个 branch |
| `scope.history_source_mode` | string | 当前至少会返回 `existing_branch` |
| `policy` | object | 当前生效策略 |
| `policy.structure` | [ResolvedStructurePolicy](#resolvedstructurepolicy) | 当前结构策略 |
| `policy.delivery` | [ResolvedDeliveryPolicy](#resolveddeliverypolicy) | 当前投递策略 |
| `policy.budget` | [BudgetPolicy](#budgetpolicy) | 当前正式 budget 策略视图 |
| `policy.source_selection` | [SourceSelectionPolicy](#sourceselectionpolicy) | 当前正式 source selection 策略视图 |
| `policy.debug` | [DebugPolicy](#debugpolicy) | 当前 debug 能力边界 |
| `persistent_policy` | [PersistentPolicy](#persistentpolicy) | 可选。当前 session 已持久化的默认策略 |
| `persistent_policy_envelope` | [PersistentPolicyEnvelope](#persistentpolicyenvelope) \| null | 可选。当前 session 持久化默认策略的 envelope 元数据 |
| `branch_persistent_policy` | [PersistentPolicy](#persistentpolicy) \| null | 当前目标 branch 已持久化的 overlay。若当前 branch 未配置 overlay，则返回 `null` |
| `branch_persistent_policy_envelope` | [PersistentPolicyEnvelope](#persistentpolicyenvelope) \| null | 可选。当前目标 branch overlay 的 envelope 元数据 |
| `assets` | [AssetsView](#assetsview) | 当前 Prompt Assets 绑定 |
| `warnings` | string[] | 控制面读取时产生的兼容 warning。当前至少会覆盖 invalid session policy、invalid branch policy，以及 `delivery.no_assistant` 推导出 `structure.mode = no_assistant` 的派生 warning |
| `diagnostics` | object[] | 结构化诊断摘要。resolved state 当前仍以 warning 投影为主；historical explain / preview 还会补充 explain snapshot、branch materialization 等说明型 diagnostics |
| `diagnostics[].code` | string | 诊断代码 |
| `diagnostics[].message` | string | 诊断说明 |
| `diagnostics[].severity` | string | `info` / `warning` / `error` |
| `diagnostics[].source` | string | 可选。当前至少会覆盖 `policy` / `branch` / `budget` / `source_selection` |
| `diagnostics[].field_path` | string | 可选。命中的字段路径 |
| `diagnostics[].phase` | string | 可选。当前 control plane 读取通常省略；preview / explain 场景会返回显式 phase |
| `limitations` | string[] | 当前已知边界摘要，例如 memory 仍不具备 branch 隔离、`variableCommit` 仍只做 `page -> floor` |
| `source_map` | object | 可选。当前已覆盖 `structure` / `delivery` / `budget` / `source_selection` / `visibility` / `debug` 的来源解释，以及 `history.source_branch_id` / `history.source_mode` |

### PolicyView

`GET /sessions/:id/prompt-runtime/policy` 与 branch policy 路由都返回这个对象：

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `persistent_policy_envelope` | [PersistentPolicyEnvelope](#persistentpolicyenvelope) \| null | 可选。已持久化策略的 envelope 元数据 |
| `persistent_policy` | [PersistentPolicy](#persistentpolicy) | 可选。对于 session policy 路由，这里表示 session policy；对于 branch policy 路由，这里表示 branch overlay |
| `resolved_policy` | object | 当前解析后的生效策略 |
| `warnings` | string[] | 当前 policy 读取过程中产生的 warning |

### Capabilities

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `structure.modes` | string[] | 当前支持的结构模式 |
| `structure.defaults` | [ResolvedStructurePolicy](#resolvedstructurepolicy) | 系统默认结构策略 |
| `delivery.defaults` | [ResolvedDeliveryPolicy](#resolveddeliverypolicy) | 系统默认投递策略 |
| `budget.defaults` | [BudgetPolicy](#budgetpolicy) | 当前正式 budget 默认值 |
| `budget.request_override_supported` | boolean | 当前是否支持 request 级 budget override |
| `budget.persistent_patch_supported` | boolean | 当前是否支持持久化 PATCH 写入 budget |
| `budget.supported_fields` | string[] | 当前支持的 budget 治理字段名 |
| `budget.trim_reason_codes` | string[] | 当前支持的 trim reason code |
| `source_selection.defaults` | [SourceSelectionPolicy](#sourceselectionpolicy) | 当前正式 source selection 默认值 |
| `source_selection.request_override_supported` | boolean | 当前是否支持 request 级 source selection override |
| `source_selection.persistent_patch_supported` | boolean | 当前是否支持持久化 PATCH 写入 source selection |
| `source_selection.supported_sources` | string[] | 当前支持的公开 source selection 来源。内部 budget group label（如 `section:*`）不会出现在这里 |
| `source_selection.history_modes` | string[] | 当前支持的 history mode |
| `source_selection.exclusion_reason_codes` | string[] | 当前支持的 exclusion reason code |
| `governance.session.envelope_metadata` | boolean | session policy 是否带 envelope 元数据 |
| `governance.session.null_clears_field` | boolean | session policy PATCH 是否支持显式 `null` 清空字段 |
| `governance.session.object_patch` | string | 当前固定为 `deep_merge` |
| `governance.session.supported_fields` | string[] | session policy 当前可治理字段 |
| `governance.branch.envelope_metadata` | boolean | branch policy 是否带 envelope 元数据 |
| `governance.branch.materialized_branches_only` | boolean | branch policy 是否只允许已物化 branch |
| `governance.branch.null_clears_field` | boolean | branch policy PATCH 是否支持显式 `null` 清空字段 |
| `governance.branch.object_patch` | string | 当前固定为 `deep_merge` |
| `governance.branch.supported_fields` | string[] | branch policy 当前可治理字段 |
| `compare.enabled` | boolean | 是否启用 committed floor compare |
| `compare.committed_floors_only` | boolean | compare 是否只支持 committed floor |
| `compare.mixed_preview_supported` | boolean | 是否支持 preview 与 committed floor 混合比较 |
| `compare.limitations_instead_of_recompute` | boolean | 缺 snapshot 时是否返回 limitations 而不是重算 |
| `observability.live.enabled` | boolean | 是否支持 live 最小观测 |
| `observability.live.default_off` | boolean | live 最小观测是否默认关闭 |
| `observability.live.request_scoped_only` | boolean | live 最小观测是否只允许请求级打开 |
| `observability.live.include_prompt_snapshot` | boolean | live 是否支持 `prompt_snapshot` |
| `observability.live.include_runtime_trace` | boolean | live 是否支持 `runtime_trace` |
| `observability.live.include_worldbook_matches` | boolean | live 是否支持 `worldbook.matches` |
| `observability.live.worldbook_matches_requires_runtime_trace` | boolean | `worldbook.matches` 是否要求同时打开 `runtime_trace` |
| `observability.live.worldbook_matches_requires_opt_in` | boolean | `worldbook.matches` 是否必须显式 opt-in |
| `observability.live.visibility_request_supported` | boolean | live 是否允许 request 级 `visibility` |
| `observability.dry_run.enabled` | boolean | dry-run 能力是否可用 |
| `observability.dry_run.returns_assembly` | boolean | dry-run 是否返回 `assembly` |
| `observability.dry_run.returns_runtime_trace` | boolean | dry-run 是否返回 `runtime_trace` |
| `observability.dry_run.supports_visibility` | boolean | dry-run 是否支持 `visibility` |
| `observability.dry_run.include_worldbook_matches` | boolean | dry-run 是否支持 `worldbook_matches` |
| `observability.preview.enabled` | boolean | preview 能力是否可用 |
| `observability.preview.mode` | string | preview 正式契约。当前固定为 `macro_text_preview`，表示 preview 只是宏解析子视图 |
| `observability.preview.returns_assembly_truth` | boolean | preview 是否暴露 full prompt assembly 真相。当前固定为 `false` |
| `observability.preview.returns_runtime_trace` | boolean | preview 是否返回 `runtime_trace` |
| `observability.preview.supports_visibility` | boolean | preview 是否支持 `visibility` |
| `observability.preview.single_text_only` | boolean | preview 是否限制为单段文本 |
| `observability.preview.llm_call` | boolean | preview 是否会调用 LLM |
| `observability.preview.creates_floor` | boolean | preview 是否会创建 floor |
| `observability.preview.writes_prompt_snapshot` | boolean | preview 是否会写 `prompt_snapshot` |
| `observability.preview.commits_side_effects` | boolean | preview 是否会提交副作用 |
| `observability.preview.trace_subset` | string[] | preview 会投影到 `runtime_trace` 的子字段列表。当前固定为 `["macro", "source_selection", "visibility"]` |
| `observability.explain.enabled` | boolean | historical explain 是否可用 |
| `observability.explain.read_only` | boolean | explain 是否只读 |
| `observability.explain.requires_committed_floor` | boolean | explain 是否只面向 committed floor |
| `observability.explain.persisted_truth_only` | boolean | explain 是否只读取持久化真相 |
| `observability.explain.recompute` | boolean | explain 是否会重新组装 / 重算。当前固定为 `false` |
| `observability.explain.snapshot_supported` | boolean | 是否支持 committed explain snapshot |
| `observability.explain.legacy_floor_fallback` | boolean | 旧 floor 缺 snapshot 时是否保留 fallback |
| `observability.explain.snapshot_availability_field` | string | 当前固定为 `snapshot_available` |
| `observability.stream.enabled` | boolean | SSE 路径是否存在 |
| `observability.stream.prompt_debug_payload` | string | 当前为 `done_only` 或 `unsupported` |
| `observability.stream.new_sse_event_family` | boolean | 是否新增独立 SSE 事件族 |
| `macro.built_in_read_only_values_persistable` | boolean | 内建只读宏值是否允许持久化 |
| `macro.st_compatibility_snapshots_persistable` | boolean | ST `local/global` 兼容快照是否允许持久化 |
| `macro.run_kind_persistable` | boolean | `runKind` 是否允许持久化 |
| `macro.diagnostics_surface` | string | 当前为 `unified_observability` |
| `macro.dedicated_macros_route` | boolean | 是否存在独立 macros control plane 路由 |
| `macro.recent_message_respects_visibility` | boolean | 最近消息读取是否遵守 visibility |
| `unsupported` | string[] | 当前明确不支持的 Prompt Runtime 路由 |

## 获取会话 Prompt Runtime 解析结果

```http
GET /sessions/:id/prompt-runtime
```

返回当前 session 在某个**已物化 branch**上的生效策略、已持久化默认策略、Prompt Assets 绑定，以及 session / branch policy envelope 元数据。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 会话 ID |

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `branch_id` | string | 否 | 指定要查看的**已物化 branch**。省略时默认查看 `main` |

### 响应 `200`

```json
{
  "data": {
    "scope": {
      "session_id": "session-1",
      "target_branch_id": "alt-branch",
      "branch_exists": true,
      "source_floor_id": null,
      "history_source_branch_id": "alt-branch",
      "history_source_mode": "existing_branch"
    },
    "policy": {
      "structure": {
        "mode": "no_assistant",
        "merge_adjacent_same_role": true,
        "preserve_system_messages": true,
        "assistant_rewrite_strategy": "to_system"
      },
      "delivery": {
        "allow_assistant_prefill": true,
        "require_last_user": true,
        "no_assistant": true
      },
      "budget": {
        "max_input_tokens": 4096,
        "reserved_completion_tokens": 1024
      },
      "source_selection": {
        "history": {
          "mode": "windowed",
          "max_messages": 24
        },
        "memory": { "enabled": true },
        "worldbook": { "enabled": true },
        "examples": { "enabled": false }
      },
      "debug": {
        "include_prompt_snapshot": false,
        "include_runtime_trace": false,
        "include_worldbook_matches": false
      }
    },
    "persistent_policy": {
      "structure": {
        "mode": "strict_alternating",
        "preserve_system_messages": true
      },
      "delivery": {
        "require_last_user": true
      }
    },
    "persistent_policy_envelope": {
      "version": 1,
      "updated_at": 1710000004200,
      "updated_by": "user-1",
      "value": {
        "structure": {
          "mode": "strict_alternating",
          "preserve_system_messages": true
        },
        "delivery": {
          "require_last_user": true
        }
      }
    },
    "branch_persistent_policy": {
      "delivery": {
        "no_assistant": true
      }
    },
    "branch_persistent_policy_envelope": {
      "version": 2,
      "updated_at": 1710000004500,
      "updated_by": "user-1",
      "value": {
        "delivery": {
          "no_assistant": true
        },
        "budget": {
          "max_input_tokens": 4096,
          "reserved_completion_tokens": 1024
        },
        "source_selection": {
          "history": {
            "mode": "windowed",
            "max_messages": 24
          },
          "memory": { "enabled": true },
          "worldbook": { "enabled": true },
          "examples": { "enabled": false }
        }
      }
    },
    "assets": {
      "preset": {
        "id": "preset-story",
        "name": "Story Preset"
      },
      "character_card": {
        "id": "char-hero",
        "name": "Hero"
      },
      "worldbook": {
        "id": "wb-lore",
        "name": "Lorebook"
      },
      "regex_profile": {
        "id": "regex-safe",
        "name": "Safety Regex"
      }
    },
    "source_map": {
      "structure": {
        "mode": "branch_policy",
        "merge_adjacent_same_role": "branch_policy",
        "preserve_system_messages": "system_default",
        "assistant_rewrite_strategy": "system_default"
      },
      "delivery": {
        "allow_assistant_prefill": "system_default",
        "require_last_user": "session_policy",
        "no_assistant": "branch_policy"
      },
      "budget": {
        "max_input_tokens": "request_override",
        "reserved_completion_tokens": "request_override"
      },
      "source_selection": {
        "history": {
          "mode": "request_override",
          "max_messages": "request_override"
        },
        "memory": { "enabled": "system_default" },
        "worldbook": { "enabled": "system_default" },
        "examples": { "enabled": "request_override" }
      },
      "history": {
        "source_branch_id": "alt-branch",
        "source_mode": "existing_branch"
      }
    },
    "warnings": [
      "delivery.noAssistant forced the resolved structure.mode to no_assistant."
    ],
    "diagnostics": [
      {
        "code": "derived_no_assistant_structure",
        "message": "delivery.noAssistant forced the resolved structure.mode to no_assistant.",
        "severity": "warning",
        "source": "policy",
        "field_path": "policy.structure.mode"
      }
    ],
    "limitations": [
      "Memory remains scoped to global / chat / floor. Branch isolation is not available.",
      "Variable commit remains page -> floor. Branch promotion is not automatic."
    ]
  }
}
```

### 常见错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 会话不存在，或不属于当前账号 |
| `404` | `branch_not_found` | `branch_id` 指向未物化或不存在的 branch |
| `500` | `internal_error` | 服务端内部错误 |

### 示例

```bash
curl http://localhost:3000/sessions/session-1/prompt-runtime \
  --get --data-urlencode 'branch_id=alt-branch' \
  -H 'Authorization: Bearer <token>'
```

## 获取会话持久化策略视图

```http
GET /sessions/:id/prompt-runtime/policy
```

返回当前 session 的已持久化默认策略、对应 envelope，以及解析后的生效策略。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 会话 ID |

### 响应 `200`

```json
{
  "data": {
    "persistent_policy": {
      "structure": {
        "mode": "strict_alternating"
      },
      "delivery": {
        "require_last_user": true
      },
      "budget": {
        "max_input_tokens": 4096,
        "reserved_completion_tokens": 1024
      },
      "source_selection": {
        "history": {
          "mode": "windowed",
          "max_messages": 24
        },
        "examples": {
          "enabled": false
        }
      }
    },
    "persistent_policy_envelope": {
      "version": 3,
      "updated_at": 1710000004300,
      "updated_by": "user-1",
      "value": {
        "structure": {
          "mode": "strict_alternating"
        },
        "delivery": {
          "require_last_user": true
        },
        "budget": {
          "max_input_tokens": 4096,
          "reserved_completion_tokens": 1024
        },
        "source_selection": {
          "history": {
            "mode": "windowed",
            "max_messages": 24
          },
          "examples": {
            "enabled": false
          }
        }
      }
    },
    "resolved_policy": {
      "structure": {
        "mode": "strict_alternating",
        "merge_adjacent_same_role": true,
        "preserve_system_messages": true,
        "assistant_rewrite_strategy": "to_system"
      },
      "delivery": {
        "allow_assistant_prefill": true,
        "require_last_user": true,
        "no_assistant": false
      },
      "budget": {
        "max_input_tokens": 4096,
        "reserved_completion_tokens": 1024
      },
      "source_selection": {
        "history": {
          "mode": "windowed",
          "max_messages": 24
        },
        "memory": { "enabled": true },
        "worldbook": { "enabled": true },
        "examples": { "enabled": false }
      },
      "debug": {
        "include_prompt_snapshot": false,
        "include_runtime_trace": false,
        "include_worldbook_matches": false
      }
    },
    "warnings": []
  }
}
```

### 常见错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 会话不存在，或不属于当前账号 |
| `500` | `internal_error` | 服务端内部错误 |

### 示例

```bash
curl http://localhost:3000/sessions/session-1/prompt-runtime/policy \
  -H 'Authorization: Bearer <token>'
```

## 更新会话持久化策略

```http
PATCH /sessions/:id/prompt-runtime/policy
```

对 session 级默认策略做增量更新。

当前允许写入：

- `structure`
- `delivery`
- `budget`
- `source_selection`

当前不允许写入：

- `debug`
- 内建只读宏值
- ST `local/global` 兼容快照
- `runKind`

### 合并规则

- 省略某个 section：保留原值。
- 传 section 对象：按已知 schema 做稳定 deep merge。
- 传 `null`：清空该 section。

### envelope 语义

- 读取侧继续兼容旧的 bare object metadata。
- 写入侧统一升级为 envelope：`{ version, updated_at, updated_by, value }`。
- `updated_by` 通常来自当前认证主体。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 会话 ID |

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `structure` | object \| null | 否 | session 级结构策略。传 `null` 表示清空 |
| `structure.mode` | string | 条件必填 | 当 `structure` 为对象时必填：`default` / `strict_alternating` / `no_assistant` / `flattened` |
| `structure.merge_adjacent_same_role` | boolean | 否 | 可选覆盖 |
| `structure.assistant_rewrite_strategy` | string | 否 | `to_system` / `to_user_transcript` |
| `structure.preserve_system_messages` | boolean | 否 | 可选覆盖 |
| `delivery` | object \| null | 否 | session 级投递策略。传 `null` 表示清空 |
| `delivery.allow_assistant_prefill` | boolean | 否 | 可选覆盖 |
| `delivery.require_last_user` | boolean | 否 | 可选覆盖 |
| `delivery.no_assistant` | boolean | 否 | 可选覆盖 |
| `budget` | object \| null | 否 | session 级 budget 策略。传 `null` 表示清空 |
| `budget.max_input_tokens` | integer | 否 | 输入预算上限 |
| `budget.reserved_completion_tokens` | integer | 否 | completion 预留预算 |
| `source_selection` | object \| null | 否 | session 级 source selection 策略。传 `null` 表示清空 |
| `source_selection.history.mode` | string | 否 | `full` / `windowed` |
| `source_selection.history.max_messages` | integer | 否 | history 窗口上限 |
| `source_selection.memory.enabled` | boolean | 否 | 是否允许 memory summary 进入 prompt |
| `source_selection.worldbook.enabled` | boolean | 否 | 是否允许 worldbook 进入 prompt |
| `source_selection.examples.enabled` | boolean | 否 | 是否允许 example dialogue 进入 prompt |

至少需要提供 `structure`、`delivery`、`budget`、`source_selection`、`visibility` 其中一个。

### 请求示例

```json
{
  "structure": {
    "mode": "strict_alternating",
    "preserve_system_messages": true
  },
  "budget": {
    "max_input_tokens": 4096,
    "reserved_completion_tokens": 1024
  },
  "source_selection": {
    "history": {
      "mode": "windowed",
      "max_messages": 24
    },
    "examples": {
      "enabled": false
    }
  },
  "delivery": null
}
```

### 响应 `200`

成功时返回 [PolicyView](#policyview)。其中 `persistent_policy_envelope` 会体现最新的版本与更新时间。

```json
{
  "data": {
    "persistent_policy": {
      "structure": {
        "mode": "strict_alternating",
        "preserve_system_messages": true
      },
      "budget": {
        "max_input_tokens": 4096,
        "reserved_completion_tokens": 1024
      },
      "source_selection": {
        "history": {
          "mode": "windowed",
          "max_messages": 24
        },
        "examples": {
          "enabled": false
        }
      }
    },
    "persistent_policy_envelope": {
      "version": 4,
      "updated_at": 1710000004600,
      "updated_by": "user-1",
      "value": {
        "structure": {
          "mode": "strict_alternating",
          "preserve_system_messages": true
        },
        "budget": {
          "max_input_tokens": 4096,
          "reserved_completion_tokens": 1024
        },
        "source_selection": {
          "history": {
            "mode": "windowed",
            "max_messages": 24
          },
          "examples": {
            "enabled": false
          }
        }
      }
    },
    "resolved_policy": {
      "structure": {
        "mode": "strict_alternating",
        "merge_adjacent_same_role": true,
        "preserve_system_messages": true,
        "assistant_rewrite_strategy": "to_system"
      },
      "delivery": {
        "allow_assistant_prefill": true,
        "require_last_user": false,
        "no_assistant": false
      },
      "budget": {
        "max_input_tokens": 4096,
        "reserved_completion_tokens": 1024
      },
      "source_selection": {
        "history": {
          "mode": "windowed",
          "max_messages": 24
        },
        "memory": { "enabled": true },
        "worldbook": { "enabled": true },
        "examples": { "enabled": false }
      },
      "debug": {
        "include_prompt_snapshot": false,
        "include_runtime_trace": false,
        "include_worldbook_matches": false
      }
    },
    "warnings": []
  }
}
```

### 常见错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体不合法，例如 `structure` 对象缺少 `mode` |
| `404` | `not_found` | 会话不存在，或不属于当前账号 |
| `500` | `internal_error` | 服务端内部错误 |

### 示例

```bash
curl -X PATCH http://localhost:3000/sessions/session-1/prompt-runtime/policy \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "structure": {
      "mode": "strict_alternating",
      "preserve_system_messages": true
    },
    "budget": {
      "max_input_tokens": 4096,
      "reserved_completion_tokens": 1024
    },
    "source_selection": {
      "history": {
        "mode": "windowed",
        "max_messages": 24
      },
      "examples": {
        "enabled": false
      }
    },
    "delivery": null
  }'
```

## 获取分支持久化策略视图

```http
GET /sessions/:id/prompt-runtime/branches/:branchId/policy
```

返回某个**已物化 branch**上的 branch persistent policy overlay、对应 envelope，以及叠加 session policy 之后的 `resolved_policy`。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 会话 ID |
| `branchId` | string | 目标 branch ID。必须已经物化 |

### 响应 `200`

```json
{
  "data": {
    "persistent_policy": {
      "delivery": {
        "no_assistant": true
      },
      "budget": {
        "max_input_tokens": 4096,
        "reserved_completion_tokens": 1024
      }
    },
    "persistent_policy_envelope": {
      "version": 2,
      "updated_at": 1710000004500,
      "updated_by": "user-1",
      "value": {
        "delivery": {
          "no_assistant": true
        },
        "budget": {
          "max_input_tokens": 4096,
          "reserved_completion_tokens": 1024
        }
      }
    },
    "resolved_policy": {
      "structure": {
        "mode": "no_assistant",
        "merge_adjacent_same_role": true,
        "preserve_system_messages": true,
        "assistant_rewrite_strategy": "to_system"
      },
      "delivery": {
        "allow_assistant_prefill": true,
        "require_last_user": true,
        "no_assistant": true
      },
      "budget": {
        "max_input_tokens": 4096,
        "reserved_completion_tokens": 1024
      },
      "source_selection": {
        "history": {
          "mode": "windowed",
          "max_messages": 24
        },
        "memory": { "enabled": true },
        "worldbook": { "enabled": true },
        "examples": { "enabled": false }
      },
      "debug": {
        "include_prompt_snapshot": false,
        "include_runtime_trace": false,
        "include_worldbook_matches": false
      }
    },
    "warnings": []
  }
}
```

### 常见错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 会话不存在，或不属于当前账号 |
| `404` | `branch_not_found` | `branchId` 不存在或尚未物化 |
| `500` | `internal_error` | 服务端内部错误 |

## 更新分支持久化策略

```http
PATCH /sessions/:id/prompt-runtime/branches/:branchId/policy
```

对某个**已物化 branch**的 persistent policy overlay 做增量更新。

当前允许写入：

- `structure`
- `delivery`
- `budget`
- `source_selection`

### 请求体

请求体字段与 [PATCH /sessions/:id/prompt-runtime/policy](#更新会话持久化策略) 完全一致。

### 合并规则

- 省略某个 section：保留原值。
- 传 section 对象：按已知 schema 做稳定 deep merge。
- 传 `null`：清空该 section。

### envelope 语义

- 读取侧继续兼容旧的 bare object metadata。
- 写入侧统一升级为 envelope：`{ version, updated_at, updated_by, value }`。
- 该路由只面向已物化 branch；不会为不存在的 branch 隐式创建 overlay。

### 响应 `200`

成功时返回 [PolicyView](#policyview)。

### 常见错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体不合法 |
| `404` | `not_found` | 会话不存在，或不属于当前账号 |
| `404` | `branch_not_found` | `branchId` 不存在或尚未物化 |
| `500` | `internal_error` | 服务端内部错误 |

## 获取会话 Prompt Assets 绑定

```http
GET /sessions/:id/prompt-runtime/assets
```

返回当前 session 绑定到 Prompt Runtime 的资产摘要。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 会话 ID |

### 响应 `200`

```json
{
  "data": {
    "preset": {
      "id": "preset-story",
      "name": "Story Preset"
    },
    "character_card": {
      "id": "char-hero",
      "name": "Hero"
    },
    "worldbook": {
      "id": "wb-lore",
      "name": "Lorebook"
    },
    "regex_profile": {
      "id": "regex-safe",
      "name": "Safety Regex"
    }
  }
}
```

### 常见错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 会话不存在，或不属于当前账号 |
| `500` | `internal_error` | 服务端内部错误 |

### 示例

```bash
curl http://localhost:3000/sessions/session-1/prompt-runtime/assets \
  -H 'Authorization: Bearer <token>'
```

## 预览单段文本的宏求值

```http
POST /sessions/:id/prompt-runtime/preview
```

对一段文本执行宏 preview，并返回预览后的文本与 `runtime_trace`。

这个入口继续复用主线宏求值链，但边界固定为：

- 只处理单段 `text`
- 不走 LLM
- 不创建 floor
- 不写 `prompt_snapshot`
- 不提交副作用
- 返回的 `runtime_trace` 当前只投影 `macro`、`source_selection`、`visibility`
- 宏诊断继续统一走 `runtime_trace.macro`

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 会话 ID |

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `text` | string | **是** | 需要 preview 的单段文本 |
| `branch_id` | string | 否 | 指定 preview 使用的目标 branch。可以是尚未物化的新 branch |
| `source_floor_id` | string | 否 | 当 `branch_id` 指向一个尚未物化的新分支时，可用它作为继承 source |
| `visibility` | object | 否 | 最近消息可见范围过滤，与 dry-run 的 `visibility` 语义一致 |
| `structure` | object | 否 | request 级结构策略覆盖。只影响本次 preview 的 control-plane 解析，不会持久化 |
| `delivery` | object | 否 | request 级投递策略覆盖。只影响本次 preview 的 control-plane 解析，不会持久化 |
| `budget` | object | 否 | request 级 budget 策略覆盖。当前首轮支持 `max_input_tokens` 与 `reserved_completion_tokens` |
| `source_selection` | object | 否 | request 级 source selection 覆盖。当前首轮支持 `history` / `memory` / `worldbook` / `examples` |

### 请求示例

```json
{
  "text": "{{.资产.金币=3}}{{getvar::资产}}",
  "branch_id": "alt-preview",
  "source_floor_id": "floor-source",
  "delivery": {
    "no_assistant": true
  },
  "visibility": {
    "mode": "allow_all_except_hidden",
    "hidden_floor_ranges": [
      {
        "start_floor_no": 1,
        "end_floor_no": 2
      }
    ]
  }
}
```

### 响应 `200`

```json
{
  "data": {
    "scope": {
      "session_id": "session-1",
      "target_branch_id": "alt-preview",
      "branch_exists": false,
      "source_floor_id": "floor-source",
      "history_source_branch_id": "fork-branch",
      "history_source_mode": "source_floor_branch"
    },
    "policy": {
      "structure": {
        "mode": "no_assistant",
        "merge_adjacent_same_role": false,
        "preserve_system_messages": true,
        "assistant_rewrite_strategy": "to_system"
      },
      "delivery": {
        "allow_assistant_prefill": true,
        "require_last_user": false,
        "no_assistant": true
      },
      "budget": {
        "max_input_tokens": 4096,
        "reserved_completion_tokens": 1024
      },
      "source_selection": {
        "history": {
          "mode": "windowed",
          "max_messages": 24
        },
        "memory": { "enabled": true },
        "worldbook": { "enabled": true },
        "examples": { "enabled": false }
      },
      "visibility": {
        "mode": "allow_all_except_hidden",
        "hidden_floor_ranges": [
          { "start_floor_no": 1, "end_floor_no": 2 }
        ]
      },
      "debug": {
        "include_prompt_snapshot": false,
        "include_runtime_trace": false,
        "include_worldbook_matches": false
      }
    },
    "source_map": {
      "structure": {
        "mode": "request_override",
        "merge_adjacent_same_role": "request_override",
        "preserve_system_messages": "system_default",
        "assistant_rewrite_strategy": "system_default"
      },
      "delivery": {
        "allow_assistant_prefill": "system_default",
        "require_last_user": "session_policy",
        "no_assistant": "request_override"
      },
      "budget": {
        "max_input_tokens": "request_override",
        "reserved_completion_tokens": "request_override"
      },
      "source_selection": {
        "history": {
          "mode": "request_override",
          "max_messages": "request_override"
        },
        "memory": { "enabled": "system_default" },
        "worldbook": { "enabled": "system_default" },
        "examples": { "enabled": "request_override" }
      },
      "visibility": {
        "mode": "request_override",
        "hidden_floor_ranges": "request_override"
      },
      "history": { "source_branch_id": "fork-branch", "source_mode": "source_floor_branch" }
    },
    "text": "{\"金币\":3}",
    "runtime_trace": {
      "macro": {
        "warnings": [
          {
            "code": "macro_preview_side_effect_suppressed",
            "message": "Macro setvar side effect was previewed but not committed.",
            "macro_name": "setvar"
          }
        ],
        "used_names": ["setvar", "getvar"],
        "mutation_preview": [
          {
            "kind": "set",
            "scope": "branch",
            "key": "资产",
            "value": "{\"金币\":3}"
          }
        ],
        "staged_mutations": [],
        "traces": [
          {
            "macro_name": "setvar",
            "raw_text": "{{.资产.金币=3}}",
            "resolved_text": "",
            "phase": "preview",
            "source_kind": "macro"
          },
          {
            "macro_name": "getvar",
            "raw_text": "{{getvar::资产}}",
            "resolved_text": "{\"金币\":3}",
            "phase": "preview",
            "source_kind": "macro"
          }
        ]
      },
      "source_selection": {
        "excluded_sources": [
          {
            "source": "history",
            "reason": "visibility_filtered",
            "detail": "Visibility filtered 2 floor(s) from the available history window."
          }
        ]
      },
      "visibility": {
        "hidden_floor_ranges": [
          {
            "start_floor_no": 1,
            "end_floor_no": 2
          }
        ],
        "filtered_floor_nos": [1, 2]
      }
    },
    "diagnostics": [
      {
        "code": "unmaterialized_branch_preview",
        "message": "Preview targeted unmaterialized branch 'alt-preview'. Branch policy overlay is unavailable until the branch is materialized.",
        "severity": "info",
        "source": "branch",
        "phase": "preview"
      }
    ],
    "limitations": [
      "Memory remains scoped to global / chat / floor. Branch isolation is not available.",
      "Variable commit remains page -> floor. Branch promotion is not automatic."
    ]
  }
}
```

### 兼容说明

- 路径读取与写入继续遵守 **exact-key-first**：先按完整 flat key 读取，找不到时才回退到路径语义。
- 支持 quoted key，例如：

```text
{{getvar::装备["剑.名"]}}
```
- 路径写入会持久化 root key 对应的 JSON 值，因此对象读取结果和 `mutation_preview.value` 会稳定输出为 JSON 字符串，而不是 `[object Object]`。
- 当 `branch_id` 指向一个尚未物化的新分支，且同时提供来自非 `main` 分支的 `source_floor_id` 时，preview 的历史读取会沿 source floor 所在 branch 回退，不会误读同 floorNo 的 `main` 历史。
- 当 `branch_id` 指向一个尚未物化的新分支，且同时提供 `source_floor_id` 时，preview 会先继承 source floor 当时可见的 local 兼容值，再在 preview overlay 中求值。
- 上一条继承语义现在只接受精确的 source floor snapshot。若 source floor 缺少 `branch_local_variable_snapshot`，preview 会直接返回 `409 branch_local_snapshot_missing`，不再回退到当前 branch/chat 可见值。
- 如果 `branch_id` 尚未物化，preview 仍然允许执行，但 `scope.branch_exists` 会返回 `false`，并在 `diagnostics` 中追加 branch pending 类提示；此时 branch policy overlay 不会生效。
- preview 也支持 v3.3 的 shorthand 写入子集与稳定 alias；`raw_text` 保留原始写法，`macro_name` 继续记录 canonical 宏名。
- `runtime_trace.macro.staged_mutations` 在 preview 中固定为空；如果需要查看完整 prompt 组装结果，请使用 `POST /sessions/:id/respond/dry-run`。
- request 级 `budget` / `structure` / `delivery` 当前仍会参与 control-plane 解析和 `policy` / `source_map` 回显，但不会把 `runtime_trace.budgets`、`runtime_trace.structure`、`runtime_trace.delivery` 投影到 preview 响应里。

- v3 Phase 2 首轮里，preview 的 `runtime_trace.source_selection.excluded_sources` 只覆盖它当前真正参与的解释面：可见 history 与 memory summary。
- 世界书、examples、group-level trim 的完整解释结果仍以 `POST /sessions/:id/respond/dry-run` 为主。

### 常见错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体不合法 |
| `404` | `not_found` / `source_floor_not_found` | 会话不存在，或 `source_floor_id` 不存在、不属于当前 session，或当前账号不可访问 |
| `409` | `session_archived` / `invalid_state` / `branch_local_snapshot_missing` | 会话已归档、目标 branch 已有 generating floor，或 source floor 缺少精确 local snapshot |
| `500` | `internal_error` | 服务端内部错误 |

### 示例

```bash
curl -X POST http://localhost:3000/sessions/session-1/prompt-runtime/preview \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "{{.资产.金币=3}}{{getvar::资产}}",
    "branch_id": "main",
    "visibility": {
      "mode": "allow_all_except_hidden",
      "hidden_floor_ranges": [
        { "start_floor_no": 1, "end_floor_no": 2 }
      ]
    }
  }'
```

## 读取已提交楼层的 Historical Explain

```http
GET /floors/:id/prompt-runtime/explain
```

读取某个 **committed floor** 的 Prompt Runtime 历史解释结果。

这个接口会优先读取 `prompt_runtime_explain_snapshot`。这份 committed snapshot 会在 live 聊天链成功 commit 时，与 assistant message、floor state、`prompt_snapshot`、committed result 等真相一起写入同一同步事务。

因此它固定遵守以下边界：

- 只读
- 不走 LLM
- 不重新组装 prompt
- 不重新展开宏
- 不重新计算 budget / source selection
- committed explain snapshot 只持久化 explain 所需子集；`limitations` 继续停留在 explain 返回面，不进入 committed snapshot

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | floor ID |

### 响应 `200`（snapshot-backed）

```json
{
  "data": {
    "floor": {
      "id": "floor-12",
      "session_id": "session-1",
      "floor_no": 12,
      "branch_id": "main",
      "parent_floor_id": "floor-11",
      "state": "committed",
      "prompt_snapshot_created_at": 1710000003000,
      "committed_at": 1710000004000
    },
    "scope": {
      "session_id": "session-1",
      "target_branch_id": "main",
      "branch_exists": true,
      "source_floor_id": null,
      "history_source_branch_id": "main",
      "history_source_mode": "existing_branch"
    },
    "snapshot_available": true,
    "assets": {
      "preset": {
        "id": "preset-story",
        "name": "Story Preset"
      },
      "character_card": {
        "id": "char-hero",
        "name": "Hero"
      },
      "worldbook": {
        "id": "wb-lore",
        "name": "Lorebook"
      },
      "regex_profile": {
        "id": "regex-safe",
        "name": "Safety Regex"
      }
    },
    "prompt_snapshot": {
      "preset_id": "preset-story",
      "preset_updated_at": 1710000000000,
      "preset_version": 3,
      "worldbook_id": "wb-lore",
      "worldbook_updated_at": 1710000001000,
      "worldbook_version": 5,
      "regex_profile_id": "regex-safe",
      "regex_profile_updated_at": 1710000002000,
      "regex_profile_version": 2,
      "worldbook_activated_entry_uids": [7, 12],
      "regex_pre_rule_names": ["trim_whitespace"],
      "regex_post_rule_names": [],
      "prompt_mode": "compat_strict",
      "prompt_digest": "0d9bc89c6130435ab870f63d0a4d45f95b9764a4b91c91f8d1c2c5a1f7d4f20c",
      "token_estimate": 512
    },
    "resolved_policy": {
      "structure": {
        "mode": "no_assistant",
        "merge_adjacent_same_role": true,
        "preserve_system_messages": true,
        "assistant_rewrite_strategy": "to_system"
      },
      "delivery": {
        "allow_assistant_prefill": true,
        "require_last_user": true,
        "no_assistant": true
      },
      "budget": {
        "max_input_tokens": 4096,
        "reserved_completion_tokens": 1024
      },
      "source_selection": {
        "history": {
          "mode": "windowed",
          "max_messages": 24
        },
        "memory": { "enabled": true },
        "worldbook": { "enabled": true },
        "examples": { "enabled": false }
      },
      "visibility": {
        "mode": "allow_all_except_hidden",
        "hidden_floor_ranges": [
          { "start_floor_no": 1, "end_floor_no": 2 }
        ]
      },
      "debug": {
        "include_prompt_snapshot": false,
        "include_runtime_trace": false,
        "include_worldbook_matches": false
      }
    },
    "source_map": {
      "structure": {
        "mode": "branch_policy",
        "merge_adjacent_same_role": "branch_policy",
        "preserve_system_messages": "system_default",
        "assistant_rewrite_strategy": "system_default"
      },
      "delivery": {
        "allow_assistant_prefill": "system_default",
        "require_last_user": "session_policy",
        "no_assistant": "branch_policy"
      },
      "budget": {
        "max_input_tokens": "request_override",
        "reserved_completion_tokens": "request_override"
      },
      "source_selection": {
        "history": {
          "mode": "request_override",
          "max_messages": "request_override"
        },
        "memory": { "enabled": "system_default" },
        "worldbook": { "enabled": "system_default" },
        "examples": { "enabled": "request_override" }
      },
      "visibility": {
        "mode": "session_policy",
        "hidden_floor_ranges": "session_policy"
      },
      "history": {
        "source_branch_id": "main",
        "source_mode": "existing_branch"
      }
    },
    "trim_reasons": [
      {
        "group": "section:main",
        "reason": "budget_exceeded",
        "detail": "Prompt runtime pruned 128 tokens from budget group 'section:main'.",
        "pruned_token_count": 128
      }
    ],
    "excluded_sources": [
      {
        "source": "examples",
        "reason": "disabled_by_policy",
        "detail": "sourceSelection.examples.enabled=false removed example dialogue from prompt assembly."
      }
    ],
    "section_stats": [
      {
        "section_name": "history",
        "token_count": 320
      },
      {
        "section_name": "main",
        "token_count": 96
      }
    ],
    "diagnostics": [
      {
        "code": "derived_no_assistant_structure",
        "message": "delivery.noAssistant forced the resolved structure.mode to no_assistant.",
        "severity": "warning",
        "source": "policy",
        "field_path": "policy.structure.mode"
      }
    ],
    "limitations": [
      "Memory remains scoped to global / chat / floor. Branch isolation is not available.",
      "Variable commit remains page -> floor. Branch promotion is not automatic."
    ],
    "result": {
      "output_page_id": "page-output-12",
      "assistant_message_id": "msg-assistant-12",
      "generated_text": "The firelight wavers as the next part of the story begins.",
      "summaries": ["The group resumes the campfire planning scene."],
      "usage": {
        "prompt_tokens": 320,
        "completion_tokens": 128,
        "total_tokens": 448
      },
      "verifier": null,
      "committed_at": 1710000004000
    }
  }
}
```

### 旧楼层 fallback

如果目标 floor 没有 committed explain snapshot，响应会显式退回最小只读 explain，并返回 `snapshot_available: false`。

典型特征如下：

- `assets = null`
- `resolved_policy = null`
- `trim_reasons = null`
- `excluded_sources = null`
- `section_stats = null`
- `source_map` 只保留 `history` 子对象
- `trim_reasons[].group` 这类 budget group 标签也不会被重算
- `excluded_sources[].source` 继续只停留在公开 source kind 层，不会因为内部 group label 而扩展
- `diagnostics` 会说明 `historical_snapshot_unavailable` 等原因
- `limitations` 会明确说明没有做 explain recompute

例如：

```json
{
  "data": {
    "snapshot_available": false,
    "assets": null,
    "resolved_policy": null,
    "trim_reasons": null,
    "excluded_sources": null,
    "section_stats": null,
    "diagnostics": [
      {
        "code": "historical_snapshot_unavailable",
        "message": "Committed prompt runtime explain snapshot is unavailable for this floor. Historical explain falls back to minimal persisted truth only.",
        "severity": "info",
        "source": "policy",
        "field_path": "snapshot_available",
        "phase": "explain"
      }
    ]
  }
}
```

### 当前返回面的解释

- `prompt_snapshot`、`floor`、`result` 都来自已持久化记录。
- `snapshot_available = true` 表示 explain 已读到 `prompt_runtime_explain_snapshot`，因此可以返回完整 `assets`、`resolved_policy`、`source_map`、`trim_reasons`、`excluded_sources`、`section_stats`。
- `snapshot_available = false` 表示目标 floor 没有这份 committed snapshot。服务会保留最小只读 explain，并通过 `diagnostics` 与 `limitations` 显式说明缺失字段。
- 无论 snapshot 是否存在，这个接口都不会重跑 prompt 组装、宏展开、budget 或 source selection。

### 常见错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` / `prompt_runtime_explain_not_found` | floor 不存在、不属于当前账号，或缺少 explain 所需的持久化真相 |
| `409` | `invalid_state` | floor 不是 committed，不能读取 historical explain |
| `500` | `internal_error` | 服务端内部错误 |

### 示例

```bash
curl http://localhost:3000/floors/floor-12/prompt-runtime/explain \
  -H 'Authorization: Bearer <token>'
```

## 比较两个已提交楼层的 Prompt Runtime 差异

```http
POST /sessions/:id/prompt-runtime/compare
```

比较同一 session 内两个 **committed floor** 的 Prompt Runtime 差异。

这个接口同样只读取 committed truth。它不会为 compare 额外做 explain recompute。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 会话 ID |

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `left.floor_id` | string | **是** | 左侧 committed floor ID |
| `right.floor_id` | string | **是** | 右侧 committed floor ID |

### 请求示例

```json
{
  "left": { "floor_id": "floor-left" },
  "right": { "floor_id": "floor-right" }
}
```

### 响应 `200`

```json
{
  "data": {
    "left": {
      "floor_id": "floor-left",
      "snapshot_available": true
    },
    "right": {
      "floor_id": "floor-right",
      "snapshot_available": true
    },
    "scope_changes": [],
    "policy_changes": [
      {
        "path": "policy.resolved_policy.budget.max_input_tokens",
        "change_type": "changed",
        "left": 4096,
        "right": 2048
      },
      {
        "path": "policy.resolved_policy.visibility.mode",
        "change_type": "changed",
        "left": "allow_all_except_hidden",
        "right": "deny_all_except_visible"
      },
      {
        "path": "policy.source_map.visibility.mode",
        "change_type": "changed",
        "left": "session_policy",
        "right": "request_override"
      }
    ],
    "asset_changes": [],
    "diagnostics_changes": [],
    "trim_changes": [
      {
        "path": "trim_reasons",
        "change_type": "changed",
        "left": [
          { "group": "section:main", "reason": "group_limit_exceeded", "pruned_token_count": 32 }
        ],
        "right": [
          { "group": "section:main", "reason": "group_limit_exceeded", "pruned_token_count": 64 }
        ]
      }
    ],
    "exclusion_changes": [
      {
        "path": "excluded_sources",
        "change_type": "changed",
        "left": [
          { "source": "history", "reason": "visibility_filtered" }
        ],
        "right": [
          { "source": "examples", "reason": "disabled_by_policy" }
        ]
      }
    ],
    "limitations": []
  }
}
```

### compare 边界

- 只支持同一 session 内的两个 committed floor。
- 不支持 preview 与 committed floor 混合比较。
- 差异项是结构化 path/value diff，不是全文级 diff。
- `path` 固定使用 `snake_case`。
- `policy_changes` 会同时覆盖 `resolved_policy` 与 `source_map`，因此 budget 和 visibility 的变化也会出现在这里；budget trim 与 source exclusion 的变化分别出现在 `trim_changes` 与 `exclusion_changes`。
- 如果某一侧缺少 committed snapshot，会把对应侧的 `snapshot_available` 置为 `false`，并在 `limitations` 中说明 compare 因缺 snapshot 而跳过了 recompute。

### 常见错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` | 会话或 floor 不存在，不属于当前账号，或 floor 不属于目标 session |
| `409` | `invalid_state` | 任一 floor 不是 committed |
| `500` | `internal_error` | 服务端内部错误 |

### 示例

```bash
curl -X POST http://localhost:3000/sessions/session-1/prompt-runtime/compare \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "left": { "floor_id": "floor-left" },
    "right": { "floor_id": "floor-right" }
  }'
```

## 获取 Prompt Runtime 全局能力边界

```http
GET /prompt-runtime/capabilities
```

返回当前部署对 Prompt Runtime control plane 的公开能力边界。

### 响应 `200`

```json
{
  "data": {
    "structure": {
      "modes": ["default", "strict_alternating", "no_assistant", "flattened"],
      "defaults": {
        "mode": "default",
        "merge_adjacent_same_role": false,
        "preserve_system_messages": true
      }
    },
    "delivery": {
      "defaults": {
        "allow_assistant_prefill": true,
        "require_last_user": false,
        "no_assistant": false
      }
    },
    "budget": {
      "defaults": {},
      "request_override_supported": true,
      "persistent_patch_supported": true,
      "supported_fields": ["maxInputTokens", "reservedCompletionTokens"],
      "trim_reason_codes": ["budget_exceeded"]
    },
    "source_selection": {
      "defaults": {
        "history": { "mode": "full" },
        "memory": { "enabled": true },
        "worldbook": { "enabled": true },
        "examples": { "enabled": true }
      },
      "request_override_supported": true,
      "persistent_patch_supported": true,
      "supported_sources": ["history", "memory", "worldbook", "examples"],
      "history_modes": ["full", "windowed"],
      "exclusion_reason_codes": ["disabled_by_policy", "budget_trimmed", "provider_constraint", "visibility_filtered", "not_triggered"]
    },
    "governance": {
      "session": {
        "envelope_metadata": true,
        "null_clears_field": true,
        "object_patch": "deep_merge",
        "supported_fields": ["structure", "delivery", "budget", "sourceSelection", "visibility"]
      },
      "branch": {
        "envelope_metadata": true,
        "materialized_branches_only": true,
        "null_clears_field": true,
        "object_patch": "deep_merge",
        "supported_fields": ["structure", "delivery", "budget", "sourceSelection", "visibility"]
      }
    },
    "compare": {
      "enabled": true,
      "committed_floors_only": true,
      "mixed_preview_supported": false,
      "limitations_instead_of_recompute": true
    },
    "observability": {
      "live": {
        "enabled": true,
        "default_off": true,
        "request_scoped_only": true,
        "include_prompt_snapshot": true,
        "include_runtime_trace": true,
        "include_worldbook_matches": true,
        "worldbook_matches_requires_runtime_trace": true,
        "worldbook_matches_requires_opt_in": true,
        "visibility_request_supported": false
      },
      "dry_run": {
        "enabled": true,
        "returns_assembly": true,
        "returns_runtime_trace": true,
        "supports_visibility": true,
        "include_worldbook_matches": true
      },
      "preview": {
        "enabled": true,
        "returns_runtime_trace": true,
        "supports_visibility": true,
        "single_text_only": true,
        "llm_call": false,
        "creates_floor": false,
        "writes_prompt_snapshot": false,
        "commits_side_effects": false
      },
      "explain": {
        "enabled": true,
        "read_only": true,
        "requires_committed_floor": true,
        "persisted_truth_only": true,
        "recompute": false,
        "snapshot_supported": true,
        "legacy_floor_fallback": true,
        "snapshot_availability_field": "snapshot_available"
      },
      "stream": {
        "enabled": true,
        "prompt_debug_payload": "done_only",
        "new_sse_event_family": false
      }
    },
    "macro": {
      "built_in_read_only_values_persistable": false,
      "st_compatibility_snapshots_persistable": false,
      "run_kind_persistable": false,
      "diagnostics_surface": "unified_observability",
      "dedicated_macros_route": false,
      "recent_message_respects_visibility": true
    },
    "unsupported": [
      "/sessions/:id/prompt-runtime/run",
      "/sessions/:id/prompt-runtime/macros",
      "/floors/:id/prompt-runtime",
      "/messages/:id/prompt-runtime"
    ]
  }
}
```

`supported_sources` 与 `excluded_sources[].source` 继续只承诺公开 source kind。像 `section:main` 这样的具体标签只会出现在 budget group / trim reason 路径中。

### 常见错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `500` | `internal_error` | 服务端内部错误 |

### 示例

```bash
curl http://localhost:3000/prompt-runtime/capabilities \
  -H 'Authorization: Bearer <token>'
```
