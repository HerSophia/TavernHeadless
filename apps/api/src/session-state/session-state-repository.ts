import { and, asc, count, desc, eq, gte, inArray, isNull, lte, type SQL } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../db/client.js";
import { floors, sessions, sessionStateMutations, sessionStateNamespaceRegistrations } from "../db/schema.js";
import type {
  SessionStateNamespaceRegistrationRecord,
  SessionStateMutationStatus,
  SessionStateMutationDecisionStatus,
  SessionStateMutationCommitMode,
  SessionStateMutationView,
  SessionStateNamespace,
  SessionStateReplayPolicySource,
  SessionStateReplaySafety,
  SessionStateMutationSourceKind,
  SessionStateVisibilityMode,
  SessionStateWriteMode,
} from "./session-state-types.js";

export type SessionStateMutationSortOrder = "asc" | "desc";

export interface SessionStateSessionHostRecord {
  id: string;
  accountId: string;
  status: typeof sessions.$inferSelect["status"];
}

export interface SessionStateFloorHostRecord {
  id: string;
  sessionId: string;
  floorNo: number;
  branchId: string;
  parentFloorId: string | null;
  state: typeof floors.$inferSelect["state"];
  createdAt: number;
  updatedAt: number;
}

export interface SessionStateNamespaceRegistrationListFilters {
  accountId: string;
  sessionId: string;
  namespace?: SessionStateNamespace;
}

export interface SessionStateMutationListFilters {
  /**
   * 必填。listMutations 永远按 session 维度收口，避免出现全表扫。
   */
  sessionId: string;
  branchId?: string;
  status?: SessionStateMutationStatus;
  sourceFloorId?: string;
  sourcePageId?: string;
  sourceBranchId?: string;
  sourceKind?: SessionStateMutationSourceKind;
  commitMode?: SessionStateMutationCommitMode;
  actorClientId?: string | null;
  runId?: string;
  targetSlot?: string;
  stateNamespace?: SessionStateNamespace;
  writeMode?: SessionStateWriteMode;
  replaySafety?: SessionStateReplaySafety;
  createdAfter?: number;
  createdBefore?: number;
}

export interface SessionStateMutationListPagination {
  limit: number;
  offset: number;
  sortOrder: SessionStateMutationSortOrder;
}

export interface SessionStateMutationListResult {
  rows: SessionStateMutationView[];
  total: number;
}

export interface SessionStateMaterializedSlotRecord {
  namespace: SessionStateNamespace;
  slot: string;
}

export interface SessionStateMaterializedSlotListFilters {
  accountId: string;
  sessionId: string;
  namespace?: SessionStateNamespace;
  slot?: string;
  statuses?: SessionStateMutationStatus[];
  writeModes?: SessionStateWriteMode[];
}

export class SessionStateRepository {
  constructor(private readonly db: AppDb | DbExecutor) {}

