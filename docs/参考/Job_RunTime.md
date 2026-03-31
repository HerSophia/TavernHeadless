# TavernHeadless 通用 Runtime 方案（基于现有 Memory Job / Worker 机制抽象）

> 目标：在不破坏当前聊天主链路语义的前提下，将现有 `memory` 的作业化能力抽象为一套可复用的通用 Runtime，逐步承接：
>
> - 工具调用（尤其是 `irreversible`）
> - 变量变更的统一提交模型
> - 资源写操作
> - 维护 / 重建 / 压缩 / 导出等后台任务
>
> **核心原则：**
>
> 1. **主链同步提交，支链后台作业**
> 2. **高频状态变更先统一语义，不急着统一异步**
> 3. **先抽象 Runtime，再迁移模块**
> 4. **复用现有 memory 的 lease / retry / revision guard 思路**

---

## 1. 先讲结论

当前系统不适合把所有模块都硬塞进一个“全异步事务队列”。

更合理的方向是拆成两层：

#### 1.1 State Mutation Runtime（状态变更运行时）

用于统一描述“一个变更动作”：

- 谁发起
- 作用到哪个 scope
- 在什么时候生效
- 是否进入 commit
- 是否允许回放
- 是否允许异步执行
- 失败后如何处理

它主要服务于：

- 变量系统
- 工具副作用
- 资源写入
- 某些会话配置变更

#### 1.2 Background Job Runtime（后台作业运行时）

用于统一执行“可延后的作业”：

- 入队
- leasing
- retry/backoff
- dead letter
- scope 串行
- revision guard
- 事件
- 可观测性

它主要服务于：

- memory ingest / compact / maintenance
- irreversible tool call
- 资源重建 / 导出 / 索引
- 异步维护任务

---

## 2. 为什么要拆成两层

如果把“变量提交”和“后台作业”混为一谈，会有两个问题：

#### 2.1 变量语义会被破坏

变量系统当前与 turn commit 强绑定：

- 工具执行期间先产生 buffered mutation
- commit 时统一 flush
- 再按策略 `page -> floor` 提升

这类动作和消息提交是一体的，不能轻易改成“先回复、后排队补变量”。

否则会出现：

- assistant message 已提交，但变量还没生效
- floor 已 committed，但 floor scope 状态未对齐
- regenerate 看到的叙事状态和消息正文不一致

#### 2.2 工具和维护任务又确实需要队列能力

例如：

- MCP 调用
- 资源写工具
- memory maintenance
- rebuild / compaction
- 导出任务

它们天然需要：

- retry
- timeout 分类
- uncertain outcome
- dead letter
- replay safety
- 跨作用域串行

所以最好的做法不是“只有一个 Runtime 干所有事”，而是：

- **Mutation Runtime 管语义**
- **Job Runtime 管异步执行**

---

## 3. 总体架构图

```text
┌────────────────────────────────────────────────────────┐
│                    API / ChatService                   │
│                                                        │
│  respond / regenerate / tool call / session mutation  │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                State Mutation Runtime                  │
│                                                        │
│  Mutation Envelope                                     │
│  - kind                                                │
│  - source                                              │
│  - scope                                               │
│  - applyPhase                                          │
│  - durability                                          │
│  - replaySafety                                        │
│  - idempotencyKey                                      │
│  - conflictPolicy                                      │
└───────────────┬─────────────────────┬──────────────────┘
                │                     │
                │ commit-time         │ async-eligible
                ▼                     ▼
┌──────────────────────────┐   ┌─────────────────────────┐
│ Turn Commit Service      │   │ Background Job Runtime  │
│                          │   │                         │
│ - flush buffered vars    │   │ - enqueue               │
│ - promote page->floor    │   │ - lease                 │
│ - persist audit          │   │ - retry/backoff         │
│ - CAS floor state        │   │ - dead letter           │
└──────────────────────────┘   │ - scope serialization   │
                               │ - revision guard        │
                               └──────────┬──────────────┘
                                          ▼
                               ┌─────────────────────────┐
                               │ Worker / Processor      │
                               │                         │
                               │ memory / tools / export │
                               │ rebuild / maintenance   │
                               └─────────────────────────┘
```

---

## 4. 统一 Runtime 的核心概念

#### 4.1 Mutation Envelope

所有“变更”都先抽象成一个统一对象，而不是直接分散写库。

建议核心字段：

