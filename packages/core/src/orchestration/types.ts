import type { ChatMessage } from '../prompt/types.js';
import type { GenerationParams, InstanceSlot, ModelConfig, TokenUsage } from '../llm/types.js';
import type { SummaryExtractorOptions } from '../generation/summary-extractor.js';
import type { MemoryInjectionOptions, MemoryInjectionResult, MemoryItem } from '../memory/types.js';
import type {
  BufferedToolVariableMutation,
  ExecutedToolCallRecord,
  PendingToolJobRequest,
  ToolPermissions,
  ToolCallRecord,
} from '../tools/types.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import type { DirectorInput, DirectorResult } from './director.js';
import type { VerifierInput, VerifierResult } from './verifier.js';
import type { ConsolidationResult } from '../memory/memory-consolidator.js';

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

/** 回合输入 */
export interface TurnInput {
  /** 会话 ID */
  sessionId: string;
  /** 楼层 ID（已创建好的 draft 楼层） */
  floorId: string;
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
  /** 原始 LLM 输出文本 */
  rawText: string;
  /** 提取的摘要 */
  summaries: string[];
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
  /** 本回合真实执行过的工具调用记录 */
  toolExecutionRecords?: ExecutedToolCallRecord[];
  /** 本回合工具产生但尚未持久化的变量写入 */
  bufferedVariableMutations?: BufferedToolVariableMutation[];
  /** 本回合已受理、但尚未 durable enqueue 的异步工具请求 */
  pendingToolJobs?: PendingToolJobRequest[];
  /**
   * 旧的摘要式工具调用记录。
   *
   * @deprecated 新路径应使用 toolExecutionRecords。
   */
  toolCalls?: ToolCallRecord[];
}

/** @deprecated 使用 TurnExecutionResult。 */
export type TurnOutput = TurnExecutionResult;
