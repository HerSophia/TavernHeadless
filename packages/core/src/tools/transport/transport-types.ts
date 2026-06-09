import type { ToolCallResult, ToolDefinition } from '../types.js';

/**
 * 可用的工具调用传输方式。
 */
export type ToolCallTransportKind = 'native_function_call' | 'text_protocol' | 'none';

/**
 * 工具调用传输决策的稳定原因码。
 */
export type ToolCallTransportReasonCode =
  | 'explicit_override'
  | 'tools_disabled'
  | 'instance_not_supports_function_call'
  | 'default_native_function_call';

/**
 * 本轮工具调用传输决策。
 */
export interface ToolCallTransportSelection {
  transport: ToolCallTransportKind;
  reasonCode: ToolCallTransportReasonCode;
  reasonDetail?: string;
}

/**
 * 渲染工具列表时的输入。
 */
export interface ToolListRenderInput {
  tools: ToolDefinition[];
}

/**
 * 渲染工具列表时的输出。
 */
export interface ToolListRenderOutput {
  content: string;
  renderedToolNames: string[];
}

/**
 * 文本协议工具调用解析输入。
 */
export interface ToolCallParseInput {
  modelOutputText: string;
  allowedToolNames: ReadonlySet<string>;
}

/**
 * 一条通过文本协议接受的工具调用。
 */
export interface ParsedToolCall {
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * 文本协议解析诊断原因。
 */
export type ToolCallParseDiagnosticReason =
  | 'tool_not_registered'
  | 'json_parse_failed'
  | 'missing_args_field'
  | 'duplicate_call_id'
  | 'malformed_block';

/**
 * 一条文本协议解析诊断。
 */
export interface ToolCallParseDiagnostic {
  callId: string | null;
  toolName: string | null;
  reason: ToolCallParseDiagnosticReason;
  excerpt: string;
}

/**
 * 文本协议块级统计。
 */
export interface ToolCallParseStats {
  blockCount: number;
  acceptedCount: number;
  rejectedCount: number;
}

/**
 * 文本协议工具调用解析输出。
 */
export interface ToolCallParseOutput {
  calls: ParsedToolCall[];
  diagnostics: ToolCallParseDiagnostic[];
  stats: ToolCallParseStats;
}

/**
 * 文本协议工具结果格式化输入。
 */
export interface ToolResultFormatInput {
  callId: string;
  toolName: string;
  result: ToolCallResult;
}

/**
 * 文本协议工具结果格式化输出。
 */
export interface ToolResultFormatOutput {
  content: string;
}

/**
 * 一种工具调用传输方式应提供的能力。
 */
export interface ToolCallTransport {
  readonly kind: ToolCallTransportKind;
  renderToolList?(input: ToolListRenderInput): ToolListRenderOutput;
  parseToolCalls?(input: ToolCallParseInput): ToolCallParseOutput;
  formatToolResult?(input: ToolResultFormatInput): ToolResultFormatOutput;
}
