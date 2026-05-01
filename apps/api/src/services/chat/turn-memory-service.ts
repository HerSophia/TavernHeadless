import type { CoreEventMap, MemoryInjectionOptions, MemoryStore, PromptRuntimeMemoryTrace, TurnInput } from "@tavern/core";
import { MemoryScopeResolver } from "@tavern/core";

import { TurnMemoryInjectionService } from "../memory/injection/turn-memory-injection-service.js";

export class TurnMemoryService {
  private readonly memoryScopeResolver = new MemoryScopeResolver();
  private readonly injectionService: TurnMemoryInjectionService;

  constructor(
    private readonly options: {
      memoryStore?: MemoryStore;
      memoryInjectionDecay?: MemoryInjectionOptions["decay"];
      enableDualSummaryInjection: boolean;
      emitBestEffortEvent: <K extends keyof CoreEventMap>(name: K, payload: CoreEventMap[K]) => Promise<void>;
    },
  ) {
    this.injectionService = new TurnMemoryInjectionService({
      memoryStore: options.memoryStore,
      memoryInjectionDecay: options.memoryInjectionDecay,
      enableDualSummaryInjection: options.enableDualSummaryInjection,
      emitBestEffortEvent: options.emitBestEffortEvent,
    });
  }

  async retrieveMemoryInjection(
    sessionId: string,
    accountId: string,
    floorId?: string,
    branchId?: string,
  ): Promise<{
    memorySummary?: string;
    memoryTrace?: Omit<PromptRuntimeMemoryTrace, "summaryInjected">;
  } | undefined> {
    const result = await this.injectionService.retrieveMemoryInjection({
      sessionId,
      accountId,
      floorId,
      branchId,
    });

    if (!result) {
      return undefined;
    }

    return { memorySummary: result.memorySummary, memoryTrace: result.memoryTrace };
  }

  async retrieveMemorySummary(
    sessionId: string,
    accountId: string,
    floorId?: string,
    branchId?: string,
  ): Promise<string | undefined> {
    const injection = await this.retrieveMemoryInjection(sessionId, accountId, floorId, branchId);
    return injection?.memorySummary;
  }

  async buildConsolidationContext(
    sessionId: string,
    accountId: string,
    floorId: string,
    branchId: string | undefined,
    currentFloorContent: string,
    enableMemoryConsolidation?: boolean,
  ): Promise<TurnInput["consolidationContext"] | undefined> {
    if (!this.options.memoryStore || enableMemoryConsolidation !== true) {
      return undefined;
    }

    const normalizedContent = currentFloorContent.trim();
    if (!normalizedContent) {
      return undefined;
    }

    try {
      const scopeRefs = this.memoryScopeResolver.resolveVisibleRefs({ accountId, sessionId, branchId, floorId });
      const [recentSummaryItems, existingFacts] = await Promise.all([
        this.options.memoryStore.query({
          scopeRefs,
          accountId,
          type: "summary",
          status: "active",
          lifecycleStatus: "active",
          orderBy: "updatedAt",
          orderDir: "desc",
          limit: 20,
        }),
        this.options.memoryStore.query({
          scopeRefs,
          accountId,
          type: "fact",
          status: "active",
          lifecycleStatus: "active",
          orderBy: "importance",
          orderDir: "desc",
          limit: 50,
        }),
      ]);

      return {
        currentFloorContent: normalizedContent,
        recentSummaries: recentSummaryItems.map((item) => item.content).filter((item) => item.trim().length > 0),
        existingFacts,
      };
    } catch (error) {
      await this.options.emitBestEffortEvent("memory.consolidation_context_failed", {
        sessionId,
        scope: "floor",
        scopeId: floorId,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      return undefined;
    }
  }
}
