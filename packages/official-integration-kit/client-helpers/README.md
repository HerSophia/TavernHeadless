# @tavern/client-helpers

TavernHeadless 官方接入的语义层。

它建立在 `@tavern/sdk` 之上，把接入侧常见的数据整理工作收拢到一块。

简单来说：SDK 负责把数据从后端拿过来，这个包负责把数据整理成前端好用的形态。

## 它做什么

- 归一化 usage（不管后端返回的是 `prompt_tokens` 还是 `inputTokens`，都能整理成统一结构）
- 构建时间线展示模型
- 累积流式生成的中间状态
- 选择 active page
- 把 API 错误映射成更适合界面消费的状态

## 它不做什么

- 不发 HTTP 请求
- 不依赖 `fetch`
- 不依赖 Vue / React / Pinia
- 不提供组件、hooks、composables

所有导出都是纯函数，不绑任何框架。

## 安装

```json
{
  "dependencies": {
    "@tavern/client-helpers": "workspace:*"
  }
}
```

本包依赖 `@tavern/sdk`。

## 当前导出

| 函数 | 用途 |
| ---- | ---- |
| `resolveUsage` | 把各种格式的 usage 归一化成统一结构 |
| `buildTimelineMessages` | 把楼层数据平展成时间线消息列表 |
| `createInitialRespondStreamState` | 创建流式生成的初始状态 |
| `reduceRespondStream` | 根据 SSE 事件累积流式状态 |
| `groupToolEventsByExecution` | 把同一次工具执行的流式事件整理成历史组 |
| `getActivePage` | 从楼层中选出当前活动页 |
| `flattenVariableSnapshot` | 把 resolved variable snapshot 整理成 inspector 可用行 |
| `sortVariableInspectorRows` | 对变量 inspector 行做稳定排序 |
| `formatVariablePreview` | 把变量值格式化成适合界面展示的预览字符串 |
| `mapApiErrorToUiState` | 把 API 错误转换成界面可用的错误状态 |
| `summarizeRuntimeToolCatalog` | 把会话级运行时工具目录整理成摘要信息 |

## 用法

### usage 归一化

后端和不同 LLM 提供商返回的 token 计数格式不一样，有的用 `prompt_tokens`，有的用 `inputTokens`。`resolveUsage` 把它们统一整理成一个结构：

```ts
import { resolveUsage } from "@tavern/client-helpers";

const usage = resolveUsage({
  prompt_tokens: 12,
  completion_tokens: 8,
});

console.log(usage.inputTokens);  // 12
console.log(usage.outputTokens); // 8
console.log(usage.totalTokens);  // 20
```

返回的 `NormalizedUsage` 同时保留了原始字段（`promptTokens`、`completionTokens`）和归一化后的字段（`inputTokens`、`outputTokens`、`totalTokens`），都能访问。

### 构建时间线

`buildTimelineMessages` 把后端返回的楼层结构平展成一个线性的消息列表，适合直接渲染到聊天界面：

```ts
import { buildTimelineMessages } from "@tavern/client-helpers";

const viewMessages = buildTimelineMessages(timeline.floors);

// 每条消息都带着 floorId、floorNo、pageId、role、content 等字段
// 只保留 user / assistant / narrator / system 角色的消息
```

返回的 `TimelineMessageView` 每条包含：

| 字段 | 说明 |
| ---- | ---- |
| `id` | 消息 ID |
| `role` | `"user"` / `"assistant"` / `"narrator"` / `"system"` |
| `content` | 消息内容 |
| `contentFormat` | `"text"` / `"markdown"` / `"json"` |
| `floorId` / `floorNo` | 所属楼层 |
| `pageId` | 所属页面 |
| `seq` | 消息序号 |
| `tokenIn` / `tokenOut` | token 统计 |
| `at` | 时间戳 |

### 累积流式状态

流式回复时，前端需要随着 SSE 事件逐步累积状态。`reduceRespondStream` 是一个纯函数 reducer，每收到一个事件就返回新状态：

```ts
import {
  createInitialRespondStreamState,
  reduceRespondStream,
} from "@tavern/client-helpers";

let state = createInitialRespondStreamState();

for (const event of events) {
  state = reduceRespondStream(state, event);
}

// state.status 会经历 "idle" → "streaming" → "done"(或 "error")
// state.content 是已累积的文本
// state.result 在 done 时填充完整结果
// state.result.summaries 和 state.result.finalState 会保留最终 done payload
```

