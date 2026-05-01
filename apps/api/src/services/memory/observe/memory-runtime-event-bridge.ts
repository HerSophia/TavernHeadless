import { parseBranchMemoryScopeId } from "@tavern/shared";

import type { RuntimeJobRecord } from "../../runtime-job-types.js";
import { parseMemoryRuntimeScopeKey } from "../../memory-runtime-job-definitions.js";
import {
  parseMemoryProposalBatchResultJson,
  type MemoryProposalBatchRecord,
} from "../proposals/memory-proposal-job-definitions.js";
import type { MemoryRuntimeMode } from "../shared/memory-runtime-mode.js";

export interface MemoryRuntimeJobEventAugment {
  branchId?: string;
  runtimeMode?: MemoryRuntimeMode;
  proposalBatchId?: string;
  proposalStatus?: MemoryProposalBatchRecord["status"];
  promotionStatus?: "promoted" | "rejected" | "superseded";
}

export function buildMemoryRuntimeJobEventAugment(job: RuntimeJobRecord): MemoryRuntimeJobEventAugment {
  const scopeRef = parseMemoryRuntimeScopeKey(job.scopeKey);
  const branchId = scopeRef.scope === "branch"
    ? parseBranchMemoryScopeId(scopeRef.scopeId)?.branchId
    : undefined;
  const payload = parseMemoryJobPayload(job.payloadJson);
  const proposalBatch = parseMemoryProposalBatchResultJson(job.resultJson);
  const proposalStatus = proposalBatch?.status;
  const promotionStatus = proposalStatus && proposalStatus !== "proposed"
    ? proposalStatus
    : undefined;

  return {
    ...(branchId ? { branchId } : {}),
    ...(proposalBatch?.runtimeMode
      ? { runtimeMode: proposalBatch.runtimeMode }
      : payload.runtimeMode
        ? { runtimeMode: payload.runtimeMode }
        : {}),
    ...(proposalBatch ? { proposalBatchId: proposalBatch.proposalBatchId } : {}),
    ...(proposalStatus ? { proposalStatus } : {}),
    ...(promotionStatus ? { promotionStatus } : {}),
  };
}

function parseMemoryJobPayload(value: string | null | undefined): {
  branchId?: string;
  runtimeMode?: MemoryRuntimeMode;
  pageId?: string;
} {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      ...(typeof parsed.branchId === "string" ? { branchId: parsed.branchId } : {}),
      ...(parsed.runtimeMode === "legacy_sync" || parsed.runtimeMode === "async_primary"
        ? { runtimeMode: parsed.runtimeMode }
        : {}),
      ...(typeof parsed.pageId === "string" ? { pageId: parsed.pageId } : {}),
    };
  } catch {
    return {};
  }
}
