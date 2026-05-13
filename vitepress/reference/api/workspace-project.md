---
outline: [2, 3]
---

# Workspace / Project（工作区与项目）

Workspace 和 Project 是账号下的两层组织边界。
Workspace 用于归拢资产、配置和插件；Project 用于把一组会话、事件和派生数据圈在一起。

当前处于阶段一：只做基础数据归属改造，不开放完整管理 API。

如果你只想搞清楚普通聊天流程里哪些地方会接触到 Workspace / Project，直接看[阶段一兼容规则](#阶段一兼容规则)。

## 什么时候需要看这页

- 你是高级接入方，想在多个会话之间共享项目上下文。
- 你需要在调用 `POST /sessions` 时把新会话放入一个已知的 Project。
- 你需要理解为什么旧 API 的行为没有变，以及哪些地方已经发生了变化。
- 你准备为阶段二或后续阶段的完整 Workspace / Project API 做技术评估。

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

高级调用方如果已经知道目标 Project，可以传 `project_id`：

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

**`project_id` 只能用在 `POST /sessions`。**
`PATCH /sessions/:id` 不接受 `project_id`，传入会返回 `400`。

## 先理解几个词

| 词 | 这里的意思 |
| ---- | ---- |
| Workspace | 账号下的资产管理边界。每个账号有且只有一个默认 Workspace。 |
| Project | 工作区内的会话联动边界。一个 Project 下可以有多个 Session。 |
| `workspace_id` | 数据库归属字段。阶段一不暴露在响应里。 |
| `project_id` | `POST /sessions` 的可选高级字段。 |
| `session_default` | 阶段一为每个 Session 自动创建的默认 Project 类型。 |
| `global` 配置 | 阶段一里表示"当前账号默认 Workspace 的默认配置"。 |

补充说明：

- **Workspace** 是 Prompt Asset、LLM Profile、Tool Definition、MCP 配置的归属层。
- **Project** 阶段一里，每个 Session 都有一个对应的 Project（默认为 `session_default`），行为等同于旧版中隐含的"一个会话就是一个独立上下文"。
- **`project_id`** 仅当调用方主动传时才使用；省略时服务端自动创建默认 Project。
- **`global` 配置** 旧配置 API 不传 `workspace_id` 时，自动写入默认 Workspace。

## 当前公开边界

阶段一只完成基础数据库归属和服务层改造，不开放完整 Workspace / Project 管理 API。

当前公开面如下：

- `POST /sessions` 请求体增加可选 `project_id`（详见 [Sessions](./sessions)）。
- `PATCH /sessions/:id` 不接受 `project_id`，传入返回 `400 session_project_move_not_supported`。
- 所有 Prompt Asset（角色、用户卡、预设、世界书、正则配置）的创建和导入默认写入当前账号默认 Workspace。
- 所有 Prompt Asset 的列表和详情默认只读当前账号默认 Workspace 下的记录。
- LLM Profile、LLM Instance Config、LLM Profile Binding 的 `global` 语义等价于"默认 Workspace"。
- Tool Definition、MCP Server Config 的创建和列表默认为当前账号默认 Workspace。
- Session 运行时工具目录只加载 Session 所属 Workspace 的工具定义。
- Session 资产绑定（preset、worldbook、regex profile、角色卡、用户卡）要求资产与 Session 属于同一 Workspace。
- 所有资产、配置、会话在数据库内部都已经写入 `workspace_id`（以及 Session 的 `project_id`），但响应体默认不返回这些字段。

阶段一明确不做：

- 完整的 `GET/POST/PATCH /workspaces` 和 `GET/POST/PATCH /projects` 管理 API。
- `GET /sessions?workspace_id=...` 或 `GET /sessions?project_id=...` 查询过滤。
- `include=workspace,project` 响应展开。
- Project 事件流、ProjectMembership、Project 级 LLM/MCP/Tool 策略覆盖。

## 阶段一兼容规则

以下规则保证旧客户端和旧脚本继续可用：

- 普通客户端创建和使用会话时，不需要传 `workspace_id` 或 `project_id`。
- `POST /sessions` 不传 `project_id` 时，
  服务端使用当前账号默认 Workspace，
  并为新 Session 创建 `session_default` Project。
- Session 的默认响应不新增 `workspace_id` 和 `project_id` 字段。
- Prompt Asset、LLM、MCP、Tool 旧配置 API 不传 `workspace_id` 时默认写当前账号默认 Workspace。
- 旧 `global` 配置语义保持不变：表示当前账号默认 Workspace 的默认配置。
- 不因为 Session 归属于某个 Project 而隐式双写 Project 级配置。
- 不因为当前请求来自某个 Session 上下文而隐式改变资产、配置的读写目标作用域。

## 与官方 SDK 的关系

`@tavern/sdk` 的 `client.sessions.create(...)` 接受可选的 `projectId` 参数。省略时行为与旧版一致。

```ts
const session = await client.sessions.create({
  accountId: "account-1",
  projectId: "proj-1",
  title: "Project Session",
});
```

详细说明见 [官方集成层 - 创建会话和 Project 兼容字段](/guide/integration-kit#创建会话和-project-兼容字段)。

`@tavern/client-helpers` 当前不需要感知 Workspace / Project。

## 下一步

阶段二计划开放：

- 完整的 `/workspaces` 和 `/projects` CRUD。
- `GET /sessions` 按 `workspace_id`、`project_id` 过滤。
- `include=workspace,project` 响应展开。
- Project 事件流和 ProjectMembership。

阶段一范围内的改动现在已经是后端真相。
外部接入方如果只需要普通聊天能力，可以继续忽略 Workspace / Project。

如果需要了解引入工作区的设计动机，可以看 [为什么需要工作区？](/ideas/why-workspace)。
