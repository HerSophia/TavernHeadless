import type { MemoryIngestOutput, PromptRuntimeMemoryTrace } from "@tavern/core";
import type { MemoryScope } from "@tavern/shared";

import type { AppDb, DbExecutor } from "../../../db/client.js";
import type { MemoryIngestTurnJobPayload } from "../../memory-runtime-job-definitions.js";
import { MEMORY_RUNTIME_SOURCE_KIND } from "../../state-governance/shared/page-inspection-contracts.js";

import {
  buildMemoryProposalBatchId,
  type MemoryProposalBatchRecord,
} from "./memory-proposal-job-definitions.js";
import { MemoryProposalLedgerService } from "./memory-proposal-ledger-service.js";

export class MemoryProposalService {
  constructor(private readonly db?: AppDb | DbExecutor) {}

  createIngestProposalBatch(args: {
    payload: MemoryIngestTurnJobPayload;
    ingestOutput: MemoryIngestOutput;
    defaultScope: MemoryScope;
    createdAt?: number;
    sourceJobId?: string;
    actorClientId?: string | null;
    strategy?: NonNullable<PromptRuntimeMemoryTrace["strategy"]>;
  }): MemoryProposalBatchRecord {
    const mutations: MemoryProposalBatchRecord["mutations"] = [];

    const microSummary = args.ingestOutput.microSummary.trim();
    if (microSummary.length > 0) {
      mutations.push({
        action: "refresh_summary",
        targetScope: args.defaultScope,
        payload: {
          content: microSummary,
          summaryTier: "micro",
          coverageStartFloorNo: args.payload.floorNo,
          coverageEndFloorNo: args.payload.floorNo,
        },
      });
    }

    for (const fact of args.ingestOutput.factsAdd) {
      mutations.push({
        action: "add_fact",
        targetScope: fact.scope ?? args.defaultScope,
        payload: {
          factKey: fact.factKey ?? fact.key ?? null,
          value: fact.value,
          importance: fact.importance ?? null,
        },
      });
    }

    for (const fact of args.ingestOutput.factsUpdate) {
      mutations.push({
        action: "update_fact",
        targetScope: args.defaultScope,
        targetMemoryId: fact.id,
        payload: {
          factKey: fact.factKey ?? null,
          value: fact.value,
          importance: fact.importance ?? null,
        },
      });
    }

    for (const fact of args.ingestOutput.factsDeprecate) {
      mutations.push({
        action: "deprecate_fact",
        targetScope: args.defaultScope,
        targetMemoryId: fact.id,
        payload: {
          reason: fact.reason,
        },
      });
    }

    for (const openLoop of args.ingestOutput.openLoopsAdd) {
      mutations.push({
        action: "add_open_loop",
        targetScope: openLoop.scope ?? args.defaultScope,
        payload: {
          content: openLoop.content,
          importance: openLoop.importance ?? null,
        },
      });
    }

    for (const openLoop of args.ingestOutput.openLoopsResolve) {
      mutations.push({
        action: "resolve_open_loop",
        targetScope: args.defaultScope,
        targetMemoryId: openLoop.id,
        payload: {
          resolution: openLoop.resolution,
        },
      });
    }

    const batch: MemoryProposalBatchRecord = {
      id: buildMemoryProposalBatchId(args.payload.pageId),
      proposalBatchId: buildMemoryProposalBatchId(args.payload.pageId),
      floorId: args.payload.floorId,
      pageId: args.payload.pageId,
      ...(args.payload.branchId ? { branchId: args.payload.branchId } : {}),
      assistantMessageId: args.payload.assistantMessageId,
      userInputDigest: args.payload.userInputDigest,
      runtimeMode: args.payload.runtimeMode,
      status: "proposed" as const,
      mutations,
    };

    if (this.db) {
      new MemoryProposalLedgerService(this.db).persistProposedBatch({
        accountId: args.payload.accountId,
        sessionId: args.payload.sessionId,
        floorId: args.payload.floorId,
        pageId: args.payload.pageId,
        branchId: args.payload.branchId,
        proposalBatchId: batch.proposalBatchId,
        runtimeMode: batch.runtimeMode,
        sourceKind: MEMORY_RUNTIME_SOURCE_KIND,
        actorClientId: args.actorClientId ?? null,
        source: {
          assistantMessageId: args.payload.assistantMessageId,
          userInputDigest: args.payload.userInputDigest,
          ...(args.sourceJobId ? { sourceJobId: args.sourceJobId } : {}),
        },
        evidence: {
          floorNo: args.payload.floorNo,
          mutationCount: mutations.length,
          summaryCount: mutations.filter((item) => item.action === "refresh_summary").length,
          ...(args.strategy ? { strategy: args.strategy } : {}),
        },
        mutations,
        createdAt: args.createdAt ?? args.payload.committedAt,
      });
    }

    return batch;
  }
}
