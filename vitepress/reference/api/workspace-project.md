---
outline: [2, 3]
---

# Workspace / Project（工作区与项目）

Workspace 和 Project 是账号下的两层组织边界。Workspace 用于归拢资产、配置和插件；Project 用于把一组会话、事件、成员访问、派生结果和收件箱圈在一起。

这一组能力按稳定的子路由族拆开。本页是总览，负责回答"我的问题应该去看哪一页"，以及所有页面共享的角色与兼容规则。

如果你只想搞清楚普通聊天流程里哪些地方会接触到 Workspace / Project，直接看[兼容规则](#兼容规则)。

## 什么时候需要看这页

- 你是高级接入方，想按 Project 组织会话和事件。
- 你需要给某个账号增加 observer 或 deriver。
- 你需要理解 owner、observer、deriver 和非成员的访问差异。
- 你需要在调用 `POST /sessions` 时把新会话放入一个已知的 Project。
- 你需要理解 Workspace 级 Agent 定义与 Project 级 Agent 启用的边界。

## 路由族一览

| 路由族 | 主要入口 | 说明 | 文档 |
| ---- | ---- | ---- | ---- |
| Workspaces 管理 | `GET/POST /workspaces`、`GET/PATCH /workspaces/:id`、`/workspaces/:id/archive`、`/workspaces/:id/restore` | 列出、读取、创建、更新、归档、恢复 Workspace | [Workspaces](./workspaces) |
| Projects 基础 | `GET/POST /projects`、`PATCH /projects/:id`、`/projects/:id/archive`、`/projects/:id/restore`、`/projects/:id/duplicate`、`/projects/:id/sessions`、`/projects/:id/events`、`/projects/:id/members` | 创建/更新/归档/恢复/复制 Project、列出、读会话摘要、查询和订阅事件、维护成员 | [Projects](./projects) |
| Derived Outputs | `/projects/:id/derived-outputs` | 保存 Project 范围内的派生 JSON 结果 | [Project Derived Outputs](./projects-derived-outputs) |
| Inbox | `/projects/:id/inbox` | 保存待 owner 决策的收件箱条目 | [Project Inbox](./projects-inbox) |
| Agent Types | `/workspaces/:id/agent-types` | Workspace 级 Agent 模板定义 | [Agent Types](./agent-types) |
| Agent Bindings | `/projects/:id/agent-bindings` | Project 级 Agent 启用与手动触发 | [Project Agent Bindings](./project-agent-bindings) |
| NodeGraph Runtime | `/projects/:id/node-graphs` | Project 级图定义、版本、预览、后台运行与 trace | [NodeGraph Runtime](./node-graphs) |
| Settings | `/projects/:id/settings/*` | Project 级 LLM / MCP / Tool Policy 覆盖 | [Project Settings](./project-settings) |
| Effective Config | `/projects/:id/effective-config`、`/sessions/:id/effective-config` | 只读生效配置视图 | [Effective Config](./effective-config) |
| Session 归属 | `POST /sessions` 的可选 `project_id`、`GET /sessions/:id/scope` | 创建会话时指定 Project，读取会话归属 | 本页[兼容规则](#兼容规则) |

## 先看哪一页

| 你要解决的问题 | 先看 |
| ---- | ---- |
| 创建、更新、归档 Workspace | [Workspaces](./workspaces) |
| 创建、更新、归档、复制 Project，列出、查事件、加成员 | [Projects](./projects) |
| 让 deriver 写入分析结果 | [Project Derived Outputs](./projects-derived-outputs) |
| 给 owner 留待决策的建议 | [Project Inbox](./projects-inbox) |
| 定义一个可复用的 Agent 模板 | [Agent Types](./agent-types) |
| 在某个 Project 中启用 Agent | [Project Agent Bindings](./project-agent-bindings) |
| 定义、预览或后台运行 NodeGraph | [NodeGraph Runtime](./node-graphs) |
| 给某个 Project 单独换模型或工具策略 | [Project Settings](./project-settings) |
| 看某个 Project / Session 最终生效的配置 | [Effective Config](./effective-config) |

## 一个简单例子

普通客户端创建会话时不需要传任何 Workspace / Project 字段：

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

如果要开始使用 Agent 能力，顺序通常是：

1. 在 Workspace 下注册 Agent Type。
2. 在 Project 下创建 Agent Binding。
3. 根据需要读取 `effective-config`。
4. 手动 run，或等待后续版本接入自动事件触发。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| Workspace | 账号下的资产管理边界。每个账号有且只有一个默认 Workspace |
| Client | 同一个账号下的不同程序调用入口。Client 不是账号；权限和审计按 Client 单独记账 |
| 默认 Client | 每个账号自动创建的内置 Client。默认 Client 可以按 owner 身份访问同账号 Project，普通 Client 不会自动获得 owner 权限 |
| Project | 工作区内的会话联动边界。一个 Project 下可以有多个 Session |
| owner | Project 所属账号。可以读写 Project 下资源 |
| observer | Project 观察者。可以读取 Project、Session、Project Event 和 Derived Output，不能写入 |
| deriver | Project 派生者。可以写入 Derived Output、创建 Inbox 条目，但不能修改主 Session |
| Project Event | Project 范围内的事件摘要日志，可通过 HTTP 查询或 SSE 订阅 |
| Derived Output | Project 范围内的派生 JSON 结果，不会自动合并进主 Session |
| Project Inbox | Project 范围内的待处理建议或通知。接受条目只记录决策，不会自动合并 |
| Agent Type | Workspace 级 Agent 定义模板。只定义默认能力，不直接运行 |
| Agent Binding | Project 级 Agent 启用记录。把某个 Agent Type 在 Project 中启用，并允许做只收窄的 override |
| effective-config | 只读生效配置视图，用于看 Project / Session 当前最终配置来源 |

## 角色与可见性

| 能力 | owner | observer | deriver | 非成员 |
| ---- | ---- | ---- | ---- | ---- |
| 读取 Project、Session 摘要、Event | 可以 | 可以 | 可以 | 不可见 |
| 看到 `visibility=owner` 的 Event | 可以 | 不可以 | 不可以 | 不可见 |
| 修改 Session、Floor、Page、Message、Variable、Memory | 可以 | 不可以 | 不可以 | 不可见 |
| 写入 Derived Output | 可以 | 不可以 | 可以 | 不可见 |
| 创建 Inbox 条目 | 可以 | 不可以 | 可以 | 不可见 |
| 决策 Inbox 条目 | 可以 | 不可以 | 不可以 | 不可见 |
| 管理成员、Agent、设置覆盖 | 可以 | 不可以 | 不可以 | 不可见 |

非成员访问 Project 下资源时，服务端隐藏资源存在性：Project API 通常返回 `404 project_not_found`，旧资源路由通常返回 `404 not_found`。

Agent 在当前版本不能写主叙事正史，也不能直接写入 `session_messages`、`floor`、`page_active`、`variable_live`、`memory_live` 或 `session_state_live_head`。详见 [Agent Types 的安全边界](./agent-types#安全边界)。

## 当前不提供的能力

下面这些能力当前明确不提供，请不要按猜测调用：

- 完整 Workspace 成员体系（多账号协作）。
- Project 的物理删除（`DELETE /projects/:id`）。归档请改用 `POST /projects/:id/archive`。
- 具体 Agent Processor 执行（当前是占位实现）。
- Agent 自动写主 Session。
- Inbox accept 自动合并到主 Session。
- `GET /sessions?workspace_id=...`、`GET /sessions?project_id=...` 和 `include=workspace,project`。

## 与官方 SDK 的关系

`@tavern/sdk` 已经封装：

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
- Session 的默认响应不新增 `workspace_id` 和 `project_id` 字段。归属信息通过 `GET /sessions/:id/scope` 显式读取。
- Prompt Asset、LLM、MCP、Tool 旧配置 API 不传 `workspace_id` 时默认写当前账号默认 Workspace。
- 旧 `global` 配置语义保持不变：表示当前账号默认 Workspace 的默认配置。
- 不因为 Session 归属于某个 Project 而隐式双写 Project 级配置。
- 不因为当前请求来自某个 Session 上下文而隐式改变资产、配置的读写目标作用域。

如果只需要普通聊天能力，可以继续忽略 Workspace / Project。若需要了解引入工作区的设计动机，可以看 [为什么需要工作区？](/ideas/why-workspace)。
