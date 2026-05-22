---
outline: [2, 3]
---

# Workspace / Project（工作区与项目）

Workspace 和 Project 是账号下的两层组织边界。
Workspace 用于归拢资产、配置和插件；Project 用于把一组会话、事件、成员访问、派生结果和 Inbox 圈在一起。

当前已经进入阶段五：除了 Project Event、observer、deriver、Derived Output 和 Project Inbox，还增加了 Workspace 级 Agent Type、Project 级 Agent Binding、Project 级设置覆盖和 effective-config 只读视图。

如果你只想搞清楚普通聊天流程里哪些地方会接触到 Workspace / Project，直接看[兼容规则](#兼容规则)。

## 什么时候需要看这页

- 你是高级接入方，想按 Project 查看会话。
- 你需要读取 Project Event，或用 SSE 订阅 Project Event。
- 你需要给某个账号增加 observer 或 deriver。
- 你需要让 deriver 写入 Derived Output 或提交 Project Inbox 条目。
- 你需要理解 owner、observer、deriver 和非成员的访问差异。
- 你需要在调用 `POST /sessions` 时把新会话放入一个已知的 Project。
- 你需要理解 Workspace 级 Agent 定义与 Project 级 Agent 启用的边界。
- 你需要读取 Project / Session 的 effective-config。

## 一个简单例子

普通客户端创建会话时仍然不需要传任何 Workspace / Project 字段：

```bash
curl -X POST http://localhost:3000/sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Campfire",
    "character_id": "char_001",
    "user_id": "usr_001",
    "preset_id": "preset_001"
  }'
```

服务端会自动使用当前账号默认 Workspace，并为这个 Session 创建 `session_default` Project。

如果你已经知道目标 Project，可以传 `project_id`：

```bash
curl -X POST http://localhost:3000/sessions \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Campfire",
    "character_id": "char_001",
    "user_id": "usr_001",
    "preset_id": "preset_001",
    "project_id": "proj_main"
  }'
```

之后可以读取这个 Session 的归属：

```bash
curl http://localhost:3000/sessions/sess_001/scope
```

也可以读取 Project 事件：

```bash
curl 'http://localhost:3000/projects/proj_main/events?after=0&limit=100'
```

如果你要开始使用阶段五 Agent 能力，顺序通常是：

1. 在 Workspace 下注册 Agent Type。
2. 在 Project 下创建 Agent Binding。
3. 根据需要读取 `effective-config`。
4. 手动 run，或等待后续阶段接入自动事件触发。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| Workspace | 账号下的资产管理边界。每个账号有且只有一个默认 Workspace。 |
| Client | 同一个账号下的不同程序调用入口。Client 不是账号；权限和审计按 Client 单独记账。 |
| 默认 Client | 每个账号自动创建的内置 Client。默认 Client 可以按 owner 身份访问同账号 Project，普通 Client 不会自动获得 owner 权限。 |
| Project | 工作区内的会话联动边界。一个 Project 下可以有多个 Session。 |
| owner | Project 所属账号。可以读写 Project 下资源。 |
| observer | Project 观察者。可以读取 Project、Session、Project Event 和 Derived Output，不能写入。 |
| deriver | Project 派生者。可以写入 Derived Output、创建 Inbox 条目，但不能修改主 Session。 |
| Project Event | Project 范围内的事件摘要日志，可通过 HTTP 查询或 SSE 订阅。 |
| Derived Output | Project 范围内的派生 JSON 结果，不会自动合并进主 Session。 |
| Project Inbox | Project 范围内的待处理建议或通知。接受条目只记录决策，不会自动合并。 |
| Agent Type | Workspace 级 Agent 定义模板。只定义默认能力，不直接运行。 |
| Agent Binding | Project 级 Agent 启用记录。把某个 Agent Type 在 Project 中启用，并允许做只收窄的 override。 |
| effective-config | 只读生效配置视图，用于看 Project / Session 当前最终配置来源。 |

补充说明：

- owner 可以看到 `visibility=project` 和 `visibility=owner` 的 Project Event。
- observer 只能看到 `visibility=project` 的 Project Event。
- deriver 只能看到 `visibility=project` 的 Project Event。
- observer 不能修改 Session、Floor、Page、Message、Variable、Memory 等 Project 下资源。
- deriver 不能修改主 Session、Floor、Page、Message、Variable、Memory 或 Session State。
- deriver 可以写入 Derived Output，并可以创建 Inbox 条目。deriver 不能决定 Inbox。
- 非成员访问 Project 下资源时，服务端继续隐藏资源存在性。Project API 通常返回 `404 project_not_found`，旧资源路由通常返回 `404 not_found`。
- Agent 在阶段五不能写主叙事正史，也不能直接写入 `session_messages`、`floor`、`page_active`、`variable_live`、`memory_live` 或 `session_state_live_head`。

## 当前公开边界

当前公开面如下：

- `POST /sessions` 请求体增加可选 `project_id`。
- `GET /sessions/:id/scope` 读取 Session 的 Workspace / Project 归属。
- `GET /projects` 列出当前账号可访问的 Project。
- `GET /projects/:id` 读取 Project 详情。
- `GET /projects/:id/sessions` 列出 Project 下的 Session 摘要。
- `GET /projects/:id/events` 查询 Project Event。
- `GET /projects/:id/events/stream` 通过 SSE 订阅 Project Event。
- `GET /projects/:id/members` 列出 Project 成员。
- `POST /projects/:id/members` 增加 observer 或 deriver。
- `DELETE /projects/:id/members/:account_id` 移除 observer 或 deriver。
- `GET /projects/:id/derived-outputs`、`POST /projects/:id/derived-outputs`、`GET/PATCH/DELETE /projects/:id/derived-outputs/:item_id` 管理 Derived Output。
- `GET /projects/:id/inbox`、`POST /projects/:id/inbox`、`GET/PATCH /projects/:id/inbox/:item_id` 管理 Project Inbox。
- `GET /workspaces/:id/agent-types`、`POST /workspaces/:id/agent-types`、`GET/PATCH /workspaces/:id/agent-types/:agent_type_id`、`POST /workspaces/:id/agent-types/:agent_type_id/disable|enable` 管理 Workspace Agent Type。
- `GET /projects/:id/agent-bindings`、`POST /projects/:id/agent-bindings`、`GET/PATCH /projects/:id/agent-bindings/:binding_id`、`POST /projects/:id/agent-bindings/:binding_id/disable|enable|run` 管理 Project Agent Binding。
- `GET /projects/:id/effective-config`、`GET /sessions/:id/effective-config` 读取只读生效配置视图。
- `GET/PUT /projects/:id/settings/llm-profile-override`、`GET/PUT /projects/:id/settings/mcp-bindings`、`GET/PUT /projects/:id/settings/tool-policy-overrides` 管理 Project 级覆盖。

阶段五明确不做：

- 完整 Workspace 成员体系。
- 完整 `GET/POST/PATCH /workspaces` 管理 API。
- 完整 `POST/PATCH/DELETE /projects` 管理 API。
- 具体 Agent Processor 落地。
- Agent 自动写主 Session。
- Inbox accept 自动合并到主 Session。
- NodeGraph 或完整 Agent 调度循环。

Derived Output 的完整接口见 [Project Derived Outputs](./projects-derived-outputs)。

Project Inbox 的完整接口见 [Project Inbox](./projects-inbox)。

阶段五新增的详细页见：

- [Agent Types](./agent-types)
- [Project Agent Bindings](./project-agent-bindings)
- [Project Settings](./project-settings)
- [Effective Config](./effective-config)

## 与官方 SDK 的关系

`@tavern/sdk` 现在已经封装：

- `client.workspaces.agentTypes.*`
- `client.projects.agentBindings.*`
- `client.projects.settings.*`
- `client.projects.getEffectiveConfig(...)`
- `client.sessions.getEffectiveConfig(...)`

这些方法保持 API 的 `snake_case` 到 SDK 的 `camelCase` 映射。

## 兼容规则

以下规则保证旧客户端和旧脚本继续可用：

- 普通客户端创建和使用会话时，不需要传 `workspace_id` 或 `project_id`。
- `POST /sessions` 不传 `project_id` 时，服务端使用当前账号默认 Workspace，并为新 Session 创建 `session_default` Project。
- Session 的默认响应不新增 `workspace_id` 和 `project_id` 字段。
- Prompt Asset、LLM、MCP、Tool 旧配置 API 不传 `workspace_id` 时默认写当前账号默认 Workspace。
- 旧 `global` 配置语义保持不变：表示当前账号默认 Workspace 的默认配置。
- 不因为 Session 归属于某个 Project 而隐式双写 Project 级配置。
- 不因为当前请求来自某个 Session 上下文而隐式改变资产、配置的读写目标作用域。

如果只需要普通聊天能力，可以继续忽略 Workspace / Project。若需要了解引入工作区的设计动机，可以看 [为什么需要工作区？](/ideas/why-workspace)。
