import type { ChatMessage, PromptRuntimeToolTransportTrace } from '../prompt/types.js';
import type { GenerationParams, InstanceSlot, ModelConfig, TokenUsage } from '../llm/types.js';
import type { SummaryExtractorOptions } from '../generation/summary-extractor.js';
import type { MemoryInjectionOptions, MemoryInjectionResult, MemoryItem } from '../memory/types.js';
import type {
  BufferedToolVariableMutation,
  ExecutedToolCallRecord,
  PendingToolJobRequest,
  ToolPermissions,
  ToolCallRecord,
  ToolSideEffectLevel,
} from '../tools/types.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import type { DirectorInput, DirectorResult } from './director.js';
import type { VerifierInput, VerifierResult } from './verifier.js';
import type { ConsolidationResult } from '../memory/memory-consolidator.js';
import type {
  FloorRunPendingOutputState,
  FloorRunPhase,
  FloorRunVerifierIssue,
  FloorRunVerifierStatus,
} from '../events/event-types.js';
import type {
  AgentLoopStopReason,
  GraphToolConfirmationDecider,
} from './text-protocol-agent-loop.js';
import type { AgentLoopPriorRoundtrip, AgentLoopStepRecord } from './agent-loop.js';

// ── Turn Config ───────────────────────────────────────

/** Verifier 不通过时的策略 */
export type VerifierFailStrategy = 'warn' | 'block' | 'retry';

/** 工具调用模式 */
export type ToolMode = 'inline' | 'standalone' | 'both';

/** 回合配置 */
export interface TurnConfig {
  /** 是否启用 Director（默认 false） */
  enableDirector?: boolean;
  /** 是否启用 Verifier（默认 false） */
  enableVerifier?: boolean;
  /** 是否启用 Memory 整理（默认 false） */
  enableMemoryConsolidation?: boolean;
  /** Verifier 不通过时的策略（默认 'warn'） */
  verifierFailStrategy?: VerifierFailStrategy;
  /** 最大重试次数（retry 策略时，默认 1） */
  maxRetries?: number;
  /** 是否启用工具调用（默认 false） */
  enableTools?: boolean;
  /** 工具调用模式（默认 'inline'） */
  toolMode?: ToolMode;
}

// ── Turn Input ────────────────────────────────────────

export interface TurnRunObserver {
  onPhaseChange?(input: {
    phase: FloorRunPhase;
    attemptNo?: number;
  }): Promise<void> | void;
  onPendingOutputUpdate?(input: {
    text: string;
    state: FloorRunPendingOutputState;
    attemptNo: number;
    force?: boolean;
    error?: string;
  }): Promise<void> | void;
  onVerifierResult?(input: {
    status: FloorRunVerifierStatus;
    suggestion?: string;
    issues?: FloorRunVerifierIssue[];
  }): Promise<void> | void;
  /**
   * 流式推理（思维链）更新。
   *
   * 仅当模型在生成过程中产出 reasoning delta 时触发，
   * 供上层（如临时对话 SSE）实时下发 reasoning。
   * `delta` 为本次增量，`text` 为累计推理文本。
   */
  onReasoningUpdate?(input: {
    delta: string;
    text: string;
    attemptNo: number;
  }): Promise<void> | void;
  /**
   * 流式中间叙述更新。
   *
   * native多步循环中，仅当某步触发了工具调用且产出可见文本时触发，
   * 供上层（如临时对话 SSE）实时下发该步的中间叙述。末步纯结论步不触发，
   * 它走正文 streaming 通道与最终 message 正文。
   * `stepIndex` 为本步在循环中的步号，`createdAt` 为该步生成完成时刻。
   */
  onStepNarration?(input: {
    stepIndex: number;
    text: string;
    createdAt: number;
  }): Promise<void> | void;
}

