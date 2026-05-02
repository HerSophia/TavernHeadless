# 协作指南

这份文档说明 TavernHeadless 当前的协作规则。

这不是单纯的 Git 说明文档。它同时约束：

- 仓库分层
- 依赖方向
- 引擎、后端、前端、官方包之间的边界
- 代码改动与文档改动的同步要求

所有参与开发的人，在提交代码前都应先读完这份文档。

---

## 目录

1. [开发环境](#1-开发环境)
2. [项目结构与分层](#2-项目结构与分层)
3. [依赖方向与公开边界](#3-依赖方向与公开边界)
4. [官方集成层协作规则](#4-官方集成层协作规则)
5. [开发工作流](#5-开发工作流)
6. [Commit 与分支规范](#6-commit-与分支规范)
7. [Pull Request 流程](#7-pull-request-流程)
8. [代码风格](#8-代码风格)
9. [文档维护规则](#9-文档维护规则)
10. [验证要求](#10-验证要求)
11. [Issue 与发布](#11-issue-与发布)

---

## 1. 开发环境

### 必须

- Node.js >= 22.22.2
- pnpm >= 9
- Git >= 2.30

### 推荐

- 编辑器：VS Code
- 插件：ESLint、Prettier、EditorConfig、SQLite Viewer
- 终端：PowerShell 7+ 或 Git Bash

### 初始化

```bash
pnpm install
pnpm dev:api
pnpm dev:web
```

安装依赖时会自动执行 `postinstall`。

- 当前它会运行 `scripts/patch-vitepress-build.mjs`
- 这个脚本用于修复 Windows 下 VitePress 1.6.4 文档构建时的盘符大小写路径问题
- 不要删除这一步，除非 VitePress 上游已经修复并且仓库里的补丁脚本已同步移除

常用命令：

```bash
pnpm dev
pnpm dev:api
pnpm dev:web
pnpm dev:both
pnpm typecheck
pnpm test:ci
pnpm lint
pnpm sdk:generate
pnpm sdk:check
pnpm docs:build
```

---

## 2. 项目结构与分层

```text
TavernHeadless/
├── apps/
│   ├── api/                                  # Fastify 后端
│   └── web/                                  # Vue 管理前端
├── packages/
│   ├── core/                                 # 核心引擎逻辑
│   ├── adapters-sillytavern/                 # SillyTavern 兼容适配层
│   ├── shared/                               # 内部共享类型、OpenAPI 生成、API Client
│   └── official-integration-kit/
│       ├── sdk/                              # 第一方官方接入基础层
│       └── client-helpers/                   # 第一方官方接入语义层
├── docs/                                     # 仓库级文档
├── vitepress/                                # 文档站
├── scripts/                                  # 根脚本
└── README.md
```

### 分层说明

- `packages/core`：纯引擎逻辑。
- `packages/adapters-sillytavern`：兼容导入与兼容编排。
- `packages/shared`：内部共享类型、OpenAPI 生成物、类型化 API Client。
- `packages/official-integration-kit/sdk`：官方第一方 HTTP / SSE / 错误 / 资源接入层。
- `packages/official-integration-kit/client-helpers`：官方第一方语义辅助层。
- `apps/api`：后端服务，对外提供 API。
- `apps/web`：管理前端，不是唯一消费方，也不是官方接入语义的定义来源。

---

## 3. 依赖方向与公开边界

### 依赖方向

必须遵守下面的依赖方向：

```text
apps/api  ──→  packages/core  ──→  packages/shared
   │               │
   └──────────→  packages/adapters-sillytavern ──→ packages/shared

apps/web  ──→  packages/official-integration-kit/*
apps/web  ──→  packages/shared
```

### 几条硬规则

- `packages/core` 不允许依赖 `apps/api`、`apps/web` 或任何前端框架。
- `packages/shared` 不允许依赖 `core` 或 `adapters-*`。它只放共享类型、内部工具和生成物。
- `apps/api` 可以依赖 `core`、`shared`、`adapters-*`。
- `apps/web` 不应重新发明一套可复用请求层或语义层。
- 依赖方向只能是 `apps -> packages`，不能反过来。

### 公开边界

当前只保留两个官方公开接入包：

- `@tavern/sdk`
- `@tavern/client-helpers`

同时必须记住：

- `@tavern/shared` 是内部包，不是公开接入面。
- 不要把新的公开接入能力放到 `@tavern/shared`。
- 不要再新增第三个“官方接入包”来绕开边界。

---

## 4. 官方集成层协作规则

这一节是当前最重要的新增规则。

### 4.1 官方集成层的职责

`@tavern/sdk` 负责：

- HTTP 请求
- 默认请求头
- 错误归一化
- SSE 读取
- 第一方资源包装

`@tavern/client-helpers` 负责：

- usage 归一化
- timeline 构建
- 流式状态 reducer
- active page 选择
- API 错误到界面状态的映射

### 4.2 不允许混淆边界

不允许把下面这些内容放进官方包：

- Vue 组件
- React hooks
- Pinia store
- Zustand store
- TanStack Query 绑定
- 只服务于一个页面的界面逻辑

### 4.3 引擎内部实现一改，官方包自然也要跟着检查

这是当前协作要求里必须明确的一条。

如果你改动了下面这些内容：

- 核心引擎的对外可见行为
- `apps/api` 的路由、请求体、响应体、错误语义
- SSE 事件结构
- OpenAPI 生成结果
- Tool Calling 或 MCP 的接入语义
- 会影响 `apps/web` 已迁入官方包的逻辑

就必须同时判断：

1. `@tavern/sdk` 是否需要同步改动
2. `@tavern/client-helpers` 是否需要同步改动
3. 包内文档和外部文档是否需要同步改动

不能只改引擎或后端，然后把接入层留在旧状态。

也不能只在 `apps/web` 里补一个局部适配，就跳过官方包。

### 4.4 什么时候优先改官方包

如果一个改动已经满足下面任意一条，应优先进入官方包，而不是继续堆在 `apps/web`：

- 这个逻辑会被多个接入方重复使用
- 这个逻辑已经直接对应后端某组资源
- 这个逻辑不是界面行为，而是接入行为
- 这个逻辑与 HTTP、SSE、错误、资源读写有关
- 这个逻辑与 timeline、usage、流式中间态、错误映射有关，并且与框架无关

### 4.5 文档同步顺序

只要官方包发生变化，文档更新顺序应保持一致：

1. 先更新包内文档
   - `packages/official-integration-kit/sdk/README.md`
   - `packages/official-integration-kit/client-helpers/README.md`
2. 再更新外部文档
   - `vitepress/guide/integration-kit.md`
   - `vitepress/guide/introduction.md`
   - `vitepress/reference/api.md`
   - `README.md`
3. 如果边界、流程或协作方式也变了，再更新协作文档
   - `docs/contributing.md`
   - `vitepress/development/contributing.md`
   - `.github/CONTRIBUTING.md`

### 4.6 `apps/web` 的处理原则

`apps/web` 仍然可以保留这些内容：

- 组件和页面逻辑
- 本地表单状态
- 只在一个界面里使用的显示映射
- 菜单和交互行为

但下面这些内容，如果已经稳定并且可复用，应尽量迁入官方包：

- 资源请求封装
- SSE 解析与归一化
- 通用错误映射
- 时间线语义整理
- 与后端资源一一对应的高层方法

---

## 5. 开发工作流

我们使用 `dev` 集成分支 + 短生命周期 feature 分支的工作方式。

### 分支结构

```text
main          稳定发布分支，只接受来自 dev 的合并
 └── dev      日常集成分支，所有 feature/fix 分支的合并目标
      ├── feat/xxx     功能分支
      ├── fix/yyy      修复分支
      └── chore/zzz    维护分支
```

### 分支职责

| 分支                           | 用途     | 谁可以合入                 | 保护规则               |
| ------------------------------ | -------- | -------------------------- | ---------------------- |
| `main`                         | 稳定发布 | 只接受 `dev → main` 的 PR  | 禁止直推、要求 CI 全绿 |
| `dev`                          | 日常集成 | 接受 feature/fix 分支的 PR | 禁止直推、要求 CI 全绿 |
| `feat/*` / `fix/*` / `chore/*` | 开发分支 | —                          | 无保护，开发者自行管理 |

### 日常流程

```text
1. 从 dev 拉新分支
2. 在分支上开发
3. 本地自查
4. 提交 PR，目标分支选 dev
5. Code Review
6. CI 全绿后合并到 dev
7. 删除分支
```

### dev → main 的合并

当 `dev` 上积累了足够的改动并且状态稳定时，由维护者发起 `dev → main` 的 PR。
这个 PR 同样需要 CI 全绿才能合并。

不允许跳过 `dev` 直接把 feature 分支合进 `main`。

### main 合并后的 dev 安全回补

仓库还有一个独立 workflow：`.github/workflows/sync-dev-with-main.yml`。

它只在 `main` push 或手动触发时运行，并先执行：

```bash
git rev-list --left-right --count origin/main...origin/dev
```

只有在 `dev` 没有自己独有 commit，且 `main` 确实领先 `dev` 时，它才会更新自动同步分支 `chore/sync-dev-with-main`，并创建或更新一个指向 `dev` 的 PR。

如果仓库已经开启 `Allow auto-merge`，这个 workflow 还会主动对同步分支触发一次 `CI` 的 `workflow_dispatch`，并传入 `run_coverage=false`，然后为同步 PR 开启 `--auto --merge`。

同时，仓库在 `Settings -> Actions -> General -> Workflow permissions` 里还要开启 `Allow GitHub Actions to create and approve pull requests`。否则 workflow 虽然可以推送同步分支，但无法创建这条同步 PR。

这样仍然完全遵守 `dev` 的 ruleset：不直接推送 `dev`，不绕过 required checks，只是在同步 PR 上把需要的检查和自动合并串起来。

之所以显式触发一次 `CI`，是因为由 `GITHUB_TOKEN` 产生的 push / PR 事件不会自动触发后续 workflow。这里改用 `workflow_dispatch`，可以在不引入额外绕过权限的前提下，让同步 PR 自己拿到 required checks。

如果 `dev` 已经有自己独有的 commit，workflow 会直接跳过，不覆盖正在集成的工作。

### 禁止事项

- 不要直接推送到 `main` 或 `dev`
- 不要把 feature 分支的 PR 目标设为 `main`（除非是 `dev → main` 的集成合并）
- 不要在共享分支上强制推送
- 不要把无关改动塞进同一个 PR
- 不要把代码改动和本应同步更新的文档拆成两个长期分离的 PR

### GitHub 分支保护（Ruleset）

仓库通过 GitHub Rulesets 对 `main` 和 `dev` 施加以下保护：

- 禁止删除分支
- 禁止 non-fast-forward push（即禁止 force push）
- 所有改动必须通过 PR 合入
- PR 合入前必须通过以下 CI 检查：Lint、Typecheck、Build、Test (shard 1/3)、Test (shard 2/3)、Test (shard 3/3)、API Smoke

---

## 6. Commit 与分支规范

### Commit 格式

使用 Conventional Commits：

```text
<类型>(<范围>): <描述>
```

### 类型

| 类型       | 用途             |
| ---------- | ---------------- |
| `feat`     | 新功能           |
| `fix`      | 修复问题         |
| `refactor` | 重构             |
| `docs`     | 只改文档         |
| `test`     | 只改测试         |
| `chore`    | 构建、依赖、配置 |
| `style`    | 格式调整         |
| `perf`     | 性能优化         |

### 范围

建议直接使用真实模块名。常见范围：

- `core`
- `api`
- `web`
- `shared`
- `sdk`
- `client-helpers`
- `integration-kit`
- `docs`
- `mcp`
- `tools`
- `memory`
- `llm`

### 示例

```text
feat(sdk): add exports tools and mcp resources
fix(api): keep tool permission patch merge semantics
docs(integration-kit): refresh sdk surface and collaboration rules
refactor(web): migrate workspace api callers to sdk resources
```

### 分支命名

```text
<类型>/<简短描述>
```

例如：

- `feat/sdk-batch4-resources`
- `fix/mcp-status-mapping`
- `docs/integration-kit-refresh`
- `refactor/web-use-sdk-resources`

---

## 7. Pull Request 流程

### PR 标题

与 commit 一样使用 Conventional 格式。

### PR 描述至少应说明

- 做了什么
- 为什么要做
- 影响了哪些模块
- 如何验证
- 是否更新了文档
- 是否影响了官方包边界

### 如果涉及引擎、后端契约或官方包，请额外说明

- 是否影响 `@tavern/sdk`
- 是否影响 `@tavern/client-helpers`
- 是否影响 `apps/web`
- 是否影响 OpenAPI 生成物
- 是否需要迁移已有接入代码

### 如果 PR 只改文档

- 请在 PR 描述中明确写明这是 docs-only PR。
- 建议在验证部分列出 `pnpm docs:lint` 与 `pnpm docs:build`。
- GitHub 上仍会显示 `Typecheck`、`API Smoke` 与三个
  `Test shard`。
- 这些检查在 docs-only PR 下会走轻量路径并快速成功。
- docs lint 若命中 markdownlint 问题，会以告警形式展示，
  但不会阻断 CI。

### Review 规则

- 每个 PR 至少需要 1 人 approve 才能合并
- Reviewer 应尽快给出第一轮反馈
- 有争议的设计问题，应转为单独讨论，不要在 PR 中长期拉扯
- 合并方式优先使用 `Squash and Merge`

---

## 8. 代码风格

### 基本原则

- TypeScript 严格模式，不要随意使用 `any`
- 以现有 ESLint 与 Prettier 配置为准
- 命名保持稳定，不随意更换同一概念的叫法
- 新增资源包装时，尽量延续既有命名：`list`、`getDetail`、`create`、`update`、`remove`
- 动作型接口保持后端原词，不强行抽象

### 概念命名边界

- `Runtime` 只用于平台层运行时能力及其既有公开面，例如 `Background Job Runtime`、`Mutation Runtime`、`runtime_job`、`runtime_scope_state`、`/sessions/:id/tools/runtime`。
- `Run` 用于聊天主链路中的一次业务运行快照，例如 `floor run`、`active run`、`runId`、`runType`、`attemptNo`。
- `Execution` 用于运行中的子级执行记录，例如 `tool execution`、`tool_execution_record`。
- 新增命名不得把这三层概念混用。尤其不要用 `runtime` 命名 turn 进度快照、楼层进度接口或其持久化表。

### 命名风格

- 文件名：`kebab-case`
- 类型、接口、类：`PascalCase`
- 变量、函数：`camelCase`
- 常量：`UPPER_SNAKE_CASE`
- 数据库表与列：`snake_case`
- API 协议字段：以后端为准，通常是 `snake_case`
- SDK 对外返回字段：遵循当前资源文件的映射风格

后续如果新增聊天主链路的运行进度接口、事件或表结构，应优先使用：

- `run`
- `floor_run_*`
- `floor.run.*`

而不是新的 `runtime` 命名。

### 导入顺序

```ts
// 1. Node.js 内置模块
import { readFile } from "node:fs/promises";

// 2. 第三方库
import { eq } from "drizzle-orm";

// 3. 仓库内部包
import type { OpenApiPaths } from "@tavern/shared";

// 4. 当前包内相对导入
import { mapRecord } from "./utils.js";
```

### 注释

- 不写重复代码含义的注释
- 注释主要说明为什么这样做
- 公共 API 和复杂逻辑使用 JSDoc
- 协议兼容、返回语义保持、历史包袱处理要写清楚原因

---

## 9. 文档维护规则

### 文档放置位置

- 仓库级文档：`docs/`
- 文档站页面：`vitepress/`
- 包级说明：各自包目录下的 `README.md`
- 对外入口：根 `README.md`

### 文档更新的硬要求

出现下面任意情况，必须更新文档：

- 改了公共 API
- 改了 OpenAPI
- 改了官方包导出面
- 改了资源覆盖范围
- 改了依赖边界
- 改了协作流程
- 改了发布与验证要求

### 代码和文档必须同 PR 提交的情况

下面这些情况，代码与文档必须放在同一个 PR：

- 新增或删除官方资源方法
- 调整 `@tavern/sdk` 或 `@tavern/client-helpers` 的职责边界
- 后端语义变化导致接入层变化
- `apps/web` 从本地逻辑迁移到官方包
- 文档中已经公开承诺的行为发生变化

### 文档风格

- 用简单直接的文字
- 先讲边界，再讲细节
- 用表格和例子说明规则
- 只写已经上线或已经落地的内容，不预先写未来设计

---

## 10. 验证要求

按改动范围执行最小但完整的验证。

### 改 `apps/api`

至少运行：

```bash
pnpm --filter @tavern/api typecheck
pnpm --filter @tavern/api test
```

### 改 `@tavern/sdk`

至少运行：

```bash
pnpm --filter @tavern/sdk typecheck
pnpm --filter @tavern/sdk test
```

如果改动会影响前端接入，还应运行：

```bash
pnpm --filter @tavern/web typecheck
```

### 改 OpenAPI 或官方包生成面

至少运行：

```bash
pnpm sdk:generate
pnpm sdk:check
pnpm --filter @tavern/sdk typecheck
pnpm --filter @tavern/sdk test
```

### 只改文档

建议至少运行：

```bash
pnpm docs:lint
pnpm docs:build
```

合并到 `main` 的 PR 会先判断是否属于 docs-only 路径。
如果命中 docs-only，GitHub 上仍会显示 `Typecheck`、`API Smoke`
与三个 `Test shard`，但这些检查会按轻量路径快速成功。
docs lint 命中问题时会显示告警，
但不会单独阻断 PR。

### 提交 PR 前的通用检查

一般代码 PR：

```bash
pnpm lint
pnpm typecheck
pnpm test:ci
```

如果 PR 只改局部模块或只改文档，也可以在说明里写清楚为什么采用更小范围的验证。

---

## 11. Issue 与发布

### Issue 标题

标题要能直接说明问题，不要写空泛标题。

好的例子：

- `tools call records query ignores floor_id when page_id is absent`
- `sdk export resource should preserve raw response semantics`
- `web timeline flow still duplicates sdk behavior`

### 标签建议

| 标签              | 用途       |
| ----------------- | ---------- |
| `bug`             | 已确认问题 |
| `feature`         | 新需求     |
| `discussion`      | 需要讨论   |
| `docs`            | 文档更新   |
| `integration-kit` | 官方包相关 |
| `help wanted`     | 需要协助   |

### 发布原则

项目仍在 `0.x` 阶段：

- 可以继续迭代
- 但公开文档中已经承诺的行为，不应随意改动
- 如果要调整公开行为，应同时更新官方包、文档和迁移说明

### 发版前检查

至少确认：

1. 相关模块 typecheck 通过
2. 相关模块测试通过
3. 官方包导出面与文档一致
4. `apps/web` 没有被留在旧语义上
5. 需要迁移的地方已经在 PR 中说明清楚