  getSessionById(sessionId: string): SessionStateSessionHostRecord | null {
    const row = this.db
      .select({
        id: sessions.id,
        accountId: sessions.accountId,
        status: sessions.status,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1)
      .get();

    return row ?? null;
  }

  getFloorById(floorId: string): SessionStateFloorHostRecord | null {
    const row = this.db
      .select({
        id: floors.id,
        sessionId: floors.sessionId,
        floorNo: floors.floorNo,
        branchId: floors.branchId,
        parentFloorId: floors.parentFloorId,
        state: floors.state,
        createdAt: floors.createdAt,
        updatedAt: floors.updatedAt,
      })
      .from(floors)
      .where(eq(floors.id, floorId))
      .limit(1)
      .get();

    return row ?? null;
  }

  getLatestCommittedFloorInBranch(sessionId: string, branchId: string): SessionStateFloorHostRecord | null {
    const row = this.db
      .select({
        id: floors.id,
        sessionId: floors.sessionId,
        floorNo: floors.floorNo,
        branchId: floors.branchId,
        parentFloorId: floors.parentFloorId,
        state: floors.state,
        createdAt: floors.createdAt,
        updatedAt: floors.updatedAt,
      })
      .from(floors)
      .where(and(
        eq(floors.sessionId, sessionId),
        eq(floors.branchId, branchId),
        eq(floors.state, "committed"),
        isNull(floors.supersededAt),
      ))
      .orderBy(desc(floors.floorNo), desc(floors.createdAt))
      .limit(1)
      .get();

    return row ?? null;
  }

  getNamespaceRegistration(input: {
    accountId: string;
    sessionId: string;
    namespace: SessionStateNamespace;
  }): SessionStateNamespaceRegistrationRecord | null {
    const row = this.db
      .select()
      .from(sessionStateNamespaceRegistrations)
      .where(and(
        eq(sessionStateNamespaceRegistrations.accountId, input.accountId),
        eq(sessionStateNamespaceRegistrations.sessionId, input.sessionId),
        eq(sessionStateNamespaceRegistrations.namespace, input.namespace),
      ))
      .limit(1)
      .get();

    return row ? toNamespaceRegistrationRecord(row) : null;
  }

  listNamespaceRegistrations(
    filters: SessionStateNamespaceRegistrationListFilters,
  ): SessionStateNamespaceRegistrationRecord[] {
    const conditions = [
      eq(sessionStateNamespaceRegistrations.accountId, filters.accountId),
      eq(sessionStateNamespaceRegistrations.sessionId, filters.sessionId),
    ];
    if (filters.namespace !== undefined) {
      conditions.push(eq(sessionStateNamespaceRegistrations.namespace, filters.namespace));
    }

    return this.db
      .select()
      .from(sessionStateNamespaceRegistrations)
      .where(conditions.length === 1 ? conditions[0]! : and(...conditions))
      .orderBy(asc(sessionStateNamespaceRegistrations.namespace), asc(sessionStateNamespaceRegistrations.createdAt))
      .all()
      .map(toNamespaceRegistrationRecord);
  }

  listMaterializedSlots(
    filters: SessionStateMaterializedSlotListFilters,
  ): SessionStateMaterializedSlotRecord[] {
    const conditions: SQL[] = [
      eq(sessionStateMutations.accountId, filters.accountId),
      eq(sessionStateMutations.sessionId, filters.sessionId),
    ];
    if (filters.namespace !== undefined) {
      conditions.push(eq(sessionStateMutations.stateNamespace, filters.namespace));
    }
    if (filters.slot !== undefined) {
      conditions.push(eq(sessionStateMutations.targetSlot, filters.slot));
    }
    if (filters.statuses && filters.statuses.length > 0) {
      conditions.push(inArray(sessionStateMutations.status, filters.statuses));
    }
    if (filters.writeModes && filters.writeModes.length > 0) {
      conditions.push(inArray(sessionStateMutations.writeMode, filters.writeModes));
    }

    return this.db
      .select({
        namespace: sessionStateMutations.stateNamespace,
        slot: sessionStateMutations.targetSlot,
      })
      .from(sessionStateMutations)
      .where(conditions.length === 1 ? conditions[0]! : and(...conditions))
      .groupBy(sessionStateMutations.stateNamespace, sessionStateMutations.targetSlot)
      .orderBy(asc(sessionStateMutations.stateNamespace), asc(sessionStateMutations.targetSlot))
      .all()
      .map((row) => ({ namespace: row.namespace as SessionStateNamespace, slot: row.slot }));
  }

  createNamespaceRegistration(input: {
    id: string;
    accountId: string;
    sessionId: string;
    domainId: string;
    namespace: SessionStateNamespace;
    logicalOwnerType: string;
    logicalOwnerId: string;
    defaultVisibilityMode: SessionStateVisibilityMode;
    defaultWriteMode: SessionStateWriteMode;
    defaultReplaySafety: SessionStateReplaySafety;
    clientWritable: boolean;
    allowedWriteModes: SessionStateWriteMode[];
    supportsSnapshot: boolean;
    supportsDiff: boolean;
    replayPolicySource: SessionStateReplayPolicySource;
    createdAt: number;
    updatedAt: number;
  }): SessionStateNamespaceRegistrationRecord {
    const row = this.db
      .insert(sessionStateNamespaceRegistrations)
      .values({
        id: input.id,
        accountId: input.accountId,
        sessionId: input.sessionId,
        domainId: input.domainId,
        namespace: input.namespace,
        logicalOwnerType: input.logicalOwnerType,
        logicalOwnerId: input.logicalOwnerId,
        defaultVisibilityMode: input.defaultVisibilityMode,
        defaultWriteMode: input.defaultWriteMode,
        defaultReplaySafety: input.defaultReplaySafety,
        clientWritable: input.clientWritable,
        allowedWriteModesJson: JSON.stringify(input.allowedWriteModes),
        supportsSnapshot: input.supportsSnapshot,
        supportsDiff: input.supportsDiff,
        replayPolicySource: input.replayPolicySource,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      })
      .returning()
      .get();

    return toNamespaceRegistrationRecord(row);
  }

  createMutation(input: {
    id: string;
    accountId: string;
    domainId: string;
    stateNamespace: SessionStateNamespace;
    sessionId: string;
    branchId: string;
    sourceFloorId?: string | null;
    sourcePageId?: string | null;
    sourceBranchId?: string | null;
    targetSlot: string;
    actorClientId?: string | null;
    sourceKind?: SessionStateMutationSourceKind | null;
    visibilityMode: SessionStateVisibilityMode;
    writeMode: SessionStateWriteMode;
    commitMode: SessionStateMutationCommitMode;
    replaySafety: SessionStateMutationView["replaySafety"];
    status: SessionStateMutationStatus;
    decisionStatus: SessionStateMutationDecisionStatus;
    decisionReason?: string | null;
    decisionCode?: string | null;
    requestId?: string | null;
    runId?: string | null;
    payloadJson: string;
    sourceSnapshotFloorId?: string | null;
    liveHeadKey?: string | null;
    linkedVariableStageId?: string | null;
    discardReason?: string | null;
    blockedReason?: string | null;
    createdAt: number;
    updatedAt: number;
    appliedAt?: number | null;
  }): SessionStateMutationView {
    const row = this.db
      .insert(sessionStateMutations)
      .values({
        id: input.id,
        accountId: input.accountId,
        domainId: input.domainId,
        stateNamespace: input.stateNamespace,
        sourceKind: input.sourceKind ?? null,
        sessionId: input.sessionId,
        branchId: input.branchId,
        sourceFloorId: input.sourceFloorId ?? null,
        sourcePageId: input.sourcePageId ?? null,
        sourceBranchId: input.sourceBranchId ?? null,
        targetSlot: input.targetSlot,
        actorClientId: input.actorClientId ?? null,
        visibilityMode: input.visibilityMode,
        writeMode: input.writeMode,
        commitMode: input.commitMode,
        replaySafety: input.replaySafety,
        status: input.status,
        decisionStatus: input.decisionStatus,
        decisionReason: input.decisionReason ?? null,
        decisionCode: input.decisionCode ?? null,
        requestId: input.requestId ?? null,
        runId: input.runId ?? null,
        payloadJson: input.payloadJson,
        sourceSnapshotFloorId: input.sourceSnapshotFloorId ?? null,
        liveHeadKey: input.liveHeadKey ?? null,
        linkedVariableStageId: input.linkedVariableStageId ?? null,
        discardReason: input.discardReason ?? null,
        blockedReason: input.blockedReason ?? null,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
        appliedAt: input.appliedAt ?? null,
      })
      .returning()
      .get();

    return toMutationView(row);
  }

  updateMutation(input: {
    mutationId: string;
    status?: SessionStateMutationStatus;
    payloadJson?: string;
    sourceSnapshotFloorId?: string | null;
    liveHeadKey?: string | null;
    decisionStatus?: SessionStateMutationDecisionStatus;
    decisionReason?: string | null;
    decisionCode?: string | null;
    linkedVariableStageId?: string | null;
    sourcePageId?: string | null;
    actorClientId?: string | null;
    sourceKind?: SessionStateMutationSourceKind | null;
    commitMode?: SessionStateMutationCommitMode;
    discardReason?: string | null;
    blockedReason?: string | null;
    updatedAt: number;
    appliedAt?: number | null;
  }): SessionStateMutationView | null {
    const row = this.db
      .update(sessionStateMutations)
      .set({
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.payloadJson !== undefined ? { payloadJson: input.payloadJson } : {}),
        ...(input.sourceSnapshotFloorId !== undefined ? { sourceSnapshotFloorId: input.sourceSnapshotFloorId } : {}),
        ...(input.liveHeadKey !== undefined ? { liveHeadKey: input.liveHeadKey } : {}),
        ...(input.decisionStatus !== undefined ? { decisionStatus: input.decisionStatus } : {}),
        ...(input.decisionReason !== undefined ? { decisionReason: input.decisionReason } : {}),
        ...(input.decisionCode !== undefined ? { decisionCode: input.decisionCode } : {}),
        ...(input.linkedVariableStageId !== undefined ? { linkedVariableStageId: input.linkedVariableStageId } : {}),
        ...(input.sourcePageId !== undefined ? { sourcePageId: input.sourcePageId } : {}),
        ...(input.actorClientId !== undefined ? { actorClientId: input.actorClientId } : {}),
        ...(input.sourceKind !== undefined ? { sourceKind: input.sourceKind } : {}),
        ...(input.commitMode !== undefined ? { commitMode: input.commitMode } : {}),
        ...(input.discardReason !== undefined ? { discardReason: input.discardReason } : {}),
        ...(input.blockedReason !== undefined ? { blockedReason: input.blockedReason } : {}),
        ...(input.appliedAt !== undefined ? { appliedAt: input.appliedAt } : {}),
        updatedAt: input.updatedAt,
      })
      .where(eq(sessionStateMutations.id, input.mutationId))
      .returning()
      .get();

    return row ? toMutationView(row) : null;
  }

