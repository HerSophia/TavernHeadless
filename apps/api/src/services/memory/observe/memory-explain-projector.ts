import type { PromptRuntimeMemoryTrace } from "@tavern/core";

import type { MemoryProposalBatchRecord } from "../proposals/memory-proposal-job-definitions.js";

export function buildCommittedExplainMemoryTrace(
  memory?: PromptRuntimeMemoryTrace,
): PromptRuntimeMemoryTrace | undefined {
  if (!memory) {
    return undefined;
  }

  return {
    summaryInjected: memory.summaryInjected,
    ...(memory.runtimeMode !== undefined ? { runtimeMode: memory.runtimeMode } : {}),
    ...(memory.requestedWrite !== undefined ? { requestedWrite: memory.requestedWrite } : {}),
    ...(memory.effectiveWrite !== undefined ? { effectiveWrite: memory.effectiveWrite } : {}),
    ...(memory.strategy !== undefined ? { strategy: memory.strategy } : {}),
    ...(memory.summaryTextHash !== undefined ? { summaryTextHash: memory.summaryTextHash } : {}),
    ...(memory.selectedItems
      ? {
          selectedItems: memory.selectedItems.map((item) => ({
            memoryId: item.memoryId,
            scope: item.scope,
            scopeId: item.scopeId,
            branchId: item.branchId ?? null,
            kind: item.kind,
          })),
        }
      : {}),
    ...(memory.tokenStats ? { tokenStats: memory.tokenStats } : {}),
    ...(memory.scopeResolution ? { scopeResolution: memory.scopeResolution } : {}),
  };
}

export function mergeHistoricalExplainMemoryTrace(args: {
  persistedMemory?: PromptRuntimeMemoryTrace | null;
  proposalBatch?: MemoryProposalBatchRecord | null;
  pageId?: string | null;
}): PromptRuntimeMemoryTrace | null {
  if (!args.persistedMemory && !args.proposalBatch) {
    return null;
  }

  const proposalStatus = args.proposalBatch?.status;
  const promotionStatus = proposalStatus && proposalStatus !== "proposed"
    ? proposalStatus
    : undefined;
  const pageId = args.pageId ?? args.proposalBatch?.pageId;

  return {
    summaryInjected: args.persistedMemory?.summaryInjected ?? false,
    ...(args.persistedMemory ?? {}),
    ...(args.proposalBatch ? { runtimeMode: args.proposalBatch.runtimeMode } : {}),
    ...(pageId
      ? { pageId }
      : {}),
    ...(args.proposalBatch ? { proposalBatchId: args.proposalBatch.proposalBatchId } : {}),
    ...(proposalStatus ? { proposalStatus } : {}),
    ...(promotionStatus ? { promotionStatus } : {}),
  };
}
