import type { FloorState, MemoryJobType, MemoryScope, VariableScope, VariableEntry } from '@tavern/shared';
import type { FloorEntity } from '../types.js';
import type { ModelConfig, TokenUsage } from '../llm/types.js';
import type { MemoryEdge, MemoryItem, MemoryRuntimeMode } from '../memory/types.js';
import type { InstanceSlot } from '../llm/types.js';
import type {
  ToolExecutionProviderType,
  ToolExecutionStatus,
  ToolSideEffectLevel,
} from '../tools/types.js';

/** 楼层状态变更事件 */
export interface FloorStateChangedEvent {
  floor: FloorEntity;
  previousState: FloorState;
  newState: FloorState;
}

/** 楼层提交事件 */
export interface FloorCommittedEvent {
  floor: FloorEntity;
  promotedVariables: VariableEntry[];
}

/** 楼层失败事件 */
export interface FloorFailedEvent {
  floor: FloorEntity;
  error: Error;
}

export type FloorRunType = 'respond' | 'regenerate_page' | 'retry_turn' | 'edit_and_regenerate';

export type FloorRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type FloorRunPhase =
  | 'input_recorded'
  | 'semantic_resolved'
  | 'prechecked'
  | 'prompt_assembled'
  | 'page_generating'
  | 'candidate_generated'
  | 'verifier_checked'
  | 'transaction_prepared'
  | 'transaction_committed'
  | 'post_commit_scheduled';

export type FloorRunPublicPhase =
  | 'preparing'
  | 'generating'
  | 'verifying'
  | 'committing'
  | 'post_processing';

export type FloorRunPendingOutputState = 'draft' | 'streaming' | 'generated' | 'failed';

export type FloorRunVerifierStatus = 'pending' | 'passed' | 'warned' | 'blocked' | 'skipped';

export interface FloorRunVerifierIssue {
  description: string;
  severity: 'warning' | 'error';
}

export interface FloorRunVerifierSnapshot {
  status: FloorRunVerifierStatus;
  suggestion?: string;
  issues?: FloorRunVerifierIssue[];
}

export interface FloorRunPendingOutput {
  tempId: string;
  attemptNo: number;
  state: FloorRunPendingOutputState;
  text: string;
  startedAt: number;
  updatedAt: number;
  error?: string;
}

export interface FloorRunError {
  code: string;
  message: string;
}

export interface FloorRunSnapshot {
  sessionId: string;
  floorId: string;
  runId: string;
  runType: FloorRunType;
  status: FloorRunStatus;
  phase: FloorRunPhase;
  publicPhase: FloorRunPublicPhase;
  phaseSeq: number;
  attemptNo: number;
  startedAt: number;
  updatedAt: number;
  completedAt?: number | null;
  pendingOutput?: FloorRunPendingOutput | null;
  verifier?: FloorRunVerifierSnapshot | null;
  error?: FloorRunError | null;
}

export type FloorRunUpdatedEvent = FloorRunSnapshot;

export type FloorRunCompletedEvent = FloorRunSnapshot;

export type FloorRunFailedEvent = FloorRunSnapshot;

/**
 * 变量写入事件（durable-only）。
 *
 * 语义：`variable.set` 仅表示一次 durable create/update 已经在数据库事务中
 * 成功提交。工具执行期的 buffered 可见性不会通过该事件对外广播。
 *
 * 发射时机：
 * - 工具缓冲写入 → 事务提交成功后 flush 一次 `variable.set`
 * - Prompt macro `setvar` / `setglobalvar` → 事务提交成功后 flush 一次 `variable.set`
 * - page → floor 的 durable promotion 走独立的 `variable.promoted`，
 *   不会额外再发一条 `variable.set`
 */
export interface VariableSetEvent {
  sessionId?: string;
  branchId?: string;
  entry: VariableEntry;
  isNew: boolean;
}

/**
 * 变量提升事件（durable-only）。
 *
 * 语义：`variable.promoted` 仅表示一次 page → floor 的 durable promotion 已在
 * 事务中成功提交。同一次 promotion 不会再额外触发 `variable.set`。
 */
export interface VariablePromotedEvent {
  sessionId?: string;
  branchId?: string;
  key: string;
  fromScope: VariableScope;
  toScope: VariableScope;
  value: unknown;
}

/**
 * 变量删除事件（durable-only）。
 *
 * 语义：`variable.deleted` 仅表示 durable delete 已经在事务中成功提交。
 * 工具执行期的 buffered delete 不会通过该事件对外广播。
 */
