---
outline: [2, 3]
---

# 简介

## 这是什么？

TavernHeadless 是一个 Headless 的 AI 角色扮演系统。你可以把它理解为「没有默认聊天 UI 的 SillyTavern 引擎层」：

- 以 API 和事件系统为核心，而不是页面驱动。
- 以工程化方式管理角色、会话、分支和记忆。
- 支持接入任意前端（Web、桌面端、自动化脚本），也可以完全不用前端。

## 当前状态

后端 `apps/api` 已完成 Beta 准入（`v0.2.0-beta.2`），14 项准入标准全部达成，真实 LLM provider 回归测试通过。项目整体仍处于 Alpha 阶段。

已完成的部分：

- 会话管理、分支治理、重试、编辑再生成、时间线查询。
- SillyTavern 生态导入：预设、世界书、正则、角色卡。
- SSE 流式输出、Prompt dry-run 调试、OpenAPI 文档、Typed SDK。
- 官方集成层两包：`@tavern/sdk`、`@tavern/client-helpers`，并已覆盖会话、内容结构、变量、记忆、导出、Tools、MCP 等主要接入域。
- 三种认证模式（`off` / `api_key` / `jwt`）、多账号隔离、LLM 密钥加密存储。
- 记忆系统（摘要提取、衰减排序、自动维护）、变量系统（四级级联）。
- LLM Profile Vault、Instance Slot 多模型配置、模型发现与连通性测试。
- batch 接口与状态类接口（variables / memories / messages / sessions / users 等）。

当前重点：部署文档完善、正式发布准备。

## 设计思路

传统的 AI RP 工具（比如 SillyTavern）是以「角色卡」为中心的前端应用。TavernHeadless 走了一条不同的路：

- **后端优先**：核心逻辑全部跑在服务端，前端只是一个可选的管理界面。
- **项目即角色卡**：不再需要一张 PNG 角色卡文件。一个 TavernHeadless 项目本身就包含了角色设定、世界观、预设、正则规则等所有内容。
- **兼容但不受限**：可以导入酒馆的预设和世界书直接用，但也提供了更强大的原生能力。

---

## 核心概念

下面介绍在 TavernHeadless 中经常出现的几个概念。理解它们有助于理解后续的 API 和架构设计。

### 三层消息结构

系统把一次聊天拆成三层：

| 层级 | 含义 | 说明 |
| ---- | ---- | ---- |
| **会话（Session）** | 一次完整的聊天 | 创建时绑定角色、预设、世界书等配置 |
| **楼层（Floor）** | 一次回合 | 用户发一条消息、AI 回一条消息，构成一个楼层 |
| **消息页（MessagePage）** | 楼层内的一个版本 | 重新生成时会在同一楼层创建新的消息页，旧版本保留 |

消息页里面是具体的**消息（Message）**——最小的数据单位。每条消息有角色（`user` / `assistant` / `system` / `narrator`）和内容。

这个结构的好处是：分支和版本管理是原生支持的。从任意楼层可以新开分支，切换消息页相当于在同一回合内切换 AI 的不同回复。

```text
Session
 └── Floor 1 (committed)
 │   ├── MessagePage v1 (inactive)    ← 第一次生成
 │   │   └── Message: assistant "你好呀"
 │   └── MessagePage v2 (active)      ← 重新生成后的版本
 │       └── Message: assistant "嗨！很高兴见到你"
 └── Floor 2 (generating)
     └── MessagePage v1 (active)
         └── Message: assistant "从前有座山..."  ← 正在流式生成
```

### 楼层状态

每个楼层有状态，按固定方向流转：

```text
draft → generating → committed
                   → failed
```

- `draft`：已创建，等待生成。
- `generating`：正在调用 LLM。
- `committed`：生成完成，内容锁定。已提交的楼层不可修改。
- `failed`：生成失败，保留现场方便排查。可以原地重试。

### 分支（Branch）

从任意已提交的楼层可以创建分支。分支是一条独立的故事线，不影响原来的内容。每个会话默认有一个 `main` 分支。

### 角色与用户

- **角色（Character）**：AI 扮演的角色。支持版本化管理，会话绑定角色时冻结一份快照。
- **用户（User）**：对话中人类一方的身份。同样支持快照冻结。

角色和用户的快照存储在会话中，保证即使原始数据被修改，已有会话的行为也不会变。

### 提示词模式

系统提供两种提示词编排路径：

| 模式 | 说明 |
| ---- | ---- |
| `compat_strict` | 严格复刻 SillyTavern 的提示词拼接行为，导入预设即用 |
| `compat_plus` | 在兼容基础上加入记忆注入等高级功能 |
| `native` | 完全使用原生流水线编排，可自由组合节点 |

会话创建时通过 `prompt_mode` 字段选择。

---

## 主要系统

### 变量系统

