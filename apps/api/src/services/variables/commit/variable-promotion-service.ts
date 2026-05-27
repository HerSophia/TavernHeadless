import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { VariableEntry } from "@tavern/shared";

import type { AppDb, DbExecutor } from "../../../db/client.js";
import { variablePromotionTraces, variables } from "../../../db/schema.js";
import type { SessionStateService } from "../../../session-state/session-state-service.js";
import { SessionStateServiceError } from "../../../session-state/session-state-service.js";
import {
  resolveVariableDecisionCode,
  type PageInspectionDecisionCode,
} from "../../state-governance/shared/page-inspection-contracts.js";
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
    sourceKind: row.sourceKind as VariablePromotionTraceRecord["sourceKind"],
    actorClientId: row.actorClientId,
    source: parseJsonObject<Record<string, unknown>>(row.sourceJson, {}),
    evidence: parseJsonObject<Record<string, unknown>>(row.evidenceJson, {}),
    decisionCode: row.decisionCode,
    decisionReason: row.decisionReason,
    linkedSessionStateMutationId: row.linkedSessionStateMutationId,
    value: JSON.parse(row.valueJson),
    createdAt: row.createdAt,
  };
}

function parseJsonObject<T extends Record<string, unknown>>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as T
      : fallback;
  } catch {
    return fallback;
  }
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

function resolveDefaultDecisionCode(
  status: Exclude<PageVariableDecisionStatus, "accepted">,
  decisionReason: string | null | undefined,
): PageInspectionDecisionCode | null {
  return resolveVariableDecisionCode({ status, decisionReason: resolveDefaultDecisionReason(status, decisionReason) });
}

function buildSessionStateTraceScopeId(namespace: string | null | undefined, slot: string | null | undefined): string {
  const normalizedNamespace = typeof namespace === "string" && namespace.trim().length > 0
    ? namespace.trim()
    : "unknown_namespace";
  const normalizedSlot = typeof slot === "string" && slot.trim().length > 0
    ? slot.trim()
    : "unknown_slot";
  return `session_state:${normalizedNamespace}:${normalizedSlot}`;
}

export class VariablePromotionService {
  constructor(
    private readonly db: AppDb | DbExecutor,
    private readonly sessionStateService?: SessionStateService,
  ) {}

