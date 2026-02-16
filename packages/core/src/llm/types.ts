// ── LLM 类型定义 ──────────────────────────────────────

import type { LanguageModel } from 'ai';

// ── Provider & Model ──────────────────────────────────

/** 支持的提供商类型 */
export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'xai'
  | 'openai-compatible';

/** 模型提供商配置 */
export interface ProviderConfig {
  /** 提供商 ID（如 'openai', 'my-proxy'） */
  id: string;
  /** 提供商类型 */
  type: ProviderType;
  /** API 密钥 */
  apiKey?: string;
  /** 自定义 Base URL（用于代理/兼容端点） */
  baseURL?: string;
  /** 额外配置 */
  options?: Record<string, unknown>;
}

/** 模型配置 */
export interface ModelConfig {
  /** 提供商 ID */
  providerId: string;
  /** 模型 ID（如 'gpt-4o', 'claude-3-5-sonnet-latest'） */
  modelId: string;
  /** 显示名称 */
  displayName?: string;
}

// ── Generation Params ─────────────────────────────────

/** 生成参数（从 STPreset 或自定义传入） */
export interface GenerationParams {
  /** 最大输出 token 数 */
  maxOutputTokens?: number;
  /** 采样温度 */
  temperature?: number;
  /** Top-P */
  topP?: number;
  /** Top-K */
  topK?: number;
  /** 频率惩罚 */
  frequencyPenalty?: number;
  /** 存在惩罚 */
  presencePenalty?: number;
  /** 停止序列 */
  stopSequences?: string[];
  /** 是否流式 */
  stream?: boolean;
  /** 超时（毫秒） */
  timeoutMs?: number;
  /** 最大重试次数 */
  maxRetries?: number;
}

// ── LLM Instance ──────────────────────────────────────

/** LLM 实例角色 */
export type LLMRole = 'narrator' | 'memory' | 'director' | 'verifier';

/**
 * LLM 实例槽位标识。
 * - 具体槽位名对应架构中的四种 LLM 实例。
 * - `'*'` 为通配符，表示「所有槽位」。
 */
export type InstanceSlot = 'narrator' | 'director' | 'verifier' | 'memory';

/** LLM 实例定义（架构文档的 LLM 实例化概念） */
export interface LLMInstance {
  /** 实例 ID */
  id: string;
  /** 角色 */
  role: LLMRole;
  /** 模型配置 */
  model: ModelConfig;
  /** 生成参数 */
  params: GenerationParams;
  /** 描述 */
  description?: string;
}

// ── Request / Response ────────────────────────────────

/** LLM 调用请求 */
export interface LLMRequest {
  /** 消息数组 */
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  /** 生成参数 */
  params: GenerationParams;
  /** 使用的模型配置（可选，覆盖默认） */
  model?: ModelConfig;
  /** 中止信号 */
  abortSignal?: AbortSignal;
}

/** Token 使用统计 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** LLM 调用结果 */
export interface LLMResponse {
  /** 生成的文本 */
  text: string;
  /** Token 使用统计 */
  usage: TokenUsage;
  /** 结束原因 */
  finishReason: string;
}

/** LLM 流式回调 */
export interface StreamCallbacks {
  /** 收到文本片段 */
  onChunk?: (chunk: string) => void;
  /** 生成完成 */
  onFinish?: (response: LLMResponse) => void;
  /** 生成出错 */
  onError?: (error: Error) => void;
}

// ── Port ──────────────────────────────────────────────

/**
 * LLM 服务端口（用于依赖注入 + Mock 测试）
 *
 * 所有 LLM 调用都通过此接口，便于替换为 Mock 实现。
 */
export interface LLMPort {
  /** 非流式生成 */
  generate(request: LLMRequest): Promise<LLMResponse>;
  /** 流式生成 */
  stream(request: LLMRequest, callbacks: StreamCallbacks): Promise<LLMResponse>;
}

// ── Provider Factory ──────────────────────────────────

/**
 * Provider 工厂函数类型
 *
 * 接收 ProviderConfig，返回一个能获取 LanguageModel 的函数。
 */
export type ProviderFactory = (config: ProviderConfig) => (modelId: string) => LanguageModel;
