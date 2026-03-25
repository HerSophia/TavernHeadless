# @tavern/client-helpers

TavernHeadless 官方接入语义层。

这个包建立在 `@tavern/sdk` 之上，用来整理接入侧的常用领域语义。

它的职责是：

- 统一 usage 归一化
- 构建时间线展示模型
- 累积流式生成状态
- 选择 active page
- 把 API 错误映射成更适合界面消费的状态

它不负责：

- 发起 HTTP 请求
- 依赖 `fetch`
- 依赖 Vue / React / Pinia
- 提供组件、hooks、composables

## 安装和依赖

本包目前作为 monorepo 内部官方包使用：

```json
{
  "dependencies": {
    "@tavern/client-helpers": "workspace:*"
  }
}
```

本包依赖 `@tavern/sdk`。

## 当前导出

当前已经提供这些函数：

- `resolveUsage`
- `buildTimelineMessages`
- `createInitialRespondStreamState`
- `reduceRespondStream`
- `getActivePage`
- `mapApiErrorToUiState`

## 用法示例

### usage 归一化

```ts
import { resolveUsage } from "@tavern/client-helpers";

const usage = resolveUsage({
  prompt_tokens: 12,
  completion_tokens: 8,
});

console.log(usage.inputTokens);
console.log(usage.outputTokens);
console.log(usage.totalTokens);
```

### 构建时间线

```ts
import { buildTimelineMessages } from "@tavern/client-helpers";

const viewMessages = buildTimelineMessages(timeline.floors);
```

### 累积流式状态

```ts
import {
  createInitialRespondStreamState,
  reduceRespondStream,
} from "@tavern/client-helpers";

let state = createInitialRespondStreamState();

for (const event of events) {
  state = reduceRespondStream(state, event);
}
```

### 选择 active page

```ts
import { getActivePage } from "@tavern/client-helpers";

const page = getActivePage({
  activePage: floor.activePage,
  pages: floor.pages,
});
```

### 错误映射

```ts
import { mapApiErrorToUiState } from "@tavern/client-helpers";

try {
  await client.sessions.respond({
    sessionId: "missing",
    message: "hello",
  });
} catch (error) {
  const uiError = mapApiErrorToUiState(error);
  console.log(uiError.kind);
  console.log(uiError.retryable);
}
```

## 设计边界

适合放进本包的内容：

- 纯函数形式的语义整理
- 时间线构建
- 流式 reducer
- 错误展示状态映射
- 与框架无关的 selector

不适合放进本包的内容：

- HTTP 请求
- DOM 操作
- Vue 响应式对象
- React state
- Pinia / Zustand / TanStack Query 绑定

## 与应用层的关系

`apps/web` 可以继续保留这些内容在应用层：

- 页面和组件交互逻辑
- 表单状态
- 本地菜单行为
- 只在一个界面里使用的临时映射

只有已经稳定、可复用、与具体框架无关的逻辑，才适合继续沉淀到本包。

## 当前状态

当前包已经开始替换 `apps/web` 中的 timeline 和流式状态整理逻辑。

后续会继续按这个原则扩展，但不会引入框架绑定层。
