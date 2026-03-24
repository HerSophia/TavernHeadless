import type { FloorState } from '@tavern/shared';
import type { ChatMessage } from '../prompt/types.js';
import type { GenerationParams, InstanceSlot, ModelConfig, TokenUsage } from '../llm/types.js';
import type { SummaryExtractorOptions } from '../generation/summary-extractor.js';
import type { MemoryInjectionOptions, MemoryInjectionResult, MemoryItem } from '../memory/types.js';
import type { ToolPermissions, ToolCallRecord } from '../tools/types.js';
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
  /** 已拼装好的 messages（由外部编排器产生） */
  messages: ChatMessage[];
  /** Generation 参数 */
  generationParams: GenerationParams;
  /** 回合配置 */
  config?: TurnConfig;
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

// ── Turn Output ───────────────────────────────────────

/** 回合输出 */
export interface TurnOutput {
  /** 楼层 ID */
  floorId: string;
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
  /** 楼层最终状态 */
  finalState: FloorState;
  /** 本回合所有工具调用记录 */
  toolCalls?: ToolCallRecord[];
}