如果 `done` 事件已经带回完整 `summaries`，reducer 会直接采用最终结果；如果旧服务端只在 `summary` 事件里提供摘要，reducer 会回退到已累积的摘要列表。

同一条流里如果还有 `tool` 事件，reducer 也会一起累积：

- `activeTools`：当前仍在执行中的工具
- `toolEvents`：完整的工具事件历史
- `warnings`：根据 `replaySafety` 推导出的重放警告

这个 reducer 直接消费 SDK `onEvent` 转发出来的真实 `done` 事件即可。已经收到真实 `done` 的消费者，不应再人为补第二个 `done`。

`RespondStreamState` 的结构：

| 字段 | 说明 |
| ---- | ---- |
| `status` | `"idle"` / `"streaming"` / `"done"` / `"error"` |
| `content` | 已累积的生成文本 |
| `floorId` / `floorNo` | 当前楼层信息 |
| `branchId` | 分支 ID |
| `summaries` | 已收到的摘要列表 |
| `error` | 错误信息（仅 error 状态） |
| `activeTools` | 当前仍在执行中的工具事件索引 |
| `toolEvents` | 已收到的全部工具事件 |
| `warnings` | 由工具重放安全信息推导出的警告 |
| `result` | 最终结果（仅 done 状态，保留 `generatedText` / `summaries` / `finalState`） |

### 整理工具事件和运行时目录

如果界面要展示 live tool inspector、执行历史或运行时冲突，可以继续使用另外两个纯函数：

```ts
import {
  groupToolEventsByExecution,
  summarizeRuntimeToolCatalog,
} from "@tavern/client-helpers";

const executionGroups = groupToolEventsByExecution(state.toolEvents);
const catalogSummary = summarizeRuntimeToolCatalog(runtimeCatalog);

console.log(executionGroups[0]?.executionId);
console.log(catalogSummary.availableCount);
console.log(catalogSummary.conflictCount);
```

这里的 `runtimeCatalog` 应来自 SDK 的 `client.sessions.getRuntimeToolCatalog(...)`。它是**会话级**运行时快照，不是全局工具目录。

### 选择 active page

一个楼层可以有多个页面（分支）。`getActivePage` 帮你从楼层数据中取出当前活动页：

```ts
import { getActivePage } from "@tavern/client-helpers";

const page = getActivePage({
  activePage: floor.activePage,
  pages: floor.pages,
});
```

如果 `activePage` 存在就直接返回，否则回退到 `pages` 数组的第一个。都没有则返回 `null`。

### 整理变量快照

`client.variables.resolveContext()` 返回的是按上下文解析后的变量快照。`flattenVariableSnapshot` 和 `sortVariableInspectorRows` 可以把它整理成更适合 inspector 面板或表格渲染的行数据：

```ts
import { flattenVariableSnapshot, sortVariableInspectorRows } from "@tavern/client-helpers";

const snapshot = await client.variables.resolveContext({
  sessionId: "session-1",
  floorId: "floor-1",
  pageId: "page-1",
  includeLayers: true,
});

const rows = sortVariableInspectorRows(flattenVariableSnapshot(snapshot));

console.log(rows[0]?.key);
console.log(rows[0]?.preview);
console.log(rows[0]?.sourceScope);
console.log(rows[0]?.layers);
```

返回的 `VariableInspectorRow` 每条至少包含：

| 字段 | 说明 |
| ---- | ---- |
| `key` | 变量键 |
| `preview` | 适合界面展示的预览字符串 |
| `sourceScope` | 当前胜出值来自哪个 scope |
| `sourceScopeId` | 当前胜出值来自哪个 scope_id |
| `updatedAt` | 当前胜出值的更新时间 |
| `layers` | 可选的各层值快照，已按 `page → floor → chat → global` 排序 |

### 错误映射

`mapApiErrorToUiState` 把各种错误转换成统一的界面状态，前端可以根据 `kind` 和 `retryable` 决定怎么展示：