/** 回合输入 */
export interface TurnInput {
  /** 会话 ID */
  sessionId: string;
  /** 楼层 ID（已创建好的 draft 楼层） */
  floorId: string;
  /** 当前分支 ID（可选，用于变量 branch scope 与工具上下文透传） */
  branchId?: string;
  /**
   * 当前工具执行的页上下文 ID（可选）。
   *
   * 当上层已经持有真实 pageId（例如 input page）时，可传给工具执行上下文。
   */
  pageId?: string;
  /** 已拼装好的 messages（由外部编排器产生） */
  messages: ChatMessage[];
  /** Generation 参数 */
  generationParams: GenerationParams;
  /** 回合配置 */
  config?: TurnConfig;
  /**
   * 当前回合工具执行日志使用的 runId。
   *
   * 上层可显式注入，以便在失败边界也能准确回收同一组 execution journal。
   */
  toolExecutionRunId?: string;
  /**
   * @deprecated 使用 modelOverrides 代替。仍可作为 narrator 的快捷方式。
   */
  model?: ModelConfig;
  /** 按 LLM 实例槽位覆盖模型配置 */
  modelOverrides?: Partial<Record<InstanceSlot, ModelConfig>>;
  /** 按 LLM 实例槽位覆盖 Generation 参数 */
  generationParamsOverrides?: Partial<Record<InstanceSlot, GenerationParams>>;

  // ── 可选组件输入 ──

  /** Director 输入（启用 Director 时必须提供） */
  directorInput?: DirectorInput;
  /** Verifier 输入模板（generatedText 由编排器在生成后填入） */
  verifierInput?: Omit<VerifierInput, 'generatedText'>;
  /** Memory 注入选项 */
  memoryOptions?: MemoryInjectionOptions;
  /** Memory 整理上下文 */
  consolidationContext?: {
    currentFloorContent: string;
    recentSummaries: string[];
    existingFacts: MemoryItem[];
  };

  // ── 工具调用 ──

  /** 工具权限配置（由外部注入，控制各槽位可用工具） */
  toolPermissions?: ToolPermissions;
  /** 工具注册表（由外部注入，持有所有已注册的工具提供者） */
  toolRegistry?: ToolRegistry;
  /** 本轮工具传输决策与注入信息。 */
  toolTransport?: PromptRuntimeToolTransportTrace;
  /** 账户 ID（透传给工具执行上下文，资源类工具需要） */
  accountId?: string;
  // ── 回调 ──

  /** 前处理：在 LLM 调用前对消息进行处理 */
  preProcess?: (messages: ChatMessage[]) => ChatMessage[];
  /** 后处理：在 LLM 输出后对文本进行处理 */
  postProcess?: (text: string) => string;
  /** 摘要提取选项 */
  summaryOptions?: SummaryExtractorOptions;
  /** 流式回调：收到文本片段 */
  onChunk?: (chunk: string) => void;
  /** 可选：中止信号（用于客户端断连等场景） */
  abortSignal?: AbortSignal;
    /** 可选：回合运行阶段观察器（由上层接入运行快照、候选输出等） */
  runObserver?: TurnRunObserver;

  /**
   * 本回合的生成尝试号（attemptNo）。
   *
   * 用于把多步 agent 循环内的进度通知（pending 输出、reasoning、阶段）统一归到
   * 同一次回合尝试，避免用循环步号污染 floor_run_state.attemptNo，进而导致
   * 统一提交边界把该回合误判为 attempt_not_current。默认按首次尝试（1）处理。
   */
  runAttemptNo?: number;

  /**
   * step 重试：已完成的前缀工具往返（按 stepIndex 升序）。
   *
   * 仅 native_function_call 路径的 step 重试使用：透传给 agent loop，让其在进入生成循环前
   * 重建前 N-1 步的工具往返上下文，从第 N 步重新生成。首次 respond 不传。
   */
  priorRoundtrips?: AgentLoopPriorRoundtrip[];

  /**
   * 图助手 text_protocol 多轮 agent 循环配置（可选）。
   *
 * 仅当本字段存在且 `toolTransport.selection.transport === 'text_protocol'`
   * 时，TurnOrchestrator 才走图助手多轮循环，并在 confirm 工具前暂停等待确认。
   * 不提供时，text_protocol 仍走既有单轮逻辑，主链与其他会话行为不变。
   *
   * 依赖方向：auto/confirm 决策由 apps/api 通过 `decideConfirmation` 回调注入，
   * core 不反向依赖图助手策略服务。
   */
  graphAssistantAgentLoop?: GraphAssistantAgentLoopConfig;
}

/** 图助手 text_protocol 多轮 agent 循环配置。 */
export interface GraphAssistantAgentLoopConfig {
  /** 单个工具的执行前确认决策回调。 */
  decideConfirmation: GraphToolConfirmationDecider;
  /**
   * 批准后续跑：进入生成循环前先执行这个已批准的工具调用。
   *
   * 仅「批准后续跑」路径传入；首次生成不传。
   */
  resumeApprovedCall?: {
    callId: string;
    toolName: string;
    args: Record<string, unknown>;
  };
}