变量用来存储叙事状态，比如好感度、是否触发过某事件、某物品的位置等。

变量分为四个层级，读取时按从小到大查找，写入时默认写到最小范围（page）作为沙箱保护：

```text
page → floor → chat → global
```

楼层提交时，页级变量可以按策略提升到更高层级。这样重新生成时不同版本之间互不干扰。

### 提示词编排

提示词系统负责把预设、世界书、变量、聊天记录、记忆等拼成一份完整的提示词，发给 LLM。

不管走哪种模式，最终都会编译成一个统一的中间格式（Prompt IR），再交给 LLM。这意味着兼容模式和原生模式共享同一个渲染器。

原生模式的流水线由以下节点组成：

| 节点 | 作用 |
| ---- | ---- |
| `template` | 渲染模板，填入变量 |
| `condition` | 按条件选择不同路径 |
| `worldbook_resolve` | 检查世界书触发条件，注入命中条目 |
| `transform` | 正则替换、文本清洗 |
| `memory_inject` | 注入记忆摘要和关键事实 |
| `token_budget` | 按 token 预算裁剪历史 |
| `pack_messages` | 最终拼装成 LLM 要求的 messages 数组 |

### LLM 调度

系统把 LLM 在逻辑上分成四个实例（Instance Slot），各自可以使用不同的模型和配置：

| 实例 | 职责 | 何时使用 |
| ---- | ---- | ---- |
| **Narrator** | 生成 RP 文本 | 每个回合 |
| **Memory** | 整理摘要、提取事实 | 回合结束后 |
| **Director** | 规划剧情走向 | 可选 |
| **Verifier** | 检查内容一致性 | 可选 |

一次回合中，实例按 Director → Memory 检索 → Narrator 生成 → Verifier 检查 → Memory 整理 的顺序执行。

这些实例配置现在会直接影响真实执行：

- narrator 被实例配置显式禁用时，请求会返回明确错误，不再偷偷回退到环境变量 narrator。
- director / verifier / memory 被禁用时，对应子流程会在该 turn 中跳过。
- narrator 的 `preset_id` 可以覆盖 `session.presetId`。
- `params` 采用浅层 merge，同名键覆盖。
- 动态 Profile 会在 turn 启动时冻结为独立 provider handle，运行中的 turn 不会被中途 Profile 更新污染。

每个实例通过 **LLM Profile** 绑定凭证配置（provider / model / apiKey 等）。Profile 支持按 scope（global / session）和 slot 粒度绑定，解析时按五级优先级回退。不配置 Profile 时使用环境变量作为默认值。

### 记忆系统

记忆系统解决聊天变长后上下文窗口装不下的问题。

记忆的来源有两个：

1. **LLM 摘要**：从 AI 回复中自动提取 `<summary>` 等标签的内容。
2. **Memory 实例整理**：回合同步提交完成后，异步 `memory_job` worker 读取近期内容，输出结构化的记忆操作（新增 / 更新 / 弃用事实）。

每条记忆有类型（fact / summary / open_loop）、所属层级、来源追溯、重要度评分和状态。`type: "summary"` 进一步区分 `summary_tier: "micro" | "macro"`。生命周期状态使用 `lifecycle_status: "active" | "compacted" | "deprecated"`，同时保留兼容字段 `status: "active" | "deprecated"`。

记忆之间还可以有关系（`supports`、`contradicts`、`updates`、`derived_from`、`compacts`、`resolves`）。系统也提供 `memory_job` 与 `memory_scope_state` 两个管理面，用于异步摄取、宏摘要压缩、维护任务和手动回填。

组装提示词时，编排器按 token 预算和重要度选取记忆条目，打包注入到提示词中。

系统还提供自动维护任务：按半衰期衰减排序、自动弃用过期摘要、清理已弃用条目。宏摘要压缩默认由 active micro 数量、micro token 总量和楼层跨度阈值触发，也可以通过后台任务手动触发。

### 事件系统

系统内部使用事件总线（基于 emittery）来解耦各模块。主要事件包括：

- 楼层生命周期：`floor.created` / `floor.committed` / `floor.failed`
- 生成过程：`generation.started` / `generation.chunk` / `generation.completed` / `generation.failed`
- 记忆操作：`memory.created` / `memory.updated` / `memory.deprecated` / `memory.consolidated`
- 变量变更：`variable.set` / `variable.promoted` / `variable.deleted`

这些事件可以通过 WebSocket 转发给前端用于实时显示，也可以用来记录日志或触发自定义逻辑。

---

## 项目模块

项目采用 pnpm monorepo 结构，分为以下几个包：

### `packages/core`

核心引擎。包含所有与具体框架无关的领域逻辑：