```ts
import { mapApiErrorToUiState } from "@tavern/client-helpers";

try {
  await client.sessions.respond({
    sessionId: "missing",
    message: "hello",
  });
} catch (error) {
  const uiError = mapApiErrorToUiState(error);
  console.log(uiError.kind);      // "not_found" / "validation" / "server" / ...
  console.log(uiError.retryable);  // true / false
  console.log(uiError.message);    // 错误信息
  console.log(uiError.code);       // 原始 API 错误码
}
```

默认映射规则：

| HTTP 状态码 | `kind` | `retryable` |
| ---- | ---- | ---- |
| 401 | `authentication` | 否 |
| 403 | `authorization` | 否 |
| 404 | `not_found` | 否 |
| 409 | `conflict` | 是 |
| 400 / 422 | `validation` | 否 |
| 5xx | `server` | 是 |
| 网络错误 | `network` | 是 |

对于当前已知的业务错误码，helper 会优先采用 code-aware 映射，再回退到通用状态码规则：

| API 错误码 | `kind` | `retryable` |
| ---- | ---- | ---- |
| `generation_conflict` | `conflict` | 是 |
| `generation_queue_timeout` | `server` | 是 |
| `generation_timeout` | `server` | 是 |
| `generation_cancelled` | `network` | 是 |
| `commit_busy` | `server` | 是 |
| `commit_conflict` | `conflict` | 是 |
| `preset_conflict` | `conflict` | 是 |
| `worldbook_conflict` | `conflict` | 是 |
| `regex_profile_conflict` | `conflict` | 是 |
| `tool_catalog_conflict` | `conflict` | 是 |
| `tool_replay_blocked` | `conflict` | 是 |
| `tool_replay_confirmation_required` | `conflict` | 是 |
| `mcp_call_uncertain_timeout` | `server` | 是 |
| `turn_commit_failed` | `server` | 是 |

这样做的目的是让界面默认语义更稳定。同时，原始 `code` 仍会保留在返回结果里，接入方如果需要更细的 UI 分支，仍可继续自行判断。

这也覆盖了资源编辑时的新版本冲突场景。比如 preset、worldbook、regex profile 的乐观锁写入失败，会落到 `conflict` 且保持可重试。

其中 `mcp_call_uncertain_timeout` 表示结果不确定，并且调用方通常需要触发重连；它不应被当成普通、确定性的失败来处理。

这条规则同样覆盖流式 `respond/stream` 的 SSE `error` 事件。流已经建立后，SDK 抛出的 `TavernApiError.status` 可能仍然是 `200`，但 `code` 会保留为 `generation_timeout`、`commit_busy`、`generation_queue_timeout` 等值，因此 helper 会优先按 `code` 处理。

默认服务配置仍是 `queueMode: "reject"`，所以同一 `session + branch` 的并发请求通常更容易看到 `generation_conflict`。`generation_queue_timeout` 一般只会在服务端显式启用 `queue` 模式时出现，而且排队范围仍只限单实例进程内。

### Memory V2 数据

Memory V2 的公开字段和管理路由现在由 `@tavern/sdk` 直接提供：

- `client.memories`：记忆条目，包含 `summaryTier`、`lifecycleStatus` 等字段
- `client.memoryJobs`：后台任务观测与 retry / cancel
- `client.memoryScopes`：scope 状态观测与 rebuild / compact

当前还没有稳定、通用、与框架无关的记忆视图整理逻辑，因此本包暂不新增专门的 memory helper。

## 设计边界

**适合放进来的：**

- 纯函数形式的语义整理
- 时间线构建
- 流式 reducer
- 错误状态映射
- 与框架无关的 selector

**不适合放进来的：**

- HTTP 请求
- DOM 操作
- Vue 响应式对象
- React state
- Pinia / Zustand / TanStack Query 绑定

## 和应用层的关系

`apps/web` 可以继续保留这些内容：

- 页面和组件的交互逻辑
- 表单状态
- 菜单行为
- 只在某一个界面里用到的临时映射

只有已经稳定、可复用、与框架无关的逻辑，才适合沉淀到这个包里。

## 当前状态

`apps/web` 现在已经直接使用这里的 timeline、变量快照、流式 reducer、工具事件分组和错误映射逻辑来支撑 inspector、重放确认和管理界面。Memory V2 的条目、任务和 scope 数据目前保持在 SDK 资源层暴露。后续会继续按这个原则扩展，但不会引入框架绑定层。
