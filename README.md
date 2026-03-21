# TavernHeadless

一个为开发者而生的 AI RP（角色扮演）后端引擎。

## 这是什么？

TavernHeadless 是一个 Headless 的 AI 角色扮演系统。你可以把它理解为
「没有默认聊天 UI 的 SillyTavern 引擎层」：

- 以 API 和事件系统为核心，而不是页面驱动。
- 以工程化方式管理角色、会话、分支和记忆。
- 支持后续接入任意前端（Web、桌面端、自动化脚本）。

## 当前状态

项目整体仍处于 **Alpha** 阶段，但 `apps/api` 后端已进入 **Beta 阶段**，当前处于收口阶段：

- 后端核心链路已完整：Session/Floor/Page、分支、重试、编辑再生成、时间线、分支治理。
- 生态兼容可用：Preset/Worldbook/Regex/Character 导入，兼容模式与原生 Prompt 流水线并存。
- 开发与调试能力可用：SSE、Prompt dry-run、OpenAPI、Typed SDK、`/docs-zh`、`/docs-en`。
- 安全与隔离能力可用：`AUTH_MODE=off|api_key|jwt`、多账号隔离、`/accounts`、`/users`、`LLM Profile Vault`。
- 首批 batch 能力已落地：`PUT /variables/batch`、`PATCH /memories/batch/status`、`POST /memories/batch/delete`、`PATCH /messages/batch/visibility`、`POST /messages/batch/delete`。
- `apps/api` 当前采用 `0.2.0-beta.2` 作为 beta 预发布版本，OpenAPI 文档版本、导出产物、自动化验证与 SDK 校验已同步通过。
- 当前重点：补做真实 provider 的最小回归，并继续保持多实例运维约束与公网部署责任文档同步。

## 主要特性

- **兼容 SillyTavern 生态**：支持导入 Preset、Regex、Worldbook、Character。
- **三层消息结构**：会话 -> 楼层 -> 消息页，天然支持分支与回放。
- **四级变量系统**：全局 / 会话 / 楼层 / 页级变量，优先级清晰。
- **提示词编排体系**：兼容模式与原生流水线并存。
- **记忆系统**：摘要提取、结构化存储、上下文注入、统计与查询。
- **开发者体验**：TypeScript 全栈、OpenAPI 导出、Typed SDK、测试覆盖。

## 技术栈

| 层级 | 技术 |
| ---- | ---- |
| 后端框架 | Fastify |
| 语言 | TypeScript |
| 数据库 | SQLite + Drizzle ORM |
| LLM 接入 | Vercel AI SDK |
| 事件系统 | emittery |
| 前端（管理台） | Vue 3 + Pinia + TailwindCSS |
| 包管理 | pnpm (monorepo) |

## 项目结构

```text
TavernHeadless/
├── apps/
│   ├── api/                  # 后端服务（Fastify）
│   └── web/                  # 管理前端（Vue 3）
├── packages/
│   ├── core/                 # 核心引擎逻辑
│   ├── adapters-sillytavern/ # 酒馆兼容层（预设/正则/世界书导入）
│   └── shared/               # 公共类型和工具函数
├── docs/                     # 文档
└── README.md
```

## 快速开始（本地开发）

```bash
# 1) 克隆
git clone https://github.com/your-org/TavernHeadless.git
cd TavernHeadless

# 2) 安装依赖
pnpm install

# 3) 配置环境变量
cp .env.example .env
# 至少设置 LLM_API_KEY；其余保持默认即可

# 4) 启动（交互选择：后端 / 前端 / 双端）
pnpm dev
```

默认可访问：

- OpenAPI JSON：`http://localhost:3000/openapi.json`
- Swagger UI：`http://localhost:3000/docs/`
- Health：`http://localhost:3000/health`

## 认证模式

在 `.env` 中设置：

