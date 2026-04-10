// ── Generation 类型定义 ───────────────────────────────

import type { ChatMessage, TokenCounter } from '../prompt/types.js';
import type { GenerationParams, ModelConfig, TokenUsage, LLMToolDefinition, LLMToolCall } from '../llm/types.js';
import type { SummaryExtractorOptions } from './summary-extractor.js';

/**
 * 生成流水线输入
 *
 * 核心设计：接收已组装好的 PromptIR → 拼装 → 调用 LLM → 后处理。
 * 编排（如 assembleCompat）和正则处理通过外部注入，
 * 保持 core 不依赖 adapters-sillytavern。
 */
export interface GenerationInput {
  /**
   * 最终发给 LLM 的消息数组。
   * 由调用方通过 assembleCompat → MessageBuilder.build() 生成。
   */
  messages: ChatMessage[];

  /** 生成参数 */
  params: GenerationParams;

  /** 使用的模型配置（可选，覆盖默认） */
  model?: ModelConfig;

  /**
   * 前处理函数（可选）。
   * 在发送给 LLM 之前对消息数组进行处理。
   * 典型用途：正则 USER_INPUT 前处理。
   */
  preProcess?: (messages: ChatMessage[]) => ChatMessage[];

  /**
   * 后处理函数（可选）。
   * 在 LLM 输出后、摘要提取后对文本进行处理。
   * 典型用途：正则 AI_OUTPUT 后处理。
   */
  postProcess?: (text: string) => string;

  /** 摘要提取选项 */
  summaryOptions?: SummaryExtractorOptions;

  /** 中止信号 */
  abortSignal?: AbortSignal;

  /** 可用工具（inline 模式，Vercel AI SDK 兼容格式） */
  tools?: Record<string, LLMToolDefinition>;

  /** 最大自动工具调用步数 */
  maxSteps?: number;
}

/** 拼装统计信息（由调用方提供，流水线透传） */
export interface AssemblyInfo {
  /** 分区数量 */
  sectionCount: number;
  /** token 使用统计 */
  tokenUsage: {
    total: number;
    bySection: Record<string, number>;
    byGroup?: Record<string, number>;
    prunedByGroup?: Record<string, number>;
    availableForReply: number;
  };
  /** 被裁剪的消息数量 */
  prunedCount: number;
}

/** 生成流水线输出 */
export interface GenerationOutput {
  /** 生成的文本（后处理后） */
  text: string;
  /** 原始文本（LLM 直接输出） */
  rawText: string;
  /** 提取到的摘要 */
  summaries: string[];
  /** Token 使用统计 */
  usage: TokenUsage;
  /** 结束原因 */
  finishReason: string;

  /** 本次生成中的工具调用记录 */
  toolCalls?: LLMToolCall[];
}

/** 流水线回调 */
export interface PipelineCallbacks {
  /** 收到文本片段 */
  onChunk?: (chunk: string) => void;
  /** 生成出错 */
  onError?: (error: Error) => void;
}
