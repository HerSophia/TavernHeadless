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
- Project Event 的读取、SSE 订阅、cursor 和去重处理
- Project Derived Output 与 Project Inbox 的资源包装

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
| Project Event、Derived Output 和 Inbox 资源包装 | Project CRUD 管理界面 |
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
| Project Event cursor 与去重辅助 | |

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

### 创建会话和 Project 兼容字段

`client.sessions.create(...)` 对应 `POST /sessions`。普通客户端不需要传 Workspace 或 Project。

```ts
const session = await client.sessions.create({
  accountId: "account-1",
  title: "Campfire",
  characterId: "char-1",
  userId: "user-1",
  presetId: "preset-1",
});
```

如果调用方已经知道目标 Project，可以传 `projectId`。SDK 会把它写成 REST 请求体里的 `project_id`：

```ts
const sessionInProject = await client.sessions.create({
  accountId: "account-1",
  projectId: "proj-1",
  title: "Project Session",
});
```

### 读取 Project 和订阅 Project Event

阶段三已经开放 Project 的读取面、Project Event 查询 / SSE、observer / deriver 成员维护、Derived Output 和 Project Inbox。普通聊天客户端可以继续忽略这组能力；需要跨会话协作或外部派生结果时再使用。

```ts
const scope = await client.sessions.getScope({
  accountId: "account-1",
  sessionId: "session-1",
});

const events = await client.projects.listEvents({
  accountId: "account-1",
  projectId: scope.projectId,
  after: 0,
  types: ["session.created", "message.updated"],
});

let cursor = events.nextAfter;

await client.projects.streamEvents({
  accountId: "account-1",
  projectId: scope.projectId,
  lastEventId: cursor ?? undefined,
  onEvent(event) {
    cursor = event.sequence;
  },
});
```

如果你需要整理事件列表，可以使用 `@tavern/client-helpers`：

```ts
import { applyProjectEventCursor, dedupeProjectEvents } from "@tavern/client-helpers";

const merged = dedupeProjectEvents([...events.items]);
const nextCursor = merged.reduce<number | null>(
  (previous, event) => applyProjectEventCursor(previous, event),
  cursor,
);
```

权限规则：owner 可以读写 Project 下资源；observer 只能读取可读资源；deriver 可以写入 Derived Output、创建 Inbox 条目，但不能修改主 Session、Variable、Memory 或 Session State。非成员会按旧账号隔离规则隐藏资源。Project API 通常返回 `404 project_not_found`，旧资源路由通常返回 `404 not_found`。

成员维护现在支持 observer 和 deriver：

```ts
await client.projects.addObserver({
  accountId: "account-1",
  projectId: "proj-1",
  observerAccountId: "account-2",
});

await client.projects.addMember(
  "proj-1",
  { accountId: "account-3", role: "deriver" },
  { accountId: "account-1" },
);

await client.projects.addDeriver("proj-1", "account-3", {
  accountId: "account-1",
});

// 把一个 Client 加入 Project：subject_type = client
await client.projects.addMember(
  "proj-1",
  { subjectType: "client", subjectId: "cli_world_sim", role: "deriver" },
  { accountId: "account-1" },
);
```

`@tavern/sdk` 在 `client.clients` 暴露 Client 管理与 API Key 管理。Client API Key 通过 `X-Tavern-Client-Key` 或 `Authorization: Bearer tvk_live_...` 调用任意 API；认证失败统一返回 401 `client_api_key_invalid`，不区分原因。

Derived Output 用来保存 Project 范围内的派生 JSON 结果，不会自动合并进主 Session：

```ts
const output = await client.projects.derivedOutputs.create(
  "proj-1",
  {
    domain: "summary.candidate",
    sourceSessionId: "session-1",
    value: { summary: "候选摘要。" },
    status: "draft",
  },
  { accountId: "account-3" },
);

await client.projects.derivedOutputs.update(
  "proj-1",
  output.id,
  { status: "published" },
  { accountId: "account-3" },
);
```

