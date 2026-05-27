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
- 提供 client-data 的通用语义 helper
- 提供 Project Event 的 cursor 与去重 helper

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

## 当前轮次说明

本轮没有新增 `@tavern/client-helpers` 对 Prompt Runtime 结构化记忆字段的专用 helper。当前同步主要集中在 `@tavern/sdk` 的 preview / inspect / dry-run 返回面与文档口径。

## 当前导出

| 函数 | 用途 |
| ---- | ---- |
| `resolveUsage` | 把各种格式的 usage 归一化成统一结构 |
| `buildTimelineMessages` | 把楼层数据平展成时间线消息列表 |
| `createInitialRespondStreamState` | 创建流式生成的初始状态 |
| `reduceRespondStream` | 根据 SSE 事件累积流式状态，并在 `done` 到达后保留 `result.promptSnapshot` / `result.runtimeTrace` |
| `groupToolEventsByExecution` | 把同一次工具执行的流式事件整理成历史组 |
| `getDisplayPage` | 优先使用运行中的候选输出，否则回退到 active page |
| `getActivePage` | 从楼层中选出当前活动页 |
| `flattenVariableSnapshot` | 把 resolved variable snapshot 整理成 inspector 可用行 |
| `flattenPageStagedVariableWrites` | 把 page staged write ledger 整理成 inspector 可用行 |
| `groupVariablePromotionTrace` | 把 page variable promotion trace 按 key 分组 |
| `sortVariableInspectorRows` | 对变量 inspector 行做稳定排序 |
| `formatVariablePreview` | 把变量值格式化成适合界面展示的预览字符串 |
| `mapApiErrorToUiState` | 把 API 错误转换成界面可用的错误状态 |
| `summarizeRuntimeToolCatalog` | 把会话级运行时工具目录整理成摘要信息 |
| `isProjectEvent` | 判断一个值是否是 SDK 归一化后的 Project Event |
| `getProjectEventCursor` | 从单个 Project Event 读取 sequence cursor |
| `dedupeProjectEvents` | 按 Project 和 sequence 对 Project Event 列表去重 |
| `applyProjectEventCursor` | 根据上一个 cursor 和新事件计算新的 cursor |
| `buildPluginOwner` | 构造 plugin owner 标识 |
| `buildApplicationOwner` | 构造 application owner 标识 |
| `groupItemsByCollection` | 把 client-data item 按 collection 分组 |
| `organizeCollectionItems` | 把 collection 下的 item 整理为键值映射 |
| `toClientDataMap` | 把 item 列表转换成适合界面消费的嵌套 map |
| `resolveItemByPath` | 按 `collectionName + itemKey` 解析单个 client-data item |

其中 `summarizeRuntimeToolCatalog` 只汇总 `/sessions/:id/tools/runtime` 返回的
### Project Event helpers

这组 helper 只处理已经由 SDK 归一化后的 Project Event，不发请求，也不绑定任何框架。

```ts
import {
  applyProjectEventCursor,
  dedupeProjectEvents,
  getProjectEventCursor,
  isProjectEvent,
} from "@tavern/client-helpers";

const events = await client.projects.listEvents({
  projectId: "proj-1",
  after: 0,
});

const visibleEvents = dedupeProjectEvents(events.items);
let cursor = events.nextAfter;

await client.projects.streamEvents({
  projectId: "proj-1",
  lastEventId: cursor ?? undefined,
  onEvent(event) {
    if (!isProjectEvent(event)) return;
    cursor = applyProjectEventCursor(cursor, event);
    const eventCursor = getProjectEventCursor(event);
    console.log(eventCursor, event.type);
  },
});
```

说明：

- `isProjectEvent(value)`：判断一个值是否是 SDK 中的 `ProjectEventRecord`。
- `getProjectEventCursor(event)`：返回事件的 `sequence`，非法值返回 `null`。
- `dedupeProjectEvents(events)`：按 `projectId + sequence` 去重，保留第一次出现的事件。
- `applyProjectEventCursor(previousCursor, event)`：返回两者中更大的 cursor。事件无效时保留上一个 cursor。


**session 级** 运行时工具目录。
它不展开未来 run / node / step overlay。

## 用法

### Client Data helpers

#### 构造 owner

```ts
import { buildApplicationOwner, buildPluginOwner } from "@tavern/client-helpers";

const appOwner = buildApplicationOwner("my-app");
const pluginOwner = buildPluginOwner("chat-annotator");
```

返回结果：

```ts
// { ownerType: "application", ownerId: "my-app" }
// { ownerType: "plugin", ownerId: "chat-annotator" }
```

这组 helper 适合用于：

- 创建 client-data domain
- 统一应用层 owner 结构
- 构造 SDK `callerOwner` 参数或 caller owner 头

#### 按 collection 分组

```ts
import { groupItemsByCollection, organizeCollectionItems, toClientDataMap } from "@tavern/client-helpers";

const grouped = groupItemsByCollection(items);
const settingsMap = organizeCollectionItems(items.filter((item) => item.collectionId === "col-1"));
const nestedMap = toClientDataMap(items, collections);
```

说明：

- `groupItemsByCollection(items)`：按 collection 归类，便于列表页或 inspector 页展示
- `organizeCollectionItems(items)`：把单个 collection 内的 item 列表转成 `itemKey -> valueJson`
- `toClientDataMap(items, collections?)`：把多 collection 的 item 列表整理成 `collectionName -> itemKey -> valueJson`

#### 通过路径读取单项数据

```ts
import { resolveItemByPath } from "@tavern/client-helpers";

const item = await resolveItemByPath(client, "domain-1", "settings", "theme.dark", {
  accountId: "account-1",
});

console.log(item?.valueJson);
```

这个 helper 内部会调用：

- `client.clientData.items.getByKey(...)`

适合把常见的：

- domainId
- collectionName
- itemKey

这一组三段路径直接收敛成一次读取动作。

### Variables inspect helpers

```ts
import {
  flattenPageStagedVariableWrites,
  flattenVariableSnapshot,
  groupVariablePromotionTrace,
} from "@tavern/client-helpers";

const resolvedRows = flattenVariableSnapshot(resolvedSnapshot);
const stagedRows = flattenPageStagedVariableWrites(stagedSnapshot);
const promotionGroups = groupVariablePromotionTrace(promotionSnapshot);
```

这组 helper 的边界是：

- `flattenVariableSnapshot(...)` 只处理 durable resolve snapshot
- `flattenPageStagedVariableWrites(...)` 只处理 page staged ledger
- `groupVariablePromotionTrace(...)` 只处理 page promotion trace
- 它们不会把三种观察面混成一份数据

## 设计边界

适合放进来的：

- 纯函数形式的语义整理
- 时间线构建
- 流式 reducer
- 错误状态映射
- 与框架无关的 selector
- 与 client-data 读取路径、分组、映射有关的通用 helper

不适合放进来的：

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

`apps/web` 现在已经直接使用这里的 timeline、变量快照、流式 reducer、工具事件分组和错误映射逻辑来支撑 inspector、重放确认和管理界面。Client Data 第二期已经补入 owner 构造、按 collection 分组、嵌套映射和路径读取 helper。Memory V2 的条目、任务、scope 数据，以及 Prompt Runtime 的结构化 `memory` 真相目前都保持在 SDK 返回面直接暴露。当前没有单独 helper，因为 preview / inspect / historical explain 的 `memory` 对象已经是稳定的只读结构。后续会继续按这个原则扩展，但不会引入框架绑定层。
