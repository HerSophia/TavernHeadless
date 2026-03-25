---
outline: [2, 3]
---

# 官方集成层

TavernHeadless 当前提供一套官方维护的第一方接入层，用来统一前端、桌面客户端、脚本和其他消费方的接入方式。

当前只有两个官方公开接入包：

- `@tavern/sdk`
- `@tavern/client-helpers`

这两个包合在一起，就是当前的 TavernHeadless Official Integration Kit。

## 为什么要有这层

后端 API 可以直接使用，但接入方通常会重复写这些代码：

- 请求封装
- 账号头注入
- SSE 解析
- 错误处理
- 时间线整理
- usage 归一化
- 流式中间态累计
- Tool Calling 与 MCP 的接入包装

如果这些逻辑散落在每个前端里，接入方式会越来越分散，行为也会不一致。

官方集成层的目标，是把已经稳定、已经重复出现、已经属于接入层的问题收住，形成统一的第一方调用面。

## 两个包的边界

### `@tavern/sdk`

`@tavern/sdk` 是基础层。

它负责：

- HTTP API 调用
- 默认请求头
- 统一错误对象
- SSE 读取与解析
- 第一方资源方法
- 保留底层类型化请求能力

它不负责：

- 时间线视图整理
- active page 选择
- store 状态管理
- hooks、composables、组件
- Vue / React / Pinia 绑定

### `@tavern/client-helpers`

`@tavern/client-helpers` 是语义层。

它负责：

- usage 归一化
- 时间线构建
- 流式状态 reducer
- active page 选择
- API 错误到界面状态的映射

它不负责：

- 发请求
- 依赖 `fetch`
- 依赖 Vue / React / Pinia

### `@tavern/shared`

`@tavern/shared` 仍然是内部包。

它可以被仓库内部复用，但不作为公开接入面的组成部分来对外承诺。

## 推荐使用顺序

建议按下面的顺序使用：

1. 用 `@tavern/sdk` 读取或写入资源
2. 用 `@tavern/client-helpers` 整理接入侧语义
3. 最后在应用层接入具体的 store、组件和页面

## 基本示例

### 创建客户端

```ts
import { createTavernClient } from "@tavern/sdk";

const client = createTavernClient({
  baseUrl: "http://localhost:3000",
});
```

### 调用资源

```ts
const sessionResult = await client.sessions.respond({
  sessionId: "session-1",
  message: "你好",
});
```

### 整理语义

```ts
import { resolveUsage } from "@tavern/client-helpers";

const usage = resolveUsage(sessionResult.totalUsage);
```

## 当前 SDK 资源覆盖范围

目前 `@tavern/sdk` 已覆盖这些资源。

### 会话与内容结构

- `health`
- `sessions`
- `messages`
- `floors`
- `pages`
- `branches`

### 角色、资料与配置

- `characters`
- `users`
- `presets`
- `presetEntries`
- `worldbooks`
- `worldbookEntries`
- `regexProfiles`

### 导入、导出与模型配置

- `imports`
- `exports`
- `llmProfiles`
- `llmInstances`

### 账号、变量与记忆

- `accounts`
- `variables`
- `memories`
- `memoryEdges`

### 工具与运行集成

- `tools`
- `mcp`

### 底层能力

除了资源方法，`@tavern/sdk` 还保留：

- `request(...)`
- `get(...)`
- `post(...)`
- `put(...)`
- `patch(...)`
- `delete(...)`
- `TavernApiError`
- `readSseStream(...)`

## 当前 `@tavern/client-helpers` 能力

目前 `@tavern/client-helpers` 已提供：

- `resolveUsage`
- `buildTimelineMessages`
- `createInitialRespondStreamState`
- `reduceRespondStream`
- `getActivePage`
- `mapApiErrorToUiState`

## 导出、Tools、MCP 的处理原则

### 导出资源

`exports` 资源直接返回原始 `Response`。

原因很简单：导出接口本身就是文件下载语义，调用方可能需要自己决定用 `text()`、`blob()`、`arrayBuffer()` 还是其他读取方式。

### Tools 资源

`tools` 资源负责：

- 内置工具列表
- 自定义工具定义 CRUD
- 启用和停用
- 调用记录查询

会话级工具权限仍保留在 `sessions` 资源下，不挪到 `tools` 中。

### MCP 资源

`mcp` 资源同时覆盖：

- 服务器配置 CRUD
- 启用和停用
- 连接状态读取
- connect / disconnect / test
- 服务器工具列表

## 与 `apps/web` 的关系

这两个包首先用于收敛仓库内部已经重复出现的接入逻辑。

当前 `apps/web` 已经开始改用这两个包：

- 请求层逻辑逐步迁入 `@tavern/sdk`
- 时间线和流式整理逻辑逐步迁入 `@tavern/client-helpers`

应用层仍然保留这些内容：

- Vue 组件和页面逻辑
- 表单状态
- 菜单交互
- 只在单一界面中使用的局部映射

## 这套文档需要怎样跟着代码变化

这点需要明确说明。

当引擎内部实现、后端路由、SSE 事件、OpenAPI、Tool Calling、MCP 或其他接入方可见语义发生变化时，不能只改引擎或只改某个前端。

此时应同时检查并按需要更新：

- `@tavern/sdk`
- `@tavern/client-helpers`
- 包内 README
- 外部接入文档

也就是说，引擎内部实现一改，官方包自然也要跟着检查；如果变化已经影响公开接入语义，官方包和文档就应同步更新。

## 文档入口

包内文档位于：

- `packages/official-integration-kit/sdk/README.md`
- `packages/official-integration-kit/client-helpers/README.md`

协作规则位于：

- `docs/contributing.md`
- [协作指南](/development/contributing)

## 版本兼容

当前建议按下面的关系理解兼容范围：

| 后端 API | `@tavern/sdk` | `@tavern/client-helpers` |
| ---- | ---- | ---- |
| `v0.2.x-beta` | `0.1.x` | `0.1.x` |

## 继续阅读

如果需要查看 API 本身，请继续参考：

- [API 参考](/reference/api)
- [Sessions（会话）](/reference/api/sessions)
- [Chat（对话生成）](/reference/api/chat)
- [Presets（预设）](/reference/api/presets)
- [Worldbooks（世界书）](/reference/api/worldbooks)
- [Tools](/reference/api/tools)
- [MCP Servers](/reference/api/mcp)