Project Inbox 用来提交待 owner 决策的建议。接受条目只记录 Inbox 状态，不会自动修改主 Session：

```ts
const inboxItem = await client.projects.inbox.create(
  "proj-1",
  {
    type: "derived_output.review",
    payload: { derivedOutputId: output.id },
    sourceSessionId: "session-1",
  },
  { accountId: "account-3" },
);

await client.projects.inbox.accept("proj-1", inboxItem.id, {
  accountId: "account-1",
  note: "已确认。",
});
```

Phase 3 相关写入会产生 Project Event：

| 资源 | 事件类型 |
| ---- | ---- |
| Derived Output | `derived_output.created`、`derived_output.updated`、`derived_output.archived` |
| Project Inbox | `project_inbox.item.created`、`project_inbox.item.accepted`、`project_inbox.item.rejected`、`project_inbox.item.archived` |

这些事件的 `payload` 只包含 ID、状态、类型、来源引用和小型元数据，不包含完整 `value` 或 `payload` JSON 正文。

省略 `projectId` 时，服务端会使用当前账号默认 Workspace，并为新 Session 创建 `session_default` Project。

### Client Data 第二期接入

如果接入方要启用插件级 caller owner 隔离，优先建议在单次 domain-scoped 调用上显式传 `callerOwner`：

```ts
const pluginOwner = { ownerType: "plugin", ownerId: "chat-annotator" } as const;

await client.clientData.items.getByKey({
  accountId: "account-1",
  domainId: "domain-1",
  callerOwner: pluginOwner,
  collectionName: "settings",
  itemKey: "theme.dark",
});
```

如果整个客户端都固定代表同一个 owner，也可以在默认请求头中加入：

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

- `callerOwner` 参数和默认头最终都会落到 `X-Client-Owner-Type` 与 `X-Client-Owner-Id`
- 未提供 caller owner 头时，服务端保持第一期兼容模式
- 提供非法 caller owner 头时，服务端返回 `400 client_data_caller_owner_invalid`
- grant / audit 管理路由要求 caller owner 必须是 domain owner
- 如果服务端把某个 domain 标记为 managed domain，raw `/client-data` 写路径会返回 `403 client_data_managed_domain_raw_access_forbidden`

### 调用 Client Data 资源

```ts
const domainOwner = { ownerType: "application", ownerId: "my-app" } as const;
const pluginOwner = { ownerType: "plugin", ownerId: "chat-annotator" } as const;

const domain = await client.clientData.domains.create({
  accountId: "account-1",
  ...domainOwner,
  domainName: "preferences",
});

await client.clientData.domains.updateQuota({
  accountId: "account-1",
  domainId: domain.id,
  quotaMaxEntries: 20000,
  quotaMaxBytes: 20971520,
});

const grant = await client.clientData.grants.create({
  accountId: "account-1",
  callerOwner: domainOwner,
  domainId: domain.id,
  granteeOwnerType: pluginOwner.ownerType,
  granteeOwnerId: pluginOwner.ownerId,
  canRead: true,
  canWrite: false,
  canDelete: false,
  canList: true,
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
  callerOwner: pluginOwner,
  domainId: imported.domain.id,
  collectionName: "settings",
  itemKey: "theme.dark",
});

const auditLogs = await client.clientData.auditLogs.list({
  accountId: "account-1",
  callerOwner: domainOwner,
  domainId: imported.domain.id,
  limit: 20,
});

console.log(grant.canRead);
console.log(item?.valueJson);
console.log(auditLogs.data[0]?.action);
```

这里的 `clientData` 资源仍然对应 raw `/client-data`。如果后端把某个底层 domain 标记为 managed domain，接入方需要改走对应的受治理服务，而不是继续直接写 raw `clientData`。

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

## Variables 的接入建议

变量相关的官方接入建议分成三层：

1. 用 `client.variables.resolveContext(...)` 读取 durable truth
2. 用 `client.variables.getPageStagedWrites(...)` 读取页级候选写入
3. 用 `client.variables.getPagePromotions(...)` 读取 durable promotion 轨迹

