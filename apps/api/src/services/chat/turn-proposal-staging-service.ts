import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../../db/client.js";
import {
  floorRunStates,
  floors,
  messagePages,
  pageStagedWrites,
} from "../../db/schema.js";
import type {
  MemoryProposalBatchRecord,
  MemoryProposalBatchStatus,
} from "../memory/proposals/memory-proposal-job-definitions.js";
import { MemoryProposalLedgerService } from "../memory/proposals/memory-proposal-ledger-service.js";
import type { PageInspectionDecisionCode } from "../state-governance/shared/page-inspection-contracts.js";

import type { CommitGateDecision } from "./turn-commit-gate.js";
import type {
  TurnMemoryProposal,
  TurnOpenLoopProposal,
  TurnProposalEnvelope,
  TurnRelationshipProposal,
  TurnStateProposal,
} from "./turn-proposal-envelope.js";
import type { TurnAttemptStaleReason } from "./turn-attempt-types.js";

const AGENT_PROPOSAL_PAGE_WRITE_SOURCE_KIND = "agent";
const AGENT_MEMORY_PROPOSAL_BATCH_PREFIX = "agent-proposal";
const MEMORY_PROPOSAL_RUNTIME_MODE = "legacy_sync" as const;

type MemoryMutation = MemoryProposalBatchRecord["mutations"][number];

type ProposalDecisionCode =
  | PageInspectionDecisionCode
  | "attempt_not_current"
  | "source_floor_superseded"
  | "commit_gate_blocked";

type ProposalStageStatus = "staged" | "blocked" | "stale";

interface ProposalDecision {
  status: ProposalStageStatus;
  reason?: string;
  decisionCode?: ProposalDecisionCode;
  persistDiscardedRows: boolean;
  persistMemoryBatch: boolean;
  memoryBatchStatus?: Exclude<MemoryProposalBatchStatus, "promoted" | "proposed">;
  memoryPromotionStatus?: "rejected" | "superseded";
}

interface PageWriteDescriptor {
  category: "state" | "relationship" | "memory";
  reason: string;
  sourceAgentId?: string;
  targetNamespace?: string;
  targetSlot?: string;
  payload: Record<string, unknown>;
}