```env
# off | api_key | jwt
AUTH_MODE=off

# AUTH_MODE=api_key 时启用
# AUTH_API_KEYS=dev-key-1,dev-key-2

# AUTH_MODE=jwt 时启用
# AUTH_JWT_SECRET=replace-with-strong-secret

# 账号模式：single（默认）| multi
# ACCOUNT_MODE=single
# AUTH_API_KEY_ACCOUNTS=key-a:acc-a,key-b:acc-b
# AUTH_JWT_ACCOUNT_CLAIM=account_id

# CORS（默认已允许本地 Vite 端口）
# CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
# CORS_CREDENTIALS=false

# LLM Profile Vault（数据库密钥加密）
# APP_SECRETS_MASTER_KEY=replace-with-strong-secret

# Memory（可选）
# ENABLE_MEMORY=true
# ENABLE_MEMORY_CONSOLIDATION=true
# 记忆注入衰减排序（可选）
# MEMORY_INJECTION_DECAY_HALF_LIFE_DAYS=7
# MEMORY_INJECTION_DECAY_MIN_FACTOR=0.05
# MEMORY_INJECTION_DECAY_BY=updatedAt

# 记忆维护任务（可选，deprecate / purge）
# ENABLE_MEMORY_MAINTENANCE=true
# MEMORY_MAINTENANCE_INTERVAL_MINUTES=60
# MEMORY_MAINTENANCE_BATCH_SIZE=500
# MEMORY_MAINTENANCE_DEPRECATE_SUMMARY_DAYS=30
# MEMORY_MAINTENANCE_DEPRECATE_OPEN_LOOP_DAYS=7
# deprecated 且自上次更新后超过 N 天自动删除（默认 90，设为 0 禁用）
# 当前无独立 deprecatedAt；这里以 updatedAt 作为 deprecated 状态下的最后变更时间
# MEMORY_MAINTENANCE_PURGE_DEPRECATED_DAYS=90
# MEMORY_MAINTENANCE_DRY_RUN=false
```

## 记忆维护语义

- `MEMORY_MAINTENANCE_DEPRECATE_SUMMARY_DAYS` 与 `MEMORY_MAINTENANCE_DEPRECATE_OPEN_LOOP_DAYS` 按 `createdAt` 判断。
- `MEMORY_MAINTENANCE_PURGE_DEPRECATED_DAYS` 按 `memory_item.updated_at` 判断，不单独引入 `deprecatedAt`。
- 这表示 purge 的含义是：条目已处于 `deprecated` 状态，且自上次更新后超过阈值。自动 deprecate 与后续手工更新都会刷新 `updatedAt`，因此会顺延清理时间。
- 当前记忆维护调度器仍运行在 `apps/api/src/app.ts` 的 API 进程内定时器上，不带分布式锁。多实例部署时，只允许一个实例开启 `ENABLE_MEMORY_MAINTENANCE=true`；其余实例应关闭，或改由独立 maintenance job / worker 负责。
- 若 `apps/api` 直接对公网开放，限流、网关防护与基础观测仍需由部署层负责。当前 beta 不内建 `@fastify/rate-limit`、`/metrics` 或 tracing / OTel。

Windows 也可以直接运行：

```bat
dev-select.bat
```

也支持无交互启动：`pnpm dev:api`、`pnpm dev:web`、`pnpm dev:both`。

## 常用命令

```bash
# 启动选择器（交互）
pnpm dev

# API 类型检查
pnpm --filter @tavern/api typecheck

# API 测试
pnpm --filter @tavern/api test

# 导出 OpenAPI + 生成 SDK
pnpm sdk:generate

# 校验 SDK 产物是否最新
pnpm sdk:check
```

## 文档

- [架构设计](docs/architecture.md)：系统整体架构、核心概念、数据模型
- [数据库数据字典](docs/database.md)：表结构、字段说明、枚举与索引约定
- [测试与 CI](docs/testing-and-ci.md)：测试策略、覆盖率指标、CI 流水线
- [协作指南](docs/contributing.md)：Git 工作流、Commit 规范、代码风格、PR 流程
- [前端视觉与构建方案](docs/frontend-vision.md)：管理前端的设计定调与技术路线
- [核心进度](PROGRESS.md)
- [API 进度](apps/api/PROGRESS.md)
- [Web 进度](apps/web/PROGRESS.md)

## 许可证

MIT
