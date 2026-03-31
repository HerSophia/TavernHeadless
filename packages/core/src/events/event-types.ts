import type { FloorState, MemoryJobType, MemoryScope, VariableScope, VariableEntry } from '@tavern/shared';
import type { FloorEntity } from '../types.js';
import type { ModelConfig, TokenUsage } from '../llm/types.js';
import type { MemoryItem } from '../memory/types.js';
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

/** 变量写入事件 */
export interface VariableSetEvent {
  sessionId?: string;
  entry: VariableEntry;
  isNew: boolean;
}

/** 变量提升事件 */
export interface VariablePromotedEvent {
  sessionId?: string;
  key: string;
  fromScope: VariableScope;
  toScope: VariableScope;
  value: unknown;
}

/** 变量删除事件 */
export interface VariableDeletedEvent {
  sessionId?: string;
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

/** 记忆事件共享上下文 */
export interface MemoryEventContext {
  sessionId?: string;
  scope: MemoryScope;
  scopeId: string;
  floorId?: string;
  sourceJobId?: string;
}

/** 记忆作业 / 处理事件共享上下文 */
export interface MemoryJobEventContext extends MemoryEventContext {
  jobType?: MemoryJobType;
}

/** 记忆创建事件 */
export interface MemoryCreatedEvent extends MemoryEventContext {
  item: MemoryItem;
  source: 'extraction' | 'consolidation' | 'manual';
}

/** 记忆更新事件 */
export interface MemoryUpdatedEvent extends MemoryEventContext {
  item: MemoryItem;
  previousContent?: string;
}

/** 记忆标记过时事件 */
export interface MemoryDeprecatedEvent extends MemoryEventContext {
  item: MemoryItem;
  reason: string;
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
  'tool.call_started': ToolCallStartedEvent;
  'tool.call_completed': ToolCallCompletedEvent;
  'tool.call_failed': ToolCallFailedEvent;
  'tool.call_denied': ToolCallDeniedEvent;
  'mcp.connected': McpServerConnectedEvent;
  'mcp.disconnected': McpServerDisconnectedEvent;
  'mcp.error': McpServerErrorEvent;
}
