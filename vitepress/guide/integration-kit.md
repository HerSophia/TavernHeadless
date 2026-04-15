---
outline: [2, 3]
---

# 官方集成层

TavernHeadless 提供了一套官方维护的第一方接入层，用来统一前端、桌面客户端、脚本和其他消费方的接入方式。

当前只有两个包：

- `@tavern/sdk` —— 基础层，负责和后端打交道
- `@tavern/client-helpers` —— 语义层，负责把数据整理成前端好用的形态

合在一起就是 TavernHeadless Official Integration Kit。

## 为什么要有这层

后端 API 可以直接调，但接入方通常会重复写这些东西：

- 请求封装和账号头注入
- SSE 解析
- 错误处理
- 时间线整理
- usage 归一化
- 流式生成的中间状态累积
- Tool Calling 和 MCP 的接入包装
- Client Data 的 owner / key-path / collection 分组语义

如果这些逻辑散落在每个前端里，接入方式会越来越分散，行为也会不一致。

官方集成层把这些已经稳定、已经重复出现、属于接入层的问题收拢住，统一提供。

## 两个包的边界

### `@tavern/sdk`

基础层。

| 负责 | 不负责 |
| ---- | ---- |
| HTTP API 调用 | 时间线视图整理 |
| 默认请求头注入 | active page 选择 |
| 统一错误对象 | store 状态管理 |
| SSE 读取与解析 | hooks、composables、组件 |
| 资源方法 | Vue / React / Pinia 绑定 |
| 保留底层请求能力 | |

### `@tavern/client-helpers`

语义层。

| 负责 | 不负责 |
| ---- | ---- |
| usage 归一化 | 发请求 |
| 时间线构建 | 依赖 `fetch` |
| 流式状态 reducer | 依赖 Vue / React / Pinia |
| active page 选择 | |
| API 错误到界面状态的映射 | |
| client-data owner / map / 路径读取辅助 | |

### `@tavern/shared`

`@tavern/shared` 是内部包，仓库内部可以复用，但不属于公开接入面。

## 建议的使用顺序

1. 用 `@tavern/sdk` 读取或写入资源
2. 用 `@tavern/client-helpers` 整理数据
3. 在应用层接入 store、组件、页面

## 基本示例

### 创建客户端

```ts
import { createTavernClient } from "@tavern/sdk";

const client = createTavernClient({
  baseUrl: "http://localhost:3000",
});
```

如果后端开启了认证，可以通过 `getHeaders` 注入：

```ts
const client = createTavernClient({
  baseUrl: "http://localhost:3000",
  getHeaders: () => ({
    authorization: "Bearer <token>",
  }),
});
```

如果服务端启用了多账号：

- `AUTH_MODE=jwt` 时，应当使用已经带有目标账号 claim 的 JWT；默认 claim 字段名是 `account_id`，可由服务端通过 `AUTH_JWT_ACCOUNT_CLAIM` 改名
- `AUTH_MODE=api_key` 时，应当由服务端通过 `AUTH_API_KEY_ACCOUNTS` 把 API Key 绑定到账号
- SDK 各资源方法里的 `accountId` 参数，以及 `buildAccountHeaders()` 生成的 `x-account-id`，都只是兼容头提示，不能替代服务端认证，也不会直接切换账号

### Client Data 第二期接入

如果接入方要启用插件级 caller owner 隔离，需要在默认请求头中加入：

```ts
const client = createTavernClient({
  baseUrl: "http://localhost:3000",
  getHeaders: () => ({
    authorization: "Bearer <token>",
    "x-client-owner-type": "plugin",
    "x-client-owner-id": "chat-annotator",
  }),
});
```

说明：

- 未提供 caller owner 头时，服务端保持第一期兼容模式
- 提供非法 caller owner 头时，服务端返回 `400 client_data_caller_owner_invalid`
- grant / audit 管理路由要求 caller owner 必须是 domain owner

### 调用 Client Data 资源

```ts
const domain = await client.clientData.domains.create({
  accountId: "account-1",
  ownerType: "application",
  ownerId: "my-app",
  domainName: "preferences",
});

await client.clientData.domains.updateQuota({
  accountId: "account-1",
  domainId: domain.id,
  quotaMaxEntries: 20000,
  quotaMaxBytes: 20971520,
});

const imported = await client.clientData.domains.importAsNew({
  accountId: "account-1",
  conflictPolicy: "fail",
  payload: {
    domain: {
      ownerType: "application",
      ownerId: "my-app",
      domainName: "preferences-copy",
    },
    collections: [],
  },
});

const item = await client.clientData.items.getByKey({
  accountId: "account-1",
  domainId: imported.domain.id,
  collectionName: "settings",
  itemKey: "theme.dark",
});
```

