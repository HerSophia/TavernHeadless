---
outline: [2, 3]
---

# Project Settings（Project 级设置覆盖）

这组接口为单个 Project 写入三类配置覆盖：LLM Profile 覆盖、MCP 绑定、Tool Policy 覆盖。

写入后实际生效的结果，请通过 [Effective Config](./effective-config) 只读视图确认，不要从写接口的响应自行推断。

## 什么时候需要看这页

- 你想为某个 Project 单独覆盖 LLM Profile。
- 你想为某个 Project 单独启用一组 MCP Server。
- 你想为某个 Project 单独覆盖 Tool Policy。

## 一个简单例子

```bash
curl -X PUT http://localhost:3000/projects/proj_main/settings/llm-profile-override \
  -H 'Content-Type: application/json' \
  -d '{
    "base_profile_id": "llm_profile_alpha",
    "override_json": { "temperature": 0.2 }
  }'
```

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| `base_profile_id` | 作为基础的 LLM Profile ID。当前数据库层不做外键约束，合法性由服务层负责 |
| `override_json` | Project 级覆盖内容，叠加在基础配置之上 |
| upsert | 同一目标已有记录就更新，没有就创建。这三组 PUT 接口都是 upsert 语义 |
| effective-config | 只读最终生效配置视图，不负责写入 |

## 响应格式说明

这组接口不使用通用的 `data` 包裹：

- 单对象读取返回 `{ "item": ... }`，没有记录时 `item` 为 `null`。
- 列表读取返回 `{ "items": [...] }`。
- PUT 直接返回写入后的对象。

## LLM Profile 覆盖

每个 Project 最多一条生效的 LLM Profile 覆盖。

### 覆盖对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 覆盖记录 ID |
| `workspace_id` | string | 所属 Workspace |
| `project_id` | string | 所属 Project |
| `base_profile_id` | string | 基础 LLM Profile |
| `override_json` | object | 覆盖参数 |
| `status` | string | 记录状态 |
| `created_at` | integer | 创建时间戳（ms） |
| `updated_at` | integer | 更新时间戳（ms） |

### 读取

```http
GET /projects/:id/settings/llm-profile-override
```

#### 响应 `200`

```json
{
  "item": {
    "id": "plo_001",
    "workspace_id": "ws_default_acc_1",
    "project_id": "proj_main",
    "base_profile_id": "llm_profile_alpha",
    "override_json": { "temperature": 0.2 },
    "status": "active",
    "created_at": 1735689600000,
    "updated_at": 1735689600000
  }
}
```

没有覆盖时返回：

```json
{ "item": null }
```

### 写入

```http
PUT /projects/:id/settings/llm-profile-override
```

#### 请求体

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `base_profile_id` | string | 是 | - | 基础 LLM Profile ID |
| `override_json` | object | 否 | `{}` | 覆盖参数 |

#### 请求示例

```bash
curl -X PUT http://localhost:3000/projects/proj_main/settings/llm-profile-override \
  -H 'Content-Type: application/json' \
  -d '{
    "base_profile_id": "llm_profile_alpha",
    "override_json": { "temperature": 0.2 }
  }'
```

#### 响应 `200`

直接返回写入后的覆盖对象（不带 `item` 包裹）。

## MCP 绑定

一个 Project 可以绑定多个 MCP Server，每个 Server 一条记录。

### 绑定对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 绑定记录 ID |
| `workspace_id` | string | 所属 Workspace |
| `project_id` | string | 所属 Project |
| `mcp_server_id` | string | MCP Server ID |
| `status` | string | `enabled` 或 `disabled` |
| `allowed_tools` | string[] | 允许的工具名列表。空数组表示不限定 |
| `config_override_json` | object | MCP 配置覆盖 |
| `created_at` | integer | 创建时间戳（ms） |
| `updated_at` | integer | 更新时间戳（ms） |

### 读取

```http
GET /projects/:id/settings/mcp-bindings
```

#### 响应 `200`

```json
{
  "items": [
    {
      "id": "pmb_001",
      "workspace_id": "ws_default_acc_1",
      "project_id": "proj_main",
      "mcp_server_id": "mcp_search",
      "status": "enabled",
      "allowed_tools": ["web_search"],
      "config_override_json": {},
      "created_at": 1735689600000,
      "updated_at": 1735689600000
    }
  ]
}
```

### 写入

```http
PUT /projects/:id/settings/mcp-bindings
```

一次写入一条绑定。同一 `mcp_server_id` 已有记录时更新，没有时创建。

#### 请求体

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `mcp_server_id` | string | 是 | - | MCP Server ID |
| `allowed_tools` | string[] | 否 | `[]` | 允许的工具名列表，重复项会去重 |
| `config_override_json` | object | 否 | `{}` | MCP 配置覆盖 |
| `status` | string | 否 | `enabled` | `enabled` 或 `disabled` |

#### 请求示例

```bash
curl -X PUT http://localhost:3000/projects/proj_main/settings/mcp-bindings \
  -H 'Content-Type: application/json' \
  -d '{
    "mcp_server_id": "mcp_search",
    "allowed_tools": ["web_search"]
  }'
```

#### 响应 `200`

直接返回写入后的绑定对象。

## Tool Policy 覆盖

### 覆盖对象

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | string | 覆盖记录 ID |
| `workspace_id` | string | 所属 Workspace |
| `project_id` | string | 所属 Project |
| `base_policy_id` | string | 基础 Tool Policy |
| `override_json` | object | 覆盖内容 |
| `status` | string | `active` 或 `archived` |
| `created_at` | integer | 创建时间戳（ms） |
| `updated_at` | integer | 更新时间戳（ms） |

### 读取

```http
GET /projects/:id/settings/tool-policy-overrides
```

#### 响应 `200`

```json
{
  "items": [
    {
      "id": "tpo_001",
      "workspace_id": "ws_default_acc_1",
      "project_id": "proj_main",
      "base_policy_id": "tool_policy_default",
      "override_json": { "deny": ["shell_exec"] },
      "status": "active",
      "created_at": 1735689600000,
      "updated_at": 1735689600000
    }
  ]
}
```

### 写入

```http
PUT /projects/:id/settings/tool-policy-overrides
```

一次写入一条覆盖。同一 `base_policy_id` 已有记录时更新，没有时创建。

#### 请求体

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `base_policy_id` | string | 是 | - | 基础 Tool Policy ID |
| `override_json` | object | 否 | `{}` | 覆盖内容 |
| `status` | string | 否 | `active` | `active` 或 `archived` |

#### 响应 `200`

直接返回写入后的覆盖对象。

## 权限

- GET 需要 `project.config.read`
- PUT 需要 `project.config.write`

角色矩阵：

| 角色 | 读取 | 写入 |
| ---- | ---- | ---- |
| owner | 可以 | 可以 |
| observer | 可以 | 不可以 |
| deriver | 可以 | 不可以 |

## 错误码汇总

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| `403` | `project_access_denied` | 当前角色没有配置写权限 |
| `404` | `project_not_found` | Project 不存在或不可见 |
| `409` | `project_archived` | Project 已归档 |

## 当前能力说明

- `base_profile_id`、`mcp_server_id`、`base_policy_id` 当前都不做数据库级外键约束，合法性主要由服务层负责。
- 生效结果请通过 [Effective Config](./effective-config) 读取，不要从写接口自行推断。

## 相关页面

- 生效配置视图：[Effective Config](./effective-config)
- 路由族总览：[Workspace / Project](./workspace-project)
