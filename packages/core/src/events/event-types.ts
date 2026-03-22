import type { FloorState, VariableScope, VariableEntry } from '@tavern/shared';
import type { FloorEntity } from '../types.js';
import type { ModelConfig, TokenUsage } from '../llm/types.js';
import type { MemoryItem } from '../memory/types.js';

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
  entry: VariableEntry;
  isNew: boolean;
}

/** 变量提升事件 */
export interface VariablePromotedEvent {
  key: string;
  fromScope: VariableScope;
  toScope: VariableScope;
  value: unknown;
}

/** 变量删除事件 */
export interface VariableDeletedEvent {
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

/** 记忆整理失败事件（降级为警告，不阻断回合） */
export interface MemoryConsolidationFailedEvent {
  floorId: string;
  error: Error;
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
  'memory.created': MemoryCreatedEvent;
  'memory.updated': MemoryUpdatedEvent;
  'memory.deprecated': MemoryDeprecatedEvent;
  'memory.consolidated': MemoryConsolidatedEvent;
  'memory.consolidation_failed': MemoryConsolidationFailedEvent;
}
