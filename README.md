# TavernHeadless

一个为开发者设计的 AI 角色扮演（RP）后端引擎。

## 这是什么？

TavernHeadless 是一个没有内置聊天界面的 AI 角色扮演系统。
你可以把它理解为 SillyTavern 的「引擎层」——核心能力都在后端，前端可以自由替换。

- 所有功能通过 RESTful API 提供，不依赖特定界面。
- 可以导入 SillyTavern 的预设、世界书、正则规则和角色卡，直接使用。
- 支持接入各种前端：Web 应用、桌面客户端、自动化脚本，或者完全不用前端。

## 当前状态

> **后端 `apps/api`** 已进入 Beta3（`v0.2.0-beta.3`），核心链路完整可用。
> 项目整体仍处于 Alpha 阶段。

已完成的部分：

- 会话管理、分支、重试、时间线等核心功能
- SillyTavern 生态导入（预设、世界书、正则、角色卡）
- 流式输出（SSE）、带 `prompt_intent` / 运行语义回显的 Prompt 调试（dry-run）、OpenAPI 文档
- Web 管理台已提供 LLM、Tools、MCP 的基础管理与运行检查界面
- 官方集成层两包：`@tavern/sdk`、`@tavern/client-helpers`，并已覆盖会话、内容结构、Prompt Runtime、Session State 公共 API、变量、记忆条目 / 边 / 作业 / scope 状态、导出、Tools、MCP 等主要接入域
- Prompt Runtime 已支持分支感知 control plane、结构化 memory truth（preview / inspect / historical explain）、budget / source selection explain、已提交楼层的 historical explain（只读持久化真相）、committed floor compare/diff，以及 session / branch policy envelope governance
- 三种认证模式、多账号隔离、LLM 密钥加密存储
- 变量、记忆、消息、会话、用户等批量操作接口
- 核心资产备份 v1：支持 `characters`、`worldbooks`、`sessions` 的导出、restore preview、异步恢复与作业查询
- LLM Profiles / Instance Slots 已接入真实执行链路，并使用 turn 级 provider 快照隔离运行中的配置

当前重点：部署文档完善、正式发布准备。真实 LLM 集成回归已通过。

## 主要特性

- **兼容 SillyTavern 生态** — 导入现有的预设和世界书就能用
- **三层消息结构** — 会话 → 楼层 → 消息页，天然支持分支和版本管理
- **五级变量系统** — 全局、会话、分支、楼层、页级，互不干扰
- **提示词编排** — 兼容模式与原生图编译路径并存，最终统一落到 PromptIR
- **Prompt Runtime 观测面** — 支持 live debug、dry-run、单段 `macro_text_preview`（宏/source selection/visibility 子视图）、结构化 memory truth、budget / source selection explain、committed floor 的 historical explain（只读持久化真相），以及 committed floor compare / diff
- **记忆系统** — 支持 Memory V2 双层摘要、结构化存储、默认分支隔离的记忆注入、page-local proposal + accepted-page promotion 语义和后台维护
- **开发者友好** — TypeScript 全栈、OpenAPI 导出、类型化 SDK
- **核心资产备份 v1** — 支持 `characters`、`worldbooks`、`sessions` 的 `.thbackup` 导出、restore preview 与异步恢复
- **官方集成层** — 提供 `@tavern/sdk` 和 `@tavern/client-helpers`

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
│   ├── core/                           # 核心引擎逻辑
│   ├── adapters-sillytavern/           # 酒馆兼容层
│   ├── shared/                         # 公共类型和内部共享工具
│   └── official-integration-kit/
│       ├── sdk/                        # 官方接入基础层
│       └── client-helpers/             # 官方接入语义层
├── docs/                     # 设计文档
└── vitepress/                # 在线文档站
```

## 快速开始

```bash
# 克隆项目
git clone https://github.com/HerSophia/TavernHeadless.git
cd TavernHeadless

# 安装依赖
pnpm install

# Windows 下文档构建补丁会在 postinstall 时自动执行
# 不需要额外手动处理

# 配置环境变量（至少填写 LLM_API_KEY）
cp .env.example .env

# 启动开发服务器
pnpm dev
```

启动后可以访问：

| 地址 | 说明 |
| ---- | ---- |
| `http://localhost:3000/docs/` | Swagger UI（在线试用 API） |
| `http://localhost:3000/openapi.json` | OpenAPI 规范文件 |
| `http://localhost:3000/health` | 健康检查 |

