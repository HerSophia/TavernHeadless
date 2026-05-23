import { describe, expect, it } from "vitest";

import { PromptRuntimeContributorRunner } from "../../chat/prompt-runtime-contributor-runner.js";

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
});
