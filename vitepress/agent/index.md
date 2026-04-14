---
outline: [2, 3]
---

# Agent 与 Skill

`/agent` 是 TavernHeadless 文档站中的统一入口。

这个入口包含两层内容：

- Agent 更新面：发布主干成功 CI 对应的公开事实
- Skill 辅助体系：给开发者和 Agent 提供接入、升级、验证的做法

当前阶段中，`/agent/*.json` 继续承担稳定的机器入口职责，
`/agent/skills/*` 则补充面向任务的指导内容。

## 这是什么

`/agent` 不是实时消息服务端。

它的作用是把当前项目对外公开的更新事实、推荐路径和开发指导，
用稳定页面和稳定 JSON 的形式发布出来。

如果只看 Agent 更新面，接入方可以知道：

- 最新公开状态是什么
- 这次变化对应哪个提交
- 哪些公开面可能受到了影响

如果再结合 Skill，接入方还可以进一步知道：

- 应该优先使用什么公开包
- 应该怎样解读 manifest
- 应该怎样组织本地验证

## Agent 与 Skill 的分工

### Agent 更新面

Agent 更新面负责回答：这次发生了什么变化。

它面向机器，也面向需要核对发布事实的开发者。

当前已经提供：

- 最新主干成功快照
- 历史更新列表
- 单次 manifest
- OpenAPI 摘要
- `@tavern/sdk` 与 `@tavern/client-helpers` 的导出、
  symbol impact 与 consumer 摘要

### Skill 辅助体系

Skill 负责回答：面对这些变化，应该怎么做。

它面向任务，而不是面向协议细节。

Skill 不替代以下内容：

- API 参考
- OpenAPI
- SDK 文档
- 集成指南

Skill 只把这些已经公开的事实组织成一套稳定的工作流。

## 可用资源

### Agent 更新资源

| 路径 | 作用 | 读者 |
| --- | --- | --- |
| [`/agent/`](/agent/) | 当前总入口页 | 人 |
| [`/agent/index.json`](/agent/index.json) | 机器发现入口 | 机器 |
| [`/agent/latest.json`](/agent/latest.json) | 最新成功主干快照 | 机器 |
| [`/agent/history.json`](/agent/history.json) | 最近若干次更新列表 | 机器 |
| [`/agent/channels.json`](/agent/channels.json) | 实时通道占位说明 | 人 / 机器 |
| `/agent/manifests/<commit>.json` | 单次更新的结构化清单 | 机器 |

### Skill 资源

| 路径 | 作用 | 读者 |
| --- | --- | --- |
| [`/agent/skills/`](/agent/skills/) | Skill 索引页 | 人 |
| [`/agent/skills/catalog.json`](/agent/skills/catalog.json) | Skill 目录 | 机器 |
| [`/agent/skills/tavern-client-integration/`](/agent/skills/tavern-client-integration) | 客户端接入与升级 Skill | 人 |
| [`/agent/skills/tavern-client-integration.json`](/agent/skills/tavern-client-integration.json) | 客户端接入与升级 Skill JSON | 机器 |

## 如何配合使用

推荐按下面的顺序使用 Agent 与 Skill：

1. 先读取 `latest.json`，确认最新 commit 和 manifest 地址
2. 再读取对应 manifest，确认 OpenAPI、SDK 和 helper 摘要
3. 再进入对应 Skill，选择推荐路径和升级步骤
4. 最后执行本地验证

也就是说：

- Agent 负责告诉你变化事实
- Skill 负责告诉你执行顺序

## 开发者常见工作流

### 新接入 TavernHeadless

1. 先阅读 [官方集成层](/guide/integration-kit)
2. 再阅读 [Skill 索引](/agent/skills/)
3. 进入
   [`tavern-client-integration`](/agent/skills/tavern-client-integration)
4. 按 Skill 中的边界选择 `@tavern/sdk` 和
   `@tavern/client-helpers`
5. 接入完成后执行本地验证

### 升级已有接入代码

1. 先读取 `/agent/index.json`
2. 再读取 `/agent/latest.json`
3. 再读取当前 commit 对应的 manifest
4. 重点检查：
   - `surfaceSummaries.openapi`
   - `surfaceSummaries.sdk`
   - `surfaceSummaries.clientHelpers`
   - `impactedExports`
   - `impactedModules`
   - `impactedConsumers`
5. 再进入对应 Skill，按推荐顺序调整本地代码
6. 最后执行 `typecheck` 和测试

## 机器接入最小示例

当前第一阶段中，Skill 目录暂不通过 `index.json` 暴露。

如果机器方需要同时消费 Agent 与 Skill，可以按固定路径读取：

```ts
const index = await fetch(
  "https://<docs-host>/TavernHeadless/agent/index.json",
).then((response) => response.json());

const latest = await fetch(index.latest).then((response) => response.json());

const manifest = await fetch(latest.latestManifest).then((response) =>
  response.json(),
);

const skillCatalog = await fetch(
  "https://<docs-host>/TavernHeadless/agent/skills/catalog.json",
).then((response) => response.json());

console.log("latest commit", latest.commit);
console.log("breaking", manifest.summary.breaking);
console.log(
  "sdk impacted consumers",
  manifest.surfaceSummaries.sdk?.impactedConsumers?.map((item) => item.file) ?? [],
);
console.log(
  "available skills",
  skillCatalog.skills.map((skill) => skill.skillId),
);
```

## 兼容与边界

- 现有 `/agent/index.json`、`latest.json`、`history.json`、
  `channels.json` 与 `manifests/<commit>.json` 路径保持不变。
- Skill 当前作为附加能力进入 `/agent/skills/*`，
  不改变现有 Agent 更新面的职责。
- Skill 是任务指导，不是新的协议真相来源。
- 具体字段、路由、错误码，仍以参考文档和 OpenAPI 为准。

## 当前限制

当前阶段仍有以下限制：

1. OpenAPI 字段级摘要当前主要覆盖 JSON request / response
   schema path，仍未到完整组件级和语义级 diff。
2. `@tavern/sdk` 与 `@tavern/client-helpers` 已补直接 import 级
   consumer 摘要，但还不是完整的数据流和执行路径图。
3. Skill 当前先覆盖客户端接入与升级主路径，
   还没有覆盖全部开发场景。
4. 当前不提供 webhook、SSE 或 Socket.IO 的真实通道地址。

## 后续扩展

后续会优先考虑以下方向：

1. 在 `/agent/index.json` 中加入 Skill 目录发现入口
2. 增加更多 Skill，例如 manifest 升级流程和流式接入
3. 让 Skill 与 manifest 的字段形成更稳定的联动关系

在这些能力落地之前，`/agent` 仍然是当前最稳定的公开更新入口，
而 Skill 则作为它的辅助层逐步扩展。
