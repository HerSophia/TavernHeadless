import type {
  ToolListRenderInput,
  ToolListRenderOutput,
} from "../transport-types.js";

import {
  TEXT_PROTOCOL_TOOL_LIST_CLOSE,
  TEXT_PROTOCOL_TOOL_LIST_OPEN,
  TEXT_PROTOCOL_TOOL_TAG,
} from "./constants.js";
import { TEXT_PROTOCOL_TOOL_CALL_INSTRUCTIONS } from "./tool-call-instructions.js";

function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function serializeToolDefinition(
  tool: ToolListRenderInput["tools"][number],
): string {
  return JSON.stringify(
    {
      description: tool.description,
      parameters: tool.parameters,
    },
    null,
    2,
  );
}

/**
 * 将工具定义列表渲染为文本协议中的 `<tool_list>` 块。
 */
export class TextProtocolToolListRenderer {
  render(input: ToolListRenderInput): ToolListRenderOutput {
    if (input.tools.length === 0) {
      return { content: "", renderedToolNames: [] };
    }

    const renderedToolNames = input.tools.map((tool) => tool.name);
    const blocks = input.tools.map((tool) => {
      const name = escapeXmlAttribute(tool.name);
      return [
        `<${TEXT_PROTOCOL_TOOL_TAG} name="${name}">`,
        serializeToolDefinition(tool),
        `</${TEXT_PROTOCOL_TOOL_TAG}>`,
      ].join("\n");
    });

    return {
      content: [
        TEXT_PROTOCOL_TOOL_LIST_OPEN,
        ...blocks,
        TEXT_PROTOCOL_TOOL_LIST_CLOSE,
      ].join("\n"),
      renderedToolNames,
    };
  }

  /**
   * 返回 text_protocol 工具调用协议说明。
   *
   * 与 {@link render} 输出的 `<tool_list>` 清单配合：清单给出可用工具与
   * 参数 schema，本说明给出 `<tool_call>` 的输出格式、JSON / 数组约束与
   * 批量规则。调用方通常把本说明前置到清单之前注入提示词。
   */
  renderInstructions(): string {
    return TEXT_PROTOCOL_TOOL_CALL_INSTRUCTIONS;
  }
}