  private insertSessionStateRerouteTrace(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    floorId: string;
    pageId: string;
    committedAt: number;
    stagedWrite: PageStagedVariableWriteRecord;
    namespace?: string | null;
    slot?: string | null;
    decisionCode: VariablePromotionTraceRecord["decisionCode"];
    decisionReason: string | null;
    linkedSessionStateMutationId: string | null;
  }): VariablePromotionTraceRecord {
    const traceRow = this.db
      .insert(variablePromotionTraces)
      .values({
        id: nanoid(),
        accountId: input.accountId,
        sessionId: input.sessionId,
        branchId: input.branchId,
        floorId: input.floorId,
        pageId: input.pageId,
        stagedWriteId: input.stagedWrite.id,
        key: input.stagedWrite.key,
        fromScope: "page",
        fromScopeId: input.pageId,
        toScope: "session_state",
        toScopeId: buildSessionStateTraceScopeId(input.namespace, input.slot),
        conflictPolicy: input.stagedWrite.conflictPolicy,
        sourceVariableId: null,
        targetVariableId: null,
        sourceKind: input.stagedWrite.sourceKind,
        actorClientId: input.stagedWrite.actorClientId,
        sourceJson: JSON.stringify(input.stagedWrite.source ?? {}),
        evidenceJson: JSON.stringify(input.stagedWrite.evidence ?? {}),
        decisionCode: input.decisionCode,
        decisionReason: input.decisionReason,
        linkedSessionStateMutationId: input.linkedSessionStateMutationId,
        valueJson: JSON.stringify(input.stagedWrite.value),
        createdAt: input.committedAt,
      })
      .returning()
      .all()[0];

    if (!traceRow) {
      throw new Error(`Failed to record session-state reroute trace for '${input.stagedWrite.key}'`);
    }

    return toVariablePromotionTraceRecord(traceRow);
  }

  private createSessionStateRerouteMutations(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    floorId: string;
    pageId: string;
    committedAt: number;
    stagedWrites: PageStagedVariableWriteRecord[];
  }): {
    stageWrites: PageStagedVariableWriteRecord[];
    promotionTraces: VariablePromotionTraceRecord[];
  } {
    const stageService = new PageVariableStageService(this.db);
    const reroutedWrites = input.stagedWrites.filter((item) => item.status === "rerouted_to_session_state");

    if (reroutedWrites.length === 0) {
      return { stageWrites: [], promotionTraces: [] };
    }

    const updates: Array<{
      id: string;
      status: PageStagedVariableWriteRecord["status"];
      decisionCode?: PageStagedVariableWriteRecord["decisionCode"];
      decisionReason?: string | null;
      linkedSessionStateMutationId?: string | null;
    }> = [];
    const promotionTraces: VariablePromotionTraceRecord[] = [];

    for (const stagedWrite of reroutedWrites) {
      const namespace = stagedWrite.reroutedTarget?.namespace?.trim();
      const slot = stagedWrite.reroutedTarget?.slot?.trim();

      if (!namespace || !slot) {
        updates.push({
          id: stagedWrite.id,
          status: "rejected",
          decisionCode: "policy_forbidden",
          decisionReason: "session_state_target_missing",
          linkedSessionStateMutationId: null,
        });
        promotionTraces.push(this.insertSessionStateRerouteTrace({
          ...input,
          stagedWrite,
          namespace,
          slot,
          decisionCode: "policy_forbidden",
          decisionReason: "session_state_target_missing",
          linkedSessionStateMutationId: null,
        }));
        continue;
      }

      if (!this.sessionStateService) {
        updates.push({
          id: stagedWrite.id,
          status: "rejected",
          decisionCode: "policy_forbidden",
          decisionReason: "session_state_unavailable",
          linkedSessionStateMutationId: null,
        });
        promotionTraces.push(this.insertSessionStateRerouteTrace({
          ...input,
          stagedWrite,
          namespace,
          slot,
          decisionCode: "policy_forbidden",
          decisionReason: "session_state_unavailable",
          linkedSessionStateMutationId: null,
        }));
        continue;
      }

      try {
        const mutation = this.sessionStateService.stageVariableRerouteValue({
          accountId: input.accountId,
          sessionId: input.sessionId,
          branchId: input.branchId,
          sourceFloorId: input.floorId,
          sourcePageId: input.pageId,
          namespace,
          slot,
          value: stagedWrite.op === "delete" ? null : stagedWrite.value,
          present: stagedWrite.op !== "delete",
          actorClientId: stagedWrite.actorClientId,
          sourceKind: stagedWrite.sourceKind,
          decisionReason: stagedWrite.decisionReason,
          decisionCode: stagedWrite.decisionCode,
          linkedVariableStageId: stagedWrite.id,
          createdAt: input.committedAt,
        }, this.db as DbExecutor);

        updates.push({
          id: stagedWrite.id,
          status: "rerouted_to_session_state",
          decisionCode: stagedWrite.decisionCode,
          decisionReason: stagedWrite.decisionReason,
          linkedSessionStateMutationId: mutation.id,
        });
        promotionTraces.push(this.insertSessionStateRerouteTrace({
          ...input,
          stagedWrite,
          namespace,
          slot,
          decisionCode: stagedWrite.decisionCode,
          decisionReason: stagedWrite.decisionReason,
          linkedSessionStateMutationId: mutation.id,
        }));
      } catch (error) {
        if (error instanceof SessionStateServiceError) {
          updates.push({
            id: stagedWrite.id,
            status: "rejected",
            decisionCode: "policy_forbidden",
            decisionReason: error.code,
            linkedSessionStateMutationId: null,
          });
          promotionTraces.push(this.insertSessionStateRerouteTrace({
            ...input,
            stagedWrite,
            namespace,
            slot,
            decisionCode: "policy_forbidden",
            decisionReason: error.code,
            linkedSessionStateMutationId: null,
          }));
          continue;
        }
        throw error;
      }
    }

    return {
      stageWrites: stageService.markResolvedWrites({
        updates,
        resolvedAt: input.committedAt,
      }),
      promotionTraces,
    };
  }

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
    actorClientId?: string | null;
  }): VariablePromotionResult {
    const status = input.pageDecision?.status ?? "accepted";
    const rerouteResult = input.pageId
      ? this.createSessionStateRerouteMutations({
          accountId: input.accountId,
          sessionId: input.sessionId,
          branchId: input.branchId,
          floorId: input.floorId,
          pageId: input.pageId,
          committedAt: input.committedAt,
          stagedWrites: input.stagedWrites ?? new PageVariableStageService(this.db).listByPageId(input.accountId, input.pageId),
        })
      : { stageWrites: [], promotionTraces: [] };

    if (status === "accepted") {
      const result = this.materializeAcceptedPage(input);
      return {
        ...result,
        stageWrites: [...result.stageWrites, ...rerouteResult.stageWrites].sort((left, right) => {
          if (left.createdAt !== right.createdAt) {
            return left.createdAt - right.createdAt;
          }
          return left.id.localeCompare(right.id);
        }),
        promotionTraces: [...result.promotionTraces, ...rerouteResult.promotionTraces].sort((left, right) => {
          if (left.createdAt !== right.createdAt) {
            return left.createdAt - right.createdAt;
          }
          return left.id.localeCompare(right.id);
        }),
      };
    }

    const result = this.resolveUnacceptedPageWrites({
      ...input,
      actorClientId: input.actorClientId,
      status,
      decisionCode: input.pageDecision?.decisionCode,
      decisionReason: input.pageDecision?.decisionReason,
    });
    return {
      ...result,
      stageWrites: [...result.stageWrites, ...rerouteResult.stageWrites].sort((left, right) => {
        if (left.createdAt !== right.createdAt) {
          return left.createdAt - right.createdAt;
        }
        return left.id.localeCompare(right.id);
      }),
      promotionTraces: [...result.promotionTraces, ...rerouteResult.promotionTraces].sort((left, right) => {
        if (left.createdAt !== right.createdAt) {
          return left.createdAt - right.createdAt;
        }
        return left.id.localeCompare(right.id);
      }),
    };
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
    actorClientId?: string | null;
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
      decisionCode?: PageStagedVariableWriteRecord["decisionCode"];
      decisionReason?: string | null;
    }> = [];
    let skippedCount = 0;

    for (const stagedWrite of activeWrites) {
      if (stagedWrite.op !== "set") {
        skippedCount += 1;
        statusUpdates.push({
          id: stagedWrite.id,
          status: "accepted_page_only",
          decisionCode: "policy_forbidden",
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
        statusUpdates.push({ id: stagedWrite.id, status: "accepted_page_only", decisionCode: "promotion_allowed" });
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
            decisionCode: "policy_forbidden",
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
          sourceKind: (stagedWrite?.sourceKind ?? "unknown") as VariablePromotionTraceRecord["sourceKind"],
          actorClientId: stagedWrite?.actorClientId ?? input.actorClientId ?? null,
          sourceJson: JSON.stringify(stagedWrite?.source ?? {}),
          evidenceJson: JSON.stringify(stagedWrite?.evidence ?? {}),
          decisionCode: "promotion_allowed",
          decisionReason: null,
          linkedSessionStateMutationId: stagedWrite?.linkedSessionStateMutationId ?? null,
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
        statusUpdates.push({ id: stagedWrite.id, status: "promoted", decisionCode: "promotion_allowed" });
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
    actorClientId?: string | null;
    status: Exclude<PageVariableDecisionStatus, "accepted">;
    decisionCode?: PageInspectionDecisionCode | null;
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
        decisionCode: input.decisionCode ?? resolveDefaultDecisionCode(input.status, input.decisionReason),
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