```ts
type MutationApplyPhase = "inline" | "commit" | "async";
type MutationDurability = "ephemeral" | "transactional" | "durable_job";

type MutationReplaySafety =
  | "safe"
  | "confirm_on_replay"
  | "never_auto_replay"
  | "uncertain";

type MutationConflictPolicy =
  | "replace"
  | "if_absent"
  | "compare_and_swap"
  | "merge";

interface RuntimeMutationEnvelope {
  id: string;
  kind: string;                 // variable.set / tool.call / resource.update / memory.ingest ...
  source: "tool" | "system" | "api" | "maintenance" | "worker";
  accountId: string;
  sessionId?: string;
  floorId?: string;
  pageId?: string;

  scope?: {
    type: "global" | "chat" | "floor" | "page" | "resource" | "external";
    key: string;
  };

  applyPhase: MutationApplyPhase;
  durability: MutationDurability;
  replaySafety: MutationReplaySafety;
  conflictPolicy?: MutationConflictPolicy;

  idempotencyKey?: string;
  payloadJson: string;

  createdAt: number;
}
```

##### 设计意图

- **变量**：统一描述为 mutation，而不是“变量表 upsert 特判”
- **工具调用**：先统一描述为 mutation，再决定 inline/commit/async
- **资源写入**：不再散落在 service / route / tool handler 中各自决定提交语义
- **后台任务**：与 mutation 之间建立稳定桥接

---

#### 4.2 Apply Phase

所有变更分三类：

##### `inline`

立即执行，结果立刻返回，但通常**不直接持久化为最终真相**

适合：

- 纯查询工具
- 只用于生成过程内部判断的临时动作

##### `commit`

作为 turn commit 的一部分执行

适合：

- buffered variable flush
- page -> floor 变量提升
- 与本回合消息强一致绑定的审计写入
- 与本次 commit 强绑定的资源快照

##### `async`

进入后台 job runtime

适合：

- irreversible tool call
- memory ingest / maintenance / rebuild
- 导出 / 重建 / 索引任务
- 非本回合必须完成的资源操作

---

#### 4.3 Scope Key

后台 job 必须定义统一的串行粒度，否则会很容易互相覆盖。

建议：

```ts
type RuntimeScopeKey =
  | `chat:${string}`
  | `floor:${string}`
  | `page:${string}`
  | `resource:${string}`
  | `tool:${string}`
  | `external:${string}`;
```

##### 建议串行规则

- **memory job**：按 `account + scope + scopeId`
- **同一 session + branch 的生成**：按 `session + branch`
- **同一资源写入**：按 `resource:<type>:<id>`
- **同一外部工具目标**：按 `external:<provider>:<target>`

---

## 5. 从现有 Memory 方案抽象什么

当前 memory 已经有一套很接近通用 job runtime 的能力：

- 持久化 job
- worker 轮询
- lease TTL
- retry/backoff
- dead letter
- scope state
- revision guard
- compact / maintenance / rebuild job
- 事件发射