如果你需要把这些数据整理成 inspector 视图，再交给 `@tavern/client-helpers`：

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

这里要注意两点：

- `resolveContext(...)` 仍然是 durable-only
- staged / promotion inspect 是额外观察面，不是 `resolveContext(...)` 的扩展字段

## SDK 资源覆盖范围

目前 `@tavern/sdk` 已覆盖这些资源：

| 分类 | 资源 |
| ---- | ---- |
| 会话与内容结构 | `health`、`sessions`、`messages`、`floors`、`pages`、`branches` |
| 提示词运行时高级资源 | `promptRuntime` |
| 角色、资料与配置 | `characters`、`users`、`presets`、`presetEntries`、`worldbooks`、`worldbookEntries`、`regexProfiles` |
| 导入、导出、备份与模型 | `imports`、`exports`、`backup`、`backupJobs`、`chatTransferJobs`、`llmProfiles`、`llmInstances` |
| 账号、变量与记忆 | `accounts`、`variables`、`memories`、`memoryEdges`、`memoryJobs`、`memoryScopes` |
| 工具与运行集成 | `tools`、`mcp` |
| Project 协作 | `projects`、`projects.derivedOutputs`、`projects.inbox` |
| 高级客户端数据系统 | `clientData`、`sessionState` |

Backup 资源支持核心资产导出和恢复作业。导出时可以通过 `includeVcTags` 保留 VC Tag，并通过 `includeOperationLogs: "referenced" | "selected_scope"` 选择是否导出相关 Operation Log。

其中 `backup` 与 `backupJobs` 对应核心资产备份 v1：

- `backup.createExportJob(...)`
- `backup.previewRestore(...)`
- `backup.createRestoreJob(...)`
- `backupJobs.list(...)` / `getDetail(...)` / `cancel(...)` / `retry(...)` / `downloadFile(...)`

`.thbackup` 文件本身继续使用 `snake_case` 契约。SDK 返回值仍按既有约定映射为 `camelCase`。

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
console.log(preview.memory?.runtimeMode);
console.log(preview.memory?.scopeResolution);
console.log(preview.runtimeTrace.visibility?.filteredFloorNos);
console.log(preview.runtimeTrace.macro?.mutationPreview);
console.log(preview.runtimeTrace.macro?.stagedMutations); // []
```

这个方法正式契约是 `macro_text_preview`，对应 `capabilities.observability.preview.mode === "macro_text_preview"` 且 `returnsAssemblyTruth === false`。它不会调用 LLM，不会创建 floor，也不会写 `promptSnapshot`，同时也不会执行 prompt assembly、budget allocation 或 delivery materialization。当前 request 级 `structure` / `delivery` / `budget` / `sourceSelection` / `visibility` 覆盖会进入返回结果里的 `policy` 与 `sourceMap`，但返回的 `runtimeTrace` 固定只投影 `capabilities.observability.preview.traceSubset`，即 `macro`、`sourceSelection`、`visibility`。宏诊断继续统一走 `runtimeTrace.macro`；响应的 `limitations` 会额外说明 preview 只是 `macro_text_preview` 子视图，便于 UI 上与 live / dry-run 区分。

## Prompt Runtime inspect 示例

```ts
const inspect = await client.promptRuntime.inspect({
  accountId: "account-1",
  sessionId: "session-1",
  message: "Please continue the campfire scene.",
  branchId: "alt-branch",
  sourceFloorId: "floor-12",
  promptIntent: "continue",
  generationParams: {
    maxOutputTokens: 256,
    temperature: 0.7,
  },
  sessionStateWrites: [
    {
      namespace: "quest_flags",
      slot: "companion",
      value: { mood: "ally" },
    },
  ],
});

