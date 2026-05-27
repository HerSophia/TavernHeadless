import { and, asc, eq, inArray } from "drizzle-orm";
import type { PromptRuntimeMemoryTrace } from "@tavern/core";

import type { AppDb, DbExecutor } from "../../../db/client.js";
import {
  pageStagedMemoryProposalBatches,
  pageStagedMemoryProposalItems,
  promptRuntimeExplainSnapshots,
} from "../../../db/schema.js";
import { parseJsonField } from "../../../lib/http.js";
import { OwnedPageRepository } from "../../owned-resource-repositories.js";
import {
  MEMORY_RUNTIME_SOURCE_KIND,
  type PageInspectionDecisionCode,
  type PageInspectionSourceKind,
} from "../../state-governance/shared/page-inspection-contracts.js";
import type { MemoryRuntimeMode } from "../shared/memory-runtime-mode.js";

import type {
  MemoryProposalBatchRecord,
  MemoryProposalBatchStatus,
} from "./memory-proposal-job-definitions.js";

export interface MemoryProposalLedgerItemRecord {
  id: string;
  batchId: string;
  memoryKind: "fact" | "summary" | "open_loop";
  operationKind: MemoryProposalBatchRecord["mutations"][number]["action"];
  targetScope: MemoryProposalBatchRecord["mutations"][number]["targetScope"];
  payload: Record<string, unknown>;
  importance: number | null;
  reason: string | null;
  evidence: Record<string, unknown>;
  status: MemoryProposalBatchStatus;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryProposalLedgerBatchRecord {
  id: string;
  proposalBatchId: string;
  pageId: string;
  floorId: string;
  branchId: string | null;
  sessionId: string;
  runtimeMode: Exclude<MemoryRuntimeMode, "disabled">;
  strategy: NonNullable<PromptRuntimeMemoryTrace["strategy"]> | null;
  sourceKind: PageInspectionSourceKind;
  actorClientId: string | null;
  source: Record<string, unknown>;
  evidence: Record<string, unknown>;
  proposalStatus: MemoryProposalBatchStatus;
  promotionStatus: "promoted" | "rejected" | "superseded" | null;
  decisionReason: string | null;
  decisionCode: PageInspectionDecisionCode | null;
  summaryTextHash: string | null;
  tokenStats: PromptRuntimeMemoryTrace["tokenStats"] | null;
  scopeResolution: PromptRuntimeMemoryTrace["scopeResolution"] | null;
  createdAt: number;
  updatedAt: number;
  decidedAt: number | null;
  items: MemoryProposalLedgerItemRecord[];
}

export interface PageMemoryProposalSnapshot {
  pageId: string;
  floorId: string;
  sessionId: string;
  branchId: string;
  items: MemoryProposalLedgerBatchRecord[];
}

export class MemoryProposalLedgerServiceError extends Error {
  constructor(
    public readonly code: "memory_host_not_found",
    message: string,
  ) {
    super(message);
    this.name = "MemoryProposalLedgerServiceError";
  }
}

type ExplainMemoryProjection = {
  strategy: NonNullable<PromptRuntimeMemoryTrace["strategy"]> | null;
  summaryTextHash: string | null;
  tokenStats: PromptRuntimeMemoryTrace["tokenStats"] | null;
  scopeResolution: PromptRuntimeMemoryTrace["scopeResolution"] | null;
};

function parseJsonObject<T extends Record<string, unknown>>(
  value: string | null | undefined,
  fallback: T,
): T {
  const parsed = parseJsonField(value ?? null);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as T
    : fallback;
}

function parseExplainMemoryProjection(value: string | null | undefined): ExplainMemoryProjection {
  const parsed = parseJsonField(value ?? null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      strategy: null,
      summaryTextHash: null,
      tokenStats: null,
      scopeResolution: null,
    };
  }

  const memory = parsed as PromptRuntimeMemoryTrace;
  return {
    strategy: memory.strategy ?? null,
    summaryTextHash: memory.summaryTextHash ?? null,
    tokenStats: memory.tokenStats ?? null,
    scopeResolution: memory.scopeResolution ?? null,
  };
}

function resolveMemoryKind(
  action: MemoryProposalBatchRecord["mutations"][number]["action"],
): MemoryProposalLedgerItemRecord["memoryKind"] {
  switch (action) {
    case "add_fact":
    case "update_fact":
    case "deprecate_fact":
      return "fact";
    case "add_open_loop":
    case "resolve_open_loop":
      return "open_loop";
    case "refresh_summary":
      return "summary";
  }
}

