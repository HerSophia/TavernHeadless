import {
  TEXT_PROTOCOL_TOOL_CALL_TAG,
  TEXT_PROTOCOL_TOOL_LIST_TAG,
  TEXT_PROTOCOL_TOOL_RESULT_TAG,
} from "./constants.js";

/**
 * text_protocol 工具调用协议说明。
 *
 * 当本轮工具调用走 text_protocol（而非原生 function calling）时，
 * 模型需要按本说明在普通文本里输出 `<tool_call>` 块来表达工具调用。
 *
 * 本说明与解析器 `TextProtocolToolCallParser` 同源：缺 id / name、
 * body 非合法 JSON、顶层无 `args` 都会被拒绝。说明里强调的硬约束
 * 与解析器实际校验的规则一一对应，避免文案与校验脱节。
 *
 * 与 `render()` 输出的 `<tool_list>` 工具清单配合使用：清单给出可用
 * 工具与其参数 schema，本说明给出调用格式、JSON / 数组约束与批量规则。
 */
export const TEXT_PROTOCOL_TOOL_CALL_INSTRUCTIONS = [
  `# Tool calling protocol`,
  ``,
  `You can call tools by emitting <${TEXT_PROTOCOL_TOOL_CALL_TAG}> blocks in your reply.`,
  `The available tools and their parameter schemas are listed in the <${TEXT_PROTOCOL_TOOL_LIST_TAG}> block.`,
  ``,
  `## Call format`,
  ``,
  `Wrap each call exactly like this:`,
  ``,
  `<${TEXT_PROTOCOL_TOOL_CALL_TAG} id="call_1" name="tool_name">`,
  `{"args": { ... }}`,
  `</${TEXT_PROTOCOL_TOOL_CALL_TAG}>`,
  ``,
  `## Hard requirements`,
  ``,
  `- Every call must have a unique "id" and a "name" that exists in the tool list.`,
  `- The block body must be a single valid JSON object.`,
  `- That JSON object must have a top-level "args" object holding the parameters.`,
  `- Do not wrap the <${TEXT_PROTOCOL_TOOL_CALL_TAG}> block in markdown code fences.`,
  ``,
  `## JSON and array rules`,
  ``,
  `- Arrays must be valid JSON arrays written inside a single call, e.g. "tags": ["a", "b"].`,
  `- Do not split one array or one argument across multiple calls.`,
  `- Do not add comments or trailing commas inside the JSON.`,
  `- Keep all strings JSON-escaped; do not paste raw line breaks that would break the JSON.`,
  ``,
  `## Batching`,
  ``,
  `- Emit independent calls together in the same reply.`,
  `- Only wait for a tool result before the next call when that call depends on the result.`,
  ``,
  `## Tool results`,
  ``,
  `- Each executed call is fed back to you as a <${TEXT_PROTOCOL_TOOL_RESULT_TAG}> block.`,
  `- Read the result, then decide your next step; stop emitting tool calls once you are done.`,
  ``,
  `## Example`,
  ``,
  `<${TEXT_PROTOCOL_TOOL_CALL_TAG} id="call_1" name="get_weather">`,
  `{"args": {"city": "Tokyo", "days": 3}}`,
  `</${TEXT_PROTOCOL_TOOL_CALL_TAG}>`,
].join("\n");