/**
 * turn 因待确认而暂停时返回的待确认调用信息。
 *
 * apps/api 据此登记 `graph_assistant_pending_tool_calls` 记录并补全 confirmationId。
 */
export interface TurnPendingToolConfirmation {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  sideEffectLevel?: ToolSideEffectLevel;
  /**
   * 暂停时的完整对话上下文，供续跑重建。
   *
   * 包含初始 messages、各步 assistant 原始输出与各步工具结果用户消息。
   */
  conversationMessages: ChatMessage[];
}

// ── Turn Execution Result ─────────────────────────────

/**
 * 回合执行结果。
 *
 * 表示生成阶段的产物，不代表楼层已经 committed。
 * 成功返回时，floor 应仍处于 generating，最终 commit 由上层服务负责。
 */
export interface TurnExecutionResult {
  /** 楼层 ID */
  floorId: string;
  /**
   * 执行阶段结束时的楼层状态。
   *
   * 统一提交边界改造后，TurnOrchestrator 成功返回时固定为 generating。
   */
  finalState: 'generating';
  /** Narrator 最终输出文本（后处理后） */
  generatedText: string;
    /**原始 LLM 输出文本 */
  rawText: string;
  /**
   * Narrator 推理（思维链）文本。
   *
   * 来自生成阶段；模型未返回 reasoning 时缺省，按「无 reasoning」处理。
   */
  reasoningText?: string;
  /** 提取的摘要 */
  summaries: string[];
  /** 需要在主回复之后追加到最终 assistant 输出中的工具结果文本块。 */
  toolResultWritebackText?: string;
  /** 本轮工具传输 trace 片段。 */
  toolTransport?: PromptRuntimeToolTransportTrace;
  /** Director 结果（如启用） */
  directorResult?: DirectorResult;
  /** Verifier 结果（如启用） */
  verifierResult?: VerifierResult;
  /** Memory 注入结果（如启用） */
  memoryInjection?: MemoryInjectionResult;
  /** Memory 整理结果（如启用） */
  consolidationResult?: ConsolidationResult;
  /** 总 Token 用量 */
  totalUsage: TokenUsage;
  /**
   * 本回合真实执行过的工具调用记录。
   *
   * 后续 commit、审计与 deferred 生命周期观察都应以此字段为主真相源。
   */
  toolExecutionRecords?: ExecutedToolCallRecord[];
  /** 本回合工具产生但尚未持久化的变量写入 */
  bufferedVariableMutations?: BufferedToolVariableMutation[];
  /** 本回合已受理、但尚未 durable enqueue 的异步工具请求 */
  pendingToolJobs?: PendingToolJobRequest[];
  /**
   * 旧的摘要式工具调用记录。
   *
   * 仅作为 legacy-compatible projection fallback。
   * 若 `toolExecutionRecords` 已存在，新路径不应再主动生产或消费此字段。
   *
   * @deprecated 新路径应使用 toolExecutionRecords。
   */
  toolCalls?: ToolCallRecord[];

  /**
   * 图助手多轮 agent 循环的停止原因（仅图助手 text_protocol 多轮路径存在）。
   *
   * - `natural_stop`：模型不再请求工具，自然停止。
   * - `awaiting_confirmation`：遇到 confirm 工具暂停，等待用户批准。
   * - `max_steps`：达到步数上限收尾。
   */
  agentLoopStopReason?: AgentLoopStopReason;

  /**图助手多轮 agent 循环实际执行的生成步数。 */
  agentLoopSteps?: number;

  /**
   * 因 confirm 工具暂停时的待确认调用信息（仅 agentLoopStopReason='awaiting_confirmation'）。
   *
   * apps/api据此登记待确认记录、持久化续跑上下文、推送 SSE。
   */
  pendingToolConfirmation?: TurnPendingToolConfirmation;

  /**
   * 图助手 native 多步循环的按步结构化记录（仅 native_function_call 路径产出）。
   *
   * 每步保留可见文本与是否触发工具调用。message 正文取末步结论；阶段二据此旁路
   * 落库「中间叙述」（触发工具且可见文本非空的步）。
   */
  agentStepRecords?: AgentLoopStepRecord[];
}

/** @deprecated 使用 TurnExecutionResult。 */
export type TurnOutput = TurnExecutionResult;