console.log(inspect.preparedTurn.messages);
console.log(inspect.preparedTurn.promptSnapshot?.promptDigest);
console.log(inspect.preparedTurn.memorySummary);
console.log(inspect.preparedTurn.memory);
console.log(inspect.preparedTurn.runtimeTrace?.memory);
console.log(inspect.preparedTurn.runtimeTrace?.budgets?.byGroup);
console.log(inspect.preparedTurn.sessionStateWrites);
console.log(inspect.governance.entries);
console.log(inspect.governance.mismatches);
```

`inspect(...)` 是只读 prepared-turn 检查接口。它会准备完整 prompt turn，并返回 `preparedTurn`、`policy`、`sourceMap`、`governance`、`diagnostics`、`trimReasons`、`excludedSources`、`sectionStats`，以及与兼容 `memorySummary` 并存的结构化 `preparedTurn.memory`。但它不会调用模型，也不会创建 floor、写 `promptSnapshot`、写 explain snapshot，或者提交任何副作用。对应能力位是 `capabilities.observability.inspect.mode === "prepared_turn"`。

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

const inspect = await client.promptRuntime.inspect({
  accountId: "account-1",
  sessionId: "session-1",
  message: "Please continue the campfire scene.",
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
console.log(explain.memory); // 旧 snapshot 或更早 explain 行可能为 null
console.log(explain.governance); // 旧 snapshot 可能为 null
console.log(explain.resolvedPolicy);

console.log(inspect.preparedTurn.messages);
console.log(inspect.governance.entries);
console.log(diff.left.snapshotAvailable, diff.right.snapshotAvailable);
console.log(diff.policyChanges);
console.log(diff.governanceChanges);
```

- `patchPolicy(...)` 和 `patchBranchPolicy(...)` 现在都支持 `structure`、`delivery`、`budget`、`sourceSelection`。
- 写入后的持久化策略会带 envelope 元数据：`version`、`updatedAt`、`updatedBy`、`value`。
- `getFloorExplain(...)` 只读取 committed floor 的持久化真相，对应 `capabilities.observability.explain.persistedTruthOnly === true`。snapshot-backed 路径会附带"只读持久化真相"声明；`snapshotAvailable = true` 表示响应来自 committed explain snapshot，`false` 表示旧楼层 fallback，此时 limitations 会在通用只读声明基础上额外追加"老 floor 字段可能为 null"的 fallback 条目，`assets`、`resolvedPolicy`、`sectionStats` 等也可能为 `null`。
- `previewText(...)` 会在顶层 `memory` 字段里返回结构化记忆真相；它不会把这部分真相塞进 `runtimeTrace`，因为 preview trace 仍固定只保留 `macro`、`sourceSelection`、`visibility` 三个子字段。
- `inspect(...).preparedTurn.memorySummary` 继续保留兼容摘要字符串；`inspect(...).preparedTurn.memory` 与 `getFloorExplain(...).memory` 是新的结构化真相对象。较旧的 explain snapshot 行可能返回 `null`。
- `compare(...)` 只支持同一 session 内的两个 committed floor，且只返回结构化 path/value diff；不会做 explain recompute。

当前 `@tavern/client-helpers` 没有为 historical explain、compare 或 Prompt Runtime 结构化 `memory` 对象增加专用 helper。原因很简单：这些响应已经是稳定的只读对象，当前没有额外的跨框架语义整理需求。接入方直接使用 SDK 返回值即可。

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

对于 regex，SDK 现在还会继续解析 `runtimeTrace.regex.phases`、`runtimeTrace.regex.reservedPlacements` 和 `runtimeTrace.regex.substitutionMode`。

- `phases` 用来表达每个 regex phase 的真实执行、跳过或 reserved 状态。
- `reservedPlacements` 用来表达当前仅保留、不执行的 placement，例如 `WORLD_INFO`。
- `substitutionMode` 用来表达当前 regex substitute 的正式语义边界。

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
| `applyProjectEventCursor` | 从 Project Event 推进 cursor |
| `dedupeProjectEvents` | Project Event 列表去重 |
| `getProjectEventCursor` | 读取单个 Project Event 的 cursor |
| `isProjectEvent` | 判断一个值是否是 Project Event |

## Session State 的公开接口已进入官方包

`/sessions/:id/state/*` 是 Session State 的公开受治理接口。`@tavern/sdk` 现在提供 `client.sessionState`，当前覆盖：

