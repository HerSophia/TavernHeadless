---
outline: [2, 3]
---

# Project Settings（Project 级设置覆盖）

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
| base_profile_id | 作为基础的 LLM Profile ID。当前数据库层不做 FK。 |
| override_json | Project 级覆盖内容。 |
| effective-config | 只读最终生效配置视图，不负责写入。 |

## 接口

### GET /projects/:id/settings/llm-profile-override

读取当前 Project 的 LLM Profile 覆盖。没有时返回：

```json
{ "item": null }
```

### PUT /projects/:id/settings/llm-profile-override

写入或更新 Project 的 LLM Profile 覆盖。

### GET /projects/:id/settings/mcp-bindings

读取当前 Project 的 MCP 绑定列表。

### PUT /projects/:id/settings/mcp-bindings

写入或更新一条 Project MCP 绑定。

### GET /projects/:id/settings/tool-policy-overrides

读取当前 Project 的 Tool Policy 覆盖列表。

### PUT /projects/:id/settings/tool-policy-overrides

写入或更新一条 Tool Policy 覆盖。

## 权限

- GET 需要 `project.config.read`
- PUT 需要 `project.config.write`

角色矩阵：

- owner：允许
- observer：只读
- deriver：只读

## 常见错误码

| 状态码 | code | 说明 |
| ---- | ---- | ---- |
| `403` | `project_access_denied` | 当前角色没有配置写权限 |
| `404` | `project_not_found` | Project 不存在或不可见 |

## 当前阶段说明

- `base_profile_id`、`mcp_server_id`、`base_policy_id` 当前都保持 TEXT，不做数据库级 FK。
- 合法性主要由服务层负责。
- 生效结果请通过 `effective-config` 接口读取，不要从写接口自行推断。
