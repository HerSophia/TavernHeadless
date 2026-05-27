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
import { MemoryProposalLedgerService } from "./memory-proposal-ledger-service.js";

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

function resolvePromotionDecision(
  page: typeof messagePages.$inferSelect | undefined,
  floorId: string,
): {
  proposalStatus: MemoryProposalBatchRecord["status"];
  promotionStatus: PromoteIngestProposalResult["promotionStatus"];
  decisionReason: string;
  decisionCode: "source_page_missing" | "source_page_scope_mismatch" | "source_page_not_output" | "source_page_not_active" | "promotion_allowed";
} {
  if (!page) {
    return { proposalStatus: "rejected", promotionStatus: "rejected", decisionReason: "page_commit_gate_source_page_missing", decisionCode: "source_page_missing" };
  }
  if (page.floorId !== floorId) {
    return { proposalStatus: "rejected", promotionStatus: "rejected", decisionReason: "page_commit_gate_floor_mismatch", decisionCode: "source_page_scope_mismatch" };
  }
  if (page.pageKind !== "output") {
    return { proposalStatus: "rejected", promotionStatus: "rejected", decisionReason: "page_commit_gate_source_page_not_output", decisionCode: "source_page_not_output" };
  }
  if (!page.isActive) {
    return { proposalStatus: "superseded", promotionStatus: "superseded", decisionReason: "page_not_active_at_commit", decisionCode: "source_page_not_active" };
  }
  return { proposalStatus: "promoted", promotionStatus: "promoted", decisionReason: "promotion_allowed", decisionCode: "promotion_allowed" };
}

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
    const ledgerService = new MemoryProposalLedgerService(this.db);
    const page = this.db
      .select()
      .from(messagePages)
      .where(eq(messagePages.id, input.proposalBatch.pageId))
      .limit(1)
      .all()[0];
    const decision = resolvePromotionDecision(page, input.floorId);

    if (decision.promotionStatus !== "promoted") {
      ledgerService.markBatchDecision({
        proposalBatchId: input.proposalBatch.proposalBatchId,
        proposalStatus: decision.proposalStatus,
        promotionStatus: decision.promotionStatus,
        decisionReason: decision.decisionReason,
        decisionCode: decision.decisionCode,
        decidedAt: input.timestamp,
      });
      return {
        proposalBatch: {
          ...input.proposalBatch,
          status: decision.proposalStatus,
        },
        counts: EMPTY_COUNTS,
        promotionStatus: decision.promotionStatus,
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
    ledgerService.markBatchDecision({
      proposalBatchId: input.proposalBatch.proposalBatchId,
      proposalStatus: "promoted",
      promotionStatus: "promoted",
      decisionReason: "promotion_allowed",
      decisionCode: "promotion_allowed",
      decidedAt: input.timestamp,
    });

    return {
      proposalBatch: {
        ...input.proposalBatch,
        status: decision.proposalStatus,
      },
      counts,
      promotionStatus: decision.promotionStatus,
    };
  }
}
