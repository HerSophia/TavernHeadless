import { describe, expect, it, vi } from "vitest";

import { TurnMemoryService } from "../../chat/turn-memory-service.js";

describe("TurnMemoryService", () => {
  const emitBestEffortEvent = vi.fn(async () => undefined);

  it("retrieveMemorySummary returns formatted text from the memory store", async () => {
    const service = new TurnMemoryService({
      memoryStore: {
        prepareInjection: vi.fn(async () => ({
          items: [],
          formattedText: "memory summary",
          tokenCount: 12,
        })),
        query: vi.fn(),
      } as never,
      enableDualSummaryInjection: false,
      emitBestEffortEvent,
    });

    await expect(service.retrieveMemorySummary("sess", "acc", "floor-1", "main")).resolves.toBe("memory summary");
  });

  it("retrieveMemoryInjection returns structured selection truth beside the summary text", async () => {
    const service = new TurnMemoryService({
      memoryStore: {
        prepareInjection: vi.fn(async () => ({
          items: [{
            id: "memory-1",
            scope: "branch",
            scopeId: "memscope:sess:main",
            type: "summary",
            summaryTier: "micro",
            content: "A recent branch summary.",
            importance: 0.7,
            confidence: 1,
            status: "active",
            tokenCountEstimate: 14,
            createdAt: 1,
            updatedAt: 1,
          }],
          formattedText: "memory summary",
          tokenCount: 14,
        })),
        query: vi.fn(),
      } as never,
      enableDualSummaryInjection: true,
      emitBestEffortEvent,
    });

    await expect(service.retrieveMemoryInjection("sess", "acc", "floor-1", "main")).resolves.toMatchObject({
      injection: expect.objectContaining({ formattedText: "memory summary", tokenCount: 14 }),
      memorySummary: "memory summary",
      memoryTrace: expect.objectContaining({ strategy: "dual_summary", summaryText: "memory summary" }),
    });
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
