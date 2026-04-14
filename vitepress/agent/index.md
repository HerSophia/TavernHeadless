---
outline: [2, 3]
---

# Agent 接入

`/agent` 是 TavernHeadless 文档站中的 Agent 更新入口。

这个入口同时面向两类读者：

- 需要了解接入方式的开发者
- 需要自动读取更新信息的 Agent 系统

当前路由由主干成功 CI 驱动更新。它提供稳定的人读页面，也提供稳定的机器入口 JSON。

## 这是什么

`/agent` 是一个固定发布面。

它不承担实时消息服务端职责，也不要求 Agent 去解析 HTML 页面。它的作用是把主干成功 CI 对应的公开更新信息，以静态页面和静态 JSON 的形式发布出来。

这个入口的重点不是展示页面，而是提供稳定的发现路径和更新快照。

## 它解决什么问题

当仓库主干进入新提交并且 CI 成功之后，下游接入方通常需要回答三个问题：

1. 现在最新的公开状态是什么
2. 这次更新对应哪个提交
3. 需要从哪里继续读取详细变更信息

如果没有统一入口，接入方往往只能从 README、提交记录、PR 文本、Release 或页面内容中自行拼装这些信息。这种方式不稳定，也不适合自动化系统。

`/agent` 把这些信息收敛到一个固定路径下，便于人和机器共同使用。

## 这个入口的好处

### 入口稳定

接入方只需要记住 `/agent/index.json` 这一处入口，就能继续发现其余资源。

### 人机双通道

- `/agent/` 给人阅读
- `/agent/*.json` 给机器读取

### 与主干成功 CI 对齐

当前发布面只反映主干成功 CI 对应的公开结果，不依赖人工手动维护。

### 支持最新快照和历史补拉

Agent 不只可以读取最新状态，也可以通过历史列表补拉最近若干次更新。

### 摘要更细

当前阶段的 manifest 已提供：

- OpenAPI operation 级与请求 / 响应字段级新增、移除、变更摘要
- `@tavern/sdk` 入口导出差异与受影响 symbol / module / consumer 摘要
- `@tavern/client-helpers` 入口导出差异与受影响 symbol / module / consumer 摘要
- 更具体的迁移提示

### 便于后续扩展

当前先发布静态 JSON。后续如果增加 webhook、SSE 或 Socket.IO，也可以继续沿用这个入口作为发现面和兜底入口。

## 可用资源

| 路径 | 作用 | 读者 |
| --- | --- | --- |
| [`/agent/`](/agent/) | 当前说明页 | 人 |
| [`/agent/index.json`](/agent/index.json) | 机器发现入口 | 机器 |
| [`/agent/latest.json`](/agent/latest.json) | 最新成功主干快照 | 机器 |
| [`/agent/history.json`](/agent/history.json) | 最近若干次更新列表 | 机器 |
| [`/agent/channels.json`](/agent/channels.json) | 实时通道占位说明 | 人 / 机器 |
| `/agent/manifests/<commit>.json` | 单次更新的结构化清单 | 机器 |

## 如何接入

### 1. 读取入口索引

接入方应先读取 `index.json`，而不是解析当前 HTML 页面。

`index.json` 会给出最新快照、历史列表、manifest 根路径和人读入口地址。

### 2. 读取最新快照

`latest.json` 表示当前文档站对应的最新成功主干状态。

接入方应至少读取以下字段：

- `commit`
- `publishedAt`
- `breaking`
- `latestManifest`

### 3. 按历史补拉

如果本地保存了上一次已处理的 commit 游标，可以对比 `latest.json` 中的 `commit`。

当发现有新提交时，再读取 `history.json`，按时间顺序补拉缺失的更新。

### 4. 读取单次 manifest

`manifests/<commit>.json` 是当前阶段最重要的机器输入。

它会给出：

- 源仓库与提交信息
- 对比基线提交
- 粗粒度变更域摘要
- 当前是否标记为 `breaking`
- 建议动作
- 对应文档入口
- OpenAPI operation 级与 schema 字段级摘要
- `@tavern/sdk` 入口导出、symbol impact 与 consumer 摘要
- `@tavern/client-helpers` 入口导出、symbol impact 与 consumer 摘要

