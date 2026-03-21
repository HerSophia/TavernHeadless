---
outline: [2, 3]
---

# 协作指南

这份文档约束项目的开发协作方式。所有参与开发的人请先读完这篇。

## 开发环境

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
pnpm install
pnpm --filter api dev     # 启动后端
pnpm --filter web dev     # 启动前端
```

## 项目结构约定

### 几条硬规则

- `packages/core` **不允许**依赖 `apps/api` 或任何 HTTP 框架。它是纯逻辑层。
- `packages/shared` **不允许**依赖 `core` 或 `adapters-*`。它只放类型定义、工具函数和常量。
- `apps/api` 可以依赖 `core`、`shared`、`adapters-*`。
- `apps/web` 只依赖 `shared`（通过 API 和后端通信，不直接引用 core）。
- 依赖方向永远是 **apps → packages**，不能反过来。

## Git 工作流

我们用 **GitHub Flow 变体**：一条主干 + 短命特性分支。

### 禁止事项

- **不要直接推 main**。所有改动必须走 PR。
- **不要 force push 到别人也在用的分支**。
- **不要在 PR 里夹带无关改动**。一个 PR 只做一件事。

## Commit 规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```text
<类型>(<范围>): <描述>
```

### 类型

| 类型 | 用途 |
| ---- | ---- |
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `refactor` | 重构 |
| `docs` | 只改文档 |
| `test` | 只改测试 |
| `chore` | 构建、依赖、配置 |
| `style` | 代码格式 |
| `perf` | 性能优化 |

### 范围

用包名或模块名：`core`、`api`、`web`、`shared`、`adapters-st`、`db`、`memory`、`orchestrator`。

## 分支策略

### 分支命名

```text
<类型>/<简短描述>
```

示例：`feat/floor-state-machine`、`fix/worldbook-import-tags`

## Pull Request 流程

- PR 标题用 Conventional 格式。
- 每个 PR 至少需要 **1 人 approve** 才能合并。
- 合并方式：优先 **Squash and Merge**。

## 代码风格

- **TypeScript 严格模式**：`strict: true`，不要用 `any`。
- **命名风格**：
  - 文件名：`kebab-case`
  - 类型/接口/类：`PascalCase`
  - 变量/函数：`camelCase`
  - 常量：`UPPER_SNAKE_CASE`
  - 数据库表/列名：`snake_case`

### 导入顺序

```typescript
// 1. Node.js 内置模块
import { readFile } from 'node:fs/promises';

// 2. 第三方库
import Fastify from 'fastify';

// 3. 项目内部包
import type { Session } from '@tavern/shared';

// 4. 当前包内的相对导入
import { validateInput } from './utils';
```

### 注释

- 不要写废话注释。
- 写**为什么**，不写**是什么**。
- 公共 API 和复杂逻辑用 JSDoc。

## 文档维护

- 改了公共 API？更新对应文档。
- 改了数据库 schema？更新数据库文档。
- **PR 里如果涉及文档更新，和代码改动放在同一个 PR 里**。
