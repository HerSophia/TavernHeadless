import { describe, expect, it } from "vitest";

import { PromptRuntimeContributorRunner } from "../../chat/prompt-runtime-contributor-runner.js";

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

describe("PromptRuntimeContributorRunner", () => {
  it("returns no contributors for compat_strict", () => {
    const runner = new PromptRuntimeContributorRunner();

    expect(runner.resolve({
      promptMode: "compat_strict",
      memorySummary: "memory summary",
      memoryTrace: {
        summaryInjected: true,
      },
      firstPartyStateContext: {
        scene: null,
        world: null,
      },
      transport: "text_protocol",
      toolsForSlot: [makeTool("roll_dice")],
    })).toEqual({ contributors: [] });
  });

  it("collects memory and state contributors for compat_plus and native", () => {
    const runner = new PromptRuntimeContributorRunner();

    const compatPlus = runner.resolve({
      promptMode: "compat_plus",
      memorySummary: "memory summary",
      memoryTrace: {
        summaryInjected: true,
      },
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

    expect(compatPlus.contributors.map((contributor) => contributor.kind)).toEqual([
      "memory_projection",
      "state_projection",
    ]);
    expect(compatPlus.contributors.every((contributor) => contributor.modeScope === "compat_plus")).toBe(true);

    const native = runner.resolve({
      promptMode: "native",
      memorySummary: "memory summary",
      memoryTrace: {
        summaryInjected: true,
      },
      firstPartyStateContext: {
        scene: null,
        world: {
          source: "source_floor_snapshot",
          present: true,
          floorId: "floor-2",
          updatedAt: 2,
          schemaVersion: 2,
          world: {
            worldbookId: "wb-1",
            worldbookVersion: 3,
            summaryLines: ["World line"],
          },
        } as never,
      },
    });

    expect(native.contributors.map((contributor) => contributor.modeScope)).toEqual([
      "native",
      "native",
    ]);
  });

  it("collects memory projection even when memorySummary is absent but structured trace exists", () => {
    const runner = new PromptRuntimeContributorRunner();

    const result = runner.resolve({
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
      firstPartyStateContext: {
        scene: null,
        world: null,
      },
    });

    expect(result.contributors.map((contributor) => contributor.kind)).toEqual(["memory_projection"]);
    expect(result.contributors[0]?.payload).toMatchObject({
      summary: null,
      memoryTrace: {
        strategy: "direct_items",
      },
    });
  });

  it("appends tool_list when text_protocol transport is selected", () => {
    const runner = new PromptRuntimeContributorRunner();

    const result = runner.resolve({
      promptMode: "native",
      firstPartyStateContext: { scene: null, world: null },
      transport: "text_protocol",
      toolsForSlot: [makeTool("roll_dice")],
    });

    expect(result.contributors.map((contributor) => contributor.kind)).toEqual(["tool_list"]);
    expect(result.contributors[0]).toMatchObject({
      id: "builtin:tool_list",
      sourceKind: "tool_list",
      modeScope: "native",
      payload: {
        transport: "text_protocol",
        toolNames: ["roll_dice"],
      },
    });
  });
});
