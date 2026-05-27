import type { AppDb, DbExecutor } from "../../../db/client.js";
import type { MemoryIngestOutput } from "@tavern/core";
import type { MemoryScope } from "@tavern/shared";

import type { PendingCoreEvent } from "../../memory-transaction-mutations.js";
import type { MemoryIngestTurnJobPayload } from "../../memory-runtime-job-definitions.js";

import { MemoryPromotionService, type PromoteIngestProposalResult } from "./memory-promotion-service.js";
import { MemoryProposalService } from "./memory-proposal-service.js";

export function commitIngestProposalBatch(args: {
  db: AppDb | DbExecutor;
  payload: MemoryIngestTurnJobPayload;
  ingestOutput: MemoryIngestOutput;
  defaultScope: MemoryScope;
  defaultScopeId: string;
  pendingEvents: PendingCoreEvent[];
  sourceJobId: string;
  timestamp: number;
}): PromoteIngestProposalResult {
  const proposalBatch = new MemoryProposalService(args.db).createIngestProposalBatch({
    payload: args.payload,
    ingestOutput: args.ingestOutput,
    defaultScope: args.defaultScope,
    createdAt: args.timestamp,
    sourceJobId: args.sourceJobId,
    strategy: "dual_summary",
  });

  return new MemoryPromotionService(args.db).promoteIngestProposal({
    proposalBatch,
    ingestOutput: args.ingestOutput,
    accountId: args.payload.accountId,
    sessionId: args.payload.sessionId,
    floorId: args.payload.floorId,
    floorNo: args.payload.floorNo,
    branchId: args.payload.branchId,
    defaultScope: args.defaultScope,
    defaultScopeId: args.defaultScopeId,
    sourceJobId: args.sourceJobId,
    timestamp: args.timestamp,
    pendingEvents: args.pendingEvents,
  });
}
