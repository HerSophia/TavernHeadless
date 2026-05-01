import type {
  CoreEventMap,
  MemoryInjectionOptions,
  MemoryInjectionResult,
  MemoryStore,
  PromptRuntimeMemoryTrace,
} from "@tavern/core";

import { MemoryInspectionService } from "../observe/memory-inspection-service.js";

export interface TurnMemoryInjectionResult {
  injection: MemoryInjectionResult;
  memorySummary?: string;
  memoryTrace: Omit<PromptRuntimeMemoryTrace, "summaryInjected">;
}

export interface TurnMemoryInjectionServiceOptions {
  memoryStore?: MemoryStore;
  memoryInjectionDecay?: MemoryInjectionOptions["decay"];
  enableDualSummaryInjection: boolean;
  emitBestEffortEvent: <K extends keyof CoreEventMap>(name: K, payload: CoreEventMap[K]) => Promise<void>;
}

export class TurnMemoryInjectionService {
  private readonly memoryInspectionService = new MemoryInspectionService();

  constructor(private readonly options: TurnMemoryInjectionServiceOptions) {}

  async retrieveMemoryInjection(args: {
    sessionId: string;
    accountId: string;
    floorId?: string;
    branchId?: string;
  }): Promise<TurnMemoryInjectionResult | undefined> {
    if (!this.options.memoryStore) {
      return undefined;
    }

    try {
      const injectionOptions = this.buildInjectionOptions(args);
      const injection = await this.options.memoryStore.prepareInjection(args.sessionId, injectionOptions);
      const memorySummary = injection.formattedText || undefined;

      return {
        injection,
        ...(memorySummary ? { memorySummary } : {}),
        memoryTrace: this.memoryInspectionService.buildMemoryInjectionTrace({
          sessionId: args.sessionId,
          branchId: args.branchId,
          floorId: args.floorId,
          options: injectionOptions,
          injection,
          memorySummary,
        }),
      };
    } catch (error) {
      await this.options.emitBestEffortEvent("memory.injection_failed", {
        sessionId: args.sessionId,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return undefined;
    }
  }

  private buildInjectionOptions(args: {
    sessionId: string;
    accountId: string;
    floorId?: string;
    branchId?: string;
  }): MemoryInjectionOptions {
    const scopeContext = {
      accountId: args.accountId,
      sessionId: args.sessionId,
      ...(args.branchId ? { branchId: args.branchId } : {}),
      ...(args.floorId ? { floorId: args.floorId } : {}),
    };

    if (this.options.enableDualSummaryInjection) {
      return {
        accountId: args.accountId,
        maxTokens: 500,
        maxItems: 24,
        minImportance: 0.35,
        includeTypes: ["open_loop", "fact", "summary"],
        strategy: "dual_summary",
        decay: this.options.memoryInjectionDecay,
        scopeContext,
      };
    }

    return {
      accountId: args.accountId,
      maxTokens: 500,
      maxItems: 24,
      minImportance: 0.35,
      includeTypes: ["open_loop", "fact", "summary"],
      selectionMode: "balanced",
      typeOrder: ["open_loop", "fact", "summary"],
      typeMaxItems: { open_loop: 6, fact: 10, summary: 8 },
      decay: this.options.memoryInjectionDecay,
      scopeContext,
    };
  }
}
