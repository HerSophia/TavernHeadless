// ── Tool Calling 核心类型定义 ─────────────────────────

import type { VariableScope } from '@tavern/shared';
import type { InstanceSlot } from '../llm/types.js';
import type { VariableContext } from '../types.js';

// ── Side Effect Level ─────────────────────────────────

/**
 * 工具的副作用级别
 *
 * - `'none'` — 纯查询，无副作用。
 * - `'sandbox'` — 副作用写入 page scope，commit 时提升。
 * - `'irreversible'` — 不可撤销的外部副作用（如 MCP 调用）。
 */
export type ToolSideEffectLevel = 'none' | 'sandbox' | 'irreversible';

// ── Parameter Schema ──────────────────────────────────

/** 工具参数 schema 中单个属性的描述 */
export interface ToolParameterProperty {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  /** 数组元素的类型描述（type 为 array 时使用） */
  items?: { type: string; description?: string };
}

/**
 * 工具参数 schema（JSON Schema 子集，与 Vercel AI SDK 兼容）
 */
export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

// ── Tool Definition ───────────────────────────────────

/** 工具定义 */
export interface ToolDefinition {
  /** 工具名称（唯一标识） */
  name: string;
  /** 工具描述（发送给 LLM，帮助其理解何时使用） */
  description: string;
  /** 参数 schema */
  parameters: ToolParameterSchema;
  /** 副作用级别 */
  sideEffectLevel: ToolSideEffectLevel;
  /** 允许使用此工具的实例槽位（空数组 = 所有槽位均可使用） */
  allowedSlots: InstanceSlot[];
  /** 工具来源标识 */
  source: 'builtin' | 'preset' | 'mcp';
}

// ── Tool Provider ─────────────────────────────────────

/** 工具提供者类型 */
export type ToolProviderType = 'builtin' | 'preset' | 'mcp';

/** 工具执行记录中的 provider 类型（允许 unknown 兜底） */
export type ToolExecutionProviderType = ToolProviderType | 'unknown';

// ── Tool Call Result ──────────────────────────────────

/** 工具执行结果 */
export interface ToolCallResult {
  /** 执行成功时的返回数据 */
  data?: unknown;
  /** 执行失败时的错误信息 */
  error?: string;
  /** 可选：供执行日志使用的更细粒度状态 */
  executionStatus?: ToolExecutionStatus;
}

// ── Tool Call Record ──────────────────────────────────

/** 工具调用状态（兼容旧 call-records 读模型） */
export type ToolCallStatus = 'success' | 'error' | 'denied';

/** 真实执行日志状态 */
export type ToolExecutionStatus =
  | ToolCallStatus
  | 'running'
  | 'timeout'
  | 'uncertain'
  | 'blocked';

/** 真实执行日志生命周期状态 */
export type ToolExecutionLifecycleState = 'opened' | 'finished';

/** 真实执行日志的最终 commit 归宿 */
export type ToolExecutionCommitOutcome =
  | 'pending'
  | 'committed'
  | 'discarded'
  | 'replay_blocked'
  | 'uncertain';

/** 工具回放安全等级 */
export type ToolReplaySafety =
  | 'safe'
  | 'confirm_on_replay'
  | 'never_auto_replay'
  | 'uncertain';

/** provider 是否具备可补偿能力 */
export type ToolProviderCompensationMode = 'compensable' | 'non_compensable';

/** 单条工具执行的回放安全评估结果 */
export interface ToolReplaySafetyEvaluation {
  replaySafety: ToolReplaySafety;
  providerCompensationMode: ToolProviderCompensationMode;
  /** 供日志、错误映射与调试使用的稳定原因码 */
  reason: string;
}

/** 单次工具调用记录（绑定到 MessagePage） */
export interface ToolCallRecord {
  /** 记录 ID */
  id: string;
  /** 所属消息页 ID */
  pageId: string;
  /** 调用序号（同一页内递增） */
  seq: number;
  /** 调用者实例槽位 */
  callerSlot: InstanceSlot;
  /** 工具名称 */
  toolName: string;
  /** 调用参数（JSON 字符串） */
  argsJson: string;
  /** 执行结果（JSON 字符串） */
  resultJson: string;
  /** 执行状态 */
  status: ToolCallStatus;
  /** 执行耗时（毫秒） */
  durationMs: number;
  /** 创建时间（epoch ms） */
  createdAt: number;
}

/**
 * 真实工具执行记录。
 *
 * 与旧的 ToolCallRecord 不同，此结构以 floor 为主归属，记录来源应为真实执行器。
 */
export interface ExecutedToolCallRecord {
  id: string;
  runId: string;
  floorId: string;
  pageId?: string;
  callerSlot: InstanceSlot;
  providerId: string;
  providerType?: ToolExecutionProviderType;
  toolName: string;
  argsJson: string;
  resultJson: string;
  status: ToolExecutionStatus;
  lifecycleState?: ToolExecutionLifecycleState;
  commitOutcome?: ToolExecutionCommitOutcome;
  sideEffectLevel?: ToolSideEffectLevel;
  errorMessage?: string;
  durationMs: number;
  startedAt?: number;
  finishedAt?: number;
  attemptNo?: number;
  replayParentExecutionId?: string;
  createdAt: number;
}

