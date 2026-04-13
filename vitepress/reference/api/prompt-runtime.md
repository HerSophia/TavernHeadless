---
outline: [2, 3]
---

# Prompt Runtime（提示词运行时）

Prompt Runtime 是一组独立的高级 API 资源。它用于读取会话当前的 Prompt Assets 绑定、session / branch 级策略视图，以及系统公开的运行边界。

它仍然是 control plane，不负责执行一轮聊天，也不会替代现有的 Chat 主链路。

当前它还提供一个**单段文本宏预览**入口：`POST /sessions/:id/prompt-runtime/preview`。这个入口继续复用现有的宏执行主线，只做单段文本的 preview，不会创建第二条执行链。

> 这组接口属于高级 API 资源，主要面向调试、平台集成、自动化脚本和策略治理。如果只需要普通聊天能力，不需要优先接入。

如果你要看真实聊天接口、dry-run 或 live debug，请同时参考：

- [Chat（对话生成）](./chat)
- [Macros（宏系统）](./macros)

## 设计边界

当前 Prompt Runtime 对外公开的是低风险 control plane，以及单段文本 preview 入口。文档上应当明确以下边界：

- 不创建第二条执行链，真实运行仍走现有 `respond` / `regenerate` / `retry` / `edit-and-regenerate` 主链路。
- `character_card` 仍然属于 Prompt Assets。
- 当前不提供 `GET /sessions/:id/prompt-runtime/macros`。
- 当前不提供 `GET /sessions/:id/prompt-runtime/run`。
- preview 只提供 `POST /sessions/:id/prompt-runtime/preview`，并且一次只处理一段 `text`。
- preview 不走 LLM、不创建 floor、不写 `prompt_snapshot`、不提交副作用。
- `GET /sessions/:id/prompt-runtime` 的 `branch_id` 只面向**已物化 branch**；未物化或不存在的 branch 返回 `404 branch_not_found`。
- branch policy 只面向**已物化 branch**；当前不支持对未物化 branch 预写入 policy。
- `GET /floors/:id/prompt-runtime/explain` 只读取已持久化真相，不会重新组装 prompt、重新展开宏或重新计算 budget / source selection。
- 当前 memory 仍是 `global / chat / floor` 三层模型，不具备 branch 隔离；同一 session 下不同 branch 仍可能共享 chat 级记忆。
- session 默认策略当前只允许持久化 `structure` 与 `delivery`。
- branch policy overlay 当前也只允许持久化 `structure` 与 `delivery`。
- `budget` 与 `source_selection` 已进入 resolved state、capabilities，以及 preview / dry-run 的 request-side 解释输出。
- 但当前**不提供** session / branch policy 对 `budget` 与 `source_selection` 的持久化 PATCH 写入。
- 不持久化内建只读宏值，不持久化 ST `local/global` 兼容快照，也不持久化 `runKind`。
- 宏诊断仍属于统一观测面，不单独拆成第二套 control plane 诊断接口。

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
| `mode` | string | `default` / `strict_alternating` / `no_assistant` |
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
| `structure.mode` | string | `default` / `strict_alternating` / `no_assistant`。当前结构对象存在时必填 |
| `structure.merge_adjacent_same_role` | boolean | 可选 |
| `structure.assistant_rewrite_strategy` | string | 可选。`to_system` / `to_user_transcript` |
| `structure.preserve_system_messages` | boolean | 可选 |
| `delivery` | object | 可选。session 级持久化投递策略 |
| `delivery.allow_assistant_prefill` | boolean | 可选 |
| `delivery.require_last_user` | boolean | 可选 |
| `delivery.no_assistant` | boolean | 可选 |
| `budget` | object | 可选。当前只作为 read-side / request-side 正式对象，不开放持久化 PATCH |
| `source_selection` | object | 可选。当前只作为 read-side / request-side 正式对象，不开放持久化 PATCH |

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
| `branch_persistent_policy` | [PersistentPolicy](#persistentpolicy) \| null | 当前目标 branch 已持久化的 overlay。若当前 branch 未配置 overlay，则返回 `null` |
| `assets` | [AssetsView](#assetsview) | 当前 Prompt Assets 绑定 |
| `warnings` | string[] | 控制面读取时产生的兼容 warning。当前至少会覆盖 invalid session policy、invalid branch policy，以及 `delivery.no_assistant` 推导出 `structure.mode = no_assistant` 的派生 warning |
| `diagnostics` | object[] | 结构化诊断摘要。resolved state 当前仍以 warning 投影为主；historical explain 还会补充“字段未持久化、因此不可用”的说明型 diagnostics |
| `diagnostics[].code` | string | 诊断代码 |
| `diagnostics[].message` | string | 诊断说明 |
| `diagnostics[].severity` | string | `info` / `warning` / `error` |
| `diagnostics[].source` | string | 可选。当前至少会覆盖 `policy` / `branch` / `budget` / `source_selection` |
| `diagnostics[].field_path` | string | 可选。命中的字段路径 |
| `diagnostics[].phase` | string | 可选。当前 control plane 读取通常省略；preview / explain 场景会返回显式 phase |
| `limitations` | string[] | 当前已知边界摘要，例如 memory 仍不具备 branch 隔离、`variableCommit` 仍只做 `page -> floor` |
| `source_map` | object | 可选。当前已覆盖 structure / delivery / budget / source_selection 的来源解释，以及 `history.source_branch_id` / `history.source_mode` |

### PolicyView

`GET /sessions/:id/prompt-runtime/policy` 与 branch policy 路由都返回这个对象：

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
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
| `source_selection.defaults` | [SourceSelectionPolicy](#sourceselectionpolicy) | 当前正式 source selection 默认值 |
| `source_selection.request_override_supported` | boolean | 当前是否支持 request 级 source selection override |
| `source_selection.persistent_patch_supported` | boolean | 当前是否支持持久化 PATCH 写入 source selection |
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
| `observability.preview.returns_runtime_trace` | boolean | preview 是否返回 `runtime_trace` |
| `observability.preview.supports_visibility` | boolean | preview 是否支持 `visibility` |
| `observability.preview.single_text_only` | boolean | preview 是否限制为单段文本 |
| `observability.preview.llm_call` | boolean | preview 是否会调用 LLM |
| `observability.preview.creates_floor` | boolean | preview 是否会创建 floor |
| `observability.preview.writes_prompt_snapshot` | boolean | preview 是否会写 `prompt_snapshot` |
| `observability.preview.commits_side_effects` | boolean | preview 是否会提交副作用 |
| `observability.explain.enabled` | boolean | historical explain 是否可用 |
| `observability.explain.read_only` | boolean | explain 是否只读 |
| `observability.explain.requires_committed_floor` | boolean | explain 是否只面向 committed floor |
| `observability.explain.persisted_truth_only` | boolean | explain 是否只读取持久化真相 |
| `observability.explain.recompute` | boolean | explain 是否会重新组装 / 重算。当前固定为 `false` |
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

返回当前 session 在某个**已物化 branch**上的生效策略、已持久化默认策略、Prompt Assets 绑定和 warning。

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
    "branch_persistent_policy": {
      "delivery": {
        "no_assistant": true
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

返回当前 session 的已持久化默认策略和解析后的生效策略。

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
      }
    },
    "resolved_policy": {
      "structure": {
        "mode": "strict_alternating",
        "merge_adjacent_same_role": false,
        "preserve_system_messages": true
      },
      "delivery": {
        "allow_assistant_prefill": true,
        "require_last_user": true,
        "no_assistant": false
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

## 获取分支持久化策略视图

```http
GET /sessions/:id/prompt-runtime/branches/:branchId/policy
```

返回某个**已物化 branch**上的 branch persistent policy overlay，以及叠加 session policy 之后的 `resolved_policy`。

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
      }
    },
    "resolved_policy": {
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

当前与 session policy patch 一样，只允许写入：

- `structure`
- `delivery`

### 合并规则

- 省略某个 section：保留原值。
- 传 section 对象：和当前 branch policy section 合并。
- 传 `null`：清空该 section。

### 常见错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `400` | `validation_error` | 请求体不合法 |
| `404` | `not_found` | 会话不存在，或不属于当前账号 |
| `404` | `branch_not_found` | `branchId` 不存在或尚未物化 |
| `500` | `internal_error` | 服务端内部错误 |

## 更新会话持久化策略

```http
PATCH /sessions/:id/prompt-runtime/policy
```

对 session 级默认策略做增量更新。

当前只允许写入：

- `structure`
- `delivery`

当前不允许写入：

- `debug`
- 内建只读宏值
- ST `local/global` 兼容快照
- `runKind`

### 合并规则

- 省略某个 section：保留原值。
- 传 section 对象：和当前已存 section 合并。
- 传 `null`：清空该 section。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 会话 ID |

### 请求体

| 字段 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `structure` | object \| null | 否 | session 级结构策略。传 `null` 表示清空 |
| `structure.mode` | string | 条件必填 | 当 `structure` 为对象时必填：`default` / `strict_alternating` / `no_assistant` |
| `structure.merge_adjacent_same_role` | boolean | 否 | 可选覆盖 |
| `structure.assistant_rewrite_strategy` | string | 否 | `to_system` / `to_user_transcript` |
| `structure.preserve_system_messages` | boolean | 否 | 可选覆盖 |
| `delivery` | object \| null | 否 | session 级投递策略。传 `null` 表示清空 |
| `delivery.allow_assistant_prefill` | boolean | 否 | 可选覆盖 |
| `delivery.require_last_user` | boolean | 否 | 可选覆盖 |
| `delivery.no_assistant` | boolean | 否 | 可选覆盖 |

至少需要提供 `structure` 或 `delivery` 其中一个。

### 请求示例

```json
{
  "structure": {
    "mode": "strict_alternating",
    "preserve_system_messages": true
  },
  "delivery": null
}
```

### 响应 `200`

```json
{
  "data": {
    "persistent_policy": {
      "structure": {
        "mode": "strict_alternating",
        "preserve_system_messages": true
      }
    },
    "resolved_policy": {
      "structure": {
        "mode": "strict_alternating",
        "merge_adjacent_same_role": false,
        "preserve_system_messages": true
      },
      "delivery": {
        "allow_assistant_prefill": true,
        "require_last_user": false,
        "no_assistant": false
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
    "delivery": null
  }'
```

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
      "debug": {
        "include_prompt_snapshot": false,
        "include_runtime_trace": false,
        "include_worldbook_matches": false
      }
    },
    "source_map": {
      "delivery": { "no_assistant": "request_override" },
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

这个接口的目标不是“事后重跑一遍 dry-run”，而是读取当前已经持久化的真相。

因此它固定遵守以下边界：

- 只读
- 不走 LLM
- 不重新组装 prompt
- 不重新展开宏
- 不重新计算 budget / source selection

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | floor ID |

### 响应 `200`

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
    "resolved_policy": null,
    "source_map": {
      "history": {
        "source_branch_id": "main",
        "source_mode": "existing_branch"
      }
    },
    "trim_reasons": null,
    "excluded_sources": null,
    "diagnostics": [
      {
        "code": "historical_resolved_policy_unavailable",
        "message": "Historical explain did not persist the resolved policy for this floor. The explain view returns persisted prompt snapshot and committed result truth only.",
        "severity": "info",
        "source": "policy",
        "field_path": "resolved_policy",
        "phase": "explain"
      }
    ],
    "limitations": [
      "Historical explain reads persisted prompt snapshot and committed floor result only. It does not re-run prompt assembly, macro evaluation, or budget decisions."
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

### 当前返回面的解释

- `prompt_snapshot`、`floor`、`result` 都来自已持久化记录。
- `scope` 与 `source_map.history` 来自 committed floor 的 branch 真相，因此不会回退到当前可见 branch/chat 值。
- `resolved_policy`、`trim_reasons`、`excluded_sources` 当前可能返回 `null`。这表示它们**没有随历史 floor 一起持久化**，而不是表示“当时没有这类结果”。
- 对这些 `null` 字段，服务会同时返回结构化 `diagnostics` 和 `limitations`，明确说明它们为何不可用。

### 常见错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `404` | `not_found` / `prompt_runtime_explain_not_found` | floor 不存在、不属于当前账号，或缺少 explain 所需的持久化真相 |
| `409` | `invalid_state` | floor 不是 committed，不能读取 historical explain |
| `500` | `internal_error` | 服务端内部错误 |

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
      "modes": ["default", "strict_alternating", "no_assistant"],
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
        "recompute": false
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

### 常见错误

| 状态码 | code | 说明 |
| ------ | ---- | ---- |
| `500` | `internal_error` | 服务端内部错误 |

### 示例

```bash
curl http://localhost:3000/prompt-runtime/capabilities \
  -H 'Authorization: Bearer <token>'
```
