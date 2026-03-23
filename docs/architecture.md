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
- **提交后不可改**：一旦提交，楼层内容就锁定了。想改？新建一个楼层。

### 消息页（MessagePage）

楼层内的一个「版本」。比如你点了重新生成（regen），就会在同一个楼层里新建一个消息页，旧的还在。

消息页的作用：

- 保存重试/重新生成的不同版本。
- 流式生成时先写到消息页里，生成完再标记为生效。
- 每个楼层有且只有一个「当前生效页」。

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

### 四个层级

| 层级               | 作用域       | 典型用途                   | 生命周期           |
| ------------------ | ------------ | -------------------------- | ------------------ |
| **全局（global）** | 整个项目     | 世界观设定、全局开关       | 永久               |
| **会话（chat）**   | 一次聊天     | 好感度、已触发事件         | 会话期间           |
| **楼层（floor）**  | 一个回合     | 本回合判定结果、临时标记   | 楼层提交后冻结     |
| **页（page）**     | 一次生成尝试 | 生成中间状态、工具调用暂存 | 生成完成后决定去留 |

### 读写规则

**读取时**，按从小到大的顺序查找，找到就停：

```text
page → floor → chat → global
```

比如读取变量 `mood`：先看当前页有没有，没有就看楼层，再看会话，最后看全局。

**写入时**，默认写到 `page`（最小范围）。这是一种保护机制——页级变量就像沙箱，不会意外改到全局状态。

**提升**：如果确实需要把变量保存到更高层级，需要显式提升。比如一次回合结束后，把 `page.mood` 提升到 `chat.mood`。这个过程由编排器控制，不会默默发生。

### 为什么要有「页」这一层？

主要解决重新生成时的隔离问题。假设 AI 生成了一个回复并且写了 `mood = happy`，你觉得不好点了重试，新的生成写了 `mood = sad`。如果没有页级变量，两次生成会互相覆盖。有了页级变量，每次生成都在自己的沙箱里，只有你选定的那个版本才会被提升到楼层或会话。

---

## 4. 提示词系统

提示词系统负责把你的预设、世界书、变量、聊天记录等拼成一份完整的提示词，发给 LLM。

### 双轨设计

我们提供两条路径：

### 路径一：酒馆兼容模式（compat）

直接导入酒馆的预设和世界书，按照酒馆的方式拼接提示词。适合已经有成熟预设的用户，导入即用。

这条路径又分两档：

- `compat_strict`：严格复刻酒馆行为，变量展开、世界书触发、拼接顺序都尽量一致。
- `compat_plus`：在兼容基础上可以加高级功能（比如自动记忆摘要），但不破坏原有行为。

### 路径二：原生编排模式（native）

完全使用我们自己的提示词编排器。编排器是一条流水线，你可以自由组合以下节点：

| 节点                | 做什么                              |
| ------------------- | ----------------------------------- |
| `template`          | 渲染模板，填入变量                  |
| `condition`         | 按条件选择不同的模板或路径          |
| `worldbook_resolve` | 检查世界书触发条件，注入命中的条目  |
| `transform`         | 正则替换、文本清洗                  |
| `memory_inject`     | 注入记忆摘要和关键事实              |
| `token_budget`      | 按 token 预算裁剪历史消息           |
| `pack_messages`     | 最终拼装成 LLM 要求的 messages 数组 |

当前 v1 已落地 `template / condition / worldbook_resolve / transform / memory_inject / token_budget / pack_messages` 闭环，
并在 API 侧支持会话显式字段 `session.prompt_mode`。解析优先级是：
`session.prompt_mode` > `metadata.promptMode` > `metadata.prompt_mode`。

### 统一中间格式（Prompt IR）

不管走哪条路径，最终都会先编译成一个统一的中间格式，再交给 LLM。这意味着：

- 酒馆预设和原生编排共享同一个渲染器。
- 加新功能只需要加新节点，不需要改兼容层。
- 调试时可以看到中间格式的完整内容，方便排查问题。

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

### LLM 实例与 Profile 的关系

