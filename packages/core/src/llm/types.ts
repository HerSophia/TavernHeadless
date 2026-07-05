// ── LLM 类型定义 ──────────────────────────────────────

import type { LanguageModel, Schema } from 'ai';

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
  /**
   * OpenAI 兼容端点的 API 形态选择。
   *
   * - `'chat'`：Chat Completions（`/v1/chat/completions`）
   * - `'responses'`：Responses（`/v1/responses`）
   * - `'completion'`：legacy Completions（`/v1/completions`）
   *
   * 仅对 openai / deepseek / xai / openai-compatible 生效；anthropic/google 忽略。
   * 缺省时保持 SDK 默认（@ai-sdk/openai v3 默认走 Responses）。
   *
   * 用途：部分自部署端点（vLLM / LM Studio 等）的 Responses API 实现不完整，
   * 可显式设为 `'chat'` 回退到 Chat Completions。
   */
  apiMode?: 'chat' | 'responses' | 'completion';
  /** 额外配置 */
  options?: Record<string, unknown>;
}

/** 模型配置 */
export interface ModelConfig {
  /** 提供商 ID */
  providerId: string;
  /** 模型 ID（如 'gpt-4o', 'claude-3-5-sonnet-latest'） */
  modelId: string;
  /** 可选：turn 级冻结的 LanguageModel 句柄。提供后优先于 providerId 动态查找。 */
  languageModel?: LanguageModel;
  /**
   * 可选：provider 类型。
   *
   * turn 级用 `languageModel` 冻结句柄时，providerId 通常是临时 id、未注册进 registry，
   * 此时无法从 registry 反查 type。上层应显式注入该字段，以便按provider 分流生成参数
   * （例如推理强度在 OpenAI 与 Anthropic 下的开启方式完全不同）。
   */
  providerType?: ProviderType;
  /** 显示名称 */
  displayName?: string;
}

// ── Generation Params ─────────────────────────────────

/** 生成响应格式 */
export interface GenerationResponseFormat {
  /** 响应类型 */
  type: 'text' | 'json_object' | 'json_schema';
  /** JSON Schema（仅 json_schema 时可用） */
  jsonSchema?: Record<string, unknown>;
}

/** 生成参数（从 STPreset 或自定义传入） */
export interface GenerationParams {
  /** 最大上下文 token 数（主要用于 prompt assemble / token budget） */
  maxContextTokens?: number;
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
  /** 随机种子 */
  seed?: number;
  /** 重复惩罚 */
  repetitionPenalty?: number;
  /** 最小概率阈值 */
  minP?: number;
  /** token 偏置 */
  logitBias?: Record<string, number>;
  /** 结构化响应格式 */
  responseFormat?: GenerationResponseFormat;
  /** 是否流式 */
  stream?: boolean;
  /** 超时（毫秒） */
  timeoutMs?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /**
   *推理强度（适用于支持 reasoning 的模型）。
   *
   * 预设三档 'low' | 'medium' | 'high' 提供字面量补全；同时允许传入任意
   * 非空字符串，以兼容部分模型提供更强档位（例如 'xhigh'、'minimal'）。
   *该值会原样透传给 provider，由模型自行解释。
   */
  reasoningEffort?: 'low' | 'medium' | 'high' | (string & {});
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

import type { ToolParameterSchema } from '../tools/types.js';

// ── 结构化模型消息 ────────────────────────────────────
//
// native function calling 的多轮续跑需要把「上一轮 assistant 的工具调用」与
// 「工具结果」结构化回填给模型。这些类型贴合 Vercel AI SDK 的 ModelMessage：
// assistant 角色携带 tool-call parts，tool 角色携带 tool-result parts。
//
// 约束：结构化消息只存在于 agent loop 内部与 LLM 请求，不进 prompt 组装、不落
// transcript。普通纯文本消息仍是 ChatMessage（{ role; content: string }），不变。

/** assistant 文本片段。 */
export interface ModelTextPart {
  type: 'text';
  text: string;
}

/** assistant发起的一次工具调用片段。 */
export interface ModelToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  /** 工具调用参数（已按 schema 还原的对象）。 */
  input: unknown;
}

/** 工具结果输出（贴合 SDK ToolResultOutput 的常用子集）。 */
export type ModelToolResultOutput =
  | { type: 'json'; value: unknown }
  | { type: 'text'; value: string }
  | { type: 'error-text'; value: string };

