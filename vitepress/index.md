---
layout: home
hero:
  name: TavernHeadless
  text: 为开发者而生的 AI RP 后端引擎
  tagline: Headless 架构 · SillyTavern 兼容 · TypeScript 全栈
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 架构设计
      link: /guide/architecture
    - theme: alt
      text: GitHub
      link: https://github.com/your-org/TavernHeadless
features:
  - icon: 🧩
    title: 兼容 SillyTavern 生态
    details: 支持导入 Preset、Regex、Worldbook、Character。酒馆预设直接用，无需重新配置。
  - icon: 🏗️
    title: 三层消息结构
    details: 会话 → 楼层 → 消息页，天然支持分支、重试与回放。每个楼层有完整的状态机。
  - icon: 📐
    title: 四级变量系统
    details: 全局 / 会话 / 楼层 / 页级变量，优先级清晰。页级沙箱隔离重生成间的状态冲突。
  - icon: 🔧
    title: 提示词编排体系
    details: 兼容模式与原生流水线并存。统一中间格式（Prompt IR），调试时可完整查看。
  - icon: 🧠
    title: 记忆系统
    details: 摘要提取、结构化存储、上下文注入、统计与查询。支持自动冲突消解与衰减排序。
  - icon: 🛠️
    title: 开发者体验
    details: TypeScript 全栈、OpenAPI 导出、Typed SDK、Swagger UI、SSE 流式、Prompt dry-run。
---

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
├── vitepress/                # 文档站（本站）
└── docs/                     # 原始文档
```
