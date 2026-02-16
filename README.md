# TavernHeadless

一个为开发者而生的 AI RP（角色扮演）后端引擎。

## 这是什么？

TavernHeadless 是一个 Headless 的 AI 角色扮演系统。你可以把它理解为
「没有默认聊天 UI 的 SillyTavern 引擎层」：

- 以 API 和事件系统为核心，而不是页面驱动。
- 以工程化方式管理角色、会话、分支和记忆。
- 支持后续接入任意前端（Web、桌面端、自动化脚本）。

## 当前状态

项目处于 **Alpha（早期成品）** 阶段：

- 核心链路可用：Session/Floor/Page、分支、重试、编辑再生成。
- 生态兼容可用：Preset/Worldbook/Regex/Character 导入。
- 调试能力可用：SSE、Prompt dry-run、OpenAPI、Typed SDK。
- 安全基线可用：`AUTH_MODE=off|api_key|jwt`。

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
```

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
