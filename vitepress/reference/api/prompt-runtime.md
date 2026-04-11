---
outline: [2, 3]
---

# Prompt Runtime（提示词运行时）

Prompt Runtime 是一组独立的高级 API 资源。它用于读取会话当前的 Prompt Assets 绑定、session 级默认策略，以及系统公开的运行边界。

它是 control plane，不负责执行一轮聊天，也不会替代现有的 Chat 主链路。

> 这组接口属于高级 API 资源，主要面向调试、平台集成、自动化脚本和策略治理。如果只需要普通聊天能力，不需要优先接入。

如果你要看真实聊天接口、dry-run 或 live debug，请同时参考：

- [Chat（对话生成）](./chat)
- [Macros（宏系统）](./macros)

## 设计边界

当前 Prompt Runtime v2 先公开的是低风险 control plane。文档上应当明确以下边界：

- 不创建第二条执行链，真实运行仍走现有 `respond` / `regenerate` / `retry` / `edit-and-regenerate` 主链路。
- `character_card` 仍然属于 Prompt Assets。
- 当前不提供 `GET /sessions/:id/prompt-runtime/macros`。
- 当前不提供 `GET /sessions/:id/prompt-runtime/run` 或 `GET /sessions/:id/prompt-runtime/preview`。
- session 默认策略当前只允许持久化 `structure` 与 `delivery`。
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
| `policy` | object | 当前生效策略 |
| `policy.structure` | [ResolvedStructurePolicy](#resolvedstructurepolicy) | 当前结构策略 |
| `policy.delivery` | [ResolvedDeliveryPolicy](#resolveddeliverypolicy) | 当前投递策略 |
| `policy.debug` | [DebugPolicy](#debugpolicy) | 当前 debug 能力边界 |
| `persistent_policy` | [PersistentPolicy](#persistentpolicy) | 可选。当前 session 已持久化的默认策略 |
| `assets` | [AssetsView](#assetsview) | 当前 Prompt Assets 绑定 |
| `warnings` | string[] | 控制面读取时产生的 warning。当前至少会覆盖 invalid policy warning，以及 `delivery.no_assistant` 推导出 `structure.mode = no_assistant` 的派生 warning |
| `source_map` | object | 可选。当前已覆盖完整的 structure / delivery 来源解释，包括 `structure.mode`、`structure.merge_adjacent_same_role`、`structure.preserve_system_messages`、`structure.assistant_rewrite_strategy`、`delivery.allow_assistant_prefill`、`delivery.require_last_user`、`delivery.no_assistant` |

### Capabilities

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `structure.modes` | string[] | 当前支持的结构模式 |
| `structure.defaults` | [ResolvedStructurePolicy](#resolvedstructurepolicy) | 系统默认结构策略 |
| `delivery.defaults` | [ResolvedDeliveryPolicy](#resolveddeliverypolicy) | 系统默认投递策略 |
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

返回当前 session 的生效策略、已持久化默认策略、Prompt Assets 绑定和 warning。

### 路径参数

| 参数 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 会话 ID |

### 响应 `200`

```json
{
  "data": {
    "policy": {
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
        "mode": "session_policy",
        "merge_adjacent_same_role": "session_policy",
        "preserve_system_messages": "system_default",
        "assistant_rewrite_strategy": "system_default"
      },
      "delivery": {
        "allow_assistant_prefill": "system_default",
        "require_last_user": "session_policy",
        "no_assistant": "system_default"
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
curl http://localhost:3000/sessions/session-1/prompt-runtime \
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
      "/sessions/:id/prompt-runtime/preview",
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