  findMutationById(mutationId: string): SessionStateMutationView | null {
    const row = this.db
      .select()
      .from(sessionStateMutations)
      .where(eq(sessionStateMutations.id, mutationId))
      .limit(1)
      .get();

    return row ? toMutationView(row) : null;
  }

  listMutationsForSourceFloor(
    floorId: string,
    statuses?: SessionStateMutationStatus[],
  ): SessionStateMutationView[] {
    const filters = [eq(sessionStateMutations.sourceFloorId, floorId)];
    if (statuses && statuses.length > 0) {
      filters.push(inArray(sessionStateMutations.status, statuses));
    }

    return this.db
      .select()
      .from(sessionStateMutations)
      .where(filters.length === 1 ? filters[0]! : and(...filters))
      .orderBy(sessionStateMutations.createdAt)
      .all()
      .map(toMutationView);
  }

  listMutations(
    filters: SessionStateMutationListFilters,
    pagination: SessionStateMutationListPagination,
  ): SessionStateMutationListResult {
    const conditions = buildListMutationsConditions(filters);
    const whereClause = conditions.length === 1 ? conditions[0]! : and(...conditions);

    const totalRow = this.db
      .select({ total: count() })
      .from(sessionStateMutations)
      .where(whereClause)
      .get();

    const total = totalRow?.total ?? 0;

    const rows = this.db
      .select()
      .from(sessionStateMutations)
      .where(whereClause)
      .orderBy(
        pagination.sortOrder === "asc"
          ? asc(sessionStateMutations.createdAt)
          : desc(sessionStateMutations.createdAt),
        pagination.sortOrder === "asc"
          ? asc(sessionStateMutations.id)
          : desc(sessionStateMutations.id),
      )
      .limit(pagination.limit)
      .offset(pagination.offset)
      .all()
      .map(toMutationView);

    return { rows, total };
  }
}

