import {
  TEXT_PROTOCOL_TOOL_CALL_TAG,
  TEXT_PROTOCOL_TOOL_LIST_TAG,
} from './constants.js';
import type {
  ToolCallParseDiagnostic,
  ToolCallParseDiagnosticReason,
} from '../transport-types.js';

/**
 * 每种解析诊断对应的修正提示（面向模型，英文，与协议说明同语言）。
 */
const REASON_HINTS: Record<ToolCallParseDiagnosticReason, string> = {
  tool_not_registered: `the tool name isnot inthe available tool list; use a name from the <${TEXT_PROTOCOL_TOOL_LIST_TAG}> block`,
  invalid_tool_name: `the tool name is malformed; use the exact name from the <${TEXT_PROTOCOL_TOOL_LIST_TAG}> block`,
  json_parse_failed: `the block body is not valid JSON; emit a single valid JSON object with no commentsor trailing commas`,
  missing_args_field: `the JSON object is missing the top-level "args" object; wrap the parameters as {"args": { ... }}`,
  missing_call_id: `the call is missing its "id" attribute; add a unique id, e.g. id="call_1"`,
  missing_tool_name: `the call is missing its "name" attribute; add name="tool_name"`,
  duplicate_call_id: `the "id" attribute is reused; give every call a unique id`,
  malformed_block: `the <${TEXT_PROTOCOL_TOOL_CALL_TAG}> block is malformed; open and close it exactly and keep the JSON body inside`,
  malformed_attributes: `the call attributes are malformed; use id="..." and name="..." with double quotes`,
};

function describeDiagnostic(diagnostic: ToolCallParseDiagnostic): string {
  const hint = REASON_HINTS[diagnostic.reason];
  const target = diagnostic.toolName
    ? `tool "${diagnostic.toolName}"`
    : diagnostic.callId
      ? `call "${diagnostic.callId}"`
      : 'one tool call';
  return `- ${target}: ${hint} (reason: ${diagnostic.reason})`;
}

/**
 * 把文本协议解析诊断转换为面向模型的自然语言反馈。
 *
 * 用于多轮 agent 循环：当某步没有解析出任何有效 `<tool_call>`，但存在解析
 * 诊断时，把这些诊断转成可读的修正说明回填给模型，引导其在下一步纠正格式，
 *而不是被误判为「自然结束」。
 *
 * @param diagnostics - 本步解析得到的诊断列表（应非空）。
 * @returns 面向模型的反馈文本。
 */
export function buildTextProtocolToolCallFeedback(
  diagnostics: ToolCallParseDiagnostic[],
): string {
  const lines = diagnostics.map(describeDiagnostic);
  return [
    `Your previous reply contained tool call blocks that could not be parsed, so no tool was executed.`,
    `Fix the following issues and re-emit the corrected <${TEXT_PROTOCOL_TOOL_CALL_TAG}> blocks:`,
    ``,
    ...lines,
    ``,
    `If you are done and do not need any tool, reply normally without any <${TEXT_PROTOCOL_TOOL_CALL_TAG}> block.`,
  ].join('\n');
}