/** tool 角色携带的单个工具结果片段。 */
export interface ModelToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output: ModelToolResultOutput;
}

/** assistant 工具调用消息（含可选文本片段 + 工具调用片段）。 */
export interface AssistantToolCallMessage {
  role: 'assistant';
  content: Array<ModelTextPart |ModelToolCallPart>;
}

/** tool 角色的工具结果消息。 */
export interface ToolResultModelMessage {
  role: 'tool';
  content: ModelToolResultPart[];
}

/** 结构化模型消息（assistant tool-call / tool result）。 */
export type StructuredModelMessage = AssistantToolCallMessage | ToolResultModelMessage;

/** 纯文本模型消息（与 ChatMessage 同构）。 */
export interface PlainTextModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 发给 LLM 的消息：纯文本消息或结构化模型消息。
 *
 * 初始 messages 仍是纯文本；只有 native agent loop 内部续跑追加的工具往返消息
 * 使用结构化形态。
 */
export type LLMMessage = PlainTextModelMessage | StructuredModelMessage;

/** 判断一条 LLM 消息是否为纯文本消息（content 为字符串）。 */
export function isPlainTextModelMessage(message: LLMMessage): message is PlainTextModelMessage {
  return typeof (message as PlainTextModelMessage).content === 'string';
}

/** LLM 调用请求 */
export interface LLMRequest {
  /** 消息数组（纯文本或结构化模型消息） */
  messages: LLMMessage[];
  /** 生成参数 */
  params: GenerationParams;
  /** 使用的模型配置（可选，覆盖默认） */
  model?: ModelConfig;
  /** 中止信号 */
  abortSignal?: AbortSignal;
  /**
   * 可用工具列表（Vercel AI SDK 兼容格式）。
   *
   * 主链 inline 模式传带 `execute` 的工具，由 SDK 自动执行；
   * native agent loop 传 schema-only 工具（不带 execute），SDK 只返回 toolCalls 不执行。
   */
  tools?: Record<string, LLMToolDefinition | LLMToolSchemaDefinition>;
  /** 工具选择策略（当前仅在支持时显式设置 auto） */
  toolChoice?: 'auto';
  /** 最大自动工具调用步数（对应 Vercel AI SDK maxSteps） */
  maxSteps?: number;
}

/**
 * Vercel AI SDK 兼容的工具 schema 定义（不带 execute）。
 *
 * 传给 SDK 时，工具不带 execute，SDK 在该步只返回 toolCalls 并停止，不自动执行。
 * native agent loop 用它让模型「说要调哪些工具」，再由仓库自驱动执行。
 */
export interface LLMToolSchemaDefinition {
  description: string;
  inputSchema: Schema<unknown>;
}

/** Vercel AI SDK 兼容的工具定义（带 execute，主链 inline 模式由 SDK 自动执行）。 */
export interface LLMToolDefinition extends LLMToolSchemaDefinition {
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

/** 单次工具调用信息 */
export interface LLMToolCall {
  /**
* 工具调用 ID（SDK 返回的 toolCallId）。
   *
   * native agent loop 用它匹配 tool-call 与 tool-result；部分提取路径可能缺失。
   */
  callId?: string;
  toolName: string;
  args: Record<string, unknown>;
}

/** 单步执行结果（多步时有多条） */
export interface LLMStepResult {
  text: string;
  toolCalls: LLMToolCall[];
  toolResults: unknown[];
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
  /** 工具调用历史（多步时有多条） */
  toolCalls?: LLMToolCall[];
  /** 各步结果（多步时有多条） */
  steps?: LLMStepResult[];
  /**
   * 推理（思维链）文本。
   *
   * 仅当模型/Provider 返回 reasoning 时存在；不支持 reasoning 的模型为空（缺省），
   * 全链路按「无 reasoning」处理，不臆造内容。
   */
  reasoningText?: string;
}

/** LLM 流式回调 */
export interface StreamCallbacks {
  /** 收到文本片段 */
  onChunk?: (chunk: string) => void;
  /**
   * 收到推理（思维链）片段。
   *
   * 仅当模型/Provider 在流式过程中产出 reasoning delta 时触发。
   */
  onReasoning?: (delta: string) => void;
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
