import type { MemoryIngestOutput } from "@tavern/core";
import type { MemoryScope } from "@tavern/shared";

import type { MemoryIngestTurnJobPayload } from "../../memory-runtime-job-definitions.js";

import {
  buildMemoryProposalBatchId,
  type MemoryProposalBatchRecord,
} from "./memory-proposal-job-definitions.js";

export class MemoryProposalService {
  createIngestProposalBatch(args: {
    payload: MemoryIngestTurnJobPayload;
    ingestOutput: MemoryIngestOutput;
    defaultScope: MemoryScope;
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

    return {
      proposalBatchId: buildMemoryProposalBatchId(args.payload.pageId),
      floorId: args.payload.floorId,
      pageId: args.payload.pageId,
      ...(args.payload.branchId ? { branchId: args.payload.branchId } : {}),
      assistantMessageId: args.payload.assistantMessageId,
      userInputDigest: args.payload.userInputDigest,
      runtimeMode: args.payload.runtimeMode,
      status: "proposed",
      mutations,
    };
  }
}
