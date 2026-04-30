import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { VariableEntry } from "@tavern/shared";

import type { AppDb, DbExecutor } from "../../../db/client.js";
import { variablePromotionTraces, variables } from "../../../db/schema.js";
import {
  type PageVariableDecision,
  type PageVariableDecisionStatus,
  type PageStagedVariableWriteRecord,
  type VariableConflictPolicy,
  type VariablePromotionResult,
  type VariablePromotionTraceRecord,
} from "../contracts.js";
import { PageVariableStageService } from "../stage/page-variable-stage-service.js";

function toVariableEntry(row: typeof variables.$inferSelect): VariableEntry {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scopeId,
    key: row.key,
    value: JSON.parse(row.valueJson),
    updatedAt: row.updatedAt,
  };
}

function toVariablePromotionTraceRecord(
  row: typeof variablePromotionTraces.$inferSelect,
): VariablePromotionTraceRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    sessionId: row.sessionId,
    branchId: row.branchId,
    floorId: row.floorId,
    pageId: row.pageId,
    stagedWriteId: row.stagedWriteId,
    key: row.key,
    fromScope: row.fromScope,
    fromScopeId: row.fromScopeId,
    toScope: row.toScope,
    toScopeId: row.toScopeId,
    conflictPolicy: row.conflictPolicy,
    sourceVariableId: row.sourceVariableId,
    targetVariableId: row.targetVariableId,
    value: JSON.parse(row.valueJson),
    createdAt: row.createdAt,
  };
}

function createEmptyPromotionResult(input: {
  pageId?: string;
  floorId: string;
  sessionId: string;
  branchId?: string;
  conflictPolicy: VariableConflictPolicy;
}): VariablePromotionResult {
  return {
    pageId: input.pageId,
    floorId: input.floorId,
    sessionId: input.sessionId,
    branchId: input.branchId,
    fromScope: "page",
    toScope: "floor",
    policy: input.conflictPolicy === "if_absent" ? "ifAbsent" : "replace",
    scannedCount: 0,
    promotedCount: 0,
    skippedCount: 0,
    promotedVariables: [],
    pageVariables: [],
    stageWrites: [],
    promotionTraces: [],
  };
}

