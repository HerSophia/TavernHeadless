---
outline: [2, 3]
---

# Effective Config（生效配置视图）

这是一组只读视图，用来回答"某个 Project 或 Session 当前最终使用的配置是什么、来自哪一层"。

它不是写入口。实际写入请走 [Project Settings](./project-settings)。

## 什么时候需要看这页

- 你想知道某个 Project 当前最终使用的配置来源。
- 你想知道某个 Session 是否有更高优先级的会话覆盖。
- 你要做调试页面，只读展示最终配置。

## 一个简单例子

```bash
curl http://localhost:3000/projects/proj_main/effective-config
```

或：

```bash
curl http://localhost:3000/sessions/sess_001/effective-config
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| source | 这一节配置最终来自哪一层：`workspace`、`project` 或 `session` |
| effective-config | 只读视图，不是写入口 |
| override | Project 级覆盖记录，由 [Project Settings](./project-settings) 写入 |

## 响应格式说明

这组接口与本站多数 API 有两点不同，请特别注意：

1. 响应**不使用 `data` 包裹**，直接返回视图对象。
2. 视图顶层字段使用 **camelCase**（如 `projectId`、`llmProfile`），不是 `snake_case`。其中 `toolPolicies.overrides` 和 `mcp.bindings` 内部的记录字段同样是 camelCase。

这是当前实现的真实契约。如果你同时接入其他资源，请不要把这里的字段风格推广到别处。

## 读取 Project 生效配置

```http
GET /projects/:id/effective-config
```

需要 `project.config.read` 权限。

### 响应 `200`

```json
{
  "projectId": "proj_main",
  "workspaceId": "ws_default_acc_1",
  "llmProfile": {
    "source": "project",
    "profileId": "llm_profile_alpha",
    "override": { "temperature": 0.2 }
  },
  "toolPolicies": {
    "overrides": [
      {
        "id": "tpo_001",
        "workspaceId": "ws_default_acc_1",
        "projectId": "proj_main",
        "accountId": "acc_1",
        "basePolicyId": "tool_policy_default",
        "overrideJson": { "deny": ["shell_exec"] },
        "status": "active",
        "createdAt": 1735689600000,
        "updatedAt": 1735689600000
      }
    ]
  },
  "mcp": {
    "source": "project",
    "bindings": [
      {
        "id": "pmb_001",
        "workspaceId": "ws_default_acc_1",
        "projectId": "proj_main",
        "accountId": "acc_1",
        "mcpServerId": "mcp_search",
        "status": "enabled",
        "allowedTools": ["web_search"],
        "configOverrideJson": {},
        "createdAt": 1735689600000,
        "updatedAt": 1735689600000
      }
    ]
  }
}
```

### 字段说明

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `projectId` | string | Project ID |
| `workspaceId` | string | 所属 Workspace |
| `llmProfile.source` | string | `project` 表示存在 Project 覆盖；`workspace` 表示没有覆盖，沿用 Workspace 层 |
| `llmProfile.profileId` | string \| null | 生效的基础 Profile。没有覆盖时为 `null` |
| `llmProfile.override` | object \| null | Project 级覆盖参数。没有覆盖时为 `null` |
| `toolPolicies.overrides` | array | Project 级 Tool Policy 覆盖记录的完整列表 |
| `mcp.source` | string | 有任何 Project 级绑定时为 `project`，否则为 `workspace` |
| `mcp.bindings` | array | Project 级 MCP 绑定记录的完整列表 |

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `403` | `project_access_denied` | 当前角色没有 `project.config.read` 权限 |
| `404` | `project_not_found` | Project 不存在或不可见 |

## 读取 Session 生效配置

```http
GET /sessions/:id/effective-config
```

服务端先解析 Session 所属 Project，再要求 `project.config.read` 权限。

### 响应 `200`

在 Project 视图基础上，额外包含两个字段：

```json
{
  "projectId": "proj_main",
  "workspaceId": "ws_default_acc_1",
  "llmProfile": { "source": "workspace", "profileId": null, "override": null },
  "toolPolicies": { "overrides": [] },
  "mcp": { "source": "workspace", "bindings": [] },
  "sessionId": "sess_001",
  "sessionOverrides": {
    "llmProfile": null
  },
  "toolTransport": {
    "available": ["native_function_call", "text_protocol"],
    "selected": "text_protocol",
    "reasonCode": "instance_not_supports_function_call",
    "capabilities": {
      "supportsFunctionCall": false,
      "supportsToolChoice": false,
      "supportsStreamingToolCall": false
    }
  }
}
```

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `sessionId` | string | Session ID |
| `sessionOverrides.llmProfile` | object \| null | Session 级覆盖位。当前实现固定返回 `null`，字段保留给后续版本 |
| `toolTransport.available` | string[] | 当前 prompt mode 允许的工具调用 transport 列表 |
| `toolTransport.selected` | string | 当前会话最终选中的 transport：`native_function_call` / `text_protocol` / `none` |
| `toolTransport.reasonCode` | string | 选择原因，例如显式 override、工具关闭、实例不支持 function call |
| `toolTransport.capabilities` | object | 当前 narrator 实例能力摘要，用于解释 transport 为什么这样选 |

### 错误

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `404` | `session_not_found` | Session 不存在 |
| `404` | `project_not_found` | 所属 Project 不可见 |
| `409` | `session_project_scope_missing` | Session 没有 Project 归属（极早期历史数据可能出现） |

## 当前能力说明

- 这是只读视图，不引入缓存，每次直接读取数据库。
- 实际写入请走 [Project Settings](./project-settings)。

## 相关页面

- 写入口：[Project Settings](./project-settings)
- 路由族总览：[Workspace / Project](./workspace-project)
