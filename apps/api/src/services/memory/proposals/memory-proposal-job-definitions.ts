import type { MemoryRuntimeMode } from "../shared/memory-runtime-mode.js";

export const MEMORY_PROPOSAL_BATCH_STATUSES = [
  "proposed",
  "promoted",
  "rejected",
  "superseded",
] as const;

export type MemoryProposalBatchStatus = (typeof MEMORY_PROPOSAL_BATCH_STATUSES)[number];

export interface MemoryProposalBatchRecord {
  id?: string;
  proposalBatchId: string;
  floorId: string;
  pageId: string;
  branchId?: string;
  assistantMessageId: string;
  userInputDigest: string;
  runtimeMode: Exclude<MemoryRuntimeMode, "disabled">;
  status: MemoryProposalBatchStatus;
  mutations: Array<{
    action: "add_fact" | "update_fact" | "deprecate_fact" | "add_open_loop" | "resolve_open_loop" | "refresh_summary";
    targetScope: "global" | "chat" | "branch" | "floor";
    targetMemoryId?: string;
    payload: Record<string, unknown>;
  }>;
}

export function buildMemoryProposalBatchId(pageId: string): string {
  return `memory-proposal:${pageId}`;
}

export function parseMemoryProposalBatchResultJson(value: string | null | undefined): MemoryProposalBatchRecord | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<MemoryProposalBatchRecord>;
    if (
      typeof parsed.proposalBatchId !== "string"
      || typeof parsed.floorId !== "string"
      || typeof parsed.pageId !== "string"
      || typeof parsed.assistantMessageId !== "string"
      || typeof parsed.userInputDigest !== "string"
      || (parsed.runtimeMode !== "legacy_sync" && parsed.runtimeMode !== "async_primary")
      || !MEMORY_PROPOSAL_BATCH_STATUSES.includes(parsed.status as MemoryProposalBatchStatus)
      || !Array.isArray(parsed.mutations)
    ) {
      return null;
    }

    return parsed as MemoryProposalBatchRecord;
  } catch {
    return null;
  }
}
