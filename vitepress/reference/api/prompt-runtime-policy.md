---
outline: [2, 3]
---

# Prompt Runtime Policy（策略面）

policy 控制提示词在组装时的五类行为：消息结构、投递约束、token 预算、来源选择和楼层可见性。这一页讲它的读取和修改。

## 什么时候需要看这页

- 想看 session 级或 branch 级 policy 当前是什么。
- 想修改 `structure`、`delivery`、`budget`、`source_selection`、`visibility`。
- 想确认哪些字段是 session policy、哪些字段是 branch policy overlay。

## 一个简单例子

只修改 session 级 token 预算：

```bash
curl -X PATCH http://localhost:3000/sessions/sess_001/prompt-runtime/policy \
  -H 'Content-Type: application/json' \
  -d '{
    "budget": {
      "max_input_tokens": 4096,
      "reserved_completion_tokens": 1024
    }
  }'
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| 持久化 policy | 写进数据库、长期生效的 policy。session 一份，每条已物化分支可以再叠一份 |
| resolved policy | 把系统默认值、持久化 policy 和请求覆盖合并后的最终生效值 |
| overlay | 叠加层。branch policy 只对该分支生效，叠在 session policy 之上 |
| source map | 标注 resolved policy 每个字段最终来自哪一层的映射表 |
| envelope | 持久化 policy 的元信息包装：版本号、更新时间、更新者 |

## 相关接口

| 接口 | 说明 |
| ---- | ---- |
| `GET /sessions/:id/prompt-runtime/policy` | 读取 session 级持久化与 resolved policy |
| `PATCH /sessions/:id/prompt-runtime/policy` | 修改 session 级持久化 policy |
| `GET /sessions/:id/prompt-runtime/branches/:branchId/policy` | 读取 branch 级 policy |
| `PATCH /sessions/:id/prompt-runtime/branches/:branchId/policy` | 修改 branch 级 policy overlay |

branch 接口只对已物化的分支可用（即分支已经有自己的楼层数据，而不只是一个名字）。

## 这页最重要的边界

- `prompt_mode` **不属于** policy。修改模式请走 [Mode](./prompt-runtime-mode)。
- policy 持久化对象只覆盖五节：`structure`、`delivery`、`budget`、`source_selection`、`visibility`。
- 不提供 `PATCH /sessions/:id/prompt-runtime`。
- 不提供 branch mode 路由。

## 五节 policy 的字段定义

### structure（消息结构）

控制最终消息序列的结构形态。

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `mode` | string | `default` / `strict_alternating`（严格用户助手交替） / `no_assistant`（去掉 assistant 消息） / `flattened`（压平成单段） |
| `merge_adjacent_same_role` | boolean | 是否合并相邻同角色消息 |
| `preserve_system_messages` | boolean | 是否保留 system 消息 |
| `assistant_rewrite_strategy` | string | assistant 消息被改写时的策略：`to_system` 或 `to_user_transcript` |

### delivery（投递约束）

控制发给模型前的最后约束。

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `allow_assistant_prefill` | boolean | 是否允许 assistant 预填 |
| `require_last_user` | boolean | 是否要求最后一条消息必须是 user |
| `no_assistant` | boolean | 是否禁止 assistant 消息出现在请求里 |

### budget（token 预算）

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `max_input_tokens` | integer | 输入 token 上限 |
| `reserved_completion_tokens` | integer | 为模型输出预留的 token 数 |

### source_selection（来源选择）

控制哪些内容来源参与组装。

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `history.mode` | string | `full`（全量历史）或 `windowed`（窗口截断） |
| `history.max_messages` | integer | `windowed` 模式下的消息条数上限 |
| `memory.enabled` | boolean | 是否注入记忆 |
| `worldbook.enabled` | boolean | 是否触发世界书 |
| `examples.enabled` | boolean | 是否注入对话示例 |

### visibility（楼层可见性）

控制哪些楼层对组装可见。

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `mode` | string | `allow_all_except_hidden`（默认全可见，列出隐藏范围）或 `deny_all_except_visible`（默认全隐藏，列出可见范围） |
| `hidden_floor_ranges` | array | 楼层号范围列表，每项为 `{ "start_floor_no", "end_floor_no" }` |

## GET 响应结构

```http
GET /sessions/:id/prompt-runtime/policy
```

### 响应 `200`

```json
{
  "data": {
    "persistent_policy": {
      "delivery": { "no_assistant": true },
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
        "delivery": { "no_assistant": true },
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
      "visibility": {
        "mode": "allow_all_except_hidden",
        "hidden_floor_ranges": []
      },
      "source_selection": {
        "history": { "mode": "windowed", "max_messages": 24 },
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

### 字段说明

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `persistent_policy` | object | 当前层的持久化 policy。只包含写入过的字段 |
| `persistent_policy_envelope` | object \| null | 持久化 policy 的元信息：`version`、`updated_at`、`updated_by`、`value`。从未写入时为 `null` |
| `resolved_policy` | object | 合并后的最终生效值，五节齐全，另含只读的 `debug` 节 |
| `warnings` | array | 解析告警。例如历史数据中存在非法 policy 对象时会在这里提示 |

policy 来源层级从低到高为：`system_default` < `asset_default` < `session_policy` < `branch_policy` < `request_override` < `provider_constraint`。

## PATCH 语义

四个 policy 接口都使用同一套对象 PATCH 语义：

- 传对象：与已有值做深合并，只改你给出的字段。
- 传 `null`：清空这一节持久化 policy。
- 未出现的字段：保持原值。

### 示例：清空 branch delivery policy

```bash
curl -X PATCH http://localhost:3000/sessions/sess_001/prompt-runtime/branches/alt-1/policy \
  -H 'Content-Type: application/json' \
  -d '{ "delivery": null }'
```

### 示例：只改 session budget

```json
{
  "budget": {
    "max_input_tokens": 4096,
    "reserved_completion_tokens": 1024
  }
}
```

PATCH 成功后返回与 GET 相同结构的最新视图。

## Session Policy 和 Branch Policy 的区别

| 面 | 作用域 | 说明 |
| ---- | ---- | ---- |
| session policy | 整个会话 | 作为默认 Prompt Runtime policy |
| branch policy | 某条已物化分支 | 只对该 branch 的 policy overlay 生效 |

## 错误

| 状态码 | 说明 |
| ---- | ---- |
| `400` | 请求体不合法 |
| `403` | 当前调用方对该会话所属 Project 没有写权限 |
| `404` | 会话或分支不存在 |
| `409` | 并发更新冲突 |

## 相关页面

- mode 控制面：[Prompt Runtime Mode](./prompt-runtime-mode)
- 当前资源绑定：[Prompt Runtime Assets](./prompt-runtime-assets)
- 请求期检查与历史解释：[Prompt Runtime Inspection](./prompt-runtime-inspection)
- 默认值与支持字段目录：[Prompt Runtime Capabilities](./prompt-runtime-capabilities)
