import { and, asc, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { BufferedToolVariableMutation, VariableWriteIntent } from "@tavern/core";

import type { AppDb, DbExecutor } from "../../../db/client.js";
import { pageStagedVariableWrites } from "../../../db/schema.js";
import {
  deriveVariableSourceKind,
  resolveVariableDecisionCode,
} from "../../state-governance/shared/page-inspection-contracts.js";
import {
  type PageStagedVariableWriteEvidence,
  type PageStagedVariableWriteRecord,
  type PageStagedVariableWriteSource,
  type PageStagedVariableWriteStatus,
  type PageStagedVariableRerouteTarget,
} from "../contracts.js";

function normalizeActorClientId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeIntent(value: VariableWriteIntent | undefined): VariableWriteIntent {
  return value === "page_only" ? "page_only" : "promote_to_floor_on_accept";
}

function normalizeReason(value: string | undefined): string {
  if (typeof value !== "string") {
    return "builtin:set_variable";
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "builtin:set_variable";
}

function parseJsonObject<T>(value: string | null, fallback: T): T {
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

function parseJsonValue(value: string | null): unknown | null {
  if (value === null) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function resolveReroutedTarget(source: PageStagedVariableWriteSource | undefined): PageStagedVariableRerouteTarget | null {
  if (!source || source.targetSurface !== "session_state") {
    return null;
  }

  return {
    surface: "session_state",
    namespace: source.sessionStateNamespace ?? null,
    slot: source.sessionStateSlot ?? null,
  };
}

function toPageStagedVariableWriteRecord(
  row: typeof pageStagedVariableWrites.$inferSelect,
): PageStagedVariableWriteRecord {
  const source = parseJsonObject<PageStagedVariableWriteSource>(row.sourceJson, {});
  return {
    id: row.id,
    accountId: row.accountId,
    sessionId: row.sessionId,
    branchId: row.branchId,
    floorId: row.floorId,
    pageId: row.pageId,
    key: row.key,
    op: row.op,
    value: parseJsonValue(row.valueJson),
    intent: row.intent,
    conflictPolicy: row.conflictPolicy,
    sourceKind: row.sourceKind as PageStagedVariableWriteRecord["sourceKind"],
    actorClientId: row.actorClientId,
    source,
    evidence: parseJsonObject<PageStagedVariableWriteEvidence>(row.evidenceJson, {}),
    reroutedTarget: resolveReroutedTarget(source),
    reason: row.reason,
    status: row.status,
    decisionCode: row.decisionCode,
    decisionReason: row.decisionReason,
    linkedSessionStateMutationId: row.linkedSessionStateMutationId,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  };
}

export class PageVariableStageService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  stageBufferedWrites(input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    floorId: string;
    pageId?: string;
    mutations: BufferedToolVariableMutation[];
    committedAt: number;
    actorClientId?: string | null;
  }): PageStagedVariableWriteRecord[] {
    if (!input.pageId || input.mutations.length === 0) {
      return [];
    }

    const inserted = this.db
      .insert(pageStagedVariableWrites)
      .values(input.mutations.map((mutation): typeof pageStagedVariableWrites.$inferInsert => ({
        id: nanoid(),
        accountId: input.accountId,
        sessionId: input.sessionId,
        branchId: input.branchId,
        floorId: input.floorId,
        pageId: input.pageId!,
        key: mutation.key,
        op: "set" as const,
        valueJson: JSON.stringify(mutation.value),
        intent: normalizeIntent(mutation.intent),
        conflictPolicy: "replace" as const,
        sourceKind: deriveVariableSourceKind({ source: mutation.source, runId: mutation.runId }) as typeof pageStagedVariableWrites.$inferInsert["sourceKind"],
        actorClientId: normalizeActorClientId(input.actorClientId),
        sourceJson: JSON.stringify({
          ...(mutation.source ?? {}),
          ...(resolveReroutedTarget(mutation.source)
            ? { reroutedTarget: resolveReroutedTarget(mutation.source) }
            : {}),
        }),
        evidenceJson: JSON.stringify({
          runId: mutation.runId,
          generationAttemptNo: mutation.generationAttemptNo,
          bufferedAt: mutation.bufferedAt,
          committedAt: input.committedAt,
          accountId: mutation.accountId ?? input.accountId,
          scope: mutation.scope,
          scopeId: mutation.scopeId,
        } satisfies PageStagedVariableWriteEvidence),
        reason: normalizeReason(mutation.reason),
        status: resolveReroutedTarget(mutation.source)
          ? "rerouted_to_session_state" as const
          : "staged" as const,
        decisionCode: resolveReroutedTarget(mutation.source)
          ? "rerouted_to_session_state"
          : null,
        decisionReason: resolveReroutedTarget(mutation.source)
          ? "identified_as_session_state_candidate"
          : null,
        linkedSessionStateMutationId: null,
        createdAt: mutation.bufferedAt,
        resolvedAt: null,
      })))
      .returning()
      .all() as Array<typeof pageStagedVariableWrites.$inferSelect>;

    return inserted
      .sort((left: typeof pageStagedVariableWrites.$inferSelect, right: typeof pageStagedVariableWrites.$inferSelect) => {
        if (left.createdAt !== right.createdAt) {
          return left.createdAt - right.createdAt;
        }

        return left.id.localeCompare(right.id);
      })
      .map(toPageStagedVariableWriteRecord);
  }

  listByPageId(accountId: string, pageId: string): PageStagedVariableWriteRecord[] {
    return this.db
      .select()
      .from(pageStagedVariableWrites)
      .where(and(
        eq(pageStagedVariableWrites.accountId, accountId),
        eq(pageStagedVariableWrites.pageId, pageId),
      ))
      .orderBy(asc(pageStagedVariableWrites.createdAt), asc(pageStagedVariableWrites.id))
      .all()
      .map(toPageStagedVariableWriteRecord);
  }

  markResolvedWrites(input: {
    updates: Array<{
      id: string;
      status: PageStagedVariableWriteStatus;
      decisionCode?: PageStagedVariableWriteRecord["decisionCode"];
      decisionReason?: string | null;
      linkedSessionStateMutationId?: string | null;
    }>;
    resolvedAt: number;
  }): PageStagedVariableWriteRecord[] {
    if (input.updates.length === 0) {
      return [];
    }

    const ids = Array.from(new Set(input.updates.map((update) => update.id)));

    for (const update of input.updates) {
      this.db
        .update(pageStagedVariableWrites)
        .set({
          status: update.status,
          decisionCode: update.decisionCode ?? resolveVariableDecisionCode({ status: update.status, decisionReason: update.decisionReason }),
          ...(update.decisionReason !== undefined ? { decisionReason: update.decisionReason } : {}),
          ...(update.linkedSessionStateMutationId !== undefined
            ? { linkedSessionStateMutationId: update.linkedSessionStateMutationId }
            : {}),
          resolvedAt: input.resolvedAt,
        })
        .where(eq(pageStagedVariableWrites.id, update.id))
        .run();
    }

    return this.db
      .select()
      .from(pageStagedVariableWrites)
      .where(inArray(pageStagedVariableWrites.id, ids))
      .all()
      .map(toPageStagedVariableWriteRecord)
      .sort((left, right) => {
        if (left.createdAt !== right.createdAt) {
          return left.createdAt - right.createdAt;
        }

        return left.id.localeCompare(right.id);
      });
  }
}