export interface VariableDeletedEvent {
  sessionId?: string;
  branchId?: string;
  id: string;
  scope: VariableScope;
  key: string;
}

// ── Generation 事件 ──────────────────────────────────

/** 生成开始事件 */
export interface GenerationStartedEvent {
  floorId?: string;
  model?: ModelConfig;
  tokenBudget?: number;
}

/** 生成文本片段事件 */
export interface GenerationChunkEvent {
  floorId?: string;
  chunk: string;
  accumulatedLength: number;
}

/** 生成完成事件 */
export interface GenerationCompletedEvent {
  floorId?: string;
  text: string;
  usage: TokenUsage;
  finishReason: string;
  summaries: string[];
}

/** 生成失败事件 */
export interface GenerationFailedEvent {
  floorId?: string;
  error: Error;
}

// ── Commit 事件 ──────────────────────────────────────

/** 提交阶段重试事件 */
export interface CommitRetryEvent {
  sessionId: string;
  branchId?: string;
  floorId: string;
  attempt: number;
  backoffMs: number;
  message: string;
}

/** 提交阶段忙碌事件 */
export interface CommitBusyEvent {
  sessionId: string;
  branchId?: string;
  floorId: string;
  attempts: number;
  message: string;
}

/** 提交阶段重试后成功事件 */
export interface CommitSucceededAfterRetryEvent {
  sessionId: string;
  branchId?: string;
  floorId: string;
  attempts: number;
}

// ── Memory 事件 ──────────────────────────────────────

export type MemoryMutationSource = 'extraction' | 'consolidation' | 'manual' | 'runtime' | 'maintenance';
export type MemoryEventEntityType = 'memory_item' | 'memory_edge';

/** 记忆事件共享上下文 */
export interface MemoryEventContext {
  mutationId?: string;
  accountId?: string;
  sessionId?: string;
  branchId?: string;
  scope: MemoryScope;
  scopeId: string;
  floorId?: string;
  pageId?: string;
  sourceJobId?: string;
  entityType?: MemoryEventEntityType;
  entityId?: string;
}

/** 记忆作业 / 处理事件共享上下文 */
export interface MemoryJobEventContext extends MemoryEventContext {
  jobType?: MemoryJobType;
}

/** 记忆创建事件 */
export interface MemoryCreatedEvent extends MemoryEventContext {
  item: MemoryItem;
  source: MemoryMutationSource;
  after?: MemoryItem;
}

/** 记忆更新事件 */
export interface MemoryUpdatedEvent extends MemoryEventContext {
  item: MemoryItem;
  previousContent?: string;
  before?: MemoryItem;
  after?: MemoryItem;
  source?: MemoryMutationSource;
}

/** 记忆标记过时事件 */
export interface MemoryDeprecatedEvent extends MemoryEventContext {
  item: MemoryItem;
  reason: string;
  before?: MemoryItem;
  after?: MemoryItem;
  source?: MemoryMutationSource;
}

/** 记忆删除事件 */
export interface MemoryDeletedEvent extends MemoryEventContext {
  item: MemoryItem;
  before: MemoryItem;
  source: MemoryMutationSource;
}

/** 记忆关系边创建事件 */
export interface MemoryEdgeCreatedEvent extends MemoryEventContext {
  edge: MemoryEdge;
  after?: MemoryEdge;
  source: MemoryMutationSource;
}

/** 记忆关系边删除事件 */
export interface MemoryEdgeDeletedEvent extends MemoryEventContext {
  edge: MemoryEdge;
  before: MemoryEdge;
  source: MemoryMutationSource;
}

/** 记忆整理完成事件 */
export interface MemoryConsolidatedEvent extends MemoryEventContext {
  created: number;
  updated: number;
  deprecated: number;
  purged?: number;
  jobType?: MemoryJobType;
}

/** 记忆注入失败事件（降级为跳过，不阻断主流程） */
export interface MemoryInjectionFailedEvent {
  sessionId: string;
  error: Error;
}

/** 记忆持久化失败事件（提交事务将回滚） */
export interface MemoryPersistFailedEvent extends MemoryJobEventContext {
  error: Error;
}

/** 记忆整理上下文加载失败事件（降级为跳过整理） */
export interface MemoryConsolidationContextFailedEvent extends MemoryJobEventContext {
  error: Error;
}

/** 记忆整理 JSON 解析失败事件（降级为仅写 turnSummary） */
export interface MemoryConsolidationJsonParseFailedEvent extends MemoryJobEventContext {
  rawText: string;
  error: Error;
}