/** 打开一条真实执行日志所需的最小字段 */
export interface ToolExecutionOpenRecord {
  id: string;
  runId: string;
  floorId: string;
  pageId?: string;
  callerSlot: InstanceSlot;
  providerId: string;
  providerType: ToolExecutionProviderType;
  toolName: string;
  argsJson: string;
  sideEffectLevel?: ToolSideEffectLevel;
  startedAt: number;
  createdAt: number;
  attemptNo: number;
  replayParentExecutionId?: string;
}

/** 结束一条真实执行日志时可更新的字段 */
export interface ToolExecutionFinishPatch {
  resultJson: string;
  status: Exclude<ToolExecutionStatus, 'running'>;
  lifecycleState?: ToolExecutionLifecycleState;
  errorMessage?: string;
  durationMs: number;
  finishedAt: number;
}

/**
 * 当前回合中，工具产生但尚未持久化的变量写入。
 *
 * 这些写入在生成期间只存在于 turn-local buffer 中，直到 commit 时才会统一落库。
 */
export interface BufferedToolVariableMutation {
  runId: string;
  generationAttemptNo: number;
  scope: VariableScope;
  scopeId: string;
  key: string;
  value: unknown;
  accountId?: string;
  bufferedAt: number;
}

// ── Execution Context ─────────────────────────────────

/** 传递给工具执行函数的上下文 */
export interface ToolExecutionContext {
  /** 当前会话 ID */
  sessionId: string;
  /** 当前账户 ID（资源类工具需要，用于多账户隔离） */
  accountId?: string;
  /** 当前楼层 ID */
  floorId: string;
  /**
   * 当前消息页 ID（可选）。
   *
   * 工具调用通常发生在 output page 创建之前，因此此字段允许为空。
   * 当上层已经持有真实 pageId（例如 input page）时，可透传进来作为执行上下文。
   */
  pageId?: string;
  /** 调用者实例槽位 */
  callerSlot: InstanceSlot;
  /** 变量上下文（用于 get/set variable 工具） */
  variableContext: VariableContext;
  /** 中止信号 */
  abortSignal?: AbortSignal;
}

// ── Permissions ───────────────────────────────────────

/** 工具权限配置（per session 或 per turn） */
export interface ToolPermissions {
  /** 是否启用工具调用（总开关） */
  enabled: boolean;
  /** 各槽位的工具白名单（不配置 = 使用工具定义自身的 allowedSlots） */
  slotAllowList?: Partial<Record<InstanceSlot, string[]>>;
  /** 各槽位的工具黑名单 */
  slotDenyList?: Partial<Record<InstanceSlot, string[]>>;
  /** 单次回合的最大工具调用次数（防止无限循环） */
  maxCallsPerTurn?: number;
  /** Narrator inline 模式的最大自动步数（对应 Vercel AI SDK maxSteps） */
  maxStepsPerGeneration?: number;
  /** 是否允许 irreversible 副作用的工具 */
  allowIrreversible?: boolean;
}

// ── Tool Provider ─────────────────────────────────────

/**
 * 工具提供者接口
 *
 * 所有工具来源（内置、预设/角色卡、MCP）都实现此接口。
 * ToolRegistry 持有多个 ToolProvider，统一管理。
 */
export interface ToolProvider {
  /** 提供者 ID（全局唯一） */
  readonly id: string;
  /** 提供者类型标识 */
  readonly type: ToolProviderType;
  /** 列出该提供者下所有可用工具 */
  listTools(): Promise<ToolDefinition[]>;
  /** 执行工具调用 */
  executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolCallResult>;
}

// ── MCP Reserved Types ────────────────────────────────

/**
 * MCP 工具提供者配置
 *
 * Core 层的轻量类型定义，不依赖 MCP SDK。
 * 具体的连接管理和传输实现位于 apps/api/src/mcp/。
 */
export interface McpToolProviderConfig {
  /** MCP 服务器 ID */
  serverId: string;
  /** 服务器显示名称 */
  serverName: string;
  /** 传输类型 */
  transport: 'stdio' | 'http';
  /** 工具名称前缀（避免与其他来源的工具冲突） */
  toolPrefix?: string;
  /** 连接超时（毫秒） */
  connectTimeoutMs?: number;
  /** 工具调用超时（毫秒） */
  callTimeoutMs?: number;
  /** 工具列表刷新间隔（毫秒，0 = 不自动刷新） */
  toolRefreshIntervalMs?: number;
  /** 该服务器工具的默认副作用级别 */
  defaultSideEffectLevel?: ToolSideEffectLevel;
}

// ── Deny Reason ───────────────────────────────────────

/** 工具调用被拒绝的原因 */
export type ToolDenyReason =
  | 'disabled'               // 工具调用总开关关闭
  | 'tool_not_found'         // 工具不存在
  | 'slot_not_allowed'       // 该槽位不允许使用此工具
  | 'deny_listed'            // 在黑名单中
  | 'not_in_allow_list'      // 不在白名单中
  | 'max_calls_exceeded'     // 超过单次回合最大调用次数
  | 'irreversible_blocked';  // irreversible 工具被禁止
