---
outline: [2, 3]
---

# tavern-client-integration

这个 Skill 用于客户端接入与升级。

它的重点不是列出全部 API 细节，而是帮助客户端开发者按推荐路径使用 TavernHeadless，
并在看到 `/agent` manifest 后按顺序完成升级判断和本地验证。

## 适用场景

这个 Skill 适用于以下场景：

- 新建 Web 客户端接入
- 新建桌面客户端接入
- 新建脚本型接入
- 升级已有接入代码
- 需要根据 manifest 判断本地影响面

## 不适用场景

以下情况不应把这个 Skill 当成主要入口：

- 只处理后端内部实现细节
- 只处理页面交互、组件布局和框架绑定
- 只处理部署、发布和 GitHub Actions 行为
- 需要逐字段查看协议定义时

遇到这些情况，应转去参考文档、OpenAPI 或对应模块文档。

## 关键边界

### `@tavern/sdk`

`@tavern/sdk` 是官方接入基础层。

它应优先承担：

- HTTP 请求
- SSE 读取
- 统一错误对象
- 资源方法封装
- 默认请求头注入

如果你的任务主要是“和后端资源打交道”，
应优先从 `@tavern/sdk` 开始。

### `@tavern/client-helpers`

`@tavern/client-helpers` 是官方接入语义层。

它应优先承担：

- usage 归一化
- timeline 构建
- 流式中间状态 reducer
- API 错误到界面状态的映射
- 与客户端展示相关但不依赖具体框架的整理逻辑

如果你的任务主要是“把服务端返回内容整理成前端更容易使用的形态”，
应优先考虑 `@tavern/client-helpers`。

### `@tavern/shared`

`@tavern/shared` 是内部包，不是公开接入面。

客户端开发者不应把它当作稳定依赖，也不应把新的接入逻辑建立在它之上。

### 原始 HTTP / SSE

只有在官方包当前没有覆盖某项能力时，
才建议退回原始 HTTP 或原始 SSE。

即使需要退回，也应遵守两个要求：

1. 在本地单独封装，不要把原始调用散落在多个页面里
2. 明确记录为什么没有使用官方包

## 推荐决策规则

| 问题 | 推荐做法 |
| --- | --- |
| 需要调用公开资源 | 优先使用 `@tavern/sdk` |
| 需要整理 timeline、usage 或流式中间态 | 优先使用 `@tavern/client-helpers` |
| 需要组件、store、hook 或页面交互逻辑 | 保留在应用层，不进入官方包 |
| 官方包暂未覆盖某项能力 | 在本地用原始 HTTP / SSE 封装，并保持边界清楚 |
| 需要读取协议细节、错误码或字段定义 | 转到 API 参考或 OpenAPI |

## 标准工作流

### 新接入

1. 先阅读 [官方集成层](/guide/integration-kit)
2. 明确当前任务属于资源请求还是语义整理
3. 资源请求先从 `@tavern/sdk` 开始
4. 需要时间线、usage 或流式状态整理时，再加入
   `@tavern/client-helpers`
5. 把组件、store 和框架绑定逻辑留在应用层
6. 接入完成后执行本地验证

### 升级已有接入代码

1. 读取 `/agent/index.json`
2. 读取 `/agent/latest.json`
3. 读取当前 commit 对应 manifest
4. 依次检查：
   - `surfaceSummaries.openapi`
   - `surfaceSummaries.sdk`
   - `surfaceSummaries.clientHelpers`
5. 重点查看以下字段：
   - `surfaceSummaries.sdk.impactedExports`
   - `surfaceSummaries.sdk.impactedModules`
   - `surfaceSummaries.sdk.impactedConsumers`
   - `surfaceSummaries.clientHelpers.impactedConsumers`
6. 回到本地工作区，优先检查直接 import 这些 symbol 的文件
7. 完成调整后执行 `typecheck` 和测试

### 需要提高警惕的信号

遇到下面这些情况时，应提高检查优先级：

- `manifest.summary.breaking === true`
- OpenAPI 出现 removed 或 changed 摘要
- `@tavern/sdk` 出现 removed exports
- `impactedConsumers` 非空

## 本地验证步骤

最少应执行：

```bash
pnpm typecheck
pnpm test
```

如果这次升级直接涉及 API 协议、流式事件或接入封装，建议再补充：

```bash
pnpm docs:build
```

如果你的工作区对某一组资源有更细的本地测试，也应优先跑受影响模块对应的测试。

## 常见反模式

### 直接依赖 `@tavern/shared`

这会把客户端接入建立在内部包上，后续升级成本会更高。

### 已有官方包覆盖，仍然重复写原始 fetch

这会让请求层、错误处理和资源语义继续分散，后续维护成本更高。

### 把框架绑定逻辑放进官方包

组件、store、hook 和页面交互逻辑不属于官方接入层边界。

### 只看 `latest.json`，不看 manifest

`latest.json` 只能告诉你最新 commit 是什么，
不能替代单次 manifest 的影响信息。

### 看到了 `impactedConsumers` 仍然不做本地回归

`impactedConsumers` 已经提示了仓库内直接导入受影响 symbol 的文件。
如果忽略这些文件，本地升级风险会更高。

## 相关文档入口

- [Agent 与 Skill 总入口](/agent/)
- [Skill 索引](/agent/skills/)
- [官方集成层](/guide/integration-kit)
- [SDK 总览](/sdk/)
- [API 参考](/reference/api)

## 相关 Agent 字段入口

建议重点关注以下字段：

- `summary.breaking`
- `surfaceSummaries.openapi`
- `surfaceSummaries.openapi.schemaFieldChanges`
- `surfaceSummaries.sdk`
- `surfaceSummaries.sdk.impactedExports`
- `surfaceSummaries.sdk.impactedModules`
- `surfaceSummaries.sdk.impactedConsumers`
- `surfaceSummaries.clientHelpers`
- `surfaceSummaries.clientHelpers.impactedConsumers`

## 对机器消费方的说明

如果你是读取 `/agent` 的 Agent 或自动化工具，
可以把这个 Skill 当作“客户端接入与升级”的默认任务模板。

建议做法是：

1. 先根据 manifest 判断是否涉及 OpenAPI、SDK 或 helper 变化
2. 再读取 `/agent/skills/tavern-client-integration.json`
3. 最后按 Skill 中的 `decisionRules`、`workflow` 和 `checks`
   组织本地升级动作