function buildListMutationsConditions(filters: SessionStateMutationListFilters): SQL[] {
  const conditions: SQL[] = [eq(sessionStateMutations.sessionId, filters.sessionId)];

  if (filters.branchId !== undefined) {
    conditions.push(eq(sessionStateMutations.branchId, filters.branchId));
  }
  if (filters.status !== undefined) {
    conditions.push(eq(sessionStateMutations.status, filters.status));
  }
  if (filters.sourceFloorId !== undefined) {
    conditions.push(eq(sessionStateMutations.sourceFloorId, filters.sourceFloorId));
  }
  if (filters.sourcePageId !== undefined) {
    conditions.push(eq(sessionStateMutations.sourcePageId, filters.sourcePageId));
  }
  if (filters.sourceBranchId !== undefined) {
    conditions.push(eq(sessionStateMutations.sourceBranchId, filters.sourceBranchId));
  }
  if (filters.sourceKind !== undefined) {
    conditions.push(eq(sessionStateMutations.sourceKind, filters.sourceKind));
  }
  if (filters.commitMode !== undefined) {
    conditions.push(eq(sessionStateMutations.commitMode, filters.commitMode));
  }
  if (filters.actorClientId !== undefined) {
    if (filters.actorClientId === null) {
      conditions.push(isNull(sessionStateMutations.actorClientId));
    } else {
      conditions.push(eq(sessionStateMutations.actorClientId, filters.actorClientId));
    }
  }
  if (filters.runId !== undefined) {
    conditions.push(eq(sessionStateMutations.runId, filters.runId));
  }
  if (filters.targetSlot !== undefined) {
    conditions.push(eq(sessionStateMutations.targetSlot, filters.targetSlot));
  }
  if (filters.stateNamespace !== undefined) {
    conditions.push(eq(sessionStateMutations.stateNamespace, filters.stateNamespace));
  }
  if (filters.writeMode !== undefined) {
    conditions.push(eq(sessionStateMutations.writeMode, filters.writeMode));
  }
  if (filters.replaySafety !== undefined) {
    conditions.push(eq(sessionStateMutations.replaySafety, filters.replaySafety));
  }
  if (filters.createdAfter !== undefined) {
    conditions.push(gte(sessionStateMutations.createdAt, filters.createdAfter));
  }
  if (filters.createdBefore !== undefined) {
    conditions.push(lte(sessionStateMutations.createdAt, filters.createdBefore));
  }

  return conditions;
}