### Client Data helper 用法

```ts
import {
  buildPluginOwner,
  groupItemsByCollection,
  resolveItemByPath,
  toClientDataMap,
} from "@tavern/client-helpers";

const owner = buildPluginOwner("chat-annotator");
const grouped = groupItemsByCollection(items);
const nested = toClientDataMap(items, collections);
const resolved = await resolveItemByPath(client, domainId, "settings", "theme.dark", {
  accountId: "account-1",
});
```

## SDK 资源覆盖范围

目前 `@tavern/sdk` 已覆盖这些资源：

| 分类 | 资源 |
| ---- | ---- |
| 会话与内容结构 | `health`、`sessions`、`messages`、`floors`、`pages`、`branches` |
| 提示词运行时高级资源 | `promptRuntime` |
| 角色、资料与配置 | `characters`、`users`、`presets`、`presetEntries`、`worldbooks`、`worldbookEntries`、`regexProfiles` |
| 导入、导出与模型 | `imports`、`exports`、`chatTransferJobs`、`llmProfiles`、`llmInstances` |
| 账号、变量与记忆 | `accounts`、`variables`、`memories`、`memoryEdges`、`memoryJobs`、`memoryScopes` |
| 工具与运行集成 | `tools`、`mcp` |
| 高级客户端数据系统 | `clientData` |

## 记忆 scope 约定

`memories`、`memoryJobs`、`memoryScopes` 现在都接受 `global`、`chat`、`branch`、`floor` 四种记忆作用域。

其中：

- 主聊天链默认使用 `branch` scope。
- `chat` scope 只表示显式的 session 级共享记忆。
- `branch` scope 的 `scopeId` 需要使用 `JSON.stringify([sessionId, branchId])` 构造。

## Prompt Runtime preview 示例

```ts
const preview = await client.promptRuntime.previewText({
  accountId: "account-1",
  sessionId: "session-1",
  branchId: "main",
  text: "{{setvar::资产.金币::3}}{{getvar::资产}}",
  budget: {
    maxInputTokens: 4096,
    reservedCompletionTokens: 1024,
  },
  sourceSelection: {
    history: { mode: "windowed", maxMessages: 24 },
    examples: { enabled: false },
  },
  visibility: {
    mode: "allow_all_except_hidden",
    hiddenFloorRanges: [{ startFloorNo: 1, endFloorNo: 2 }],
  },
});

console.log(preview.policy.budget);
console.log(preview.text);
console.log(preview.runtimeTrace.sourceSelection?.excludedSources);
console.log(preview.runtimeTrace.visibility?.filteredFloorNos);
console.log(preview.runtimeTrace.macro?.mutationPreview);
console.log(preview.runtimeTrace.macro?.stagedMutations); // []
```

这个方法只做单段文本 preview。它不会调用 LLM，不会创建 floor，也不会写 `promptSnapshot`。当前 request 级 `structure` / `delivery` / `budget` / `sourceSelection` / `visibility` 覆盖会进入返回结果里的 `policy` 与 `sourceMap`，但返回的 `runtimeTrace` 只投影 `macro`、`sourceSelection`、`visibility`。宏诊断继续统一走 `runtimeTrace.macro`。

## Prompt Runtime governance / explain / compare 示例

```ts
const policy = await client.promptRuntime.patchPolicy({
  accountId: "account-1",
  sessionId: "session-1",
  budget: {
    maxInputTokens: 4096,
    reservedCompletionTokens: 1024,
  },
  sourceSelection: {
    history: { mode: "windowed", maxMessages: 24 },
    examples: { enabled: false },
  },
});

const explain = await client.promptRuntime.getFloorExplain({
  accountId: "account-1",
  floorId: "floor-12",
});

const diff = await client.promptRuntime.compare({
  accountId: "account-1",
  sessionId: "session-1",
  leftFloorId: "floor-11",
  rightFloorId: "floor-12",
});

console.log(policy.persistentPolicyEnvelope?.version);
console.log(policy.persistentPolicyEnvelope?.updatedAt);
console.log(policy.persistentPolicyEnvelope?.updatedBy);
console.log(policy.persistentPolicyEnvelope?.value.budget);

console.log(explain.snapshotAvailable);
console.log(explain.assets);
console.log(explain.sectionStats);
console.log(explain.resolvedPolicy);

console.log(diff.left.snapshotAvailable, diff.right.snapshotAvailable);
console.log(diff.policyChanges);
```

