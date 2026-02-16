# 协作指南

这份文档约束项目的开发协作方式。所有参与开发的人请先读完这篇。

---

## 目录

1. [开发环境](#1-开发环境)
2. [项目结构约定](#2-项目结构约定)
3. [Git 工作流](#3-git-工作流)
4. [Commit 规范](#4-commit-规范)
5. [分支策略](#5-分支策略)
6. [Pull Request 流程](#6-pull-request-流程)
7. [代码风格](#7-代码风格)
8. [文档维护](#8-文档维护)
9. [Issue 规范](#9-issue-规范)
10. [发布流程](#10-发布流程)

---

## 1. 开发环境

### 必须

- Node.js >= 20
- pnpm >= 9（不要用 npm 或 yarn）
- Git >= 2.30

### 推荐

- 编辑器：VS Code
- 插件：ESLint、Prettier、EditorConfig、SQLite Viewer
- 终端：PowerShell 7+ 或 Git Bash

### 初始化

```bash
# 克隆后第一件事
pnpm install

# 启动后端开发
pnpm --filter api dev

# 启动前端开发
pnpm --filter web dev
```

---

## 2. 项目结构约定

```text
TavernHeadless/
├── apps/
│   ├── api/                  # 后端服务
│   └── web/                  # 管理前端
├── packages/
│   ├── core/                 # 核心引擎（纯逻辑，不依赖 HTTP 框架）
│   ├── adapters-sillytavern/ # 酒馆兼容层
│   └── shared/               # 公共类型、工具函数、常量
├── docs/                     # 所有文档
├── scripts/                  # 构建/部署/迁移脚本
└── README.md
```

### 几条硬规则

- `packages/core` **不允许**依赖 `apps/api` 或任何 HTTP 框架。它是纯逻辑层，要能脱离 Fastify 独立运行和测试。
- `packages/shared` **不允许**依赖 `core` 或 `adapters-*`。它只放类型定义、工具函数和常量。
- `apps/api` 可以依赖 `core`、`shared`、`adapters-*`。
- `apps/web` 只依赖 `shared`（通过 API 和后端通信，不直接引用 core）。
- 依赖方向永远是 **apps → packages**，不能反过来。

```text
apps/api  ──→  packages/core  ──→  packages/shared
   │               │
   └──→  packages/adapters-sillytavern ──→  packages/shared

apps/web  ──→  packages/shared
```

---

## 3. Git 工作流

我们用 **GitHub Flow 变体**：一条主干 + 短命特性分支。

### 日常流程

```text
1. 从 main 拉新分支
2. 在分支上开发
3. 提交 PR
4. Code Review（至少一人）
5. 合并到 main
6. 删除分支
```

### 禁止事项

- **不要直接推 main**。所有改动必须走 PR。
- **不要 force push 到别人也在用的分支**。自己的分支随意。
- **不要在 PR 里夹带无关改动**。一个 PR 只做一件事。

---

## 4. Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```text
<类型>(<范围>): <描述>

<正文（可选）>

<脚注（可选）>
```

### 类型

| 类型 | 用途 |
| ---- | ---- |
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `refactor` | 重构（不改功能、不修 bug） |
| `docs` | 只改文档 |
| `test` | 只改测试 |
| `chore` | 构建、依赖、配置等杂活 |
| `style` | 代码格式（空格、分号、换行等，不影响逻辑） |
| `perf` | 性能优化 |

### 范围

用包名或模块名：`core`、`api`、`web`、`shared`、`adapters-st`、`db`、`memory`、`orchestrator`。

### 示例

```text
feat(core): 实现楼层状态机
fix(adapters-st): 修复世界书导入时标签丢失
docs: 更新架构文档的记忆系统章节
chore: 升级 Drizzle ORM 到 0.35
```

### Commit 粒度

- 一个 commit 做一件事。
- 写了一半不想提交？用 `git stash`，别提交半成品。
- 如果你的 PR 里有 20 个 commit 且大部分是 "fix typo"，合并前请 squash。

---

## 5. 分支策略

### 分支命名

```text
<类型>/<简短描述>
```

示例：

- `feat/floor-state-machine`
- `fix/worldbook-import-tags`
- `refactor/prompt-ir-types`
- `docs/add-contributing-guide`

### 特殊分支

| 分支 | 用途 | 谁能推 |
| ---- | ---- | ---- |
| `main` | 稳定主干 | 只通过 PR 合并 |
| `release/*` | 发版准备（如有需要） | 维护者 |
| `hotfix/*` | 紧急修复 | 维护者 |

---

## 6. Pull Request 流程

### PR 标题

和 commit 一样用 Conventional 格式：

```text
feat(core): 实现楼层状态机
```

### PR 描述模板

```markdown
## 做了什么

简要说明这个 PR 做了什么。

## 为什么

为什么要做这个改动。如果有对应 Issue，写 `Closes #123`。

## 怎么测试

说明怎么验证这个改动是正确的。

## 截图（如果涉及前端）

贴图。

## 注意事项

有什么需要 reviewer 特别关注的。
```

### Review 规则

- 每个 PR 至少需要 **1 人 approve** 才能合并。
- Reviewer 应在 **48 小时内**给出第一轮反馈。
- 有争议的设计问题，拉到 Issue 或讨论区单独聊，不要在 PR 里打持久战。
- 合并方式：优先 **Squash and Merge**（保持 main 历史干净）。

---

## 7. 代码风格

### 基本原则

- **TypeScript 严格模式**：`tsconfig.json` 开启 `strict: true`，不要用 `any`（实在需要用 `unknown` + 类型守卫）。
- **ESLint + Prettier**：保存时自动格式化。具体规则以项目根目录的配置文件为准。
- **命名风格**：
  - 文件名：`kebab-case`（如 `floor-state-machine.ts`）
  - 类型/接口/类：`PascalCase`（如 `FloorState`）
  - 变量/函数：`camelCase`（如 `createFloor`）
  - 常量：`UPPER_SNAKE_CASE`（如 `MAX_TOKEN_BUDGET`）
  - 数据库表/列名：`snake_case`（如 `message_page`）

### 导入顺序

```typescript
// 1. Node.js 内置模块
import { readFile } from 'node:fs/promises';

// 2. 第三方库
import Fastify from 'fastify';
import { eq } from 'drizzle-orm';

// 3. 项目内部包（packages/*）
import type { Session } from '@tavern/shared';
import { createFloor } from '@tavern/core';

// 4. 当前包内的相对导入
import { validateInput } from './utils';
```

### 错误处理

- 不要吞异常。捕获了就处理或往上抛。
- 自定义错误类型统一放在 `packages/shared/errors.ts`。
- API 层统一错误格式：`{ error: { code: string, message: string, details?: any } }`。

### 注释

- 不要写废话注释（`// 创建用户` 上面一行就是 `createUser()`，没必要）。
- 写**为什么**，不写**是什么**。代码本身说明「是什么」，注释解释「为什么这么做」。
- 公共 API 和复杂逻辑用 JSDoc。

---

## 8. 文档维护

### 文档放哪

- 项目级文档放 `docs/` 目录。
- API 接口文档跟着代码走（JSDoc + 自动生成）。
- 包级别的说明放各自包的 `README.md`。

### 什么时候更新文档

- 改了公共 API？更新对应文档。
- 改了数据库 schema？更新架构文档的数据库章节。
- 加了新概念或新模块？在架构文档里加对应章节。
- **PR 里如果涉及文档更新，和代码改动放在同一个 PR 里**，不要拆开。

### 文档风格

- 说人话，少用缩写和黑话。
- 用表格和示例代替大段文字。
- Markdown 代码块注明语言标签（如 `` ```typescript `` 而不是光秃秃的 `` ``` ``）。

---

## 9. Issue 规范

### Issue 标题

清晰描述问题或需求，不要写「有个 bug」。

好的标题：

- `世界书导入时如果条目超过 500 条会超时`
- `希望支持从 JSON 批量导入变量`

### Issue 标签

| 标签 | 用途 |
| ---- | ---- |
| `bug` | 确认的 bug |
| `feature` | 新功能需求 |
| `discussion` | 需要讨论的设计问题 |
| `good first issue` | 适合新人的入门任务 |
| `help wanted` | 需要社区帮忙 |
| `wontfix` | 不打算修 |

### Bug 报告模板

```markdown
## 环境

- 操作系统：
- Node.js 版本：
- pnpm 版本：

## 复现步骤

1. ...
2. ...
3. ...

## 期望行为

...

## 实际行为

...

## 错误日志（如有）

...
```

---

## 10. 发布流程

> 🚧 项目早期阶段，发布流程待完善。以下为初步规划。

### 版本号

使用 [语义化版本](https://semver.org/lang/zh-CN/)：`MAJOR.MINOR.PATCH`。

- `0.x.y` 阶段：API 随时可能变，不保证向后兼容。
- `1.0.0` 之后：遵循语义化版本严格规则。

### 发版步骤

1. 从 `main` 创建 `release/vX.Y.Z` 分支。
2. 更新版本号和 CHANGELOG。
3. 跑一遍完整测试。
4. 合并到 `main`，打 Git Tag。
5. 删除 release 分支。

### CHANGELOG

- 每个版本记录 `新增`、`修复`、`变更`、`移除` 四类。
- 基于 commit 历史生成，但需要人工审阅措辞。
