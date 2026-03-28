import type { FloorState, VariableScope, VariableEntry } from '@tavern/shared';
import type { FloorEntity } from '../types.js';
import type { ModelConfig, TokenUsage } from '../llm/types.js';
import type { MemoryItem } from '../memory/types.js';
import type { InstanceSlot } from '../llm/types.js';

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

/** 记忆创建事件 */
export interface MemoryCreatedEvent {
  item: MemoryItem;
  source: 'extraction' | 'consolidation' | 'manual';
}

/** 记忆更新事件 */
export interface MemoryUpdatedEvent {
  item: MemoryItem;
  previousContent?: string;
}

/** 记忆标记过时事件 */
export interface MemoryDeprecatedEvent {
  item: MemoryItem;
  reason: string;
}

/** 记忆整理完成事件 */
export interface MemoryConsolidatedEvent {
  floorId: string;
  created: number;
  updated: number;
  deprecated: number;
}

/** 记忆注入失败事件（降级为跳过，不阻断主流程） */
export interface MemoryInjectionFailedEvent {
  sessionId: string;
  error: Error;
}

/** 记忆持久化失败事件（提交事务将回滚） */
export interface MemoryPersistFailedEvent {
  floorId: string;
  sessionId: string;
  error: Error;
}

/** 记忆整理上下文加载失败事件（降级为跳过整理） */
export interface MemoryConsolidationContextFailedEvent {
  sessionId: string;
  error: Error;
}

/** 记忆整理 JSON 解析失败事件（降级为仅写 turnSummary） */
export interface MemoryConsolidationJsonParseFailedEvent {
  floorId: string;
  rawText: string;
  error: Error;
}

/** 记忆整理失败事件（降级为警告，不阻断回合） */
export interface MemoryConsolidationFailedEvent {
  floorId: string;
  error: Error;
}

// ── Tool 事件 ────────────────────────────────────────

/** 工具调用开始事件 */
export interface ToolCallStartedEvent {
  floorId: string;
  pageId?: string;
  callerSlot: InstanceSlot;
  toolName: string;
  args: Record<string, unknown>;
}

/** 工具调用完成事件 */
export interface ToolCallCompletedEvent {
  floorId: string;
  pageId?: string;
  callerSlot: InstanceSlot;
  toolName: string;
  result: unknown;
  durationMs: number;
}

/** 工具调用失败事件 */
export interface ToolCallFailedEvent {
  floorId: string;
  pageId?: string;
  callerSlot: InstanceSlot;
  toolName: string;
  error: Error;
}

/** 工具调用被拒绝事件 */
export interface ToolCallDeniedEvent {
  floorId: string;
  pageId?: string;
  callerSlot: InstanceSlot;
  toolName: string;
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
  'tool.call_started': ToolCallStartedEvent;
  'tool.call_completed': ToolCallCompletedEvent;
  'tool.call_failed': ToolCallFailedEvent;
  'tool.call_denied': ToolCallDeniedEvent;
  'mcp.connected': McpServerConnectedEvent;
  'mcp.disconnected': McpServerDisconnectedEvent;
  'mcp.error': McpServerErrorEvent;
}