- `registerNamespace`
- `listNamespaces`
- `writeValue`
- `deleteValue`
- `resolve`
- `getFloorSnapshots`
- `diff`

其中：

- `registerNamespace` 是 control-plane write，只负责注册 custom namespace
- `writeValue` / `deleteValue` 是 public Session State value write，只针对 registered custom namespace
- turn API 现在也支持 `sessionStateWrites`，对应 turn-embedded `commit_bound` 写入：
  - `sessions.respond`
  - `sessions.respondStream`
  - `sessions.regenerate`
  - `floors.retry`
  - `messages.editAndRegenerate`
- `listNamespaces` 会同时返回公开稳定的 built-in namespace 与当前 session 下已注册的 custom namespace
- custom slot 会在首次成功 direct write 或首次成功 turn-bound commit 后 materialize，并进入 discovery / resolve / snapshot / diff
- 当前公开稳定的 built-in slot 只有 `game_state.scene` 与 `game_state.world`
- `game_state` 仍然对客户端只读；public delete 与 turn 内 `delete: true` 的治理语义都是 `present: false`
- `registerNamespace` 当前遵循已经冻结的 identity contract：
  - `namespace` 与 `logicalOwnerType` 必须使用小写稳定标识，可带点分段
  - `logicalOwnerId` 必须使用小写稳定 id，允许字符 `a-z0-9._:@/-`
  - `game_state` 与 `game_state.*` 仍然是保留 built-in namespace / prefix，不能注册为 custom namespace
  - 服务端只会先做 `trim()`，不会自动转小写
- `listNamespaces`、`resolve`、`getFloorSnapshots`、`diff` 当前都不提供 `limit` / `offset` 分页；服务端会直接返回当前过滤条件命中的完整结果
- `listNamespaces` 返回的 `sizeBudgetBytes` 就是 slot 当前有效的 payload budget。custom namespace 默认继承当前部署的 Client Data item size limit；built-in slot 使用各自固定预算
- Session State 的规模限制来自底层 managed storage。常见 `error.code` 包括：
  - `validation_error`
  - `session_state_namespace_count_limit_exceeded`、`session_state_namespace_item_limit_exceeded`、`session_state_namespace_byte_limit_exceeded`
  - `session_state_account_item_limit_exceeded`、`session_state_account_byte_limit_exceeded`
  - `session_state_payload_too_large`
- 当前实现里，如果部署关闭了 `enableClientData`：
  - `/sessions/:id/state/*` 这组 public route family 默认不会注册，外部通常直接看到 `404`
  - turn API 如果携带了 `sessionStateWrites`，会返回 `503 feature_unavailable`

公开端点定义见 [`reference/api/session-state.md`](../reference/api/session-state.md)。
最小联调顺序见 [`session-state-client-checklist.md`](./session-state-client-checklist.md)。

## Session-State 观察面仍不在官方包范围内

`/sessions/:id/session-state/*` 与 `/floors/:id/session-state/*` 仍然是内部观察面。它们继续只用于排错与运维，不会进入 `@tavern/sdk` 和 `@tavern/client-helpers`。

当前实现里，如果部署关闭了 `enableClientData`，这组 observation route family 默认也不会注册，外部通常直接看到 `404`。

如果你的集成方确实需要对接这组内部观察面，请基于 OpenAPI 自行封装，并接受该契约可能变化。完整定义见 [`reference/api/session-state-observation.md`](../reference/api/session-state-observation.md)。



## 文档同步规则

如果改动影响以下任意一项，应同步检查官方包与文档：

- 后端 API 资源契约
- SSE 事件结构
- OpenAPI 输出
- SDK 资源覆盖范围
- helper 导出范围
- Client Data 的 owner / grant / audit 语义
- Project Event、Derived Output 或 Project Inbox 的契约

至少同步更新：

- `packages/official-integration-kit/sdk/README.md`
- `packages/official-integration-kit/client-helpers/README.md`
- `vitepress/guide/integration-kit.md`
- `vitepress/reference/api.md`
- 对应资源参考页