每个 LLM 实例（Narrator / Director / Verifier / Memory）可以独立绑定不同的 **LLM Profile**。Profile 是一组加密存储的 LLM 凭证配置，包含 provider、modelId、apiKey 等。

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
    { "key": "角色B即将离开", "value": "计划下周离开", "scope": "chat" }
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

### 记忆怎么用

每次组装提示词时，编排器会：

1. 按 token 预算分配记忆可用空间。
2. 按重要程度和相关性选取记忆条目。
3. 打包成「记忆摘要块」注入到提示词中。
4. 在兼容模式下，还会按酒馆的方式将摘要放到旧楼层的位置（替代被隐藏的完整内容）。

### 安全机制

- Memory 实例的输出需要经过校验才会写入数据库，不会直接落库。
- 摘要文本会做基本的清洗，过滤掉可能的提示词注入（比如「忽略以上所有指令」这种内容）。
- 所有记忆操作都有完整的来源追溯，可以知道每条记忆是什么时候、从哪个楼层产生的。

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
   归一化记忆，输出 facts_add / update / deprecate
   校验通过后从 page 提升到 floor / chat
    │
    ▼
⑨ 提交楼层
   楼层状态 → committed
   页级变量按策略提升
   触发 floor.committed 事件
    │
    ▼
返回结果给用户
```

如果中间任何步骤失败，楼层标记为 `failed`，保留现场方便排查。

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
  state           TEXT NOT NULL DEFAULT 'draft',  -- draft / generating / committed / failed
  metadata_json   TEXT,                            -- 包含 user_binding
  token_in        INTEGER DEFAULT 0,
  token_out       INTEGER DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE(session_id, floor_no, branch_id)
);
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
  scope       TEXT NOT NULL,          -- global / chat / floor / page
  scope_id    TEXT NOT NULL,          -- 对应的 session_id / floor_id / page_id
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
  importance        REAL DEFAULT 0.5,
  confidence        REAL DEFAULT 1.0,
  source_floor_id   TEXT,
  source_message_id TEXT,
  status            TEXT DEFAULT 'active',  -- active / deprecated
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
```

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
| PATCH | `/pages/:id/activate` | 切换当前生效的消息页 |

### 变量

| 方法   | 路径             | 说明                          |
| ------ | ---------------- | ----------------------------- |
| GET    | `/variables`     | 查询变量（支持按 scope 过滤） |
| PUT    | `/variables`     | 设置变量                      |
| DELETE | `/variables/:id` | 删除变量                      |

### 导入导出（酒馆兼容）

| 方法 | 路径                | 说明             |
| ---- | ------------------- | ---------------- |
| POST | `/import/preset`    | 导入酒馆预设     |
| POST | `/import/worldbook` | 导入酒馆世界书   |
| POST | `/import/regex`     | 导入酒馆正则规则 |
| POST | `/import/character` | 导入酒馆角色卡   |

---

## 10. 事件系统

系统内部使用事件总线（emittery）来解耦各模块。以下是主要事件：

| 事件名                 | 触发时机       | 携带数据              |
| ---------------------- | -------------- | --------------------- |
| `session.created`      | 创建会话后     | session 对象          |
| `floor.created`        | 创建楼层后     | floor 对象            |
| `floor.committed`      | 楼层提交后     | floor 对象 + 变量变更 |
| `floor.failed`         | 楼层生成失败   | floor 对象 + 错误信息 |
| `page.activated`       | 切换生效消息页 | page 对象             |
| `message.appended`     | 新消息写入     | message 对象          |
| `generation.started`   | 开始调用 LLM   | 模型配置 + token 预算 |
| `generation.chunk`     | 收到流式片段   | 文本片段              |
| `generation.completed` | 生成完成       | 完整文本 + token 统计 |
| `generation.failed`    | 生成失败       | 错误信息              |
| `memory.extracted`     | 提取到摘要     | 摘要内容 + 来源       |
| `memory.committed`     | 记忆写入数据库 | 记忆操作列表          |
| `worldbook.matched`    | 世界书条目命中 | 命中的条目列表        |
| `regex.applied`        | 正则规则执行   | 规则 ID + 替换结果    |

