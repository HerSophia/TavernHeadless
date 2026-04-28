import type { CoreEventMap, MemoryInjectionOptions, MemoryStore, TurnInput } from "@tavern/core";
import { MemoryScopeResolver } from "@tavern/core";

export class TurnMemoryService {
  private readonly memoryScopeResolver = new MemoryScopeResolver();

  constructor(
    private readonly options: {
      memoryStore?: MemoryStore;
      memoryInjectionDecay?: MemoryInjectionOptions["decay"];
      enableDualSummaryInjection: boolean;
      emitBestEffortEvent: <K extends keyof CoreEventMap>(name: K, payload: CoreEventMap[K]) => Promise<void>;
    },
  ) {}

  async retrieveMemorySummary(
    sessionId: string,
    accountId: string,
    floorId?: string,
    branchId?: string,
  ): Promise<string | undefined> {
    if (!this.options.memoryStore) {
      return undefined;
    }

    try {
      const scopeContext = {
        accountId,
        sessionId,
        ...(branchId ? { branchId } : {}),
        ...(floorId ? { floorId } : {}),
      };
      const injection = await this.options.memoryStore.prepareInjection(
        sessionId,
        this.options.enableDualSummaryInjection
          ? {
              accountId,
              maxTokens: 500,
              maxItems: 24,
              minImportance: 0.35,
              includeTypes: ["open_loop", "fact", "summary"],
              strategy: "dual_summary",
              decay: this.options.memoryInjectionDecay,
              scopeContext,
            }
          : {
              accountId,
              maxTokens: 500,
              maxItems: 24,
              minImportance: 0.35,
              includeTypes: ["open_loop", "fact", "summary"],
              selectionMode: "balanced",
              typeOrder: ["open_loop", "fact", "summary"],
              typeMaxItems: { open_loop: 6, fact: 10, summary: 8 },
              decay: this.options.memoryInjectionDecay,
              scopeContext,
            },
      );

      return injection.formattedText || undefined;
    } catch (error) {
      await this.options.emitBestEffortEvent("memory.injection_failed", {
        sessionId,
        error: error instanceof Error ? error : new Error(String(error)),
      });

      return undefined;
    }
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
