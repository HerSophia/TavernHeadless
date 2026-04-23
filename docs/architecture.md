# TavernHeadless 架构设计

这份文档面向想要理解系统设计、参与开发或进行二次开发的开发者。

---

## 目录

1. [整体思路](#1-整体思路)
2. [消息结构：会话 → 楼层 → 消息页](#2-消息结构会话--楼层--消息页)
3. [变量系统](#3-变量系统)
4. [提示词系统](#4-提示词系统)
5. [LLM 实例化](#5-llm-实例化)
6. [记忆系统](#6-记忆系统)
7. [一次完整回合的流程](#7-一次完整回合的流程)
8. [数据库设计](#8-数据库设计)
9. [API 概览](#9-api-概览)
10. [事件系统](#10-事件系统)

---

## 1. 整体思路

传统的 AI RP 工具（比如 SillyTavern）是以「角色卡」为中心的前端应用。TavernHeadless 走了一条不同的路：

- **后端优先**：核心逻辑全部跑在服务端，前端只是一个可选的管理界面。
- **项目即角色卡**：不再需要一张 PNG 角色卡文件。一个 TavernHeadless 项目本身就包含了角色设定、世界观、预设、正则规则等所有内容。
- **兼容但不受限**：可以导入酒馆的预设和世界书直接用，但也提供了更强大的原生能力。

系统分为三个主要部分：

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

---

## 2. 消息结构：会话 → 楼层 → 消息页

这是整个系统的数据骨架。我们把一次聊天拆成三层：

### 会话（Session）

一次完整的聊天。创建会话时会绑定预设、世界书、正则规则、模型配置等。

### 楼层（Floor）

一次「回合」。你发一条消息、AI 回一条消息，这就是一个楼层。

楼层的关键能力：

- **分支**：从任意楼层新开一条故事线，不影响原来的内容。
- **状态机**：每个楼层有状态——`draft`（草稿）→ `generating`（生成中）→ `committed`（已提交）或 `failed`（失败）。
- **提交后不可改**：一旦提交，楼层内容就锁定了。这里的 `committed` 表示 assistant 输出、usage、Prompt 快照、工具审计、变量提升和记忆写回已经完成落库。想改？新建一个楼层。

### 消息页（MessagePage）

楼层内的一个页槽位或页版本，主要用于承载 input / output、流式中间态和同槽位版本切换。当前 `regenerate` 不会在已提交楼层内追加 page，而是创建新的 floor，并把旧 floor 标记为 superseded。

消息页的作用：

- 保存同一楼层内的页版本与槽位内容。
- 流式生成时先写到消息页里，生成完再标记为生效。
- 每个 `(floor_id, page_no)` 槽位最多只有一个「当前生效页」。

### 消息（Message）

最小单位。每条消息有角色（`user` / `assistant` / `system` / `narrator`）、内容、格式等。

### 关系图

```text
Session
 └── Floor 1 (committed)
 │   ├── MessagePage v1 (inactive)    ← 第一次生成的版本
 │   │   ├── Message: user "你好"
 │   │   └── Message: assistant "你好呀"
 │   └── MessagePage v2 (active)      ← 重新生成后的版本
 │       ├── Message: user "你好"
 │       └── Message: assistant "嗨！很高兴见到你"
 └── Floor 2 (generating)
     └── MessagePage v1 (active)
         ├── Message: user "讲个故事吧"
         └── Message: assistant "从前有座山..."  ← 正在流式生成
```

---

## 3. 变量系统

变量是用来存储叙事状态的容器。比如「角色当前的心情」「某个物品是否被拿走了」「好感度数值」等等。

### 五个层级

| 层级               | 作用域       | 典型用途                   | 生命周期           |
| ------------------ | ------------ | -------------------------- | ------------------ |
| **全局（global）** | 整个项目     | 世界观设定、全局开关       | 永久               |
| **会话（chat）**   | 一次聊天     | 好感度、已触发事件         | 会话期间           |
| **分支（branch）** | 一条分支     | 分支内持续状态、分支走向   | 分支存在期间       |
| **楼层（floor）**  | 一个回合     | 本回合判定结果、临时标记   | 楼层提交后冻结     |
| **页（page）**     | 一次生成尝试 | 生成中间状态、工具调用暂存 | 生成完成后决定去留 |

### 读写规则

**读取时**，按从小到大的顺序查找，找到就停：

```text
page → floor → branch → chat → global
```

比如读取变量 `mood`：先看当前页有没有，没有就看楼层，再看分支，再看会话，最后看全局。

**写入时**，默认写到 `page`（最小范围）。这是一种保护机制——页级变量就像沙箱，不会意外改到全局状态。

**提升**：如果确实需要把变量保存到更高层级，需要显式提升。比如一次回合结束后，把 `page.mood` 提升到 `branch.mood` 或 `chat.mood`。这个过程由编排器控制，不会默默发生。

变量系统现在还补齐了两条重要约束：

- 所有持久化变量都按 `account_id` 隔离
- `floor` / `page` 宿主进入 `committed` 后，不再允许继续写入或删除该层变量

API 侧提供 `GET /variables/resolve`，用于解析当前 `session / branch / floor / page` 上下文里真正可见的胜出变量快照。

官方接入层中：

- `@tavern/sdk` 提供 `client.variables.resolveContext(...)`
- `@tavern/client-helpers` 提供变量快照到 inspector 行的整理函数

### 为什么要有「页」这一层？

主要解决同一楼层内部不同页版本的隔离问题。假设 AI 生成了一个回复并且写了 `mood = happy`，你在同一页槽位里切到另一个版本后，又得到 `mood = sad`。如果没有页级变量，这两次生成会互相覆盖。有了页级变量，每次页版本都在自己的沙箱里，只有你选定的那个版本才会被提升到楼层、分支或会话。

---

## 4. 提示词系统

提示词系统负责把你的预设、世界书、变量、聊天记录等拼成一份完整的提示词，发给 LLM。

### 双轨设计

我们提供两条路径：

### 路径一：酒馆兼容模式（compat）

直接导入酒馆的预设和世界书，按照酒馆的方式拼接提示词。适合已经有成熟预设的用户，导入即用。

这条路径又分两档：

- `compat_strict`：严格复刻酒馆行为，变量展开、世界书触发、拼接顺序都尽量一致。
- `compat_plus`：在兼容基础上加入少量已声明的增强能力，比如记忆注入，但不改变兼容层的基本边界。

### 路径二：原生编排模式（native）

当前会走原生编排路径。现在 API 主链已经开始把导入的 ST preset 映射为 Native Imported Group，再通过 `PromptGraphDocument -> PromptIR` 的编译路径输出统一中间格式。

这一模式不承诺 ST preset 的保真执行。导入 ST preset 时，默认应优先使用 `compat_strict`。

| 原生图节点 | 做什么 |
| --- | --- |
| `static_text` | 普通文本 prompt 节点 |
| `marker` | 锚点或插槽标记 |
| `chat_history` | 聊天历史 |
| `character` | 角色描述、个性、场景、system prompt、post-history |
| `persona` | 用户 persona 描述 |
| `worldbook` | 世界书 before / after / depth 注入 |
| `example_dialogue` | 示例对话 |
| `memory` | 记忆摘要 |
| `tool_result` | 工具结果 |
| `variable_template` | 变量模板文本 |

原先 `packages/core` 中的 `native-pipeline` 节点链仍然保留，主要作为过渡执行层和测试基础；但 `apps/api` 的 native 主链已经优先使用 graph compiler。

当前 v1 已落地最小 PromptGraph 文档模型与 `compilePromptGraph()` 闭环，
并在 API 侧支持会话显式字段 `session.prompt_mode`。解析优先级是：
`session.prompt_mode` > `metadata.promptMode` > `metadata.prompt_mode`。

### 统一中间格式（Prompt IR）

不管走哪条路径，最终都会先编译成一个统一的中间格式，再交给 LLM。这意味着：

- 酒馆预设和原生编排共享同一个渲染器。
- 加新功能只需要加新节点，不需要改兼容层。
- 调试时可以看到中间格式的完整内容，方便排查问题。

### Prompt 快照与 dry-run 对齐

无论是兼容模式还是原生模式，每次真实生成都会冻结一份 `prompt_snapshot`。

这份快照至少记录：

- 当前使用的 preset / worldbook / regex profile 及其更新时间
- 命中的 worldbook entry uid 列表
- 正则前处理和后处理命中的规则名
- `prompt_mode`、`prompt_digest`、`token_estimate`

提示词组装时，现在会把当前可见的持久化 `global / chat / branch / floor / page` 变量一起注入模板变量表。

其中 `char` 和 `user` 仍然保留为系统别名。如果持久化变量与这两个键冲突，系统别名优先，dry-run 会把冲突写到 `assembly.reserved_variable_collisions`。

如果 preset 存在多条 `prompt_order` 轨道，或者包含当前未完整执行的字段与 marker，dry-run 的 `assembly` 还会返回选中的轨道、被忽略的轨道、未执行字段和 warning，方便调用方判断本轮兼容边界。

同一份 `assembly` 现在还会回显 `prompt_intent`、`assistant_prefill_applied`、`assistant_prefill_strategy`、`continue_nudge_applied`、`continue_nudge_text`、`names_behavior_applied`、`trigger_filtered_entry_ids` 与 `in_chat_inserted_entry_ids`。其中 `assistant_prefill` 作为发送指令处理，不写入真实历史；若当前 narrator provider 不支持，dry-run 会把策略标记为 `unsupported` 并保留 warning。

`/sessions/:id/respond/dry-run` 走的是同一条 Prompt 组装路径，但只返回快照预览，不写入数据库。真实生成则会在 commit 阶段把同字段模型写入 `prompt_snapshot` 表。因此 dry-run 返回的 `prompt_snapshot` 可以直接拿来和已提交楼层的快照对比。

---

## 5. LLM 实例化

在复杂的 RP 场景中，一个 LLM 不够用。你可能需要一个「叙述者」负责写故事，一个「记忆管理员」负责整理摘要，一个「导演」负责把控剧情方向。

我们的做法是：把 LLM 在逻辑上「实例化」——不是真的开多个模型进程，而是用不同的配置去调用同一个（或不同的）在线 LLM。

### 每个实例包含什么

| 配置项     | 说明                                       |
| ---------- | ------------------------------------------ |
| 身份       | 名字和职责描述（如「narrator」「memory」） |
| 模型配置   | 用哪个模型、温度、最大 token 数等          |
| 提示词约定 | 这个实例的系统提示词模板，以及输入输出格式 |
| 变量权限   | 能读写哪些层级的变量                       |
| 预算限制   | 单次最多用多少 token、超时时间、重试次数   |

### 预设的实例类型

| 实例                   | 职责                                 | 什么时候用         |
| ---------------------- | ------------------------------------ | ------------------ |
| **Narrator（叙述者）** | 生成 RP 文本，产出故事内容           | 每个回合都用       |
| **Memory（记忆员）**   | 整理摘要、提取关键事实               | 回合结束后         |
| **Director（导演）**   | 规划剧情走向、给叙述者提供结构化指令 | 可选，复杂场景开启 |
| **Verifier（校验员）** | 检查角色行为是否符合设定             | 可选，严格场景开启 |

### 调度顺序

一次回合中，实例按以下顺序执行：

```
1. Director（可选）：分析当前局势，给出本回合指令
       ↓
2. Memory：检索相关记忆，准备注入上下文
       ↓
3. Narrator：根据指令和记忆，生成本回合内容
       ↓
4. Verifier（可选）：检查生成内容是否合理
       ↓
5. 提交楼层
```

### 兼容模式下的行为

在 `compat_strict` 模式下，只启用 Narrator，其余实例全部关闭。这样行为和酒馆完全一致。切到 `compat_plus` 或 `native` 模式后才会按需开启其他实例。

`llm_instance_config` 现在已经直接进入真实 turn 执行链路：

- `enabled=false` 且 `slot=narrator` 时，聊天请求会返回显式领域错误，不再回退到环境变量 narrator。
- `enabled=false` 且 `slot=director` / `verifier` / `memory` 时，对应子流程会在该 turn 中被强制关闭。
- `preset_id` 用于覆盖 narrator 的 `session.presetId`。
- `params` 采用浅层 merge，同名键覆盖。

### LLM 实例与 Profile 的关系

每个 LLM 实例（Narrator / Director / Verifier / Memory）可以独立绑定不同的 **LLM Profile**。Profile 是一组加密存储的 LLM 凭证配置，包含 provider、modelId、apiKey 等。

从实现上看，静态 provider 仍由共享 `ProviderRegistry` 管理；但动态 `LLM Profile` 已改为 **turn 级 provider 快照**：

- turn 启动时先解析 Profile 与 Instance 配置；
- 再为本轮创建独立的 provider handle；
- 运行中的 turn 只消费自己的快照，不会被中途 Profile 更新覆盖。

这样可以保证：当前 turn 和下一次 turn 可以看到不同的 Profile 更新结果，但同一个运行中的 turn 不会被共享稳定 providerId 覆盖污染。

#### Instance Slot

系统定义了 4 种 **Instance Slot**（槽位）：

| Slot       | 对应实例   | 说明                   |
| ---------- | ---------- | ---------------------- |
| `narrator` | Narrator   | 叙事生成               |
| `director` | Director   | 剧情导演               |
| `verifier` | Verifier   | 一致性校验             |
| `memory`   | Memory     | 记忆整理               |

此外还有通配符 `*`，表示「所有未单独绑定的槽位」。

#### Profile Binding

通过 `llm_profile_binding` 表，可以按 scope（global / session）和 slot 粒度绑定 Profile：

```
唯一约束: (scope, scope_id, instance_slot)
```

例如：
- 全局绑定一个 Profile 到 `*` → 所有实例默认使用这个 Profile
- 某会话单独绑定 `director` 到另一个 Profile → 该会话的 Director 使用不同模型

#### 解析优先级

对于某个 session 的某个 slot X，解析顺序为：

```
1. session + slot X  →  最高优先
2. global  + slot X
3. session + '*'     →  通配 fallback
4. global  + '*'
5. null              →  使用 env 环境变量配置
```

每个 slot 独立解析，互不影响。这意味着你可以：
- 让 Narrator 用高质量大模型（如 Claude 3.5 Sonnet）
- 让 Director / Verifier / Memory 用廉价快速模型（如 GPT-4o-mini）
- 按会话粒度切换 Narrator 模型，而不影响其他实例

#### 与 env fallback 的关系

如果某个 slot 在 Profile binding 中没有找到匹配（五级优先级都为空），则使用 `LLM_API_KEY` / `LLM_PROVIDER` 等环境变量配置。这保证了零配置也能运行。

---

## 6. 记忆系统

记忆系统解决一个核心问题：聊天越来越长，LLM 的上下文窗口装不下所有内容，怎么办？

### 记忆从哪来

**来源一：LLM 自己写的摘要**

很多酒馆预设会引导 LLM 在回复末尾输出类似这样的内容：

```
<summary>角色A向角色B表白，被婉拒。角色B透露自己即将离开这座城市。</summary>
```

我们会自动识别并提取这些摘要。支持多种标签名（`<summary>`、`<摘要>`、`<memory>` 等），也支持在预设里自定义标签名。

提取顺序很重要：

1. 先从 LLM 原始输出中提取摘要标签。
2. 然后再跑正则处理（该隐藏的隐藏，该替换的替换）。
3. 这样既不影响用户看到的文本，也不会丢掉摘要信息。

**来源二：Memory 实例主动整理**

在高级模式下，Memory 实例会在每个回合结束后：

- 读取最近几个楼层的内容。
- 结合已有的 LLM 摘要。
- 输出结构化的记忆操作：新增事实、更新事实、标记过时事实。

Memory 实例的输出是严格的 JSON 格式，不是自由文本。比如：

```json
{
  "turn_summary": "角色A向角色B表白被拒，角色B将离开城市",
  "facts_add": [
    { "factKey": "角色B即将离开", "value": "计划下周离开", "scope": "chat" }
  ],
  "facts_update": [
    { "id": "fact_001", "value": "角色A的心情变为沮丧" }
  ],
  "facts_deprecate": [
    { "id": "fact_002", "reason": "之前推测角色B会留下，现已矛盾" }
  ]
}
```

### 记忆怎么存

每条记忆是一个独立的记录，包含：

- 内容和类型（事实 / 摘要 / 开放剧情线）
- 所属层级（全局 / 会话 / 楼层）
- 来源（哪个楼层、哪条消息产生的）
- 重要程度和可信度评分
- 状态（活跃 / 已过时）

记忆之间还可以有关系：「支持」「矛盾」「更新」。

对于 `fact` 类型，系统还会额外保存结构化 `factKey`（数据库列名为 `fact_key`）。
`content` 继续保留给展示和注入使用，但更新、冲突消解和主查询路径都以 `factKey` 为准，不再依赖从文本内容反解 key。

### 记忆怎么用

每次组装提示词时，编排器会：

1. 按 token 预算分配记忆可用空间。
2. 按重要程度和相关性选取记忆条目。
3. 打包成「记忆摘要块」注入到提示词中。
4. 在兼容模式下，还会按酒馆的方式将摘要放到旧楼层的位置（替代被隐藏的完整内容）。

主聊天链读取记忆时，会先按当前上下文展开 `global → chat → floor` 三层可见范围，
再按既有的 importance / balanced / dual-summary 规则统一排序、裁剪和注入。

### 安全机制

- Memory 实例的输出需要经过校验才会写入数据库，不会直接落库。
- 记忆整理阶段只产出结构化结果，不直接写库；真正写入发生在楼层 commit 的短事务里。
- 摘要文本会做基本的清洗，过滤掉可能的提示词注入（比如「忽略以上所有指令」这种内容）。
- 所有记忆操作都有完整的来源追溯，可以知道每条记忆是什么时候、从哪个楼层产生的。
- 如果记忆注入失败，系统会发出 `memory.injection_failed`，但主聊天流程继续。
- 如果记忆整理上下文加载失败，系统会发出 `memory.consolidation_context_failed`，并跳过本轮整理。
- 如果整理 JSON 解析失败，系统会发出 `memory.consolidation_json_parse_failed`，并降级为仅保留 `turnSummary`。
- 如果事务内记忆持久化失败，系统会发出 `memory.persist_failed`，并回滚整个 commit。
- 所有 committed 记忆事件只在事务成功提交后发出。
  涉及的事件名包括 `memory.created`、`memory.updated`、`memory.deprecated`、
  `memory.deleted`、`memory.edge.created`、`memory.edge.deleted`。
  事务回滚的写入不会发出任何 committed 记忆事件。
- 这些 committed 记忆事件在 turn commit、runtime ingest / compaction、
  manual CRUD、maintenance 四条路径上共享同一组路由字段。
  路由字段包括 `mutationId`、`accountId`、`scope`、`scopeId`、`sessionId`
  （chat / branch scope 可解析时填充）、`branchId`（branch scope 时填充）、
  `floorId`、`entityType`、`entityId`、`source`（取值为
  `extraction` / `consolidation` / `manual` / `runtime` / `maintenance`），
  以及 `before` / `after` 实体快照。
- `memory.consolidated` 仍然是 additive 的整理汇总事件，
  不替代上述 item-level 真相。

### Background Job Runtime 与高级开发者路由

后台记忆作业、聊天导入导出作业，现已统一进入 `Background Job Runtime`。它负责 `runtime_job` / `runtime_scope_state` 持久化、lease、retry、dead letter、scope 串行和进度记录。

内部实现上，Runtime 现在统一由 `RuntimeJobCatalog`、`RuntimeJobScheduler`、`RuntimeWorker`、`RuntimeRevisionGuard`、`RuntimeJobQueryService` 组成。路由层保留 `memory jobs / memory scopes / chat transfer jobs` 这一层业务投影，但底层查询、取消、重试已经改为复用通用 Runtime 管理服务。

Runtime 还会发出统一的 `runtime.job_*` 生命周期事件，例如 `runtime.job_enqueued`、`runtime.job_started`、`runtime.job_progress_updated`、`runtime.job_succeeded`、`runtime.job_retry_scheduled`、`runtime.job_dead_lettered`、`runtime.job_cancelled`。这些事件用于统一观测，不改变现有业务事件（例如 `memory.consolidated`）的保留策略。

需要特别说明的是：与这些后台作业对应的查询、重试、取消、文件下载路由，属于**高级开发者特性**。它们主要服务于开发调试、运维排障、自动化脚本和平台集成，不是普通聊天主链路的一部分。聊天主生成链、turn commit 同步真相边界，以及当前 `GenerationCoordinator`，都不属于这个 Runtime 的接入范围。

### Mutation Runtime

`Mutation Runtime` 现在已经先落在 service 层，用来统一变更 envelope、apply phase、durability、replay safety 和 conflict policy。它和 `Background Job Runtime` 是两层不同的能力：

- `Mutation Runtime` 管变更语义与接入入口。
- `Background Job Runtime` 管异步调度、lease、retry 和 durable job 执行。

当前已经接入 `Mutation Runtime` 的写路径包括：

- `TurnCommitService` / `VariableCommitService` 的 commit-phase 变量 flush 与 `page -> floor` promotion
- `VariableService` 的 inline 变量 upsert / batch upsert / delete
- `LlmProfileService`、`LlmInstanceService` 的配置写入
- `ResourceToolProvider` 的资源类 tool 写入

此外，`Mutation Runtime.enqueueAsync()` 已经可以桥接到现有 `runtime_job`，但这条能力当前仍是内部能力，没有新增公共 `/runtime/mutations` 路由，也没有改变现有变量、配置、资源写入默认同步生效的策略。

### Runtime / Run / Execution 命名边界

仓库内的这三个词，现在按下面的边界使用：

- `Runtime`：平台层运行时能力，例如 `Background Job Runtime`、`Mutation Runtime`、`runtime_job`、`runtime_scope_state`，以及现有 `/sessions/:id/tools/runtime` 工具目录快照。
- `Run`：聊天主链路中的一次业务运行快照，例如楼层生成进度、会话当前激活运行、`runId`、`runType`、`attemptNo`。
- `Execution`：运行内部的子级执行记录，例如工具执行与 `tool_execution_record`。

这个边界的目的，是避免把平台 Runtime、工具目录快照和 turn 进度快照混成一个概念。

因此，后续如果新增聊天主链路的进度接口、事件或表结构，应优先使用 `run` 命名，例如 `/floors/:id/run`、`floor.run.updated`、`floor_run_state`，而不是新的 `/floors/:id/runtime` 或 `floor.runtime.*`。


---

## 7. 一次完整回合的流程

把前面所有系统串起来，一次用户发消息到 AI 回复的完整过程是这样的：

```txt
用户发送消息
    │
    ▼
① 创建新楼层（状态：draft）
   创建消息页 v1，写入用户消息
    │
    ▼
② Director 实例（可选）
   分析当前局势，输出本回合结构化指令
    │
    ▼
③ Memory 检索
   查找相关记忆条目，准备注入
    │
    ▼
④ 提示词编排
   收集：预设 + 世界书命中 + 记忆 + 历史楼层 + 变量
   按 token 预算裁剪
   正则前处理
   拼装成最终 messages[]
    │
    ▼
⑤ Narrator 实例生成
   楼层状态 → generating
   流式写入消息页
    │
    ▼
⑥ 后处理
   提取摘要标签 → 送入记忆候选池
   正则后处理 → 生成用户可见文本
    │
    ▼
⑦ Verifier 实例（可选）
   检查生成内容一致性
    │
    ▼
⑧ Memory 实例整理
   归一化记忆，输出 turn_summary / facts_add / update / deprecate
   这里只产出结构化结果，不直接写库
    │
    ▼
⑨ 短事务提交
   写入 output page + assistant message + usage
   写入 prompt_snapshot 与 tool_execution_record
   页级变量按策略提升到 floor
   写入记忆结果并创建必要的 memory_edge
   楼层状态 generating → committed（CAS）
   触发 floor.committed 事件（携带 promotedVariables）
    │
    ▼
返回结果给用户
```

如果生成阶段失败，楼层会标记为 `failed`，保留现场方便排查。如果生成已经成功但提交事务失败，`committed` 不会出现；系统只会在楼层仍可变更时 best-effort 标记 `failed`，不会把已经提交的楼层再覆盖回 `failed`。

---

## 8. 数据库设计

使用 SQLite，通过 Drizzle ORM 操作。以下是核心表：

### 会话表（session）

```sql
CREATE TABLE session (
  id            TEXT PRIMARY KEY,
  title         TEXT,
  account_id    TEXT NOT NULL,         -- 所属账号
  status        TEXT NOT NULL DEFAULT 'active',  -- active / archived
  character_id  TEXT,                  -- 绑定角色
  character_version_id TEXT,           -- 绑定角色版本
  character_snapshot_json TEXT,        -- 冻结角色快照
  character_sync_policy TEXT NOT NULL DEFAULT 'pin', -- pin / manual / force
  user_id       TEXT,                  -- 绑定用户卡
  user_snapshot_json TEXT,             -- 冻结用户卡快照
  preset_id     TEXT,
  regex_profile_id     TEXT,
  worldbook_profile_id TEXT,
  model_provider TEXT,
  model_name     TEXT,
  model_params_json TEXT,        -- { temperature, top_p, max_tokens ... }
  prompt_mode    TEXT,           -- compat_strict / compat_plus / native
  metadata_json  TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
```

其中 `session.user_id + session.user_snapshot_json` 用于实现「会话只绑定一个 user，但可替换」；
替换时会同步更新该会话下所有 floor 的 `metadata_json.user_binding`。

### 楼层表（floor）

```sql
CREATE TABLE floor (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES session(id),
  floor_no        INTEGER NOT NULL,
  branch_id       TEXT NOT NULL DEFAULT 'main',
  parent_floor_id TEXT,
  superseded_at   INTEGER,
  superseded_by_floor_id TEXT,
  state           TEXT NOT NULL DEFAULT 'draft',  -- draft / generating / committed / failed
  metadata_json   TEXT,                            -- 包含 user_binding
  token_in        INTEGER DEFAULT 0,
  token_out       INTEGER DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
```

当前用部分唯一索引约束 live floor：

```sql
CREATE UNIQUE INDEX floor_session_no_branch_live_uq
ON floor(session_id, floor_no, branch_id)
WHERE superseded_at IS NULL;
```

### 账号内用户卡（account_user）

```sql
CREATE TABLE account_user (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES account(id),
  name          TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',   -- active / disabled / deleted
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE(account_id, name)
);
```

`account_user` 是 user 角色卡的第一类实体，不再依赖 `session.metadata_json.persona`。
Prompt 组装优先读取 `session.user_snapshot_json`，仅为兼容老数据才回落到 `metadata.persona`。

### 消息页表（message_page）

```sql
CREATE TABLE message_page (
  id          TEXT PRIMARY KEY,
  floor_id    TEXT NOT NULL REFERENCES floor(id),
  page_no     INTEGER NOT NULL,
  page_kind   TEXT NOT NULL,          -- input / output / mixed
  is_active   INTEGER NOT NULL DEFAULT 1,
  version     INTEGER NOT NULL DEFAULT 1,
  checksum    TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(floor_id, page_no, version)
);
```

同时还存在一个部分唯一约束：

```sql
CREATE UNIQUE INDEX message_page_floor_no_active_uq
ON message_page(floor_id, page_no)
WHERE is_active = 1;
```

active 不变量是“同一 `(floor_id, page_no)` 最多一个 active version”，不是“同一 floor 最多一个 active page”。因此 input 槽位和 output 槽位可以同时 active。

### 消息表（message）

```sql
CREATE TABLE message (
  id              TEXT PRIMARY KEY,
  page_id         TEXT NOT NULL REFERENCES message_page(id),
  seq             INTEGER NOT NULL,
  role            TEXT NOT NULL,      -- user / assistant / system / narrator
  content         TEXT NOT NULL,
  content_format  TEXT DEFAULT 'text', -- text / markdown / json
  token_count     INTEGER DEFAULT 0,
  is_hidden       INTEGER DEFAULT 0,
  source          TEXT,               -- sillytavern / import / api / manual
  created_at      INTEGER NOT NULL,
  UNIQUE(page_id, seq)
);
```

### 变量表（variable）

```sql
CREATE TABLE variable (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,          -- global / chat / branch / floor / page
  scope_id    TEXT NOT NULL,          -- 对应的 session_id / branch 宿主 / floor_id / page_id
  key         TEXT NOT NULL,
  value_json  TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(scope, scope_id, key)
);
```

### 记忆表（memory_item）

```sql
CREATE TABLE memory_item (
  id                TEXT PRIMARY KEY,
  scope             TEXT NOT NULL,      -- global / chat / floor
  scope_id          TEXT NOT NULL,
  type              TEXT NOT NULL,      -- fact / summary / open_loop
  content_json      TEXT NOT NULL,
  fact_key          TEXT,
  importance        REAL DEFAULT 0.5,
  confidence        REAL DEFAULT 1.0,
  source_floor_id   TEXT,
  source_message_id TEXT,
  account_id        TEXT NOT NULL REFERENCES account(id),
  status            TEXT DEFAULT 'active',  -- active / deprecated
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
```

其中 `fact_key` 只对 `fact` 类型有意义。新写入会对 key 做归一化，冲突消解与批量查询使用 `(account_id, scope, scope_id, type, status, fact_key)` 索引，不再依赖从 `content_json` 反解 key。

### 记忆关系表（memory_edge）

```sql
CREATE TABLE memory_edge (
  id        TEXT PRIMARY KEY,
  from_id   TEXT NOT NULL REFERENCES memory_item(id),
  to_id     TEXT NOT NULL REFERENCES memory_item(id),
  relation  TEXT NOT NULL,            -- supports / contradicts / updates
  created_at INTEGER NOT NULL
);
```

### Prompt 快照表（prompt_snapshot）

```sql
CREATE TABLE prompt_snapshot (
  floor_id     TEXT PRIMARY KEY REFERENCES floor(id) ON DELETE CASCADE,
  session_id   TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  preset_id    TEXT REFERENCES preset(id) ON DELETE SET NULL,
  preset_updated_at INTEGER,
  worldbook_id TEXT REFERENCES worldbook(id) ON DELETE SET NULL,
  worldbook_updated_at INTEGER,
  regex_profile_id TEXT REFERENCES regex_profile(id) ON DELETE SET NULL,
  regex_profile_updated_at INTEGER,
  worldbook_activated_entry_uids_json TEXT NOT NULL DEFAULT '[]',
  regex_pre_rule_names_json  TEXT NOT NULL DEFAULT '[]',
  regex_post_rule_names_json TEXT NOT NULL DEFAULT '[]',
  prompt_mode   TEXT NOT NULL,
  prompt_digest TEXT NOT NULL,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
```

`prompt_snapshot` 用来冻结某个 floor 实际生成时使用的 Prompt 资源版本和摘要信息。dry-run 返回的是同字段模型的预览，不写库。

### 工具执行记录表（tool_execution_record）

```sql
CREATE TABLE tool_execution_record (
  id                         TEXT PRIMARY KEY,
  run_id                     TEXT NOT NULL,
  floor_id                   TEXT NOT NULL REFERENCES floor(id) ON DELETE CASCADE,
  page_id                    TEXT REFERENCES message_page(id) ON DELETE SET NULL,
  caller_slot                TEXT NOT NULL,
  provider_id                TEXT NOT NULL,
  tool_name                  TEXT NOT NULL,
  provider_type              TEXT NOT NULL DEFAULT 'unknown',
  args_json                  TEXT NOT NULL DEFAULT '{}',
  result_json                TEXT NOT NULL DEFAULT '{}',
  status                     TEXT NOT NULL DEFAULT 'running',
  lifecycle_state            TEXT NOT NULL DEFAULT 'finished',
  commit_outcome             TEXT NOT NULL DEFAULT 'pending',
  side_effect_level          TEXT,
  error_message              TEXT,
  duration_ms                INTEGER NOT NULL DEFAULT 0,
  started_at                 INTEGER NOT NULL DEFAULT 0,
  finished_at                INTEGER,
  attempt_no                 INTEGER NOT NULL DEFAULT 1,
  replay_parent_execution_id TEXT,
  created_at                 INTEGER NOT NULL
);
```

主审计模型已经是 `tool_execution_record`。它以 `floor_id` 为主归属，`page_id` 只在上层已有真实页上下文时写入，因此允许为空。

`tool_call_record` 在兼容期仍会保留，但它只用于旧查询面，不再是新的审计真相来源。

---

## 9. API 概览

所有接口都是 RESTful 风格，返回 JSON。

### 会话管理

| 方法   | 路径            | 说明         |
| ------ | --------------- | ------------ |
| POST   | `/sessions`     | 创建会话     |
| GET    | `/sessions`     | 列出会话     |
| GET    | `/sessions/:id` | 获取会话详情 |
| PATCH  | `/sessions/:id` | 更新会话配置 |
| DELETE | `/sessions/:id` | 删除会话     |

### 用户卡管理

| 方法   | 路径         | 说明 |
| ------ | ------------ | ---- |
| POST   | `/users`     | 创建账号内用户卡 |
| GET    | `/users`     | 列出账号内用户卡 |
| GET    | `/users/:id` | 获取用户卡详情 |
| PATCH  | `/users/:id` | 更新用户卡（快照/状态） |
| DELETE | `/users/:id` | 软删除用户卡 |

### 生成与聊天

| 方法 | 路径                            | 说明                                       |
| ---- | ------------------------------- | ------------------------------------------ |
| POST | `/sessions/:id/respond`         | 发送消息并获取 AI 回复（核心接口）         |
| POST | `/sessions/:id/respond/stream`  | SSE 流式返回 AI 回复片段                   |
| POST | `/sessions/:id/respond/dry-run` | 仅组装 Prompt 并返回调试元信息（无副作用） |
| POST | `/sessions/:id/regenerate`      | 重新生成最后一个楼层                       |
| GET  | `/sessions/:id/timeline`        | 获取完整时间线（楼层 + 消息页）            |

### 楼层与消息

| 方法  | 路径                  | 说明                 |
| ----- | --------------------- | -------------------- |
| GET   | `/floors/:id`         | 获取楼层详情         |
| POST  | `/floors/:id/branch`  | 从该楼层创建分支     |
| GET   | `/floors/:id/pages`   | 列出楼层的所有消息页 |
| PATCH | `/pages/:id/activate` | 在同一 `(floor_id, page_no)` 槽位内切换当前生效的消息页 |

说明：

- `POST /pages` 和 `PATCH /pages/:id` 不再接受公开的 `is_active` 写入
- `PATCH /pages/:id/activate` 是唯一公开的激活入口，并且只影响同一 `(floor_id, page_no)` 槽位
- `page_kind = "input"` 的页不允许通过该入口激活

### 变量

| 方法   | 路径             | 说明                          |
| ------ | ---------------- | ----------------------------- |
| GET    | `/variables`     | 查询变量（支持按 scope 过滤） |
| PUT    | `/variables`     | 设置变量                      |
| DELETE | `/variables/:id` | 删除变量                      |

### 导入导出（酒馆兼容）

| 方法 | 路径                | 说明                                               |
| ---- | ------------------- | -------------------------------------------------- |
| POST | `/import/preset`    | 导入酒馆预设                                       |
| POST | `/import/worldbook` | 导入酒馆世界书                                     |
| POST | `/import/regex`     | 导入酒馆正则规则                                   |
| POST | `/import/character` | 导入酒馆角色卡                                     |
| POST | `/import/chat`      | 导入聊天文件（自动识别 `.thchat` 原生 / ST `.jsonl`） |

### 导出

| 方法 | 路径                     | 说明                                          |
| ---- | ------------------------ | --------------------------------------------- |
| GET  | `/export/chat/:id`       | 导出会话（`.thchat` 无损 / `.jsonl` ST 兼容） |
| GET  | `/export/preset/:id`     | 导出预设（ST 原始 JSON）                      |
| GET  | `/export/worldbook/:id`  | 导出世界书（ST 格式 JSON）                    |
| GET  | `/export/regex/:id`      | 导出正则配置（ST 格式 JSON 数组）             |
| GET  | `/export/character/:id`  | 导出角色卡（ST Character Card V2 JSON）       |

导入和导出形成对称关系：导入解析外部格式写入数据库，导出从数据库序列化为标准文件。聊天文件额外有一套 TavernHeadless 原生格式（`.thchat`），能无损保留完整四层数据结构、变量、记忆，以及 superseded 楼层历史关系。

---

## 10. 事件系统

系统内部使用事件总线（emittery）来解耦各模块。以下是主要事件：

| 事件名                 | 触发时机       | 携带数据              |
| ---------------------- | -------------- | --------------------- |
| `floor.stateChanged`   | 楼层状态变化   | floor + previousState + newState |
| `floor.committed`      | 短事务提交完成 | floor + promotedVariables |
| `floor.failed`         | 楼层失败       | floor + error |
| `generation.started`   | 开始调用 LLM   | floorId |
| `generation.chunk`     | 收到流式片段   | floorId + chunk + accumulatedLength |
| `generation.completed` | 生成完成       | floorId + text + usage + summaries |
| `generation.failed`    | 生成失败       | floorId + error |
| `memory.created`       | 创建记忆       | item + source |
| `memory.updated`       | 更新记忆       | item + previousContent |
| `memory.deprecated`    | 记忆废弃       | item + reason |
| `memory.deleted`       | 物理删除记忆条目的 committed 真相 | item + before + source |
| `memory.edge.created`  | 新建记忆关系边的 committed 真相   | edge + after + source |
| `memory.edge.deleted`  | 删除记忆关系边的 committed 真相   | edge + before + source |
| `memory.consolidated`  | consolidation 写回完成 | floorId + created / updated / deprecated |
| `memory.injection_failed` | 记忆注入失败但主流程继续 | sessionId + error |
| `memory.persist_failed` | 记忆事务写回失败并触发回滚 | floorId + sessionId + error |
| `memory.consolidation_context_failed` | 整理上下文加载失败 | sessionId + error |
| `memory.consolidation_json_parse_failed` | 整理 JSON 解析失败并降级 | floorId + rawText + error |
| `memory.consolidation_failed` | 整理阶段异常但回合继续 | floorId + error |
| `tool.call_started`    | 工具调用开始   | floorId + pageId? + toolName + args |
| `tool.call_completed`  | 工具调用完成   | floorId + pageId? + toolName + result + durationMs |
| `tool.call_failed`     | 工具调用失败   | floorId + pageId? + toolName + error |
| `tool.call_denied`     | 工具调用被拒绝 | floorId + pageId? + toolName + reason |

这些事件可以用来：

- 在前端实时显示生成进度（通过 WebSocket 转发）。
- 记录日志和调试信息。
- 触发自定义逻辑（插件系统的基础）。

---

## 11. 工具调用（Tool Calling）

工具调用让 LLM 实例在 RP 回合中执行结构化操作——读写变量、掷骰、查询记忆等——而不仅仅是生成自由文本。

### 设计目标

- 所有 LLM 实例（Narrator / Director / Verifier / Memory）都可以调用工具，但每个实例的工具权限独立配置。
- 主审计模型是 `tool_execution_record`，以 floor 为主归属，并允许附带可空的 `page_id`。
- 运行时工具目录是**会话级**快照，通过 `/sessions/:id/tools/runtime` 暴露当前 session 真正可调用的 builtin / custom / MCP 工具集合。
- 当前公开配置的 `toolMode` 仍只有 `inline`。`standalone` 和 `both` 会返回结构化配置错误，不再被文档视为已实现能力；但在 `inline` 回合内部，允许部分 allowlisted 工具先返回 deferred receipt，再通过 `runtime_job` 延后完成。
- 兼容期内仍保留 `tool_call_record` 供旧查询接口使用，但它不是长期主模型。

### 工具来源

| 来源 | 说明 |
| ---- | ---- |
| **内置工具（builtin）** | 引擎自带的 7 个通用工具：`get_variable`、`set_variable`、`roll_dice`、`random_choice`、`get_time`、`query_memory`、`get_character_info` |
| **资源管理工具（builtin）** | 23 个资源操作工具（`ResourceToolProvider`）：角色卡 CRUD + 版本列表（5 个）、世界书 CRUD + 条目摘要/单读（7 个）、正则配置读写 + 列表/创建（6 个）、预设读写（5 个）。允许 LLM 在对话中主动读写资源，创建的资源 `source = 'tool'`。写入工具 `sideEffectLevel = 'irreversible'`。 |
| **预设/角色卡工具（preset）** | 从数据库加载的自定义工具定义，支持脚本执行 |
| **MCP 工具** | 通过 MCP（Model Context Protocol）连接外部工具服务器。支持 stdio 和 Streamable HTTP 两种传输方式。通过 `ENABLE_MCP=true` 启用，需通过 API 配置 MCP 服务器后才会注册工具。 |

### 当前支持的执行模式

通过 `TurnConfig.toolMode` 控制：

| 模式 | 说明 |
| ---- | ---- |
| `inline` | 工具定义传入 Vercel AI SDK 的 `tools` 参数，LLM 在生成过程中自主决定是否调用（通过 `maxSteps` 多步执行）。这是默认模式。对于允许延后执行的工具，`inline` 回合内部仍可能返回 deferred receipt，并附带 `runtime_job_id`。 |
| `standalone` | 当前未实现。服务端会返回结构化配置错误。 |
| `both` | 当前未实现。服务端会返回结构化配置错误。 |

这意味着对外契约上不能再把 `standalone` 或 `both` 当成可工作的运行模式来描述。

### 权限控制

工具权限通过 `ToolPermissions` 配置，存储在会话的 `metadata_json.tool_permissions` 中：

- **`slotAllowList`**：按实例槽位允许的工具名白名单。
- **`slotDenyList`**：按实例槽位禁止的工具名黑名单。
- **`allowIrreversible`**：是否允许不可撤销的工具（默认拒绝）。
- **`maxCallsPerTurn`**：单回合最大工具调用次数。
- **`maxStepsPerGeneration`**：Vercel AI SDK 的 `maxSteps` 上限（默认 5）。

每个工具定义都声明 `allowedSlots`（允许调用的实例类型）和 `sideEffectLevel`（副作用级别）。解析权限时经过四层过滤：

```text
allowedSlots → slotAllowList → slotDenyList → allowIrreversible
```

### 副作用级别

| 级别 | 说明 | 示例 |
| ---- | ---- | ---- |
| `none` | 纯查询，无副作用 | `get_variable`、`roll_dice`、`get_time` |
| `sandbox` | 副作用写入 page scope，楼层提交时才提升 | `set_variable` |
| `irreversible` | 不可撤销的外部操作，需要显式授权 | 资源管理工具的写入操作、MCP 外部 API 调用 |

### 执行审计与隔离

- 每次真实工具调用都会生成一条 `tool_execution_record`，通过 `floor_id` 归属到当前楼层。
- `page_id` 是可选绑定：当工具发生在 output page 创建之前，它可以为空；如果上层已经持有真实 input page，会一并透传写入。
- 重新生成（regen）会创建新楼层，工具重新执行，不复用之前的调用记录。
- 工具的副作用（如写变量）先写入 page scope，只有在楼层提交时才提升到更高层级。
- 兼容期仍会补写 `tool_call_record`，旧查询接口继续按 page 维度读取；新路径应优先使用 `tool_execution_record`，并把 `tool_call_record` 视为兼容只读模型。

### 回合流程中的位置

工具调用插入在 Director 之后、Narrator 生成之前（或生成过程中）：

```text
② Director（可选）
    ↓
②b 工具初始化（enableTools 时）
    创建 ToolExecutor → 按权限过滤可用工具 → 构建 LLM tools
    ↓
⑤ Narrator 生成（inline 模式下工具调用嵌入此步骤）
    ↓
⑤b 收集真实工具执行记录 → commit 阶段写入 tool_execution_record
```

### 架构组件

| 组件 | 位置 | 职责 |
| ---- | ---- | ---- |
| `ToolRegistry` | `packages/core/src/tools/` | 管理所有 ToolProvider，按实例槽位过滤可用工具 |
| `ToolExecutor` | `packages/core/src/tools/` | 执行工具调用，权限检查，事件发射，计数限制 |
| `BuiltinToolProvider` | `packages/core/src/tools/` | 内置 7 个工具的实现 |
| `PresetToolProvider` | `packages/core/src/tools/` | 从数据库加载自定义工具；`script` handler 默认不执行，需显式受信开关 |
| `ToolProvider` 接口 | `packages/core/src/tools/` | 工具提供者抽象接口 |
| `McpToolProvider` | `apps/api/src/mcp/` | MCP 工具提供者，通过 McpConnectionManager 代理工具调用 |
| `McpConnectionManager` | `apps/api/src/mcp/` | 管理多个 MCP 服务器连接的生命周期 |
| `DrizzleToolExecutionRepository` | `apps/api/src/adapters/` | `tool_execution_record` 的数据库操作 |
| `DrizzleToolRepository` | `apps/api/src/adapters/` | 兼容期 `tool_call_record` 与工具定义的数据库操作 |
| `ToolService` | `apps/api/src/services/` | 工具管理业务层 |
| 工具路由 | `apps/api/src/routes/tools.ts` | 11 个 API 端点 |

### API 端点

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET | `/tools/builtin` | 列出内置工具 |
| GET | `/tools/definitions` | 列出自定义工具定义 |
| GET | `/tools/definitions/:id` | 获取单个工具定义 |
| POST | `/tools/definitions` | 创建自定义工具 |
| PATCH | `/tools/definitions/:id` | 更新工具定义 |
| DELETE | `/tools/definitions/:id` | 删除工具定义 |
| PATCH | `/tools/definitions/:id/toggle` | 启用/禁用工具 |
| GET | `/tools/executions` | 查询主执行审计记录（`tool_execution_record`） |
| GET | `/tools/call-records` | 查询兼容调用记录（`tool_call_record`） |
| GET | `/sessions/:id/tools/runtime` | 获取会话级运行时工具目录快照 |
| GET | `/sessions/:id/tool-permissions` | 获取会话工具权限 |
| PUT | `/sessions/:id/tool-permissions` | 替换会话工具权限 |
| PATCH | `/sessions/:id/tool-permissions` | 合并更新会话工具权限 |
| GET | `/mcp/servers` | 列出 MCP 服务器配置 |
| GET | `/mcp/servers/:id` | 获取单个 MCP 服务器配置 |
| POST | `/mcp/servers` | 创建 MCP 服务器配置 |
| PATCH | `/mcp/servers/:id` | 更新 MCP 服务器配置 |
| DELETE | `/mcp/servers/:id` | 删除 MCP 服务器配置 |
| PATCH | `/mcp/servers/:id/toggle` | 启用/禁用 MCP 服务器 |
| GET | `/mcp/servers/:id/status` | 查看连接状态 |
| GET | `/mcp/statuses` | 查看所有连接状态 |
| POST | `/mcp/servers/:id/connect` | 连接/重连 |
| POST | `/mcp/servers/:id/disconnect` | 断开连接 |
| GET | `/mcp/servers/:id/tools` | 查看服务器工具列表 |
| POST | `/mcp/servers/:id/test` | 测试连接 |

说明：

- `script` handler 在 Beta3 默认关闭。
- 只有服务端显式设置 `ENABLE_UNSAFE_SCRIPT_HANDLER=true` 时，`/tools/definitions` 的 script 创建、更新和重新启用才会放行。
- 在默认关闭状态下，历史 definition-backed script tools 会在 `/sessions/:id/tools/runtime` 中显示为 `unavailable`，不会进入可执行运行时目录。

`/mcp/statuses` 和 `/mcp/servers/:id/status` 现在还会暴露 `reconnect_required`、`last_timeout_at`。当一次 MCP 调用触发 `mcp_call_uncertain_timeout` 时，语义是“结果不确定并且需要重连”，不是普通的确定性失败。

`/mcp/servers` 和 `/mcp/servers/:id` 现在还会回显 `live_status`。当 `ENABLE_MCP=true` 时，create / update / enable / disable / delete 会直接同步 live `McpConnectionManager`，不再保留“数据库已变、运行时未变”的分裂状态；如果 runtime 没有挂载，也会通过 `attached` / `reason` 明确回显。

世界书 `position=outlet` 现在会进入真实 prompt 组装：优先按同名 outlet marker/placement 注入；如果没有匹配 marker，则回退为显式 section，而不是静默丢弃。Regex 主链也会透传 `runOnEdit` 与 depth 上下文：`edit-and-regenerate` 使用 `channel="edit"`，USER_INPUT / AI_OUTPUT / at-depth WORLD_INFO 会消费 `minDepth` / `maxDepth`。

同一 `session + branch` 上的排队语义仍只在当前进程内生效。这里没有分布式锁，也没有跨实例队列。
