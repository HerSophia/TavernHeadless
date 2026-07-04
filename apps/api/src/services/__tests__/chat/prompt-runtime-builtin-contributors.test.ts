import { describe, expect, it, vi } from "vitest";

import {
  buildMemoryProjectionContributor,
  buildStateProjectionContributor,
  buildToolListContributor,
} from "../../chat/prompt-runtime-builtin-contributors.js";

function makeTool(name: string) {
  return {
    name,
    description: `${name} description`,
    parameters: {
      type: "object" as const,
      properties: {
        value: { type: "string" },
      },
      required: ["value"],
    },
    sideEffectLevel: "none" as const,
    allowedSlots: [],
    source: "builtin" as const,
  };
}

describe("prompt-runtime-builtin-contributors", () => {
  it("builds memory projection contributor from memory summary and trace", () => {
    const result = buildMemoryProjectionContributor({
      promptMode: "compat_plus",
      memorySummary: "  memory summary  ",
      memoryTrace: {
        summaryInjected: true,
        runtimeMode: "async_primary",
        requestedWrite: true,
        effectiveWrite: true,
      },
    });

    expect(result.contributor).toMatchObject({
      id: "builtin:memory_projection",
      kind: "memory_projection",
      sourceKind: "memory",
      modeScope: "compat_plus",
      promptRenderable: {
        title: "Memory summary",
        content: "memory summary",
      },
      trace: {
        deterministic: true,
        cacheScope: "floor",
      },
    });
  });

  it("skips memory projection contributor when no summary exists", () => {
    const result = buildMemoryProjectionContributor({
      promptMode: "native",
      memorySummary: "  ",
      memoryTrace: undefined,
    });

    expect(result.contributor).toBeUndefined();
  });

  it("still builds memory projection contributor when only structured memory items exist", () => {
    const result = buildMemoryProjectionContributor({
      promptMode: "native",
      memorySummary: undefined,
      memoryTrace: {
        summaryInjected: false,
        strategy: "direct_items",
        selectedItems: [
          {
            memoryId: "memory-1",
            scope: "branch",
            scopeId: "memscope:session-1:main",
            branchId: "main",
            kind: "fact",
            source: "store",
            score: 0.8,
            tokenCount: 12,
            selectedReason: null,
          },
        ],
      },
    });

    expect(result.contributor).toMatchObject({
      id: "builtin:memory_projection",
      kind: "memory_projection",
      sourceKind: "memory",
      modeScope: "native",
      promptRenderable: {
        title: "Memory selection",
        content: JSON.stringify(
          {
            selected_items: [
              {
                memory_id: "memory-1",
                scope: "branch",
                scope_id: "memscope:session-1:main",
                branch_id: "main",
                kind: "fact",
                source: "store",
                score: 0.8,
                token_count: 12,
              },
            ],
          },
          null,
          2,
        ),
      },
    });
    expect(result.contributor?.payload).toMatchObject({
      summary: null,
      memoryTrace: {
        strategy: "direct_items",
        selectedItems: [
          expect.objectContaining({ memoryId: "memory-1", kind: "fact" }),
        ],
      },
    });
  });

  it("builds state projection contributor from managed scene and world context", () => {
    const result = buildStateProjectionContributor({
      promptMode: "native",
      firstPartyStateContext: {
        scene: {
          source: "source_floor_snapshot",
          present: true,
          floorId: "floor-1",
          updatedAt: 1,
          schemaVersion: 1,
          scene: {
            generatedText: "Scene text",
            summaries: [],
          },
        } as never,
        world: null,
      },
    });

    expect(result.contributor).toMatchObject({
      id: "builtin:state_projection",
      kind: "state_projection",
      sourceKind: "state_projection",
      modeScope: "native",
      trace: {
        deterministic: true,
        cacheScope: "floor",
      },
    });
    expect(result.contributor?.promptRenderable?.content).toContain(
      "Scene text",
    );
  });

  it("skips state projection contributor when no managed state is present", () => {
    const result = buildStateProjectionContributor({
      promptMode: "compat_plus",
      firstPartyStateContext: { scene: null, world: null },
    });

    expect(result.contributor).toBeUndefined();
  });

  it("builds a tool_list contributor only for text_protocol transport", () => {
    const result = buildToolListContributor({
      promptMode: "compat_strict",
      transport: "text_protocol",
      toolsForSlot: [makeTool("roll_dice")],
    });

    expect(result.contributor).toMatchObject({
      id: "builtin:tool_list",
      kind: "tool_list",
      sourceKind: "tool_list",
      modeScope: "compat_strict",
      payload: {
        transport: "text_protocol",
        toolNames: ["roll_dice"],
        budgetGroup: "tool_list",
      },
      promptRenderable: {
        title: "Tool list",
      },
    });
    expect(result.contributor?.promptRenderable?.content).toContain(
      "<tool_list>",
    );
    expect(result.contributor?.promptRenderable?.content).toContain(
      'name="roll_dice"',
    );
    // text_protocol 下应把工具调用协议说明前置到工具清单之前
    expect(result.contributor?.promptRenderable?.content).toContain(
      "Tool calling protocol",
    );
    expect(result.contributor?.promptRenderable?.content).toContain(
      "<tool_call",
    );
    const content = result.contributor?.promptRenderable?.content ?? "";
    expect(content.indexOf("Tool calling protocol")).toBeLessThan(
      content.indexOf("<tool_list>"),
    );

    expect(
      buildToolListContributor({
        promptMode: "native",
        transport: "text_protocol",
        toolsForSlot: [],
      }).contributor,
    ).toBeUndefined();
  });

  it("injects native anti-hallucination instructions for native_function_call transport", () => {
    const result = buildToolListContributor({
      promptMode: "native",
      transport: "native_function_call",
      toolsForSlot: [makeTool("roll_dice")],
    });

    expect(result.contributor).toMatchObject({
      id: "builtin:tool_list",
      kind: "tool_list",
      sourceKind: "tool_list",
      modeScope: "native",
      payload: {
        transport: "native_function_call",
        toolNames: ["roll_dice"],
        budgetGroup: "tool_list",
      },
      promptRenderable: {
        title: "Tool calling protocol",
      },
    });

    const content = result.contributor?.promptRenderable?.content ?? "";
    // native 说明仍属 Tool calling protocol，但明确禁止文本工具块。
    expect(content).toContain("Tool calling protocol");
    expect(content).toContain("native function calling");
    expect(content).toContain("<tool_call>");
    expect(content).toContain("<tool_result>");
    expect(content).toContain("<tool_response>");
    // native 不应输出 text_protocol 的 <tool_list> 清单或调用格式模板。
    expect(content).not.toContain("<tool_list>");
  });

  it("does not inject tool_list contributor when transport is none", () => {
    expect(
      buildToolListContributor({
        promptMode: "native",
        transport: "none",
        toolsForSlot: [makeTool("roll_dice")],
      }).contributor,
    ).toBeUndefined();
  });
});
