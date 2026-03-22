# 简介

## 这是什么？

TavernHeadless 是一个 Headless 的 AI 角色扮演系统。你可以把它理解为「没有默认聊天 UI 的 SillyTavern 引擎层」：

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
- **三层消息结构**：会话 → 楼层 → 消息页，天然支持分支与回放。
- **四级变量系统**：全局 / 会话 / 楼层 / 页级变量，优先级清晰。
- **提示词编排体系**：兼容模式与原生流水线并存。
- **记忆系统**：摘要提取、结构化存储、上下文注入、统计与查询。
- **开发者体验**：TypeScript 全栈、OpenAPI 导出、Typed SDK、测试覆盖。

## 设计思路

传统的 AI RP 工具（比如 SillyTavern）是以「角色卡」为中心的前端应用。TavernHeadless 走了一条不同的路：

- **后端优先**：核心逻辑全部跑在服务端，前端只是一个可选的管理界面。
- **项目即角色卡**：不再需要一张 PNG 角色卡文件。一个 TavernHeadless 项目本身就包含了角色设定、世界观、预设、正则规则等所有内容。
- **兼容但不受限**：可以导入酒馆的预设和世界书直接用，但也提供了更强大的原生能力。

## 系统分层

```text
┌─────────────────────────────────────────────────┐
│                  apps/web                       │
│              管理前端（可选）                      │
└──────────────────────┬──────────────────────────┘
                       │ HTTP / WebSocket
┌──────────────────────▼──────────────────────────┐
│                  apps/api                       │
│              Fastify 后端服务                     │
│  ┌───────────────────────────────────────────┐   │
│  │            packages/core                  │   │
│  │  消息管理 · 变量系统 · 提示词编排            │   │
│  │  LLM 调度 · 记忆系统 · 事件总线             │   │
│  └───────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────┐   │
│  │      packages/adapters-sillytavern        │   │
│  │  预设导入 · 正则导入 · 世界书导入            │   │
│  └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## 依赖方向

```text
apps/api  ──→  packages/core  ──→  packages/shared
   │               │
   └──→  packages/adapters-sillytavern ──→  packages/shared

apps/web  ──→  packages/shared
```

依赖方向永远是 **apps → packages**，不能反过来。
