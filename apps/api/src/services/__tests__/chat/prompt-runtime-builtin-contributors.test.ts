import { describe, expect, it, vi } from "vitest";

import { buildMemoryProjectionContributor, buildStateProjectionContributor, buildToolListContributor } from "../../chat/prompt-runtime-builtin-contributors.js";

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
        content: JSON.stringify({
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
        }, null, 2),
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
    expect(result.contributor?.promptRenderable?.content).toContain("Scene text");
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
      },
      promptRenderable: {
        title: "Tool list",
      },
    });
    expect(result.contributor?.promptRenderable?.content).toContain("<tool_list>");
    expect(result.contributor?.promptRenderable?.content).toContain('name="roll_dice"');

    expect(buildToolListContributor({
      promptMode: "native",
      transport: "native_function_call",
      toolsForSlot: [makeTool("roll_dice")],
    }).contributor).toBeUndefined();

    expect(buildToolListContributor({
      promptMode: "native",
      transport: "text_protocol",
      toolsForSlot: [],
    }).contributor).toBeUndefined();
  });
});