| `tool.call_started`    | 工具调用开始   | 工具名 + 参数 + 调用方实例 |
| `tool.call_completed`  | 工具调用完成   | 工具名 + 返回值 + 耗时     |
| `tool.call_failed`     | 工具调用失败   | 工具名 + 错误信息           |
| `tool.call_denied`     | 工具调用被拒绝 | 工具名 + 拒绝原因           |

这些事件可以用来：

- 在前端实时显示生成进度（通过 WebSocket 转发）。
- 记录日志和调试信息。
- 触发自定义逻辑（插件系统的基础）。

---

## 11. 工具调用（Tool Calling）

工具调用让 LLM 实例在 RP 回合中执行结构化操作——读写变量、掷骰、查询记忆等——而不仅仅是生成自由文本。

### 设计目标

- 所有 LLM 实例（Narrator / Director / Verifier / Memory）都可以调用工具，但每个实例的工具权限独立配置。
- 工具调用记录绑定到 MessagePage，遵循三层消息结构的隔离原则。
- 支持两种执行模式，可按场景切换。

### 工具来源

| 来源 | 说明 |
| ---- | ---- |
| **内置工具（builtin）** | 引擎自带的 7 个工具：`get_variable`、`set_variable`、`roll_dice`、`random_choice`、`get_time`、`query_memory`、`get_character_info` |
| **预设/角色卡工具（preset）** | 从数据库加载的自定义工具定义，支持脚本执行 |
| **MCP 工具** | 通过 MCP（Model Context Protocol）连接外部工具服务器。支持 stdio 和 Streamable HTTP 两种传输方式。通过 `ENABLE_MCP=true` 启用，需通过 API 配置 MCP 服务器后才会注册工具。 |

### 两种执行模式

通过 `TurnConfig.toolMode` 控制：

| 模式 | 说明 |
| ---- | ---- |
| `inline` | 工具定义传入 Vercel AI SDK 的 `tools` 参数，LLM 在生成过程中自主决定是否调用（通过 `maxSteps` 多步执行）。这是默认模式。 |
| `standalone` | 工具在 LLM 生成之前或之后独立执行，不嵌入生成流程。 |
| `both` | 同时启用两种模式。 |

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
| `irreversible` | 不可撤销的外部操作，需要显式授权 | MCP 外部 API 调用 |

### 调用记录与消息页隔离

- 每次工具调用生成一条 `ToolCallRecord`，通过 `page_id` 外键绑定到 `MessagePage`。
- 重新生成（regen）会创建新楼层，工具重新执行，不复用之前的调用记录。
- 切换消息页时，每个页面有自己独立的工具调用快照。
- 工具的副作用（如写变量）先写入 page scope，只有在楼层提交时才提升到更高层级。

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
⑤b 收集工具调用记录
```

### 架构组件

| 组件 | 位置 | 职责 |
| ---- | ---- | ---- |
| `ToolRegistry` | `packages/core/src/tools/` | 管理所有 ToolProvider，按实例槽位过滤可用工具 |
| `ToolExecutor` | `packages/core/src/tools/` | 执行工具调用，权限检查，事件发射，计数限制 |
| `BuiltinToolProvider` | `packages/core/src/tools/` | 内置 7 个工具的实现 |
| `PresetToolProvider` | `packages/core/src/tools/` | 从数据库加载的自定义工具提供者 |
| `ToolProvider` 接口 | `packages/core/src/tools/` | 工具提供者抽象接口 |
| `McpToolProvider` | `apps/api/src/mcp/` | MCP 工具提供者，通过 McpConnectionManager 代理工具调用 |
| `McpConnectionManager` | `apps/api/src/mcp/` | 管理多个 MCP 服务器连接的生命周期 |
| `DrizzleToolRepository` | `apps/api/src/adapters/` | 工具调用记录和工具定义的数据库操作 |
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
| GET | `/tools/call-records` | 查询工具调用记录 |
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