function normalizeDecisionReason(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveDefaultDecisionReason(
  status: Exclude<PageVariableDecisionStatus, "accepted">,
  decisionReason: string | null | undefined,
): string {
  const normalized = normalizeDecisionReason(decisionReason);
  if (normalized) {
    return normalized;
  }

  switch (status) {
    case "rejected":
      return "page_rejected";
    case "discarded":
      return "page_not_accepted";
    case "rerouted_to_session_state":
      return "write_rerouted_to_session_state";
  }
}

export class VariablePromotionService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  finalizePageWrites(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    floorId: string;
    pageId?: string;
    committedAt: number;
    conflictPolicy?: VariableConflictPolicy;
    stagedWrites?: PageStagedVariableWriteRecord[];
    pageDecision?: PageVariableDecision;
  }): VariablePromotionResult {
    const status = input.pageDecision?.status ?? "accepted";
    if (status === "accepted") {
      return this.materializeAcceptedPage(input);
    }

    return this.resolveUnacceptedPageWrites({
      ...input,
      status,
      decisionReason: input.pageDecision?.decisionReason,
    });
  }

  materializeAcceptedPage(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    floorId: string;
    pageId?: string;
    committedAt: number;
    conflictPolicy?: VariableConflictPolicy;
    stagedWrites?: PageStagedVariableWriteRecord[];
  }): VariablePromotionResult {
    const conflictPolicy = input.conflictPolicy ?? "replace";
    if (!input.pageId) {
      return createEmptyPromotionResult({
        pageId: input.pageId,
        floorId: input.floorId,
        sessionId: input.sessionId,
        branchId: input.branchId,
        conflictPolicy,
      });
    }

    const stageService = new PageVariableStageService(this.db);
    const stagedWrites = input.stagedWrites ?? stageService.listByPageId(input.accountId, input.pageId);
    const activeWrites = stagedWrites.filter((item) => item.status === "staged");

    const existingPageRows = this.db
      .select()
      .from(variables)
      .where(and(
        eq(variables.accountId, input.accountId),
        eq(variables.scope, "page"),
        eq(variables.scopeId, input.pageId),
      ))
      .orderBy(asc(variables.key), asc(variables.id))
      .all();

    const existingFloorRows = this.db
      .select()
      .from(variables)
      .where(and(
        eq(variables.accountId, input.accountId),
        eq(variables.scope, "floor"),
        eq(variables.scopeId, input.floorId),
      ))
      .orderBy(asc(variables.key), asc(variables.id))
      .all();

    const pageRowsByKey = new Map(existingPageRows.map((row) => [row.key, row]));
    const floorRowsByKey = new Map(existingFloorRows.map((row) => [row.key, row]));
    const stagedWritesByKey = new Map<string, PageStagedVariableWriteRecord>();
    const pageVariables: VariablePromotionResult["pageVariables"] = [];
    const promotedVariables: VariableEntry[] = [];
    const promotionTraces: VariablePromotionTraceRecord[] = [];
    const statusUpdates: Array<{
      id: string;
      status: PageStagedVariableWriteRecord["status"];
      decisionReason?: string | null;
    }> = [];
    let skippedCount = 0;

    for (const stagedWrite of activeWrites) {
      if (stagedWrite.op !== "set") {
        skippedCount += 1;
        statusUpdates.push({
          id: stagedWrite.id,
          status: "accepted_page_only",
          decisionReason: "delete_op_not_materialized_in_phase_one",
        });
        continue;
      }

      const valueJson = JSON.stringify(stagedWrite.value);
      const existingPageRow = pageRowsByKey.get(stagedWrite.key);
      const nextPageRow = existingPageRow
        ? this.db
            .update(variables)
            .set({
              valueJson,
              updatedAt: input.committedAt,
            })
            .where(eq(variables.id, existingPageRow.id))
            .returning()
            .all()[0]
        : this.db
            .insert(variables)
            .values({
              id: nanoid(),
              accountId: input.accountId,
              scope: "page",
              scopeId: input.pageId,
              key: stagedWrite.key,
              valueJson,
              updatedAt: input.committedAt,
            })
            .returning()
            .all()[0];

      if (!nextPageRow) {
        throw new Error(`Failed to materialize page variable '${stagedWrite.key}'`);
      }

      pageRowsByKey.set(stagedWrite.key, nextPageRow);
      pageVariables.push({
        stagedWriteId: stagedWrite.id,
        entry: toVariableEntry(nextPageRow),
        isNew: !existingPageRow,
      });
      stagedWritesByKey.set(stagedWrite.key, stagedWrite);

      if (stagedWrite.intent === "page_only") {
        statusUpdates.push({ id: stagedWrite.id, status: "accepted_page_only" });
      }
    }

    const pageRows = Array.from(pageRowsByKey.values()).sort((left, right) => {
      const keyOrder = left.key.localeCompare(right.key);
      if (keyOrder !== 0) {
        return keyOrder;
      }

      return left.id.localeCompare(right.id);
    });

    for (const pageRow of pageRows) {
      const stagedWrite = stagedWritesByKey.get(pageRow.key);
      if (stagedWrite?.intent === "page_only") {
        continue;
      }

      const existingFloorRow = floorRowsByKey.get(pageRow.key);
      if (conflictPolicy === "if_absent" && existingFloorRow) {
        skippedCount += 1;
        if (stagedWrite) {
          statusUpdates.push({
            id: stagedWrite.id,
            status: "accepted_page_only",
            decisionReason: "promotion_skipped_if_absent",
          });
        }
        continue;
      }

      const nextFloorRow = existingFloorRow
        ? this.db
            .update(variables)
            .set({
              valueJson: pageRow.valueJson,
              updatedAt: input.committedAt,
            })
            .where(eq(variables.id, existingFloorRow.id))
            .returning()
            .all()[0]
        : this.db
            .insert(variables)
            .values({
              id: nanoid(),
              accountId: input.accountId,
              scope: "floor",
              scopeId: input.floorId,
              key: pageRow.key,
              valueJson: pageRow.valueJson,
              updatedAt: input.committedAt,
            })
            .returning()
            .all()[0];

      if (!nextFloorRow) {
        throw new Error(`Failed to promote floor variable '${pageRow.key}'`);
      }

      floorRowsByKey.set(pageRow.key, nextFloorRow);
      promotedVariables.push(toVariableEntry(nextFloorRow));

      const traceRow = this.db
        .insert(variablePromotionTraces)
        .values({
          id: nanoid(),
          accountId: input.accountId,
          sessionId: input.sessionId,
          branchId: input.branchId,
          floorId: input.floorId,
          pageId: input.pageId,
          stagedWriteId: stagedWrite?.id ?? null,
          key: pageRow.key,
          fromScope: "page",
          fromScopeId: input.pageId,
          toScope: "floor",
          toScopeId: input.floorId,
          conflictPolicy,
          sourceVariableId: pageRow.id,
          targetVariableId: nextFloorRow.id,
          valueJson: pageRow.valueJson,
          createdAt: input.committedAt,
        })
        .returning()
        .all()[0];

      if (!traceRow) {
        throw new Error(`Failed to record variable promotion trace for '${pageRow.key}'`);
      }

      promotionTraces.push(toVariablePromotionTraceRecord(traceRow));
      if (stagedWrite) {
        statusUpdates.push({ id: stagedWrite.id, status: "promoted" });
      }
    }

    const resolvedWrites = stageService.markResolvedWrites({
      updates: statusUpdates,
      resolvedAt: input.committedAt,
    });

    return {
      pageId: input.pageId,
      floorId: input.floorId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      fromScope: "page",
      toScope: "floor",
      policy: conflictPolicy === "if_absent" ? "ifAbsent" : "replace",
      scannedCount: pageRows.length,
      promotedCount: promotedVariables.length,
      skippedCount,
      promotedVariables,
      pageVariables,
      stageWrites: resolvedWrites,
      promotionTraces,
    };
  }

  private resolveUnacceptedPageWrites(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    floorId: string;
    pageId?: string;
    committedAt: number;
    conflictPolicy?: VariableConflictPolicy;
    stagedWrites?: PageStagedVariableWriteRecord[];
    status: Exclude<PageVariableDecisionStatus, "accepted">;
    decisionReason?: string | null;
  }): VariablePromotionResult {
    const conflictPolicy = input.conflictPolicy ?? "replace";
    const emptyResult = createEmptyPromotionResult({
      pageId: input.pageId,
      floorId: input.floorId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      conflictPolicy,
    });

    if (!input.pageId) {
      return emptyResult;
    }

    const stageService = new PageVariableStageService(this.db);
    const stagedWrites = input.stagedWrites ?? stageService.listByPageId(input.accountId, input.pageId);
    const activeWrites = stagedWrites.filter((item) => item.status === "staged");

    if (activeWrites.length === 0) {
      return emptyResult;
    }

    const resolvedWrites = stageService.markResolvedWrites({
      updates: activeWrites.map((item) => ({
        id: item.id,
        status: input.status,
        decisionReason: resolveDefaultDecisionReason(input.status, input.decisionReason),
      })),
      resolvedAt: input.committedAt,
    });

    return {
      ...emptyResult,
      scannedCount: activeWrites.length,
      skippedCount: activeWrites.length,
      stageWrites: resolvedWrites,
    };
  }
}