/** 记忆整理失败事件（降级为警告，不阻断回合） */
export interface MemoryConsolidationFailedEvent extends MemoryJobEventContext {
  error: Error;
}

// ── Runtime Job 事件 ─────────────────────────────────

/** Background Job Runtime 生命周期事件的公共载荷 */
export interface RuntimeJobEvent {
  jobId: string;
  jobType: string;
  accountId: string;
  scopeType: string;
  scopeKey: string;
  sessionId?: string;
  floorId?: string;
  pageId?: string;
  branchId?: string;
  runtimeMode?: MemoryRuntimeMode;
  strategy?: 'none' | 'single_summary' | 'dual_summary' | 'direct_items';
  proposalBatchId?: string;
  proposalStatus?: 'proposed' | 'promoted' | 'rejected' | 'superseded';
  promotionStatus?: 'promoted' | 'rejected' | 'superseded';
  status: string;
  phase?: string | null;
  attemptCount: number;
  maxAttempts: number;
  availableAt: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  workerId?: string | null;
  basedOnRevision?: number | null;
  dedupeKey?: string | null;
  progressCurrent: number;
  progressTotal?: number | null;
  progressMessage?: string | null;
  errorCode?: string | null;
  errorClass?: string | null;
  message?: string | null;
  durationMs?: number | null;
}

export type RuntimeJobEnqueuedEvent = RuntimeJobEvent;

export type RuntimeJobLeasedEvent = RuntimeJobEvent;

export type RuntimeJobStartedEvent = RuntimeJobEvent;

export type RuntimeJobProgressUpdatedEvent = RuntimeJobEvent;

export type RuntimeJobSucceededEvent = RuntimeJobEvent;

export type RuntimeJobRetryScheduledEvent = RuntimeJobEvent & {
  retryAt: number;
};

export type RuntimeJobDeadLetteredEvent = RuntimeJobEvent;

export type RuntimeJobCancelledEvent = RuntimeJobEvent;

export type RuntimeJobLeaseLostEvent = RuntimeJobEvent;

// ── Runtime Mutation 事件 ─────────────────────────────

export type RuntimeMutationApplyPhase = 'inline' | 'commit' | 'async';
export type RuntimeMutationDurability = 'ephemeral' | 'transactional' | 'durable_job';
export type RuntimeMutationReplaySafety = 'safe' | 'confirm_on_replay' | 'never_auto_replay' | 'uncertain';
export type RuntimeMutationSource = 'api' | 'tool' | 'system' | 'worker' | 'maintenance';
export type RuntimeMutationEventOutcome = 'applied' | 'skipped' | 'failed';

export interface RuntimeMutationEvent {
  mutationId: string;
  kind: string;
  source: RuntimeMutationSource;
  accountId: string;
  sessionId?: string;
  floorId?: string;
  pageId?: string;
  scopeType: string;
  scopeKey: string;
  applyPhase: RuntimeMutationApplyPhase;
  durability: RuntimeMutationDurability;
  replaySafety: RuntimeMutationReplaySafety;
  actorType?: string;
  actorId?: string;
  requestId?: string;
  relatedJobId?: string;
  outcome?: RuntimeMutationEventOutcome;
  skipReason?: string;
  errorCode?: string | null;
  errorClass?: string | null;
  errorMessage?: string | null;
  createdAt: number;
  observedAt: number;
}

export type RuntimeMutationCreatedEvent = RuntimeMutationEvent;
export type RuntimeMutationAppliedEvent = RuntimeMutationEvent;
export type RuntimeMutationSkippedEvent = RuntimeMutationEvent;
export type RuntimeMutationFailedEvent = RuntimeMutationEvent;

// ── Tool 事件 ────────────────────────────────────────

/** 工具调用开始事件 */
export interface ToolCallStartedEvent {
  floorId: string;
  pageId?: string;
  callerSlot: InstanceSlot;
  executionId: string;
  providerId: string;
  providerType: ToolExecutionProviderType;
  sideEffectLevel?: ToolSideEffectLevel;
  toolName: string;
  args: Record<string, unknown>;
}

/** 工具调用完成事件 */
export interface ToolCallCompletedEvent {
  floorId: string;
  pageId?: string;
  callerSlot: InstanceSlot;
  executionId: string;
  providerId: string;
  providerType: ToolExecutionProviderType;
  sideEffectLevel?: ToolSideEffectLevel;
  toolName: string;
  result: unknown;
  status: Extract<ToolExecutionStatus, 'success'>;
  durationMs: number;
}