Windows 用户也可以双击 `dev-select.bat` 启动。

如果本机默认 Node 版本不是仓库固定的 `22.22.2`，并且遇到 `better-sqlite3`
原生模块加载错误，可以改用下面这些命令：

```bash
pnpm dev:local
pnpm dev:api:local
pnpm rebuild:native
```

PowerShell 也可以先执行：

```powershell
.\scripts\use-local-node.ps1
```

再继续运行 `pnpm dev`、`pnpm --filter @tavern/api dev` 或其他命令。

如果不想用交互菜单，可以直接运行：

```bash
pnpm dev:api    # 只启动后端
pnpm dev:web    # 只启动前端
pnpm dev:both   # 同时启动
```

## 认证

通过 `.env` 中的 `AUTH_MODE` 选择认证方式：

| 模式 | 说明 |
| ---- | ---- |
| `off` | 不需要认证（默认，适合本地开发） |
| `api_key` | 通过 API Key 认证 |
| `jwt` | 通过 JWT Token 认证 |

`AUTH_MODE=off` 只应用于本地开发环境。当前服务会在 `NODE_ENV=production && AUTH_MODE=off` 时直接拒绝启动。

多账号隔离时，`ACCOUNT_MODE=multi` 不能与 `AUTH_MODE=off` 一起使用。

`/health`、`/version`、`/openapi.json`、`/docs`、`/docs/*` 这些 public path 始终按匿名请求处理，不会继承管理员上下文。

项目还支持多账号隔离（`ACCOUNT_MODE=multi`）和 LLM 密钥加密存储。
详细配置见 `.env.example` 中的注释。

## 常用命令

```bash
pnpm dev                          # 交互式启动
pnpm --filter @tavern/api test    # 运行测试
pnpm --filter @tavern/api typecheck  # 类型检查
pnpm dev:local                    # 用仓库内置 Node 22 启动开发流程
pnpm dev:api:local                # 用仓库内置 Node 22 只启动后端
pnpm rebuild:native               # 用仓库内置 Node 22 重建 better-sqlite3
pnpm sdk:generate                 # 导出 OpenAPI + 生成 SDK
pnpm sdk:check                    # 检查 SDK 是否最新
pnpm --filter @tavern/api jobs:backup  # 运行核心资产备份 worker
```

## 后台作业 worker

如果你要使用异步核心资产备份，请先在 `.env` 中启用：

- `ENABLE_BACKUP_WORKER=true`

然后运行：

```bash
pnpm --filter @tavern/api jobs:backup
```

常用配置项包括：

- `ENABLE_BACKUP_WORKER`
- `BACKUP_WORKER_POLL_INTERVAL_MS`、`BACKUP_WORKER_LEASE_TTL_MS`、`BACKUP_WORKER_MAX_CONCURRENT_JOBS`
- `BACKUP_WORKER_RETRY_BASE_DELAY_MS`、`BACKUP_WORKER_MAX_RETRY_DELAY_MS`、`BACKUP_WORKER_CANDIDATE_SCAN_LIMIT`
- `BACKUP_ARTIFACT_DIR`、`BACKUP_IMPORT_MAX_BYTES`、`BACKUP_EXPORT_ARTIFACT_TTL_MS`

完整说明见 `.env.example`。

## 文档

**在线文档站**：部署后可通过 VitePress 访问完整文档。

**设计文档**（`docs/` 目录）：

- [架构设计](docs/architecture.md) — 系统架构、核心概念、数据模型
- [前端设计](docs/frontend-vision.md) — 管理前端的视觉方案和技术路线
- [数据库字典](docs/database.md) — 表结构和字段说明
- [协作指南](docs/contributing.md) — Git 工作流、代码规范、PR 流程、官方包边界和文档同步规则
- [测试与 CI](docs/testing-and-ci.md) — 测试策略和 CI 配置

如果改动影响了引擎对外语义、后端路由、SSE、OpenAPI 或官方接入行为，请同时检查 `@tavern/sdk`、`@tavern/client-helpers` 和对应文档是否需要同步更新。

**进度追踪**：

- [总体进度](PROGRESS.md)
- [后端进度](apps/api/PROGRESS.md)
- [前端进度](apps/web/PROGRESS.md)

## 许可证

MIT