export interface TurnProposalPromotionSummary {
  status: ProposalStageStatus;
  reason?: string;
  decisionCode?: ProposalDecisionCode;
  pageWriteAcceptedCount: number;
  pageWriteDiscardedCount: number;
  stateObservedCount: number;
  stateDiscardedCount: number;
  sessionStateStagedCount: number;
  memoryBatchCount: number;
  memoryProposedCount: number;
  memoryRejectedCount: number;
  memorySupersededCount: number;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toMemoryDecisionCode(reason: TurnAttemptStaleReason | "commit_gate_blocked"): ProposalDecisionCode {
  switch (reason) {
    case "source_page_missing":
      return "source_page_missing";
    case "source_page_scope_mismatch":
      return "source_page_scope_mismatch";
    case "source_page_not_output":
      return "source_page_not_output";
    case "source_page_not_active":
      return "source_page_not_active";
    case "source_floor_superseded":
      return "source_floor_superseded";
    case "attempt_not_current":
      return "attempt_not_current";
    case "commit_gate_blocked":
      return "commit_gate_blocked";
  }
}

function toDecisionReason(reason: TurnAttemptStaleReason | "commit_gate_blocked"): string {
  switch (reason) {
    case "source_page_missing":
      return "page_commit_gate_source_page_missing";
    case "source_page_scope_mismatch":
      return "page_commit_gate_floor_mismatch";
    case "source_page_not_output":
      return "page_commit_gate_source_page_not_output";
    case "source_page_not_active":
      return "page_not_active_at_commit";
    case "source_floor_superseded":
      return "source_floor_already_superseded";
    case "attempt_not_current":
      return "attempt_not_current";
    case "commit_gate_blocked":
      return "commit_gate_blocked";
  }
}

function toProposalDecision(reason: TurnAttemptStaleReason | "commit_gate_blocked", options: {
  persistDiscardedRows: boolean;
  persistMemoryBatch: boolean;
}): ProposalDecision {
  if (reason === "commit_gate_blocked") {
    return {
      status: "blocked",
      reason: toDecisionReason(reason),
      decisionCode: toMemoryDecisionCode(reason),
      persistDiscardedRows: options.persistDiscardedRows,
      persistMemoryBatch: options.persistMemoryBatch,
      memoryBatchStatus: "rejected",
      memoryPromotionStatus: "rejected",
    };
  }

  if (reason === "source_page_not_active" || reason === "source_floor_superseded") {
    return {
      status: "stale",
      reason: toDecisionReason(reason),
      decisionCode: toMemoryDecisionCode(reason),
      persistDiscardedRows: options.persistDiscardedRows,
      persistMemoryBatch: options.persistMemoryBatch,
      memoryBatchStatus: "superseded",
      memoryPromotionStatus: "superseded",
    };
  }

  return {
    status: "stale",
    reason: toDecisionReason(reason),
    decisionCode: toMemoryDecisionCode(reason),
    persistDiscardedRows: options.persistDiscardedRows,
    persistMemoryBatch: options.persistMemoryBatch,
    memoryBatchStatus: "rejected",
    memoryPromotionStatus: "rejected",
  };
}

function toPageWriteDescriptor(proposal: TurnStateProposal): PageWriteDescriptor {
  return {
    category: "state",
    reason: "agent:state_proposal",
    sourceAgentId: proposal.sourceAgentId,
    targetNamespace: proposal.targetNamespace,
    targetSlot: proposal.targetSlot,
    payload: {
      id: proposal.id,
      promotion: proposal.promotion,
      payload: proposal.payload,
    },
  };
}

function toRelationshipPageWriteDescriptor(proposal: TurnRelationshipProposal): PageWriteDescriptor {
  return {
    category: "relationship",
    reason: "agent:relationship_proposal",
    payload: {
      id: proposal.id,
      summary: proposal.summary,
      promotion: proposal.promotion,
      ...(proposal.payload !== undefined ? { payload: proposal.payload } : {}),
    },
  };
}

function toMemoryFallbackPageWriteDescriptor(proposal: TurnMemoryProposal): PageWriteDescriptor {
  return {
    category: "memory",
    reason: "agent:memory_proposal_fallback",
    sourceAgentId: proposal.sourceAgentId,
    payload: {
      id: proposal.id,
      kind: proposal.kind,
      summary: proposal.summary,
      promotion: proposal.promotion,
      ...(proposal.payload !== undefined ? { payload: proposal.payload } : {}),
    },
  };
}

function toMemoryMutation(
  proposal: TurnMemoryProposal,
  defaultScope: MemoryMutation["targetScope"],
): MemoryMutation | null {
  const payload = toRecord(proposal.payload);
  const kind = proposal.kind.trim().toLowerCase();

  if (kind === "summary") {
    const content = toNonEmptyString(payload.content) ?? proposal.summary;
    return {
      action: "refresh_summary",
      targetScope: defaultScope,
      payload: {
        content,
        summaryTier: toNonEmptyString(payload.summaryTier) ?? "micro",
        ...(toFiniteNumber(payload.coverageStartFloorNo) !== null
          ? { coverageStartFloorNo: toFiniteNumber(payload.coverageStartFloorNo)! }
          : {}),
        ...(toFiniteNumber(payload.coverageEndFloorNo) !== null
          ? { coverageEndFloorNo: toFiniteNumber(payload.coverageEndFloorNo)! }
          : {}),
      },
    };
  }

  if (kind === "fact") {
    return {
      action: "add_fact",
      targetScope: defaultScope,
      payload: {
        factKey: toNonEmptyString(payload.factKey) ?? toNonEmptyString(payload.key),
        value: payload.value ?? proposal.summary,
        importance: toFiniteNumber(payload.importance),
      },
    };
  }

  if (kind === "open_loop") {
    return {
      action: "add_open_loop",
      targetScope: defaultScope,
      payload: {
        content: toNonEmptyString(payload.content) ?? proposal.summary,
        importance: toFiniteNumber(payload.importance),
      },
    };
  }

  if (kind === "resolve_open_loop") {
    const targetMemoryId = toNonEmptyString(payload.targetMemoryId) ?? toNonEmptyString(payload.id);
    const resolution = toNonEmptyString(payload.resolution) ?? proposal.summary;
    if (!targetMemoryId) {
      return null;
    }
    return {
      action: "resolve_open_loop",
      targetScope: defaultScope,
      targetMemoryId,
      payload: {
        resolution,
      },
    };
  }

  return null;
}

function toOpenLoopMutation(
  proposal: TurnOpenLoopProposal,
  defaultScope: MemoryMutation["targetScope"],
): MemoryMutation {
  const payload = toRecord(proposal.payload);
  return {
    action: "add_open_loop",
    targetScope: defaultScope,
    payload: {
      content: toNonEmptyString(payload.content) ?? proposal.summary,
      importance: toFiniteNumber(payload.importance),
    },
  };
}

function buildMemoryBatchId(pageId: string): string {
  return `${AGENT_MEMORY_PROPOSAL_BATCH_PREFIX}:${pageId}`;
}

export class TurnProposalStagingService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  stageCommittedProposals(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    floorId: string;
    outputPageId: string;
    assistantMessageId: string;
    committedAt: number;
    proposalEnvelope?: TurnProposalEnvelope;
    commitGateDecision?: CommitGateDecision;
  }): TurnProposalPromotionSummary | undefined {
    const envelope = input.proposalEnvelope;
    if (!envelope) {
      return undefined;
    }

    const stateObservedCount = envelope.stateProposals.length;
    const totalProposalCount =
      stateObservedCount
      + envelope.memoryProposals.length
      + envelope.relationshipProposals.length
      + envelope.openLoopProposals.length;

    if (totalProposalCount === 0) {
      return undefined;
    }

    const summary: TurnProposalPromotionSummary = {
      status: "staged",
      pageWriteAcceptedCount: 0,
      pageWriteDiscardedCount: 0,
      stateObservedCount,
      stateDiscardedCount: 0,
      sessionStateStagedCount: 0,
      memoryBatchCount: 0,
      memoryProposedCount: 0,
      memoryRejectedCount: 0,
      memorySupersededCount: 0,
    };

    const pageRow = this.db
      .select({
        id: messagePages.id,
        floorId: messagePages.floorId,
        pageKind: messagePages.pageKind,
        isActive: messagePages.isActive,
      })
      .from(messagePages)
      .where(eq(messagePages.id, input.outputPageId))
      .limit(1)
      .all()[0];

    const pageHostUsable = Boolean(pageRow && pageRow.floorId === input.floorId && pageRow.pageKind === "output");
    const decision = this.resolveDecision(input, envelope, pageRow, pageHostUsable);
    summary.status = decision.status;
    if (decision.reason) {
      summary.reason = decision.reason;
    }
    if (decision.decisionCode) {
      summary.decisionCode = decision.decisionCode;
    }

    const defaultScope: MemoryMutation["targetScope"] = input.branchId ? "branch" : "chat";
    const genericWrites: PageWriteDescriptor[] = [
      ...envelope.stateProposals.map(toPageWriteDescriptor),
      ...envelope.relationshipProposals.map(toRelationshipPageWriteDescriptor),
    ];

    const memoryMutations: MemoryMutation[] = [];
    for (const proposal of envelope.memoryProposals) {
      const mutation = toMemoryMutation(proposal, defaultScope);
      if (mutation) {
        memoryMutations.push(mutation);
        continue;
      }
      genericWrites.push(toMemoryFallbackPageWriteDescriptor(proposal));
    }

    for (const proposal of envelope.openLoopProposals) {
      memoryMutations.push(toOpenLoopMutation(proposal, defaultScope));
    }

    if (genericWrites.length > 0 && decision.persistDiscardedRows) {
      const discarded = decision.status !== "staged";
      this.db
        .insert(pageStagedWrites)
        .values(genericWrites.map((descriptor): typeof pageStagedWrites.$inferInsert => ({
          id: nanoid(),
          accountId: input.accountId,
          sessionId: input.sessionId,
          branchId: input.branchId,
          floorId: input.floorId,
          pageId: input.outputPageId,
          sourceKind: AGENT_PROPOSAL_PAGE_WRITE_SOURCE_KIND,
          sourceSessionId: input.sessionId,
          sourcePageId: input.outputPageId,
          actorClientId: null,
          content: JSON.stringify(descriptor.payload),
          contentFormat: "json",
          reason: descriptor.reason,
          status: discarded ? "discarded" : "accepted",
          metadataJson: JSON.stringify({
            category: descriptor.category,
            sourceAgentId: descriptor.sourceAgentId ?? null,
            targetNamespace: descriptor.targetNamespace ?? null,
            targetSlot: descriptor.targetSlot ?? null,
            stageStatus: decision.status,
            decisionCode: decision.decisionCode ?? null,
            decisionReason: decision.reason ?? null,
            outputPageId: input.outputPageId,
            attemptNo: envelope.attempt.attemptNo,
          }),
          createdAt: input.committedAt,
          updatedAt: input.committedAt,
          appliedAt: null,
          discardedAt: discarded ? input.committedAt : null,
        })))
        .run();

      if (discarded) {
        summary.pageWriteDiscardedCount += genericWrites.length;
        summary.stateDiscardedCount += envelope.stateProposals.length;
      } else {
        summary.pageWriteAcceptedCount += genericWrites.length;
      }
    }

    if (memoryMutations.length > 0 && decision.persistMemoryBatch) {
      const proposalBatchId = buildMemoryBatchId(input.outputPageId);
      new MemoryProposalLedgerService(this.db).persistProposedBatch({
        accountId: input.accountId,
        sessionId: input.sessionId,
        floorId: input.floorId,
        pageId: input.outputPageId,
        branchId: input.branchId,
        proposalBatchId,
        runtimeMode: MEMORY_PROPOSAL_RUNTIME_MODE,
        sourceKind: "agent",
        actorClientId: null,
        source: {
          attemptNo: envelope.attempt.attemptNo,
          runId: envelope.attempt.runId,
          assistantMessageId: input.assistantMessageId,
          outputPageId: input.outputPageId,
          sourceAgentIds: Array.from(new Set([
            ...envelope.memoryProposals.map((proposal) => proposal.sourceAgentId),
          ])),
        },
        evidence: {
          gateStatus: input.commitGateDecision?.status ?? "allow",
          memoryProposalCount: envelope.memoryProposals.length,
          openLoopProposalCount: envelope.openLoopProposals.length,
          mutationCount: memoryMutations.length,
        },
        mutations: memoryMutations,
        createdAt: input.committedAt,
      });

      summary.memoryBatchCount += 1;

      if (decision.status === "staged") {
        summary.memoryProposedCount += memoryMutations.length;
      } else {
        new MemoryProposalLedgerService(this.db).markBatchDecision({
          proposalBatchId,
          proposalStatus: decision.memoryBatchStatus ?? "rejected",
          promotionStatus: decision.memoryPromotionStatus ?? "rejected",
          decisionReason: decision.reason ?? null,
          decisionCode: normalizeMemoryDecisionCode(decision.decisionCode),
          decidedAt: input.committedAt,
        });

        if (decision.memoryBatchStatus === "superseded") {
          summary.memorySupersededCount += memoryMutations.length;
        } else {
          summary.memoryRejectedCount += memoryMutations.length;
        }
      }
    }

    return summary;
  }

  private resolveDecision(
    input: {
      accountId: string;
      sessionId: string;
      branchId: string;
      floorId: string;
      outputPageId: string;
      commitGateDecision?: CommitGateDecision;
    },
    envelope: TurnProposalEnvelope,
    pageRow:
      | {
          id: string;
          floorId: string;
          pageKind: string;
          isActive: boolean;
        }
      | undefined,
    pageHostUsable: boolean,
  ): ProposalDecision {
    if (input.commitGateDecision?.status === "block") {
      return toProposalDecision("commit_gate_blocked", {
        persistDiscardedRows: pageHostUsable,
        persistMemoryBatch: pageHostUsable,
      });
    }

    if (
      envelope.attempt.sessionId !== input.sessionId
      || envelope.attempt.branchId !== input.branchId
      || envelope.attempt.floorId !== input.floorId
      || envelope.attempt.candidateOutputPageId !== input.outputPageId
      || envelope.outputPageId !== input.outputPageId
    ) {
      return toProposalDecision("source_page_scope_mismatch", {
        persistDiscardedRows: false,
        persistMemoryBatch: false,
      });
    }

    const currentAttemptRow = this.db
      .select({
        runId: floorRunStates.runId,
        runType: floorRunStates.runType,
        attemptNo: floorRunStates.attemptNo,
        status: floorRunStates.status,
      })
      .from(floorRunStates)
      .where(eq(floorRunStates.floorId, input.floorId))
      .limit(1)
      .all()[0];

    if (
      currentAttemptRow
      && (
        currentAttemptRow.status !== "running"
        || currentAttemptRow.runId !== envelope.attempt.runId
        || currentAttemptRow.runType !== envelope.attempt.runType
        || currentAttemptRow.attemptNo !== envelope.attempt.attemptNo
      )
    ) {
      return toProposalDecision("attempt_not_current", {
        persistDiscardedRows: false,
        persistMemoryBatch: false,
      });
    }

    if (envelope.attempt.sourceFloorId && envelope.attempt.sourceFloorId !== input.floorId) {
      const sourceFloorRow = this.db
        .select({
          supersededAt: floors.supersededAt,
          supersededByFloorId: floors.supersededByFloorId,
        })
        .from(floors)
        .where(eq(floors.id, envelope.attempt.sourceFloorId))
        .limit(1)
        .all()[0];

      if (
        sourceFloorRow?.supersededAt !== null
        && sourceFloorRow?.supersededByFloorId !== null
        && sourceFloorRow?.supersededByFloorId !== input.floorId
      ) {
        return toProposalDecision("source_floor_superseded", {
          persistDiscardedRows: pageHostUsable,
          persistMemoryBatch: pageHostUsable,
        });
      }
    }

    if (!pageRow) {
      return toProposalDecision("source_page_missing", {
        persistDiscardedRows: false,
        persistMemoryBatch: false,
      });
    }

    if (pageRow.floorId !== input.floorId) {
      return toProposalDecision("source_page_scope_mismatch", {
        persistDiscardedRows: false,
        persistMemoryBatch: false,
      });
    }

    if (pageRow.pageKind !== "output") {
      return toProposalDecision("source_page_not_output", {
        persistDiscardedRows: false,
        persistMemoryBatch: false,
      });
    }

    if (!pageRow.isActive) {
      return toProposalDecision("source_page_not_active", {
        persistDiscardedRows: true,
        persistMemoryBatch: true,
      });
    }

    return {
      status: "staged",
      persistDiscardedRows: true,
      persistMemoryBatch: true,
    };
  }
}

function normalizeMemoryDecisionCode(
  value: ProposalDecisionCode | undefined,
): PageInspectionDecisionCode | null {
  switch (value) {
    case "source_page_missing":
    case "source_page_scope_mismatch":
    case "source_page_not_output":
    case "source_page_not_active":
      return value;
    case "source_floor_superseded":
      return "source_page_superseded";
    case "attempt_not_current":
    case "commit_gate_blocked":
      return "policy_forbidden";
    default:
      return null;
  }
}