function resolveImportance(
  payload: Record<string, unknown>,
): number | null {
  const value = payload.importance;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveReason(
  action: MemoryProposalBatchRecord["mutations"][number]["action"],
  payload: Record<string, unknown>,
): string | null {
  const directReason = payload.reason;
  if (typeof directReason === "string" && directReason.trim().length > 0) {
    return directReason;
  }

  switch (action) {
    case "refresh_summary":
      return "memory_ingest_micro_summary";
    case "add_fact":
      return "memory_ingest_fact_add";
    case "update_fact":
      return "memory_ingest_fact_update";
    case "deprecate_fact":
      return "memory_ingest_fact_deprecate";
    case "add_open_loop":
      return "memory_ingest_open_loop_add";
    case "resolve_open_loop":
      return "memory_ingest_open_loop_resolve";
  }
}

function toLedgerItemRecord(
  row: typeof pageStagedMemoryProposalItems.$inferSelect,
): MemoryProposalLedgerItemRecord {
  return {
    id: row.id,
    batchId: row.batchId,
    memoryKind: row.memoryKind,
    operationKind: row.operationKind,
    targetScope: row.targetScope,
    payload: parseJsonObject<Record<string, unknown>>(row.payloadJson, {}),
    importance: row.importance ?? null,
    reason: row.reason ?? null,
    evidence: parseJsonObject<Record<string, unknown>>(row.evidenceJson, {}),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class MemoryProposalLedgerService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  persistProposedBatch(input: {
    accountId: string;
    sessionId: string;
    floorId: string;
    pageId: string;
    branchId?: string;
    proposalBatchId: string;
    runtimeMode: Exclude<MemoryRuntimeMode, "disabled">;
    sourceKind?: PageInspectionSourceKind;
    actorClientId?: string | null;
    source: Record<string, unknown>;
    evidence: Record<string, unknown>;
    mutations: MemoryProposalBatchRecord["mutations"];
    createdAt: number;
  }): void {
    const explainMemory = this.loadExplainMemoryProjection(input.floorId);
    const now = input.createdAt;
    const batchId = input.proposalBatchId;

    this.db
      .insert(pageStagedMemoryProposalBatches)
      .values({
        id: batchId,
        accountId: input.accountId,
        proposalBatchId: input.proposalBatchId,
        pageId: input.pageId,
        floorId: input.floorId,
        branchId: input.branchId ?? null,
        sessionId: input.sessionId,
        runtimeMode: input.runtimeMode,
        strategy: explainMemory.strategy,
        sourceKind: input.sourceKind ?? MEMORY_RUNTIME_SOURCE_KIND,
        actorClientId: input.actorClientId ?? null,
        sourceJson: JSON.stringify(input.source),
        evidenceJson: JSON.stringify(input.evidence),
        proposalStatus: "proposed",
        promotionStatus: null,
        decisionReason: null,
        decisionCode: null,
        createdAt: now,
        updatedAt: now,
        decidedAt: null,
      })
      .onConflictDoUpdate({
        target: pageStagedMemoryProposalBatches.proposalBatchId,
        set: {
          accountId: input.accountId,
          pageId: input.pageId,
          floorId: input.floorId,
          branchId: input.branchId ?? null,
          sessionId: input.sessionId,
          runtimeMode: input.runtimeMode,
          strategy: explainMemory.strategy,
          sourceKind: input.sourceKind ?? MEMORY_RUNTIME_SOURCE_KIND,
          actorClientId: input.actorClientId ?? null,
          sourceJson: JSON.stringify(input.source),
          evidenceJson: JSON.stringify(input.evidence),
          proposalStatus: "proposed",
          promotionStatus: null,
          decisionReason: null,
          decisionCode: null,
          updatedAt: now,
          decidedAt: null,
        },
      })
      .run();

    this.db
      .delete(pageStagedMemoryProposalItems)
      .where(eq(pageStagedMemoryProposalItems.batchId, batchId))
      .run();

    if (input.mutations.length === 0) {
      return;
    }

    this.db
      .insert(pageStagedMemoryProposalItems)
      .values(input.mutations.map((mutation, index): typeof pageStagedMemoryProposalItems.$inferInsert => ({
        id: `${batchId}:${index + 1}`,
        batchId,
        memoryKind: resolveMemoryKind(mutation.action),
        operationKind: mutation.action,
        targetScope: mutation.targetScope,
        payloadJson: JSON.stringify(mutation.payload),
        importance: resolveImportance(mutation.payload),
        reason: resolveReason(mutation.action, mutation.payload),
        evidenceJson: JSON.stringify({
          ...(mutation.targetMemoryId ? { targetMemoryId: mutation.targetMemoryId } : {}),
        }),
        status: "proposed" as const,
        createdAt: now,
        updatedAt: now,
      })))
      .run();
  }

  markBatchDecision(input: {
    proposalBatchId: string;
    proposalStatus: MemoryProposalBatchStatus;
    promotionStatus?: "promoted" | "rejected" | "superseded" | null;
    decisionReason?: string | null;
    decisionCode?: PageInspectionDecisionCode | null;
    decidedAt: number;
  }): void {
    this.db
      .update(pageStagedMemoryProposalBatches)
      .set({
        proposalStatus: input.proposalStatus,
        promotionStatus: input.promotionStatus ?? null,
        decisionReason: input.decisionReason ?? null,
        decisionCode: input.decisionCode ?? null,
        updatedAt: input.decidedAt,
        decidedAt: input.decidedAt,
      })
      .where(eq(pageStagedMemoryProposalBatches.proposalBatchId, input.proposalBatchId))
      .run();

    this.db
      .update(pageStagedMemoryProposalItems)
      .set({
        status: input.proposalStatus,
        updatedAt: input.decidedAt,
      })
      .where(eq(pageStagedMemoryProposalItems.batchId, input.proposalBatchId))
      .run();
  }

  getPageSnapshot(
    accountId: string,
    pageId: string,
    options: { promotionsOnly?: boolean } = {},
  ): PageMemoryProposalSnapshot {
    const page = new OwnedPageRepository(this.db).getContextById(accountId, pageId);
    if (!page) {
      throw new MemoryProposalLedgerServiceError("memory_host_not_found", `Page '${pageId}' not found`);
    }

    let batchRows = this.db
      .select()
      .from(pageStagedMemoryProposalBatches)
      .where(and(
        eq(pageStagedMemoryProposalBatches.accountId, accountId),
        eq(pageStagedMemoryProposalBatches.pageId, pageId),
      ))
      .orderBy(asc(pageStagedMemoryProposalBatches.createdAt), asc(pageStagedMemoryProposalBatches.id))
      .all();

    if (options.promotionsOnly) {
      batchRows = batchRows.filter((row) => row.promotionStatus !== null);
    }

    const batchIds = batchRows.map((row) => row.id);
    const itemRows = batchIds.length > 0
      ? this.db
          .select()
          .from(pageStagedMemoryProposalItems)
          .where(inArray(pageStagedMemoryProposalItems.batchId, batchIds))
          .orderBy(asc(pageStagedMemoryProposalItems.createdAt), asc(pageStagedMemoryProposalItems.id))
          .all()
      : [];
    const explainMemory = this.loadExplainMemoryProjection(page.floorId);

    const itemsByBatchId = new Map<string, MemoryProposalLedgerItemRecord[]>();
    for (const row of itemRows) {
      const existing = itemsByBatchId.get(row.batchId) ?? [];
      existing.push(toLedgerItemRecord(row));
      itemsByBatchId.set(row.batchId, existing);
    }

    return {
      pageId: page.id,
      floorId: page.floorId,
      sessionId: page.sessionId,
      branchId: page.branchId,
      items: batchRows.map((row): MemoryProposalLedgerBatchRecord => ({
        id: row.id,
        proposalBatchId: row.proposalBatchId,
        pageId: row.pageId,
        floorId: row.floorId,
        branchId: row.branchId ?? null,
        sessionId: row.sessionId,
        runtimeMode: row.runtimeMode,
        strategy: row.strategy ?? explainMemory.strategy,
        sourceKind: row.sourceKind as MemoryProposalLedgerBatchRecord["sourceKind"],
        actorClientId: row.actorClientId ?? null,
        source: parseJsonObject<Record<string, unknown>>(row.sourceJson, {}),
        evidence: parseJsonObject<Record<string, unknown>>(row.evidenceJson, {}),
        proposalStatus: row.proposalStatus,
        promotionStatus: row.promotionStatus ?? null,
        decisionReason: row.decisionReason ?? null,
        decisionCode: row.decisionCode ?? null,
        summaryTextHash: explainMemory.summaryTextHash,
        tokenStats: explainMemory.tokenStats
          ? {
              budget: explainMemory.tokenStats.budget ?? null,
              used: explainMemory.tokenStats.used,
              microSummary: explainMemory.tokenStats.microSummary,
              macroSummary: explainMemory.tokenStats.macroSummary,
              directItems: explainMemory.tokenStats.directItems,
            }
          : null,
        scopeResolution: explainMemory.scopeResolution,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        decidedAt: row.decidedAt ?? null,
        items: itemsByBatchId.get(row.id) ?? [],
      })),
    };
  }

  private loadExplainMemoryProjection(floorId: string): ExplainMemoryProjection {
    const row = this.db
      .select({
        memoryJson: promptRuntimeExplainSnapshots.memoryJson,
      })
      .from(promptRuntimeExplainSnapshots)
      .where(eq(promptRuntimeExplainSnapshots.floorId, floorId))
      .limit(1)
      .all()[0];

    return parseExplainMemoryProjection(row?.memoryJson ?? null);
  }
}
