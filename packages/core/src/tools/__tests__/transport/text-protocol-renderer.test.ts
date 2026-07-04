import { describe, expect, it } from "vitest";

import type { ToolDefinition } from "../../types.js";
import {
  TextProtocolToolListRenderer,
  TEXT_PROTOCOL_TOOL_CALL_INSTRUCTIONS,
} from "../../transport/index.js";

function makeTool(name: string, description: string): ToolDefinition {
  return {
    name,
    description,
    parameters: {
      type: "object",
      properties: {
        value: { type: "string" },
      },
      required: ["value"],
    },
    sideEffectLevel: "none",
    allowedSlots: [],
    source: "builtin",
  };
}

describe("TextProtocolToolListRenderer", () => {
  it("returns an empty block for an empty tool list", () => {
    const renderer = new TextProtocolToolListRenderer();

    expect(renderer.render({ tools: [] })).toEqual({
      content: "",
      renderedToolNames: [],
    });
  });

  it("renders a stable tool_list block", () => {
    const renderer = new TextProtocolToolListRenderer();
    const result = renderer.render({
      tools: [makeTool("roll_dice", "Roll a dice")],
    });

    expect(result.renderedToolNames).toEqual(["roll_dice"]);
    expect(result.content).toContain("<tool_list>");
    expect(result.content).toContain('<tool name="roll_dice">');
    expect(result.content).toContain('"description": "Roll a dice"');
    expect(result.content.indexOf('"description"')).toBeLessThan(
      result.content.indexOf('"parameters"'),
    );
    expect(result.content).toContain("</tool_list>");
  });

  it("preserves inputorder for multiple tools", () => {
    const renderer = new TextProtocolToolListRenderer();
    const result = renderer.render({
      tools: [makeTool("alpha", "Alpha tool"), makeTool("beta", "Beta tool")],
    });

    expect(result.renderedToolNames).toEqual(["alpha", "beta"]);
    expect(result.content.indexOf('name="alpha"')).toBeLessThan(
      result.content.indexOf('name="beta"'),
    );
  });

  it("renders the tool call protocol instructions matching the parser contract", () => {
    const renderer = new TextProtocolToolListRenderer();
    const instructions = renderer.renderInstructions();

    expect(instructions).toBe(TEXT_PROTOCOL_TOOL_CALL_INSTRUCTIONS);
    // 与解析器同源的硬约束都应在说明里出现
    expect(instructions).toContain("<tool_call");
    expect(instructions).toContain('id="call_1"');
    expect(instructions).toContain("name=");
    expect(instructions).toContain('"args"');
    // render() 的工具清单与说明相互独立，说明本身不应内联 <tool_list> 清单内容
    expect(renderer.render({ tools: [] }).content).toBe("");
  });
});
