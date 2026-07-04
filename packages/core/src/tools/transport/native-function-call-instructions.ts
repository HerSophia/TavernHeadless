/**
 * native function calling 模式的协议反幻觉说明。
 *
 * 与 text_protocol 的 `TEXT_PROTOCOL_TOOL_CALL_INSTRUCTIONS` 对称：text_protocol
 * 说明教模型「如何用文本块表达工具调用」，本说明则相反，明确告诉模型「工具调用走原生
 * 结构化通道，正文里不要出现任何工具往返文本块」。
 *
 * 背景：native 模式下工具是 schema-only（SDK 只返回结构化 toolCalls，不自动执行），
 * 模型本应直接发起结构化调用而非在正文写工具块。但当对话历史里残留过 text_protocol 的
 * 文本协议范例，或模型自行幻觉式复述工具往返时，正文会泄漏 `<tool_call>` /
 * `<tool_result>` / `<tool_response>` 文本块。本说明作为 native 模式的定点话术，
 * 给一句明确的否定，避免「零协议说明」让模型脑补。
 *
 * 这是提示词侧的反幻觉约束，与输出侧的 `stripNativeToolBlocksPreservingTrailingMalformed`
 * 剥离器形成「话术 + 机制」双层防御；剥离器是兜底，本说明是提示。
 *
 * 内容为一句一条的硬约束，正文尽量短，不写长段论述。
 */
export const NATIVE_FUNCTION_CALL_TOOL_CALL_INSTRUCTIONS = [
  `# Tool calling protocol`,
  ``,
  `Tools are available through native function calling. Follow these rules:`,
  ``,
  `- Always invoke tools through the native function calling channel, never as text.`,
  `- Do not output <tool_call>, <tool_result>, or <tool_response> blocks in your reply.`,
  `- Do not describe, narrate, replay, or fabricate any tool call or tool result in the reply text.`,
  `- When you need a tool, issue a structured tool call directly instead of writing about it.`,
  `- When you need to answer, output only the user-facing reply text.`,
].join("\n");
