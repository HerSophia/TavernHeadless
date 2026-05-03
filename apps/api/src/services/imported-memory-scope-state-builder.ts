import {
  buildBranchMemoryScopeId,
  type MemoryScope,
  type MemorySummaryTier,
} from "@tavern/shared";

import { runtimeScopeStates } from "../db/schema.js";
import { MEMORY_RUNTIME_SCOPE_TYPE, buildMemoryRuntimeScopeKey } from "./memory-runtime-job-definitions.js";

export interface ImportedMemoryScopeStateFloorInput {
  id: string;
  branchId: string;
  floorNo: number;
}

export interface ImportedMemoryScopeStateItemInput {
  scope: Extract<MemoryScope, "chat" | "branch" | "floor">;
  scopeId: string;
  type: "fact" | "summary" | "open_loop";
  summaryTier: MemorySummaryTier | null;
  status: "active" | "deprecated";
}

export function buildImportedMemoryScopeStateRowsFromResolvedData(input: {
  accountId: string;
  sessionId: string;
  now: number;
  floors: ImportedMemoryScopeStateFloorInput[];
  items: ImportedMemoryScopeStateItemInput[];
}): Array<typeof runtimeScopeStates.$inferInsert> {
  const makeScopeKey = (scope: "global" | "chat" | "branch" | "floor", scopeId: string) => JSON.stringify([scope, scopeId]);
  const scopeMeta = new Map<string, { revision: number; hasMacroSummary: boolean }>();
  const scopeRows = new Map<string, typeof runtimeScopeStates.$inferInsert>();
  const branchLastProcessedFloorNo = new Map<string, number>();
  const chatLastProcessedFloorNo = input.floors.reduce<number | null>(
    (maxFloorNo, floor) => (maxFloorNo === null ? floor.floorNo : Math.max(maxFloorNo, floor.floorNo)),
    null,
  );

  for (const floor of input.floors) {
    const scopeId = buildBranchMemoryScopeId(input.sessionId, floor.branchId);
    const key = makeScopeKey("branch", scopeId);
    const currentFloorNo = branchLastProcessedFloorNo.get(key);
    branchLastProcessedFloorNo.set(
      key,
      currentFloorNo === undefined ? floor.floorNo : Math.max(currentFloorNo, floor.floorNo),
    );
  }

  for (const item of input.items) {
    const key = makeScopeKey(item.scope, item.scopeId);
    const current = scopeMeta.get(key) ?? { revision: 0, hasMacroSummary: false };
    current.revision = 1;
    if (item.type === "summary" && item.summaryTier === "macro" && item.status === "active") {
      current.hasMacroSummary = true;
    }
    scopeMeta.set(key, current);
  }

  const chatScopeKey = makeScopeKey("chat", input.sessionId);
  if (chatLastProcessedFloorNo !== null || scopeMeta.has(chatScopeKey)) {
    const meta = scopeMeta.get(chatScopeKey);
    scopeRows.set(chatScopeKey, {
      accountId: input.accountId,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey("chat", input.sessionId),
      revision: meta?.revision ?? 0,
      leaseOwner: null,
      leaseUntil: null,
      lastProcessedAt: input.now,
      lastSuccessJobId: null,
      metadataJson: JSON.stringify({
        lastProcessedFloorNo: chatLastProcessedFloorNo,
        lastCompactionAt: meta?.hasMacroSummary ? input.now : null,
      }),
      updatedAt: input.now,
    });
  }

  for (const floor of input.floors) {
    const key = makeScopeKey("floor", floor.id);
    const meta = scopeMeta.get(key);
    scopeRows.set(key, {
      accountId: input.accountId,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey("floor", floor.id),
      revision: meta?.revision ?? 0,
      leaseOwner: null,
      leaseUntil: null,
      lastProcessedAt: input.now,
      lastSuccessJobId: null,
      metadataJson: JSON.stringify({
        lastProcessedFloorNo: floor.floorNo,
        lastCompactionAt: meta?.hasMacroSummary ? input.now : null,
      }),
      updatedAt: input.now,
    });
  }

  for (const [key, lastProcessedFloorNo] of branchLastProcessedFloorNo.entries()) {
    const [, scopeId] = JSON.parse(key) as ["branch", string];
    const meta = scopeMeta.get(key);
    scopeRows.set(key, {
      accountId: input.accountId,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey("branch", scopeId),
      revision: meta?.revision ?? 0,
      leaseOwner: null,
      leaseUntil: null,
      lastProcessedAt: input.now,
      lastSuccessJobId: null,
      metadataJson: JSON.stringify({
        lastProcessedFloorNo,
        lastCompactionAt: meta?.hasMacroSummary ? input.now : null,
      }),
      updatedAt: input.now,
    });
  }

  for (const [key, meta] of scopeMeta.entries()) {
    if (scopeRows.has(key)) {
      continue;
    }

    const [scope, scopeId] = JSON.parse(key) as ["global" | "chat" | "branch" | "floor", string];
    scopeRows.set(key, {
      accountId: input.accountId,
      scopeType: MEMORY_RUNTIME_SCOPE_TYPE,
      scopeKey: buildMemoryRuntimeScopeKey(scope, scopeId),
      revision: meta.revision,
      leaseOwner: null,
      leaseUntil: null,
      lastProcessedAt: input.now,
      lastSuccessJobId: null,
      metadataJson: JSON.stringify({
        lastProcessedFloorNo: scope === "chat" ? chatLastProcessedFloorNo : branchLastProcessedFloorNo.get(key) ?? null,
        lastCompactionAt: meta.hasMacroSummary ? input.now : null,
      }),
      updatedAt: input.now,
    });
  }

  return Array.from(scopeRows.values());
}