- `patchPolicy(...)` 和 `patchBranchPolicy(...)` 现在都支持 `structure`、`delivery`、`budget`、`sourceSelection`。
- 写入后的持久化策略会带 envelope 元数据：`version`、`updatedAt`、`updatedBy`、`value`。
- `getFloorExplain(...)` 只读取 committed floor 的持久化真相。`snapshotAvailable = true` 表示响应来自 committed explain snapshot；`false` 表示旧楼层 fallback，此时 `assets`、`resolvedPolicy`、`sectionStats` 等可能为 `null`。
- `compare(...)` 只支持同一 session 内的两个 committed floor，且只返回结构化 path/value diff；不会做 explain recompute。

当前 `@tavern/client-helpers` 没有为 historical explain 或 compare 增加专用 helper。原因很简单：这两份响应已经是稳定的只读对象，当前没有额外的跨框架语义整理需求。接入方直接使用 SDK 返回值即可。

<a id="assembly提示词组装的运行结果"></a>

## assembly：提示词组装的运行结果

`respondDryRun(...)` 返回的 `assembly` 可以理解为 dry-run 的兼容摘要面。SDK 现在同时导出：

- `PromptAssemblyCompat`
- `RespondDryRunAssembly`（兼容别名）

如果同一事实已经在 `runtimeTrace` 中以更结构化的形式出现，建议优先读取 `runtimeTrace`。`assembly` 继续保留，主要是为了让既有 dry-run 调试面和 preset 兼容说明保持稳定。

常见对应关系如下：

| `assembly` 字段 | 优先读取的 `runtimeTrace` | 说明 |
| ---- | ---- | ---- |
| `assistantPrefillApplied` / `assistantPrefillStrategy` | `runtimeTrace.delivery` | assistant prefill 是否真正落到最终发送消息 |
| `regexPreRules` / `regexPostRules` / `preprocessedUserMessage` | `runtimeTrace.regex` | 正则执行结果与预处理后的用户消息 |
| `worldbookHits` / `worldbookMatches` | `runtimeTrace.worldbook` | 世界书命中数量与详情 |
| `memorySummaryInjected` | `runtimeTrace.memory.summaryInjected` | 记忆摘要是否注入 |
| `selectedPromptOrderCharacterId` / `ignoredPromptOrderCharacterIds` / `continueNudgeApplied` / `continueNudgeText` / `namesBehaviorApplied` | `runtimeTrace.preset` | 预设运行事实与降级说明 |

同时要区分两类名字：

- `runtimeTrace.budgets.byGroup[].group` 与 `runtimeTrace.budgets.trimReasons[].group` 是 budget group 标签，可以出现具体 section 标签，例如 `section:main`
- `capabilities.sourceSelection.supportedSources` 与 `runtimeTrace.sourceSelection.excludedSources[].source` 仍只使用公开 source kind：`history`、`memory`、`worldbook`、`examples`

下面这些字段仍主要留在 `assembly`：

- `mode`
- `promptIntent`
- `unsupportedPresetFields`
- `ignoredPresetFields`
- `unresolvedPresetMarkers`
- `presetWarnings`


## `@tavern/client-helpers` 当前导出

| 函数 | 用途 |
| ---- | ---- |
| `resolveUsage` | usage 归一化 |
| `buildTimelineMessages` | 楼层数据 → 时间线消息列表 |
| `createInitialRespondStreamState` | 流式状态初始值 |
| `reduceRespondStream` | SSE 事件 → 流式状态累积 |
| `getDisplayPage` | 优先使用运行中的候选输出，否则回退到 active page |
| `groupToolEventsByExecution` | 工具流式事件 → 执行历史分组 |
| `getActivePage` | 从楼层取真实持久化 active page |
| `flattenVariableSnapshot` | resolved variable snapshot → inspector 行 |
| `sortVariableInspectorRows` | 变量 inspector 行稳定排序 |
| `formatVariablePreview` | 变量值 → 展示预览字符串 |
| `mapApiErrorToUiState` | API 错误 → 界面错误状态 |
| `summarizeRuntimeToolCatalog` | 会话级运行时工具目录 → 摘要 |
| `buildPluginOwner` | 构造 plugin owner |
| `buildApplicationOwner` | 构造 application owner |
| `groupItemsByCollection` | client-data item 按 collection 分组 |
| `organizeCollectionItems` | collection 内 item 整理 |
| `toClientDataMap` | item 列表转嵌套 map |
| `resolveItemByPath` | 按 `collectionName + itemKey` 直接读取单项数据 |

## 文档同步规则

如果改动影响以下任意一项，应同步检查官方包与文档：

- 后端 API 资源契约
- SSE 事件结构
- OpenAPI 输出
- SDK 资源覆盖范围
- helper 导出范围
- Client Data 的 owner / grant / audit 语义

至少同步更新：

- `packages/official-integration-kit/sdk/README.md`
- `packages/official-integration-kit/client-helpers/README.md`
- `vitepress/guide/integration-kit.md`
- `vitepress/reference/api.md`
- 对应资源参考页
