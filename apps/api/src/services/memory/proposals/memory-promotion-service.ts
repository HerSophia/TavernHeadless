import { eq } from "drizzle-orm";
import type { MemoryIngestOutput } from "@tavern/core";
import type { MemoryScope } from "@tavern/shared";

import type { AppDb, DbExecutor } from "../../../db/client.js";
import { messagePages } from "../../../db/schema.js";
import {
  applyTransactionalMemoryMutations,
  type PendingCoreEvent,
  type TransactionalMemoryMutationCounts,
} from "../../memory-transaction-mutations.js";

import type { MemoryProposalBatchRecord } from "./memory-proposal-job-definitions.js";

export interface PromoteIngestProposalResult {
  proposalBatch: MemoryProposalBatchRecord;
  counts: TransactionalMemoryMutationCounts;
  promotionStatus: "promoted" | "rejected" | "superseded";
}

const EMPTY_COUNTS: TransactionalMemoryMutationCounts = {
  created: 0,
  updated: 0,
  deprecated: 0,
};

export class MemoryPromotionService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  promoteIngestProposal(input: {
    proposalBatch: MemoryProposalBatchRecord;
    ingestOutput: MemoryIngestOutput;
    accountId: string;
    sessionId: string;
    floorId: string;
    floorNo: number;
    branchId?: string;
    defaultScope: MemoryScope;
    defaultScopeId: string;
    sourceJobId: string;
    timestamp: number;
    pendingEvents: PendingCoreEvent[];
  }): PromoteIngestProposalResult {
    const page = this.db
      .select()
      .from(messagePages)
      .where(eq(messagePages.id, input.proposalBatch.pageId))
      .limit(1)
      .all()[0];

    if (!page || page.floorId !== input.floorId || page.pageKind !== "output") {
      return {
        proposalBatch: {
          ...input.proposalBatch,
          status: "rejected",
        },
        counts: EMPTY_COUNTS,
        promotionStatus: "rejected",
      };
    }

    if (!page.isActive) {
      return {
        proposalBatch: {
          ...input.proposalBatch,
          status: "superseded",
        },
        counts: EMPTY_COUNTS,
        promotionStatus: "superseded",
      };
    }

    const counts = applyTransactionalMemoryMutations({
      tx: this.db as DbExecutor,
      accountId: input.accountId,
      timestamp: input.timestamp,
      pendingEvents: input.pendingEvents,
      ingestOutput: input.ingestOutput,
      sourceFloorNo: input.floorNo,
      sourceJobId: input.sourceJobId,
      defaultScope: input.defaultScope,
      defaultScopeId: input.defaultScopeId,
      scopeContext: {
        accountId: input.accountId,
        sessionId: input.sessionId,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        floorId: input.floorId,
      },
      sourceFloorId: input.floorId,
      sourceMessageId: input.proposalBatch.assistantMessageId,
    });

    return {
      proposalBatch: {
        ...input.proposalBatch,
        status: "promoted",
      },
      counts,
      promotionStatus: "promoted",
    };
  }
}
