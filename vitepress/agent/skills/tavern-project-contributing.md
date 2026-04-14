---
outline: [2, 3]
---

# tavern-project-contributing

这个 Skill 用于想要参与 TavernHeadless 开发的贡献者。

它的重点不是重复抄写全部协作规则，
而是帮助贡献者按当前仓库的分层边界、验证要求和 PR 规范完成改动。

## 适用场景

这个 Skill 适用于以下场景：

- 第一次准备参与 TavernHeadless 开发
- 需要修改 `apps/api`、`apps/web` 或 `packages/*`
- 需要判断某次改动应该落在哪一层
- 需要判断是否要同步更新 `@tavern/sdk`、
  `@tavern/client-helpers` 和文档
- 需要整理本地验证和 PR 说明

## 不适用场景

以下情况不应把这个 Skill 当成主要入口：

- 只想接入 TavernHeadless，而不是参与仓库开发
- 只需要查看具体 API 字段和错误码
- 只需要查看某个资源方法的详细协议
- 只处理页面视觉和单页交互细节

遇到这些情况，应转去集成指南、API 参考、SDK 文档或对应模块文档。

## 关键边界

### 先确认自己改的是哪一层

当前仓库的主要层次是：

- `packages/core`：核心引擎逻辑
- `packages/adapters-sillytavern`：兼容适配层
- `packages/shared`：内部共享类型和生成物
- `packages/official-integration-kit/sdk`：官方接入基础层
- `packages/official-integration-kit/client-helpers`：官方接入语义层
- `apps/api`：后端服务
- `apps/web`：管理前端

开始写代码前，应先判断目标改动属于哪一层。

### 公开接入面只有两个官方包

当前公开接入面只有：

- `@tavern/sdk`
- `@tavern/client-helpers`

`@tavern/shared` 仍然是内部包，不应被当成公开接入面扩展。

### 外部可见语义变化时，要联动官方包和文档

如果你改动了下面这些内容：

- 引擎对外可见行为
- 后端路由、请求体、响应体、错误语义
- SSE 事件结构
- OpenAPI 生成结果
- 会影响接入方的公开资源行为

就应同时检查：

1. `@tavern/sdk` 是否需要更新
2. `@tavern/client-helpers` 是否需要更新
3. 包内文档与外部文档是否需要同步更新

不能只改后端或只改 `apps/web` 的局部适配，
让官方接入层停留在旧语义上。

## 推荐决策规则

| 问题 | 推荐做法 |
| --- | --- |
| 改动会影响外部可见语义 | 同一个 PR 中同时检查官方包、OpenAPI 和文档 |
| `apps/web` 中出现可复用接入逻辑 | 优先评估是否迁入官方包 |
| 需要公开给接入方使用的能力 | 不要放到 `@tavern/shared` |
| 只改文档 | 至少执行 `pnpm docs:build`，并按实际范围补充文档格式检查 |
| 改动涉及 OpenAPI 或官方包导出面 | 执行 `pnpm sdk:generate`、`pnpm sdk:check` 及对应包验证 |
| 准备提交 PR | 使用 Conventional Commits，并在 PR 中说明影响范围和验证方式 |

## 标准工作流

### 开始前

1. 阅读 [README](/)
2. 阅读 [协作指南](/development/contributing)
3. 阅读 [测试与 CI](/development/testing)
4. 如需修改文档规范，再阅读
   [文档规范](/development/doc-standards)
5. 如果改动会影响公开接入层，再补读
   [官方集成层](/guide/integration-kit)

### 开发时

1. 先判断改动属于哪一层
2. 保持依赖方向和公开边界不被破坏
3. 如果改动会影响外部可见语义，同步检查官方包
4. 如果改动会影响公开承诺，同步更新文档
5. 如果是在跟进最近一次主干外部变更，先读取 `/agent/latest.json`
   和对应 manifest，再决定优先回归哪些公开面

### 提交前

1. 按改动范围选择最小但完整的本地验证
2. 检查是否遗漏文档同步
3. 检查是否需要同步更新 OpenAPI、SDK 或 helper
4. 检查 commit 标题和 PR 说明是否清楚

### 提 PR 时

PR 说明至少应写清：

- 做了什么
- 为什么要做
- 影响了哪些模块
- 如何验证
- 是否影响 `@tavern/sdk`
- 是否影响 `@tavern/client-helpers`
- 是否影响 `apps/web`
- 是否影响 OpenAPI 或生成物

## 本地验证步骤

### 通用代码 PR

最少建议执行：

```bash
pnpm lint
pnpm typecheck
pnpm test:ci
```

### 改 `apps/api`

建议至少执行：

```bash
pnpm --filter @tavern/api typecheck
pnpm --filter @tavern/api test
```

### 改 `@tavern/sdk`

建议至少执行：

```bash
pnpm --filter @tavern/sdk typecheck
pnpm --filter @tavern/sdk test
```

如果会影响前端接入，再补充：

```bash
pnpm --filter @tavern/web typecheck
```

### 改 OpenAPI 或官方包生成面

建议至少执行：

```bash
pnpm sdk:generate
pnpm sdk:check
pnpm --filter @tavern/sdk typecheck
pnpm --filter @tavern/sdk test
```

### 只改文档

建议至少执行：

```bash
pnpm docs:build
```

如果需要补充页面格式检查，可按实际范围执行 markdownlint。

## 常见反模式

### 直接把改动推到 `main`

日常开发应从 `main` 拉短分支，走 PR 和 Review。

### 改了公开语义，却不检查官方包

这会让后端、文档和接入层逐渐脱节。

### 把 `@tavern/shared` 当成公开接入面

这会模糊内部包和公开包的边界。

### 把已稳定、可复用的接入逻辑继续留在 `apps/web`

这会让可复用逻辑分散在前端局部实现里。

### 代码和文档分成两个长期分离的 PR

如果改动已经影响公开行为，文档应和代码一起进入同一个 PR。

### 一个 PR 混入多类无关改动

这会让 Review 和回归都更困难。

## 相关文档入口

- [Agent 与 Skill 总入口](/agent/)
- [Skill 索引](/agent/skills/)
- [协作指南](/development/contributing)
- [测试与 CI](/development/testing)
- [文档规范](/development/doc-standards)
- [官方集成层](/guide/integration-kit)

## 相关 Agent 字段入口

如果这次改动会影响公开面，建议重点关注：

- `summary.domains`
- `summary.breaking`
- `changes`
- `surfaceSummaries.openapi`
- `surfaceSummaries.sdk`
- `surfaceSummaries.clientHelpers`

## 对机器消费方的说明

如果你是读取 `/agent` 的 Agent 或自动化工具，
可以把这个 Skill 当作“参与项目开发与提交流程”的默认任务模板。

建议做法是：

1. 先根据 manifest 判断是否涉及公开面变化
2. 再读取 `/agent/skills/tavern-project-contributing.json`
3. 最后按 Skill 中的 `decisionRules`、`workflow` 和 `checks`
   组织本地实现、验证和 PR 说明
