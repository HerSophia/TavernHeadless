import { describe, expect, it } from "vitest";

import {
  buildMemoryProjectionContributor,
  buildStateProjectionContributor,
} from "../../chat/prompt-runtime-builtin-contributors.js";

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
});