这些都值得抽出来成为通用层。现有 repo 中的 `MemoryWorker`、`MemoryJobScheduler`、scope lease / revision guard 已经是很好的原型。相关机制已在代码中落地，且 `memory` 已支持 ingest、macro compaction、maintenance、rebuild 等作业。([github.com](https://github.com/HerSophia/TavernHeadless/blob/main/apps/api/src/services/memory-worker.ts)) ([github.com](https://github.com/HerSophia/TavernHeadless/blob/main/apps/api/src/services/memory-job-scheduler.ts))

---

## 6. 建议拆出的通用模块

---

#### 6.1 `RuntimeJobScheduler`

从 `MemoryJobScheduler` 提取出通用部分。

##### 目标职责

- 生成 job id
- 统一 enqueue
- 做 payload schema 校验
- 统一 schedule / availableAt
- 幂等插入
- 规范 job type

##### 建议接口

```ts
interface EnqueueRuntimeJobInput<TPayload> {
  jobId?: string;
  jobType: string;
  accountId: string;

  scopeType: string;
  scopeKey: string;

  sessionId?: string;
  floorId?: string;
  pageId?: string;

  payload: TPayload;

  maxAttempts?: number;
  availableAt?: number;
  dedupeKey?: string;
}

interface EnqueueRuntimeJobResult {
  jobId: string;
  created: boolean;
}
```

---

#### 6.2 `RuntimeWorker`

从 `MemoryWorker` 中抽通用轮询器和 lease 机制。

##### 目标职责

- 轮询 due job
- 按 scope lease
- 控制 max concurrent
- lease / renew / release
- 调用 processor
- 成功 ack
- 失败 retry / dead letter

##### 建议接口

```ts
interface RuntimeJobProcessor<TPayload = unknown> {
  supports(jobType: string): boolean;
  process(job: RuntimeJobRecord<TPayload>): Promise<void>;
}
```

Worker 不关心 memory / tool / export 业务，只负责：

- 拿 job
- 校验 lease
- 找 processor
- 处理生命周期

---

#### 6.3 `RuntimeScopeStateRepository`

从 `memoryScopeStates` 的设计中抽象 scope 状态管理。

##### 目标职责

- revision
- leaseOwner
- leaseUntil
- per-scope metadata

##### 建议字段

```ts
scope_type
scope_key
revision
lease_owner
lease_until
last_processed_at
last_success_job_id
updated_at
metadata_json
```

##### 作用

- 让任何需要“串行写 scope”的模块都能复用
- 不再只服务 memory

---

#### 6.4 `RuntimeRevisionGuard`

从 `MemoryRevisionGuard` 抽出来，作为通用 CAS 守卫。

##### 适用场景

- memory consolidation
- 资源重建
- 同一 resource 的异步写操作
- 未来如果某些 chat/global 变量允许异步 mutation，也能复用

---

## 7. 各模块如何接入

---

#### 7.1 变量系统

##### 目标

不优先 job 化，但先统一 Mutation Runtime。

##### 现阶段建议

保持现有语义不变：

- 工具执行时产生 `BufferedToolVariableMutation`
- commit 时 `flushBufferedMutations()`
- 再 `promoteAll(page -> floor)`

这部分当前已经在 `VariableCommitService` 和 `TurnCommitService.commit()` 中成型。([github.com](https://github.com/HerSophia/TavernHeadless/blob/main/apps/api/src/services/variable-commit-service.ts)) ([github.com](https://github.com/HerSophia/TavernHeadless/blob/main/apps/api/src/services/turn-commit-service.ts))

##### 需要新增的统一抽象

##### a. 变量 mutation envelope

```ts
interface VariableMutationPayload {
  scope: "page" | "floor" | "chat" | "global";
  scopeId: string;
  key: string;
  value: unknown;
  operation: "set" | "delete";
}
```

##### b. apply rule

- `page` / `floor`：默认 `commit`
- `chat` / `global`：

  - 若与本回合可见状态强绑定，仍走 `commit`
  - 若是维护型 / 推导型 / 非关键增强型更新，可考虑 `async`

##### 不建议现在做的事

不要把 `page -> floor` promotion 改成后台 job。
这是 turn 语义的一部分，不应该延后。

---

#### 7.2 工具调用

##### 目标

这是优先接入通用 Runtime 的第一候选模块。

##### 按副作用级别分层

##### `none`

- 仍然 inline
- 不入 job runtime
- 只走统一 audit + mutation envelope

##### `sandbox`

- 继续走 buffered mutation
- commit 时落地
- 不优先后台化

##### `irreversible`

- 优先支持 `async` execution path
- 进入 Background Job Runtime
- 需要独立 replay / timeout / uncertain / compensation 语义

当前工具系统已经有明确的 `sideEffectLevel` 分层，这正好能作为 Runtime 分流依据。

##### 建议新增字段

```ts
interface ToolExecutionRuntimeOptions {
  executionMode: "inline" | "commit" | "async";
  replaySafety: "safe" | "confirm_on_replay" | "never_auto_replay" | "uncertain";
  compensationMode: "compensable" | "non_compensable";
  timeoutClass?: "deterministic" | "uncertain";
}
```

##### 推荐顺序

1. 先统一 tool execution envelope
2. 再给 irreversible 工具增加 async 入口
3. 最后再考虑是否让部分 tool provider 默认 job 化

---

#### 7.3 资源写操作

##### 适合接 Runtime 的资源

- character version create / rollback / restore
- preset entry create / update
- regex rule/profile 修改
- worldbook / entry 修改
- session tool permissions / llm instance config / profile binding 等配置写入

##### 原因

这些操作具备共性：

- 有审计需求
- 有权限边界
- 有幂等需求
- 可能来自 API / UI / Tool / Worker
- 有些必须同步，有些可以异步

##### 推荐 apply 策略

- **用户直操作、且要立即生效的**：`commit`
- **LLM 触发、外部副作用强或可能较慢的**：`async`
- **纯校验或预览型**：`inline`

---

#### 7.4 Memory

##### 目标

从“memory 专属 job 系统”升级为“通用 job runtime 的首个消费者”。

##### 不需要先动的部分

- ingest / compaction / maintenance / rebuild 业务本身
- 摘要与 revision 语义

##### 需要做的事

- 把 scheduler / worker / scope-state / revision-guard 通用化
- 让 memory 仅保留 processor 和 payload schema
- 减少 memory 模块自己维护 job 基础设施的职责

---

#### 7.5 导出 / 重建 / 维护任务

这类最适合直接接 Background Job Runtime：

- chat export
- bulk rebuild
- orphan cleanup
- index rebuild
- backfill
- maintenance scan

##### 原因

- 不需要阻塞主对话
- 失败后可重试
- 天然适合 dead letter
- 需要稳定 job audit

---

## 8. 表设计建议

---

#### 8.1 通用 `runtime_job`

建议以现有 `memory_jobs` 为原型扩展：

```sql
CREATE TABLE runtime_job (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,

  account_id TEXT NOT NULL,

  scope_type TEXT NOT NULL,
  scope_key TEXT NOT NULL,

  session_id TEXT,
  floor_id TEXT,
  page_id TEXT,

  status TEXT NOT NULL,           -- pending / leased / running / retry_waiting / succeeded / dead_letter / cancelled
  payload_json TEXT NOT NULL,

  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,

  available_at INTEGER NOT NULL,
  lease_owner TEXT,
  lease_until INTEGER,

  based_on_revision INTEGER,
  dedupe_key TEXT,
  last_error TEXT,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
```

建议索引：

```sql
CREATE INDEX idx_runtime_job_due
ON runtime_job(status, available_at);

CREATE INDEX idx_runtime_job_scope
ON runtime_job(account_id, scope_type, scope_key, created_at);

CREATE UNIQUE INDEX uq_runtime_job_dedupe
ON runtime_job(job_type, dedupe_key)
WHERE dedupe_key IS NOT NULL;
```

---

#### 8.2 通用 `runtime_scope_state`

```sql
CREATE TABLE runtime_scope_state (
  account_id TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_key TEXT NOT NULL,

  revision INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until INTEGER,

  last_processed_at INTEGER,
  last_success_job_id TEXT,
  metadata_json TEXT,

  updated_at INTEGER NOT NULL,

  PRIMARY KEY (account_id, scope_type, scope_key)
);
```

---

#### 8.3 可选 `runtime_mutation_log`

用于观测和 replay，不一定第一期就做。

```sql
CREATE TABLE runtime_mutation_log (
  id TEXT PRIMARY KEY,
  mutation_kind TEXT NOT NULL,
  source TEXT NOT NULL,

  account_id TEXT NOT NULL,
  session_id TEXT,
  floor_id TEXT,
  page_id TEXT,

  scope_type TEXT,
  scope_key TEXT,

  apply_phase TEXT NOT NULL,      -- inline / commit / async
  durability TEXT NOT NULL,       -- ephemeral / transactional / durable_job
  replay_safety TEXT NOT NULL,

  idempotency_key TEXT,
  payload_json TEXT NOT NULL,

  commit_outcome TEXT NOT NULL,   -- pending / committed / discarded / failed
  related_job_id TEXT,

  created_at INTEGER NOT NULL
);
```

---

## 9. 事件模型建议

建议统一为 runtime 级事件，而不是业务模块各自发散命名。

#### 9.1 Job 事件

```ts
runtime.job_enqueued
runtime.job_leased
runtime.job_started
runtime.job_succeeded
runtime.job_retry_scheduled
runtime.job_dead_lettered
runtime.job_cancelled
```

#### 9.2 Mutation 事件

```ts
runtime.mutation_created
runtime.mutation_applied
runtime.mutation_skipped
runtime.mutation_failed
```

#### 9.3 业务事件继续保留

例如：

- floor.committed
- memory.consolidated
- tool.call_completed
- variable.promoted

但它们应该建立在 runtime 事件之上，而不是替代 runtime 事件。

---

## 10. 推荐迁移顺序

---

#### Phase 1：抽底座，不迁业务

目标：

- 抽出 `runtime_job`
- 抽出 `runtime_scope_state`
- 抽出通用 scheduler / worker / revision guard
- 让 memory 成为新 runtime 的兼容消费者

完成后：

- 行为不变
- 只是 memory 的 job 基础设施变成通用层

---

#### Phase 2：统一 Tool Runtime

目标：

- 所有工具执行都统一经过 `ToolExecutionRuntime`
- 引入统一 `ToolExecutionEnvelope`
- `irreversible` 支持 async execution path
- `none` / `sandbox` 维持现有同步语义

完成后：

- 工具系统副作用边界更稳定
- replay / audit / timeout / uncertain 语义统一

---

#### Phase 3：统一 Variable Mutation Runtime

目标：

- 所有变量变更都先形成 `VariableMutationEnvelope`
- 仍保持 commit-time apply
- 暂不大规模 job 化
- 打通 mutation log / explainability

当前状态：

- 已完成变量相关的 `Mutation Runtime` 接入
- `TurnCommitService` / `VariableCommitService` 已改为 commit-phase mutation batch
- `VariableService` 已改为 inline mutation path

完成后：

- 变量系统进入统一 runtime 体系
- 但不破坏 turn 一致性

---

#### Phase 4：资源写操作接入

目标：

- 资源修改统一 mutation 化
- 按场景选择 commit / async
- 支持来自 API / Tool / Worker 的同构入口

当前状态：

- `LlmProfileService`、`LlmInstanceService`、`ResourceToolProvider` 已接入统一 mutation 入口
- 默认策略仍然保持同步生效，不改变现有对外行为

---

#### Phase 5：补后台作业消费者

目标：

- export / rebuild / backfill / cleanup
- 非阻塞型维护任务
- 真正把 runtime 变成平台能力

当前状态：

- `Mutation Runtime.enqueueAsync()` 已可桥接到现有 `runtime_job`
- 当前只作为内部能力，不新增公共 `/runtime/mutations` 路由

---

## 11. 最小接口草案

---

#### 11.1 Mutation Runtime

```ts
interface MutationRuntime {
  create(envelope: RuntimeMutationEnvelope): Promise<void>;

  applyInline<T = unknown>(
    envelope: RuntimeMutationEnvelope,
    handler: () => Promise<T>,
  ): Promise<T>;

  stageForCommit(envelope: RuntimeMutationEnvelope): void;

  enqueueAsJob(envelope: RuntimeMutationEnvelope, jobType: string): Promise<EnqueueRuntimeJobResult>;
}
```

---

#### 11.2 Job Runtime

```ts
interface JobRuntime {
  enqueue<TPayload>(input: EnqueueRuntimeJobInput<TPayload>): Promise<EnqueueRuntimeJobResult>;
  cancel(jobId: string): Promise<void>;
  retry(jobId: string): Promise<void>;
}
```

---

#### 11.3 Processor Registry

```ts
interface RuntimeJobProcessorRegistry {
  register(processor: RuntimeJobProcessor): void;
  resolve(jobType: string): RuntimeJobProcessor | undefined;
}
```

---

## 12. 一些硬规则（非常重要）

---

#### 12.1 不要异步化 turn 的核心真相

以下必须留在同步 commit：

- assistant message 落库
- floor state CAS
- prompt snapshot
- tool execution audit 的主记录
- buffered variable flush
- page -> floor promotion

---

#### 12.2 async 只能承接“允许延后”的副作用

只有满足下面条件之一，才能进 async：

- 不影响本次 turn 的用户可见真相
- 延后执行不会破坏下一轮上下文正确性
- 有明确 retry / replay / dead-letter 语义
- 允许以 job state 暴露给上层

---

#### 12.3 高频 != 应该 job 化

高频只是说明它值得统一抽象。
是否 job 化，要看它是不是属于：

- turn 内真相
- 用户立即可见状态
- 下一轮 prompt 的必要输入

如果是，就不要先异步化。

---

## 13. 这套方案下的模块建议总结

| 模块           | 先统一 Runtime | 先上 Job Runtime             | 备注                                      |
| -------------- | -------------- | ---------------------------- | ----------------------------------------- |
| 变量系统       | 是             | 否（大部分）                 | 先统一 mutation envelope，不要打散 commit |
| 工具调用       | 是             | 是（先从 irreversible 开始） | 最适合作为通用 runtime 的首个扩展消费者   |
| Memory         | 是             | 已经在做                     | 先抽底座，保留 processor 语义             |
| 资源写操作     | 是             | 部分适合                     | 用户直操作同步，LLM/维护型写入可异步      |
| 导出/重建/维护 | 是             | 是                           | 天然适合后台作业                          |
| 聊天主生成链   | 暂不需要       | 不建议现在做                 | 先保持同步 turn commit 语义               |

---

## 14. 最终建议

最推荐的落地方向是：

1. **以 memory 的 job/worker/revision 机制为原型，抽出通用 Background Job Runtime**
2. **以变量系统为核心，抽出统一 Mutation Runtime**
3. **优先让工具调用接入统一 Runtime，尤其是 `irreversible` 工具**
4. **保留 turn commit 的同步真相，不要为了统一而统一**

一句话总结：

> **把“统一 Runtime”做成平台层，把“是否异步”做成策略，而不是把所有模块都变成后台队列。**