当前第二阶段中，建议重点读取 `surfaceSummaries`：

- `surfaceSummaries.openapi`
- `surfaceSummaries.openapi.schemaFieldChanges`
- `surfaceSummaries.sdk`
- `surfaceSummaries.sdk.impactedConsumers`
- `surfaceSummaries.sdk.impactedExports`
- `surfaceSummaries.sdk.impactedModules`
- `surfaceSummaries.clientHelpers`
- `surfaceSummaries.clientHelpers.impactedConsumers`

### 5. 执行本地验证

如果你的工作区直接依赖公开 API、OpenAPI、`@tavern/sdk`
或 `@tavern/client-helpers`，
建议在读取 manifest 后执行本地验证，
例如：

```bash
pnpm typecheck
pnpm test
```

## 示例

### 读取入口索引

```bash
curl https://<docs-host>/TavernHeadless/agent/index.json
```

### 读取最新快照

```bash
curl https://<docs-host>/TavernHeadless/agent/latest.json
```

### TypeScript 最小接入示例

```ts
const index = await fetch(
  "https://<docs-host>/TavernHeadless/agent/index.json",
).then((response) => response.json());

const latest = await fetch(index.latest).then((response) => response.json());

if (latest.commit !== lastHandledCommit) {
  const manifest = await fetch(latest.latestManifest).then((response) => response.json());

  console.log("next commit", latest.commit);
  console.log("breaking", manifest.summary.breaking);
  console.log("domains", manifest.summary.domains);
  console.log(
    "openapi changed operations",
    manifest.surfaceSummaries.openapi?.changedCount ?? 0,
  );
  console.log(
    "openapi changed fields",
    manifest.surfaceSummaries.openapi?.schemaFieldChangedCount ?? 0,
  );
  console.log(
    "first field diff",
    manifest.surfaceSummaries.openapi?.schemaFieldChanges?.[0]?.fieldPath ?? null,
  );
  console.log(
    "sdk added exports",
    manifest.surfaceSummaries.sdk?.addedExports ?? [],
  );
  console.log(
    "sdk impacted exports",
    manifest.surfaceSummaries.sdk?.impactedExports?.map(
      (item) => item.exportName,
    ) ?? [],
  );
  console.log(
    "sdk impacted modules",
    manifest.surfaceSummaries.sdk?.impactedModules?.map(
      (item) => item.module,
    ) ?? [],
  );
  console.log(
    "sdk impacted consumers",
    manifest.surfaceSummaries.sdk?.impactedConsumers?.map(
      (item) => item.file,
    ) ?? [],
  );
}
```

## 兼容与版本

- `index.json` 中的 `contractVersion` 用于标识当前 JSON 契约版本。
- 当前 manifest 已提供 OpenAPI operation 级与字段级摘要，以及官方包的导出、symbol impact 和 consumer 摘要。
- `history.json` 当前保留最近若干次更新，用于补拉最近一段时间的变更。
- `channels.json` 当前只提供占位字段，尚未接入真实实时通道。

## 当前限制

当前阶段仍有以下限制：

1. OpenAPI 字段级摘要当前主要覆盖 JSON request / response schema path，仍未到完整组件级和语义级 diff。
2. `@tavern/sdk` 与 `@tavern/client-helpers` 已补直接 import 级 consumer 摘要，但还不是完整的数据流和执行路径图。
3. 当前不提供 webhook、SSE 或 Socket.IO 的真实通道地址。

这些限制不会影响当前入口的稳定性，但会影响变更信息的细粒度。

## 后续扩展

后续会优先考虑以下增强项：

1. 提升 OpenAPI schema 级别 diff 能力
2. 增加更细的 SDK / client-helpers symbol 影响摘要
3. 在 `channels.json` 中接入真实 webhook、SSE 或 Socket.IO 信息

在这些能力落地之前，`/agent` 仍然是当前最稳定的 Agent 发现入口和补拉入口。
