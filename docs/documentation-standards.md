# 文档规范

这份文档规定项目中应该有哪些文档、每种文档怎么写、写到什么程度。

目的很简单：任何一个新来的开发者，靠读文档就能理解系统、找到接口、上手开发。不需要翻源码猜意图，不需要找人问「这个函数是干嘛的」。

---

## 目录

1. [文档体系总览](#1-文档体系总览)
2. [README（项目/包级别）](#2-readme项目包级别)
3. [架构文档](#3-架构文档)
4. [API 文档](#4-api-文档)
5. [代码内文档（JSDoc）](#5-代码内文档jsdoc)
6. [数据库文档](#6-数据库文档)
7. [配置文档](#7-配置文档)
8. [变更日志（CHANGELOG）](#8-变更日志changelog)
9. [设计决策记录（ADR）](#9-设计决策记录adr)
10. [格式与风格](#10-格式与风格)

---

## 1. 文档体系总览

项目中需要维护以下文档：

| 文档 | 位置 | 谁来写 | 什么时候更新 |
| ---- | ---- | ---- | ---- |
| 项目 README | `README.md` | 维护者 | 功能变更、技术栈变更时 |
| 包级 README | `packages/*/README.md` | 包的开发者 | 包的公共 API 变更时 |
| 架构设计 | `docs/architecture.md` | 维护者 | 核心设计变更时 |
| 协作指南 | `docs/contributing.md` | 维护者 | 流程变更时 |
| 测试与 CI | `docs/testing-and-ci.md` | 维护者 | 测试策略变更时 |
| 文档规范 | `docs/documentation-standards.md` | 维护者 | 本文件 |
| HTTP API 文档 | `docs/api/` 目录 | 接口开发者 | 接口变更时，和代码同一个 PR |
| 数据库文档 | `docs/database.md` | schema 变更者 | schema 变更时 |
| 配置文档 | `docs/configuration.md` | 配置项变更者 | 新增或修改配置项时 |
| 变更日志 | `CHANGELOG.md` | 发版者 | 每次发版 |
| 设计决策记录 | `docs/adr/` 目录 | 决策参与者 | 做出重大技术决策时 |
| 代码内文档 | 源码中的 JSDoc | 代码作者 | 写代码时同步写 |

**硬规则：改了公共 API 但没更新文档的 PR，不予合并。**

---

## 2. README（项目/包级别）

### 项目 README（根目录）

必须包含：

- 一句话说清楚项目是什么
- 主要特性列表
- 技术栈表格
- 项目目录结构
- 快速开始（克隆、安装、启动）
- 文档索引（链接到 `docs/` 下的各文档）
- 许可证

### 包级 README（`packages/*/README.md`）

每个 package 都要有自己的 README，包含：

- 这个包是做什么的（一两句话）
- 安装方式（如果是独立可用的包）
- 核心导出一览（表格，列出主要的类/函数/类型）
- 简单的使用示例
- 和其他包的依赖关系

示例：

```markdown
# @tavern/core

TavernHeadless 的核心引擎，包含消息管理、变量系统、提示词编排、LLM 调度、记忆系统。

## 核心导出

| 导出 | 类型 | 说明 |
| ---- | ---- | ---- |
| `SessionManager` | class | 会话生命周期管理 |
| `FloorStateMachine` | class | 楼层状态流转 |
| `VariableResolver` | class | 四级变量读写 |
| `PromptOrchestrator` | class | 提示词编排器 |
| `SummaryExtractor` | class | 摘要标签提取 |
| `createSession` | function | 创建会话的快捷方法 |
| `Session` | type | 会话类型定义 |
| `Floor` | type | 楼层类型定义 |

## 使用示例

// 代码示例...
```

---

## 3. 架构文档

已有的 `docs/architecture.md` 遵循以下原则：

- 面向「想理解系统设计的开发者」，不是面向终端用户。
- 每个核心概念都要有：是什么、为什么这么设计、和其他概念的关系。
- 用图表辅助，但图表必须用纯文本格式（ASCII art 或 Mermaid），不要贴图片。
- 数据流和调用链要有完整的步骤图。
- 改了核心设计必须同步更新这份文档。

---

## 4. API 文档

这里指 HTTP API（`apps/api` 对外暴露的接口）。每个接口需要按以下模板记录。

### 接口文档模板

每个接口一个章节，包含以下部分：

```markdown
### POST /sessions/:id/respond

发送用户消息并获取 AI 回复。这是最核心的接口，内部会走完整的回合流程。

#### 请求

**路径参数**

| 参数 | 类型 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `id` | `string` | 是 | 会话 ID |

**请求头**

| Header | 值 | 必填 | 说明 |
| ---- | ---- | ---- | ---- |
| `Content-Type` | `application/json` | 是 | |
| `Accept` | `text/event-stream` | 否 | 设置后返回 SSE 流式响应 |

**请求体**

```json
{
  "message": "讲个故事吧",
  "options": {
    "enable_director": false,
    "enable_verifier": false,
    "max_tokens": 2048
  }
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `message` | `string` | 是 | - | 用户发送的消息内容 |
| `options` | `RespondOptions` | 否 | `{}` | 本次回合的覆盖配置 |
| `options.enable_director` | `boolean` | 否 | `false` | 是否启用 Director 实例 |
| `options.enable_verifier` | `boolean` | 否 | `false` | 是否启用 Verifier 实例 |
| `options.max_tokens` | `number` | 否 | 会话配置值 | 本次生成的最大 token 数 |

#### 响应

**成功（200）**

```json
{
  "floor": {
    "id": "floor_abc123",
    "floor_no": 3,
    "state": "committed",
    "token_in": 1520,
    "token_out": 487
  },
  "message": {
    "id": "msg_xyz789",
    "role": "assistant",
    "content": "从前有座山，山上有座庙..."
  },
  "memory_ops": {
    "facts_added": 2,
    "facts_updated": 0,
    "facts_deprecated": 1
  }
}
```

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `floor` | `Floor` | 本次回合创建的楼层 |
| `floor.id` | `string` | 楼层 ID |
| `floor.floor_no` | `number` | 楼层编号 |
| `floor.state` | `FloorState` | 楼层状态 |
| `floor.token_in` | `number` | 输入 token 数 |
| `floor.token_out` | `number` | 输出 token 数 |
| `message` | `Message` | AI 生成的消息 |
| `memory_ops` | `MemoryOpsResult` | 记忆操作统计 |

**错误**

| 状态码 | `error.code` | 说明 |
| ---- | ---- | ---- |
| 400 | `INVALID_MESSAGE` | 消息内容为空或格式错误 |
| 404 | `SESSION_NOT_FOUND` | 会话不存在 |
| 409 | `SESSION_BUSY` | 会话正在生成中，不能同时发起第二次 |
| 502 | `LLM_ERROR` | LLM 服务返回错误 |
| 504 | `LLM_TIMEOUT` | LLM 服务超时 |

#### 示例

```bash
curl -X POST http://localhost:3000/sessions/sess_001/respond \
  -H 'Content-Type: application/json' \
  -d '{"message": "讲个故事吧"}'
```
```

### 接口文档的硬规则

- 每个接口必须包含：路径、方法、说明、请求参数（路径/查询/请求体）、响应格式、错误码。
- 请求体和响应体必须给出完整的 JSON 示例，不能只写类型名。
- 每个字段必须标注类型、是否必填、默认值（如果有）、说明。
- 错误码必须列全，包括状态码、业务错误码、说明。
- 至少给一个 curl 示例。

### 类型引用

如果某个类型在多个接口中复用（比如 `Floor`、`Message`），在文档开头或单独文件中定义一次，后面引用：

```markdown
## 公共类型

### Floor

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `id` | `string` | 楼层 ID，格式 `floor_` + nanoid |
| `session_id` | `string` | 所属会话 ID |
| `floor_no` | `number` | 楼层编号，从 1 开始 |
| `branch_id` | `string` | 分支标识，默认 `"main"` |
| `state` | `FloorState` | 状态枚举 |
| `token_in` | `number` | 输入 token 数 |
| `token_out` | `number` | 输出 token 数 |
| `created_at` | `number` | 创建时间戳（ms） |
| `updated_at` | `number` | 更新时间戳（ms） |

### FloorState

`"draft"` | `"generating"` | `"committed"` | `"failed"`
```

---

## 5. 代码内文档（JSDoc）

### 什么时候必须写 JSDoc

- 从包中 `export` 出去的所有函数、类、类型、接口、枚举、常量。
- 说白了：别人会 `import` 的东西，都要有 JSDoc。
- 包内部的私有函数不强制，但复杂逻辑建议写。

### 函数的 JSDoc 模板

```typescript
/**
 * 按优先级从多个作用域中解析变量值。
 *
 * 查找顺序：page → floor → chat → global。
 * 找到第一个匹配的就返回，全部没有则返回 undefined。
 *
 * @param key - 变量名
 * @param context - 当前作用域上下文，包含各级 scope ID
 * @returns 变量值，如果所有层级都没找到则返回 undefined
 *
 * @example
 * ```typescript
 * const mood = resolver.resolve('mood', {
 *   pageId: 'page_001',
 *   floorId: 'floor_001',
 *   sessionId: 'sess_001',
 * });
 * // mood: string | undefined
 * ```
 *
 * @throws {InvalidScopeError} 如果 context 中缺少必要的 scope ID
 */
resolve(key: string, context: ScopeContext): unknown | undefined;
```

必须包含：

- **第一行**：一句话说明这个函数做什么。
- **详细说明**（可选）：补充行为细节、边界情况、注意事项。
- **`@param`**：每个参数，写类型和说明。
- **`@returns`**：返回值的类型和含义。
- **`@example`**（推荐）：至少一个使用示例。
- **`@throws`**（如果有）：可能抛出的错误类型和条件。

### 类的 JSDoc 模板

```typescript
/**
 * 楼层状态机。
 *
 * 管理楼层从创建到提交的完整生命周期。
 * 状态流转：draft → generating → committed | failed。
 *
 * 状态一旦变为 committed 或 failed 就不可再变更。
 * 尝试非法流转会抛出 InvalidTransitionError。
 *
 * @example
 * ```typescript
 * const fsm = new FloorStateMachine('draft');
 * fsm.transition('generating');  // OK
 * fsm.transition('committed');   // OK
 * fsm.transition('draft');       // throws InvalidTransitionError
 * ```
 */
export class FloorStateMachine {
  /**
   * 当前状态。
   */
  get state(): FloorState;

  /**
   * 执行状态流转。
   *
   * @param target - 目标状态
   * @throws {InvalidTransitionError} 如果当前状态不允许流转到目标状态
   */
  transition(target: FloorState): void;
}
```

### 类型/接口的 JSDoc 模板

```typescript
/**
 * 会话配置。
 *
 * 创建会话时传入，决定这次聊天使用的预设、世界书、模型等。
 */
export interface SessionConfig {
  /** 预设 ID，对应 preset 表的主键 */
  presetId: string;

  /** 正则规则集 ID，可选。不传则不应用正则 */
  regexProfileId?: string;

  /** 世界书 ID，可选。不传则不注入世界书 */
  worldbookProfileId?: string;

  /**
   * 模型配置。
   *
   * provider 和 name 组合确定具体模型。
   * params 中的值会覆盖预设中的默认模型参数。
   */
  model: {
    /** 模型提供商，如 "openai"、"anthropic" */
    provider: string;
    /** 模型名称，如 "gpt-4o"、"claude-3.5-sonnet" */
    name: string;
    /** 模型参数覆盖 */
    params?: Partial<ModelParams>;
  };
}
```

每个字段都要有行内注释（`/** ... */`），说明这个字段是什么、取值范围、和其他字段的关系。

### 枚举/常量的 JSDoc

```typescript
/**
 * 楼层状态枚举。
 *
 * - `draft`：刚创建，还没开始生成
 * - `generating`：正在调用 LLM 生成中
 * - `committed`：生成完成，已提交（不可再改）
 * - `failed`：生成失败，保留现场供排查
 */
export type FloorState = 'draft' | 'generating' | 'committed' | 'failed';

/**
 * 默认的 token 预算上限。
 *
 * 超过这个值时编排器会开始裁剪历史消息。
 * 可在会话配置中覆盖。
 */
export const DEFAULT_TOKEN_BUDGET = 8192;
```

---

## 6. 数据库文档

放在 `docs/database.md`，包含：

### 必须有的内容

- **ER 图**：用 Mermaid 画，展示表之间的关系。
- **每张表的字段说明**：

```markdown
### session 表

会话主表，一次完整聊天对应一条记录。

| 列名 | 类型 | 约束 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| `id` | TEXT | PK | - | nanoid 生成 |
| `title` | TEXT | - | `NULL` | 会话标题 |
| `status` | TEXT | NOT NULL | `'active'` | `active` 或 `archived` |
| `preset_id` | TEXT | FK → preset.id | `NULL` | 关联的预设 |
| `created_at` | INTEGER | NOT NULL | - | 创建时间戳（ms） |
| `updated_at` | INTEGER | NOT NULL | - | 更新时间戳（ms） |

**索引**

| 索引名 | 列 | 类型 | 用途 |
| ---- | ---- | ---- | ---- |
| `idx_session_status` | `status` | 普通 | 按状态筛选会话 |
| `idx_session_created` | `created_at` | 普通 | 按时间排序 |
```

- **迁移记录**：每次 schema 变更记录版本号、变更内容、迁移 SQL。

---

## 7. 配置文档

放在 `docs/configuration.md`，列出所有可配置项：

```markdown
### 服务器配置

| 配置项 | 环境变量 | 类型 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| 监听端口 | `PORT` | `number` | `3000` | HTTP 服务端口 |
| 数据库路径 | `DB_PATH` | `string` | `./data/tavern.db` | SQLite 文件路径 |
| 日志级别 | `LOG_LEVEL` | `string` | `"info"` | `debug` / `info` / `warn` / `error` |

### LLM 配置

| 配置项 | 环境变量 | 类型 | 默认值 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| OpenAI API Key | `OPENAI_API_KEY` | `string` | - | 必填（如果使用 OpenAI） |
| 默认超时 | `LLM_TIMEOUT` | `number` | `60000` | LLM 请求超时时间（ms） |
```

每个配置项必须写明：名称、对应的环境变量、类型、默认值、说明。

---

## 8. 变更日志（CHANGELOG）

放在项目根目录 `CHANGELOG.md`，按版本倒序排列：

```markdown
# 变更日志

## [0.2.0] - 2025-03-15

### 新增

- 记忆系统：支持自动提取 LLM 输出中的摘要标签
- Memory 实例：自动整理和归一化记忆

### 修复

- 世界书导入时超过 500 条目会超时
- 变量提升时 scope_id 写错的问题

### 变更

- `POST /sessions/:id/respond` 响应格式中新增 `memory_ops` 字段

### 移除

- 移除了废弃的 `POST /sessions/:id/generate` 接口

## [0.1.0] - 2025-02-01

### 新增

- 基础会话管理
- 楼层状态机
- 酒馆预设导入
```

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

---

## 9. 设计决策记录（ADR）

当团队做出重大技术决策时，写一份 ADR 记录下来。放在 `docs/adr/` 目录下。

### 什么算「重大决策」

- 选择或更换核心依赖（比如从 Express 换到 Fastify）
- 数据模型的重大变更（比如增加消息页这一层级）
- 架构层面的取舍（比如是否做 LLM 实例化）
- 放弃某个方案的理由

### ADR 模板

文件名格式：`NNNN-简短标题.md`（如 `0001-use-fastify-over-express.md`）

```markdown
# ADR-0001: 使用 Fastify 而不是 Express

## 状态

已采纳 / 已废弃 / 已被 ADR-XXXX 取代

## 背景

我们需要选择一个 HTTP 框架。候选项有 Express、Fastify、Hono。

## 决策

选择 Fastify。

## 理由

- 性能好于 Express（基准测试数据：...）
- 原生支持 JSON Schema 校验
- 插件系统设计合理
- TypeScript 支持好

## 考虑过的替代方案

### Express

生态最大，但性能差，类型支持弱。

### Hono

轻量快速，但社区和插件生态还不够成熟。

## 后果

- 团队需要学习 Fastify 的插件系统
- 中间件不能直接复用 Express 生态的
```

---

## 10. 格式与风格

### 通用规则

- **语言**：项目文档统一使用中文。代码注释和 JSDoc 可以用中文或英文，但同一个文件内保持一致。
- **说人话**：避免没必要的术语。如果用了，第一次出现时解释一下。
- **段落短一些**：每段不超过 4-5 行。大段文字拆成列表或表格。
- **用示例说话**：抽象的描述配一个具体的例子，效果翻倍。

### Markdown 格式

- 标题用 `#`，不要用 `===` 或 `---` 下划线风格。
- 标题层级不要跳（不要 `##` 直接跳到 `####`）。
- 代码块标注语言：`` ```typescript ``、`` ```json ``、`` ```sql ``、`` ```bash ``。纯文本用 `` ```text ``。
- 表格对齐不强求（反正渲染出来都一样），但分隔行统一用 `| ---- |`。
- 文件内的链接用相对路径。

### 图表

- 优先用 Mermaid（GitHub / 大多数 Markdown 渲染器都支持）。
- 简单的层级关系可以用 ASCII art。
- 不要贴截图代替文字图表（不可搜索、不可编辑、容易过时）。

### 文档的「保鲜」

过时的文档比没有文档更有害。几条规则来保鲜：

- **和代码同一个 PR**：改了代码就顺手更新文档，不要「以后再补」。
- **Review 时检查**：Reviewer 有责任看一眼文档是否需要更新。
- **定期扫描**：每个月花 30 分钟扫一遍 `docs/` 目录，标记过时内容。
- **宁可删掉也不要留着错的**：如果某段文档已经不准确又没时间更新，先删掉并开一个 Issue 追踪。