- **楼层状态机**（FloorStateMachine）：管理楼层状态流转和变量提升。
- **变量系统**（VariableResolver / VariableStore）：四级级联读取和沙箱写入。
- **提示词基础设施**（TemplateEngine / TokenBudget / MessageBuilder）：模板渲染、token 预算裁剪、消息拼装。
- **原生流水线**（assembleNativePrompt + 7 种节点）：可组合的提示词编排流水线。
- **LLM 接入层**（ProviderRegistry / LLMService）：基于 Vercel AI SDK 的多 provider 调度。
- **生成流水线**（GenerationPipeline）：前处理 → LLM 调用 → 摘要提取 → 后处理。
- **记忆系统**（MemoryStore / MemoryConsolidator）：记忆存储、整理和注入。
- **编排器**（TurnOrchestrator / Director / Verifier）：回合级串联调度。
- **Port 接口**（FloorRepository / VariableRepository / MemoryRepository）：数据库操作的抽象接口，由 API 层实现。

core 只依赖 shared，不依赖任何 API 或框架代码。

### `packages/adapters-sillytavern`

SillyTavern 兼容适配层。负责：

- **解析器**：把酒馆格式的预设（STPreset）、世界书（STWorldBook）、正则（STRegexScript）、角色卡（STCharacterCard）解析为内部格式。全部基于 Zod schema 做运行时校验。
- **世界书引擎**：处理关键词触发、正则触发、selective 逻辑、scanDepth、constant 等世界书机制。
- **正则引擎**：执行查找替换、捕获组、placement 等正则脚本规则。
- **编排器**：`assembleCompat`（compat_strict 模式）和 `assembleCompatPlus`（compat_plus 模式），按酒馆的方式拼接提示词。

### `packages/shared`

公共类型和工具。包含全项目共享的常量定义和类型：

- 楼层状态（FloorState）、变量作用域（VariableScope）、记忆类型（MemoryType / MemoryScope / MemoryStatus / MemoryRelation）等枚举常量。
- 事件名称常量（CoreEvents）。
- 自动生成的 OpenAPI 类型和类型化 API 客户端（createApiClient）。

### `packages/official-integration-kit/sdk`

官方接入基础层。负责：

- 类型安全 API Client。
- 默认请求头和基础 transport。
- SSE 事件流读取与错误归一化。
- 面向接入方的第一方资源调用入口。
- 当前已覆盖会话、页面、分支、角色、预设、世界书、正则、账号、变量、记忆条目 / 边 / 作业 / scope 状态、导出、Tools、MCP、LLM 配置等主要域。
- 保留底层 `request/get/post/put/patch/delete` 能力，供需要精确访问底层协议的接入方使用。

### `packages/official-integration-kit/client-helpers`

官方接入语义层。负责：

- usage 归一化。
- timeline 构建。
- 流式状态 reducer。
- active page 选择和错误映射。

这两个包是当前唯一官方公开接入面。

`packages/shared` 仍然是内部包，不作为公开接入承诺的一部分。

当引擎内部实现、后端路由、SSE 事件或 OpenAPI 契约变化并影响接入语义时，应同步检查这两个官方包和对应文档，而不是只在某一个前端里做局部补丁。

### `apps/api`

Fastify 后端服务。负责：

- **数据库层**：SQLite + Drizzle ORM，16 张表，14 个有序 migration，启动时自动迁移。
- **路由层**：14 个 CRUD 路由模块 + 6 个聊天端点，Zod 运行时校验，snake_case API 协议。
- **服务层**：ChatService（聊天业务）、PromptAssembler（提示词组装）、LlmProfileService（Profile 管理）、LlmInstanceService（Instance 配置）、MemoryMaintenanceService（记忆维护）等。
- **插件**：认证（auth）、CORS、OpenAPI / Swagger、中英文文档、请求日志。
- **运维脚本**：性能基准测试、OpenAPI 导出、记忆维护 CLI、真实 provider 回归测试、API 冒烟测试。

### `apps/web`

管理前端（可选）。Vue 3 + Pinia + TailwindCSS，提供 Narrative Workspace 工作流界面。当前处于 P0/P1 阶段，解耦约 95%。

---

## 系统分层

```text
┌─────────────────────────────────────────────────┐
│                  apps/web                       │
│              管理前端（可选）                      │
└────────────────────────────────────────────┘
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
         └──→  packages/official-integration-kit
                    ├──→  sdk
                    └──→  client-helpers
```

依赖方向永远是 **apps → packages**，不能反过来。`core` 不知道 `api` 的存在，`api` 通过实现 `core` 定义的 Port 接口来对接数据库。

## 下一步

- 想了解完整的架构设计细节，请阅读 [架构设计](/guide/architecture)。
- 想动手试一试，请阅读 [快速开始](/guide/getting-started)。
- 想了解官方集成包，请阅读 [官方集成层](/guide/integration-kit)。
- 想查阅 API 接口，请阅读 [API 参考](/reference/api)。
- 想了解当前进度，请查看 [进度总览](/progress/)。