function toMutationView(row: typeof sessionStateMutations.$inferSelect): SessionStateMutationView {
  return {
    id: row.id,
    accountId: row.accountId,
    domainId: row.domainId,
    stateNamespace: row.stateNamespace,
    sourceKind: row.sourceKind ?? null,
    sessionId: row.sessionId,
    branchId: row.branchId,
    sourceFloorId: row.sourceFloorId ?? null,
    sourcePageId: row.sourcePageId ?? null,
    sourceBranchId: row.sourceBranchId ?? null,
    targetSlot: row.targetSlot,
    actorClientId: row.actorClientId ?? null,
    visibilityMode: row.visibilityMode,
    writeMode: row.writeMode,
    commitMode: row.commitMode,
    replaySafety: row.replaySafety,
    payloadJson: row.payloadJson,
    status: row.status,
    decisionStatus: row.decisionStatus,
    decisionReason: row.decisionReason ?? null,
    decisionCode: row.decisionCode ?? null,
    requestId: row.requestId ?? null,
    runId: row.runId ?? null,
    payload: { present: true, value: null },
    sourceSnapshotFloorId: row.sourceSnapshotFloorId ?? null,
    liveHeadKey: row.liveHeadKey ?? null,
    linkedVariableStageId: row.linkedVariableStageId ?? null,
    discardReason: row.discardReason ?? null,
    blockedReason: row.blockedReason ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    appliedAt: row.appliedAt ?? null,
  };
}

function toNamespaceRegistrationRecord(
  row: typeof sessionStateNamespaceRegistrations.$inferSelect,
): SessionStateNamespaceRegistrationRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    sessionId: row.sessionId,
    domainId: row.domainId,
    namespace: row.namespace,
    logicalOwnerType: row.logicalOwnerType,
    logicalOwnerId: row.logicalOwnerId,
    defaultSlotTemplate: {
      defaultVisibilityMode: row.defaultVisibilityMode,
      defaultWriteMode: row.defaultWriteMode,
      defaultReplaySafety: row.defaultReplaySafety,
      clientWritable: row.clientWritable,
      allowedWriteModes: parseAllowedWriteModes(row.allowedWriteModesJson),
      supportsSnapshot: row.supportsSnapshot,
      supportsDiff: row.supportsDiff,
      replayPolicySource: row.replayPolicySource,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseAllowedWriteModes(value: string): SessionStateWriteMode[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is SessionStateWriteMode => entry === "direct" || entry === "commit_bound")
      : [];
  } catch {
    return [];
  }
}
