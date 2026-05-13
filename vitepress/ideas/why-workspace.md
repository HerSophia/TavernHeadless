---
outline: [2, 3]
---

# 为什么需要工作区？

> 本文说明为什么 TavernHeadless 后续需要引入工作区，以及它和账号、项目、会话、插件、Agentic 之间是什么关系。
> 这是一份思路文档，不是稳定 API 承诺。

## 问题不是普通会话不够用

如果只看普通聊天，当前的会话模型已经够用。

一个普通客户端只需要做这些事：

- 创建会话。
- 发送消息。
- 读取楼层和消息页。
- 处理重新生成。
- 读写变量、记忆和必要的配置。

在这种场景下，让客户端先理解工作区，反而会增加接入成本。

所以工作区不是为了替代会话。它要解决的是会话之上的问题。

更准确地说：

```text
会话解决一条叙事线怎样运行。
工作区解决一组能力和一组会话怎样被管理。
```

如果一个客户端只是做普通聊天，它不应该被迫理解工作区。

## 只有账号和会话时，边界不够用

当前模型可以简单理解为：

```text
Account
  └─ Session
```

这个模型很简单，但它遇到一些问题时会缺少中间层。

例如：

- 多个客户端同时连接同一个账号时，它们应该怎样共享信息。
- 一个世界推演客户端怎样只读主叙事的结果。
- 插件安装在哪里，启用在哪里。
- MCP 和工具权限应该挂在账号上，还是挂在某个会话上。
- 后台 Agent 监听哪些事件，结果写到哪里。
- 派生数据属于哪个范围。
- 高级客户端能不能加入普通客户端的会话，但只读。

如果没有工作区，这些能力只能挂在账号或会话上。

挂在账号上太粗。一个账号下可能有很多无关的会话，不能让插件和后台 Agent 默认看到全部内容。

挂在会话上又太窄。有些能力天然是跨会话的，例如主叙事会话和世界推演会话需要在同一个范围里联动。

所以需要一层新的边界。

## 推荐的层级

推荐结构是：

```text
Account
  └─ Workspace
       └─ Project
            └─ Session
```

这几个概念各自回答不同的问题。

| 层级 | 主要回答的问题 |
| ---- | ---- |
| Account | 用户是谁，资源最终属于谁 |
| Workspace | 这个账号下有哪些默认设置、插件、工具和能力上限 |
| Project | 哪些会话属于同一个叙事范围，哪些客户端和 Agent 可以参与 |
| Session | 一条具体叙事线怎样运行 |

这里的 Project 可以理解为“会话工作区”。它是一组相关会话的联动范围。

Workspace 不是一场叙事。Workspace 更像账号下的默认环境。Project 才是具体叙事范围。

有些资源应该默认属于 Workspace，而不是 Project。

特别是这些 Prompt Asset：

- 预设。
- 角色卡。
- 用户卡。
- 世界书。
- 正则配置。

它们是用户在多个会话中经常查询、切换和复用的基础资产。默认放在账号的默认 Workspace，可以让普通客户端和普通用户少处理一层 Project。Project 和 Session 只需要保存绑定关系、默认选择或可见性限制。

## 普通客户端不需要主动使用工作区

这是设计里最重要的一条。

基础 API 仍然应该以 Session 为中心：

```text
POST /sessions
GET /sessions/:id
POST /sessions/:id/respond
```

普通客户端调用 `POST /sessions` 时，不需要传 Workspace 或 Project。

后端可以自动完成：

```text
找到账号默认 Workspace。
创建默认 Project。
创建 Session。
把 Session 绑定到 Project。
```

这样做之后，后端内部有完整归属，普通客户端外部体验仍然简单。

也就是说：

```text
工作区对后端是基础归属。
工作区对普通客户端是高级能力。
```

这个边界需要长期保持。

## 工作区让多客户端联动有边界

一个很典型的场景是：

```text
主叙事客户端
  负责正常 RP。

世界推演客户端
  基于主叙事结果生成微博、B站评论、论坛反应、新闻稿等派生内容。
```

如果让世界推演客户端自己监听主叙事客户端，就会出现几个问题：

- 它可能处理未接受的 MessagePage。
- 它可能在重试时重复处理旧结果。
- 它可能不知道哪个 Page 才是正史。
- 它的输出可能直接污染主会话。
- 它的读写权限不清楚。

Project 可以作为这个联动范围。

世界推演客户端加入 Project 后，默认只能读取已提交事件：

```text
message_page.activated
floor.committed
session_state.committed
memory.promoted
```

它不能修改主会话。

如果它生成派生内容，默认写到自己的派生数据域，或者写入 Project 收件箱。

这就形成了单向联动：

```text
主叙事产生正史事件。
高级客户端读取事件。
高级客户端生成派生内容。
派生内容不自动进入主叙事。
普通客户端或用户决定是否采纳。
```

## 加入 Project 不等于获得写权限

这是工作区权限设计的基础。

高级客户端加入普通客户端的 Project 时，默认角色应该是 `observer`。

`observer` 可以读取：

- Project 元数据。
- 已提交事件。
- 被授权 Session 的已提交消息。