/** 工具调用失败事件 */
export interface ToolCallFailedEvent {
  floorId: string;
  pageId?: string;
  callerSlot: InstanceSlot;
  executionId: string;
  providerId: string;
  providerType: ToolExecutionProviderType;
  sideEffectLevel?: ToolSideEffectLevel;
  toolName: string;
  status: Extract<ToolExecutionStatus, 'error' | 'timeout' | 'uncertain' | 'blocked'>;
  error: Error;
  durationMs: number;
}

/** 工具调用被拒绝事件 */
export interface ToolCallDeniedEvent {
  floorId: string;
  pageId?: string;
  callerSlot: InstanceSlot;
  executionId: string;
  providerId: string;
  providerType: ToolExecutionProviderType;
  sideEffectLevel?: ToolSideEffectLevel;
  toolName: string;
  status: Extract<ToolExecutionStatus, 'denied'>;
  reason: string;
}

// ── MCP 事件 ─────────────────────────────────────────

/** MCP 服务器连接成功事件 */
export interface McpServerConnectedEvent {
  serverId: string;
  serverName: string;
  transport: 'stdio' | 'http';
  toolCount: number;
}

/** MCP 服务器断开连接事件 */
export interface McpServerDisconnectedEvent {
  serverId: string;
  serverName: string;
  reason: 'shutdown' | 'error' | 'manual';
  error?: string;
}

/** MCP 服务器错误事件 */
export interface McpServerErrorEvent {
  serverId: string;
  serverName: string;
  error: string;
}

/** Core 事件映射表（提供 emittery 强类型约束） */
export interface CoreEventMap {
  'floor.stateChanged': FloorStateChangedEvent;
  'floor.committed': FloorCommittedEvent;
  'floor.failed': FloorFailedEvent;
  'floor.run.updated': FloorRunUpdatedEvent;
  'floor.run.completed': FloorRunCompletedEvent;
  'floor.run.failed': FloorRunFailedEvent;
  'variable.set': VariableSetEvent;
  'variable.promoted': VariablePromotedEvent;
  'variable.deleted': VariableDeletedEvent;
  'generation.started': GenerationStartedEvent;
  'generation.chunk': GenerationChunkEvent;
  'generation.completed': GenerationCompletedEvent;
  'generation.failed': GenerationFailedEvent;
  'commit.retry': CommitRetryEvent;
  'commit.busy': CommitBusyEvent;
  'commit.succeeded_after_retry': CommitSucceededAfterRetryEvent;
  'memory.created': MemoryCreatedEvent;
  'memory.updated': MemoryUpdatedEvent;
  'memory.deprecated': MemoryDeprecatedEvent;
  'memory.deleted': MemoryDeletedEvent;
  'memory.edge.created': MemoryEdgeCreatedEvent;
  'memory.edge.deleted': MemoryEdgeDeletedEvent;
  'memory.injection_failed': MemoryInjectionFailedEvent;
  'memory.persist_failed': MemoryPersistFailedEvent;
  'memory.consolidation_context_failed': MemoryConsolidationContextFailedEvent;
  'memory.consolidation_json_parse_failed': MemoryConsolidationJsonParseFailedEvent;
  'memory.consolidated': MemoryConsolidatedEvent;
  'memory.consolidation_failed': MemoryConsolidationFailedEvent;
  'runtime.job_enqueued': RuntimeJobEnqueuedEvent;
  'runtime.job_leased': RuntimeJobLeasedEvent;
  'runtime.job_started': RuntimeJobStartedEvent;
  'runtime.job_progress_updated': RuntimeJobProgressUpdatedEvent;
  'runtime.job_succeeded': RuntimeJobSucceededEvent;
  'runtime.job_retry_scheduled': RuntimeJobRetryScheduledEvent;
  'runtime.job_dead_lettered': RuntimeJobDeadLetteredEvent;
  'runtime.job_cancelled': RuntimeJobCancelledEvent;
  'runtime.job_lease_lost': RuntimeJobLeaseLostEvent;
  'runtime.mutation_created': RuntimeMutationCreatedEvent;
  'runtime.mutation_applied': RuntimeMutationAppliedEvent;
  'runtime.mutation_skipped': RuntimeMutationSkippedEvent;
  'runtime.mutation_failed': RuntimeMutationFailedEvent;
  'tool.call_started': ToolCallStartedEvent;
  'tool.call_completed': ToolCallCompletedEvent;
  'tool.call_failed': ToolCallFailedEvent;
  'tool.call_denied': ToolCallDeniedEvent;
  'mcp.connected': McpServerConnectedEvent;
  'mcp.disconnected': McpServerDisconnectedEvent;
  'mcp.error': McpServerErrorEvent;
}
