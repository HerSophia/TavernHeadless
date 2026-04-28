import { describe, expect, it, vi } from "vitest";

import { TurnMemoryService } from "../../chat/turn-memory-service.js";

describe("TurnMemoryService", () => {
  const emitBestEffortEvent = vi.fn(async () => undefined);

  it("retrieveMemorySummary returns formatted text from the memory store", async () => {
    const service = new TurnMemoryService({
      memoryStore: {
        prepareInjection: vi.fn(async () => ({ formattedText: "memory summary" })),
        query: vi.fn(),
      } as never,
      enableDualSummaryInjection: false,
      emitBestEffortEvent,
    });

    await expect(service.retrieveMemorySummary("sess", "acc", "floor-1", "main")).resolves.toBe("memory summary");
  });

  it("buildConsolidationContext returns undefined when consolidation is disabled", async () => {
    const service = new TurnMemoryService({
      memoryStore: {
        prepareInjection: vi.fn(),
        query: vi.fn(),
      } as never,
      enableDualSummaryInjection: false,
      emitBestEffortEvent,
    });

    await expect(service.buildConsolidationContext("sess", "acc", "floor-1", "main", "text", false)).resolves.toBeUndefined();
  });

  it("buildConsolidationContext loads recent summaries and facts when enabled", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ content: "summary A" }])
      .mockResolvedValueOnce([{ id: "fact-1", content: "fact A" }]);
    const service = new TurnMemoryService({
      memoryStore: {
        prepareInjection: vi.fn(),
        query,
      } as never,
      enableDualSummaryInjection: false,
      emitBestEffortEvent,
    });

    const result = await service.buildConsolidationContext("sess", "acc", "floor-1", "main", " current text ", true);

    expect(result).toMatchObject({
      currentFloorContent: "current text",
      recentSummaries: ["summary A"],
      existingFacts: [{ id: "fact-1", content: "fact A" }],
    });
  });
});