`observer` 不能做：

- 触发回复生成。
- 触发重新生成。
- 切换 active page。
- 写变量。
- 写记忆。
- 写 Session State。
- 写主会话消息。
- 修改插件绑定。
- 修改 Project 设置。

如果高级客户端需要保存自己的结果，可以给它更窄的 `deriver` 角色。

`deriver` 可以写自己的派生数据，但仍然不能写主会话。

这个规则可以避免一个问题：高级客户端一加入，就变成了普通客户端的协作者。

加入只代表建立读取通道，不代表拥有写入权。

## 工作区是插件系统的安装和启用边界

插件也需要工作区。

因为插件需要回答这些问题：

- 插件安装在哪里。
- 插件在哪些叙事范围中启用。
- 插件能读取哪些事件。
- 插件能写哪些数据。
- 插件卸载后数据如何处理。
- 插件提供的工具和节点在哪里可用。

推荐分层是：

```text
Workspace 安装插件。
Project 启用插件。
Session 使用插件带来的能力。
```

例如：

```text
Workspace:
  安装 world_social 插件。

Project A:
  启用 world_social，生成社交媒体反应。

Project B:
  不启用 world_social。
```

这样插件不会因为安装在账号下，就自动影响所有会话。

插件数据也应有明确归属。插件私有缓存、客户端展示数据、可被 Prompt 投影的数据，都不能混在主会话正史里。

## 工作区让 Agentic 有运行边界

Agentic 能力越强，越需要边界。

一次回复内部的 Agentic 可以绑定 Floor 和 MessagePage，例如：

- SceneStateAgent。
- MemorySelectAgent。
- WorldbookFocusAgent。
- DirectorAgent。
- Verifier。
- StateAgent。

这些是当前回合内的临时能力。

但后续还会有另一类 Agent：

- 世界推演 Agent。
- 长期记忆整理 Agent。
- 世界书维护 Agent。
- 项目审阅 Agent。
- 外部资料研究 Agent。

这些 Agent 不一定属于某一个 Page。它们可能监听 Project 事件，在后台运行，并把结果写到派生数据或收件箱。

因此可以分成两类：

```text
Turn-bound Agentic:
  绑定 Floor / Page，服务一次生成。

Project-bound Agentic:
  绑定 Project，服务一组相关会话和后台任务。
```

Workspace / Project 不改变 Narrator 单一正文原则。

它们只是提供 Agent 的身份、权限、事件、任务和数据边界。

## 工作区让配置作用域更清楚

引入工作区后，LLM、MCP、工具这些基础配置也需要明确归属。

推荐规则是：

```text
不传 workspace_id 时，只写当前账号的默认 Workspace。
Project 默认继承 Workspace。
Project 或 Session 的特殊配置必须通过显式 project_id 或 session_id 写入。
不做隐式双写。
```

也就是说，旧的基础配置 API 不应该同时修改默认 Workspace 和当前 Project。

原因很简单：双写会让配置来源不清楚，也会无意间制造 Project 覆盖配置。

更好的方式是：

```text
Workspace 定义能力和默认值。
Project 显式启用和收窄能力。
Session 记录运行时覆盖。
```

例如：

```text
Workspace 注册 MCP server。
Workspace 保存预设、角色卡、用户卡、世界书和正则配置。
Project 决定是否启用这个 MCP server。
Project 或 Session 选择要使用哪些 Prompt Asset。
Session 或 Page 记录本次实际调用。
```

这样旧客户端仍然可以修改默认配置或默认资产，旧 Project 因为继承 Workspace，也会看到有效变化。但系统不会偷偷写 Project override，也不会把资产复制到 Project。

## 为什么不是一开始就做完整工作区系统

工作区很有价值，但它也是一个大工程。

它会牵动：

- 数据模型。
- 权限检查。
- 事件流。
- SDK。
- 插件系统。
- Agentic Runtime。
- MCP 权限。
- 文档和迁移。

所以它不适合一次性完整推出。

更合适的路线是分阶段：

1. 先让后端内部有 Workspace / Project 归属。
2. 再提供 Project committed-only 事件流。
3. 再支持高级客户端只读加入。
4. 再加入派生数据和 Project 收件箱。
5. 再做插件安装、启用和权限。
6. 最后接入后台 Agent、NodeGraph 和 MCP。

第一版只需要做到：

```text
普通客户端不受影响。
每个 Session 都有 Project 归属。
高级客户端可以只读监听 Project 正史事件。
高级客户端不能写普通客户端的会话数据。
```

这已经能解决多客户端单向联动的关键问题。

## 最后

工作区不是为了让简单事情变复杂。

它是为了让复杂能力有边界。

普通客户端仍然应该只面对 Session。需要多客户端联动、插件、后台 Agent、MCP 和派生数据时，再进入 Workspace 和 Project 这一层。

如果用一句话概括：

```text
Session 是叙事运行入口。
Project 是叙事联动边界。
Workspace 是能力和默认环境边界。
```

这个分层能让 TavernHeadless 保持基础接入简单，同时为后续插件系统、Agentic Runtime 和多客户端联动留出清楚的位置。
