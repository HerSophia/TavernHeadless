# TavernHeadless

面向开发者的 AI 角色扮演（RP）后端引擎。Headless 架构，SillyTavern 资产兼容，TypeScript 全栈。

## 具体来说，它是什么？

TavernHeadless 把 AI 角色扮演的核心——会话、楼层、消息、变量、记忆、提示词编排、工具调用——做成了一套 RESTful 后端。它不绑定任何界面，前端可以自由替换。

已有的 SillyTavern 资产（预设、世界书、正则、角色卡）可以直接导入使用。

完整文档在 **[hersophia.github.io/TavernHeadless](https://hersophia.github.io/TavernHeadless/)**。

## 核心概念

- **会话 → 楼层 → 消息页**：三层结构，天然支持分支和重新生成。
- **五级变量**：全局 / 会话 / 分支 / 楼层 / 页级，互不干扰。
- **提示词编排**：兼容酒馆拼接模式，也支持原生图编译，统一输出 Prompt IR。
- **记忆系统**：自动提取摘要，结构化存储，后台异步维护。
- **工具调用 & MCP**：内置工具 + 自定义工具，支持 MCP 服务器集成。
- **官方 SDK**：`@tavern/sdk` + `@tavern/client-helpers`，TypeScript 类型化接入。

## 快速开始

```bash
git clone https://github.com/HerSophia/TavernHeadless.git
cd TavernHeadless

pnpm install
cp .env.example .env
pnpm dev
```

启动后访问：

| 地址 | 说明 |
| ---- | ---- |
| `http://localhost:3000/docs/` | Swagger UI |
| `http://localhost:3000/openapi.json` | OpenAPI 规范 |
| `http://localhost:3000/health` | 健康检查 |

更多命令、认证配置、环境变量说明见文档站 **[快速开始](https://hersophia.github.io/TavernHeadless/guide/getting-started)**。

## 文档

在线文档站：**[hersophia.github.io/TavernHeadless](https://hersophia.github.io/TavernHeadless/)**

| 文档 | 说明 |
| ---- | ---- |
| [简介 & 快速开始](https://hersophia.github.io/TavernHeadless/guide/introduction) | 了解项目、跑起来 |
| [架构设计](https://hersophia.github.io/TavernHeadless/guide/architecture) | 系统架构、核心概念、数据模型 |
| [API 参考](https://hersophia.github.io/TavernHeadless/reference/api) | 所有 REST 接口 |
| [SDK 文档](https://hersophia.github.io/TavernHeadless/sdk/) | 官方接入指南 |
| [协作指南](https://hersophia.github.io/TavernHeadless/development/contributing) | 参与开发需要知道的规则 |

仓库内设计文档（`docs/` 目录）包含架构、数据库字典、测试与 CI 等详细说明。

## 技术栈

| 层级 | 技术 |
| ---- | ---- |
| 后端框架 | Fastify |
| 语言 | TypeScript |
| 数据库 | SQLite + Drizzle ORM |
| LLM 接入 | Vercel AI SDK |
| 前端（管理台） | Vue 3 + Pinia + TailwindCSS |
| 包管理 | pnpm (monorepo) |

## 许可证

MIT
