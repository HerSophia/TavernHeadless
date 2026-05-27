import { createHash } from "node:crypto";

import { parseBranchMemoryScopeId } from "@tavern/shared";
import type {
  MemoryInjectionOptions,
  MemoryInjectionResult,
  PromptRuntimeMemoryTrace,
} from "@tavern/core";

import {
  buildPromptRuntimeMemoryScopeResolutionTrace,
  buildPromptRuntimeMemoryTokenStats,
} from "../shared/memory-scope-trace-projector.js";

export class MemoryInspectionService {
  buildMemoryInjectionTrace(args: {
    sessionId: string;
    branchId?: string;
    floorId?: string;
    options: MemoryInjectionOptions;
    injection: MemoryInjectionResult;
    memorySummary?: string;
    strategy?: NonNullable<PromptRuntimeMemoryTrace["strategy"]>;
  }): Omit<PromptRuntimeMemoryTrace, "summaryInjected"> {
    const selectedItems = args.injection.items.map((item) => this.toSelectedItemTrace(item));
    const scopeResolution = buildPromptRuntimeMemoryScopeResolutionTrace({
      sessionId: args.sessionId,
      branchId: args.branchId,
      floorId: args.floorId,
      options: args.options,
      diagnostics: args.injection.scopeResolution,
      selectedItems,
    });
    const strategy = args.strategy ?? resolveMemoryStrategy(args.options, args.injection, args.memorySummary);
    const summaryTextHash = args.memorySummary ? createSummaryTextHash(args.memorySummary) : null;

    return {
      strategy,
      ...(args.memorySummary !== undefined ? { summaryText: args.memorySummary } : {}),
      ...(summaryTextHash ? { summaryTextHash } : {}),
      ...(selectedItems.length > 0 ? { selectedItems } : {}),
      tokenStats: buildPromptRuntimeMemoryTokenStats({
        budget: args.options.maxTokens,
        used: args.injection.tokenCount,
        selectedItems,
      }),
      ...(scopeResolution ? { scopeResolution } : {}),
    };
  }

  private toSelectedItemTrace(item: MemoryInjectionResult["items"][number]): NonNullable<PromptRuntimeMemoryTrace["selectedItems"]>[number] {
    const branchId = item.scope === "branch"
      ? parseBranchMemoryScopeId(item.scopeId)?.branchId ?? null
      : null;

    return {
      memoryId: item.id,
      scope: item.scope,
      scopeId: item.scopeId,
      branchId,
      kind: resolveSelectedItemKind(item),
      source: resolveSelectedItemSource(item),
      score: Number.isFinite(item.importance) ? item.importance : null,
      tokenCount: item.tokenCountEstimate ?? null,
      selectedReason: null,
    };
  }
}

function resolveMemoryStrategy(
  options: MemoryInjectionOptions,
  injection: MemoryInjectionResult,
  memorySummary: string | undefined,
): NonNullable<PromptRuntimeMemoryTrace["strategy"]> {
  if (!memorySummary && injection.items.length === 0) {
    return "none";
  }

  if (options.strategy === "dual_summary") {
    return "dual_summary";
  }

  const hasSummary = injection.items.some((item) => item.type === "summary");
  return hasSummary ? "single_summary" : "direct_items";
}

function resolveSelectedItemKind(
  item: MemoryInjectionResult["items"][number],
): NonNullable<PromptRuntimeMemoryTrace["selectedItems"]>[number]["kind"] {
  if (item.type === "fact") {
    return "fact";
  }

  if (item.type === "open_loop") {
    return "open_loop";
  }

  if (item.summaryTier === "micro") {
    return "micro_summary";
  }

  if (item.summaryTier === "macro") {
    return "macro_summary";
  }

  return "summary";
}

function resolveSelectedItemSource(
  item: MemoryInjectionResult["items"][number],
): NonNullable<PromptRuntimeMemoryTrace["selectedItems"]>[number]["source"] {
  if (item.type === "summary") {
    return "summary";
  }

  if (item.type === "open_loop") {
    return "open_loop";
  }

  return "store";
}

function createSummaryTextHash(summaryText: string): string {
  return `sha256:${createHash("sha256").update(summaryText).digest("hex")}`;
}
