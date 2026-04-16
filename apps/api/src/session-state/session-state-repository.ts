import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../db/client.js";
import { floors, sessions, sessionStateMutations } from "../db/schema.js";
import type {
  SessionStateMutationStatus,
  SessionStateMutationView,
  SessionStateNamespace,
  SessionStateVisibilityMode,
  SessionStateWriteMode,
} from "./session-state-types.js";

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

  createMutation(input: {
    id: string;
    accountId: string;
    domainId: string;
    stateNamespace: SessionStateNamespace;
    sessionId: string;
    branchId: string;
    sourceFloorId?: string | null;
    targetSlot: string;
    visibilityMode: SessionStateVisibilityMode;
    writeMode: SessionStateWriteMode;
    replaySafety: SessionStateMutationView["replaySafety"];
    status: SessionStateMutationStatus;
    requestId?: string | null;
    runId?: string | null;
    payloadJson: string;
    sourceSnapshotFloorId?: string | null;
    liveHeadKey?: string | null;
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
        sessionId: input.sessionId,
        branchId: input.branchId,
        sourceFloorId: input.sourceFloorId ?? null,
        targetSlot: input.targetSlot,
        visibilityMode: input.visibilityMode,
        writeMode: input.writeMode,
        replaySafety: input.replaySafety,
        status: input.status,
        requestId: input.requestId ?? null,
        runId: input.runId ?? null,
        payloadJson: input.payloadJson,
        sourceSnapshotFloorId: input.sourceSnapshotFloorId ?? null,
        liveHeadKey: input.liveHeadKey ?? null,
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
}

function toMutationView(row: typeof sessionStateMutations.$inferSelect): SessionStateMutationView {
  return {
    id: row.id,
    accountId: row.accountId,
    domainId: row.domainId,
    stateNamespace: row.stateNamespace,
    sessionId: row.sessionId,
    branchId: row.branchId,
    sourceFloorId: row.sourceFloorId ?? null,
    targetSlot: row.targetSlot,
    visibilityMode: row.visibilityMode,
    writeMode: row.writeMode,
    replaySafety: row.replaySafety,
    payloadJson: row.payloadJson,
    status: row.status,
    requestId: row.requestId ?? null,
    runId: row.runId ?? null,
    payload: { present: true, value: null },
    sourceSnapshotFloorId: row.sourceSnapshotFloorId ?? null,
    liveHeadKey: row.liveHeadKey ?? null,
    discardReason: row.discardReason ?? null,
    blockedReason: row.blockedReason ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    appliedAt: row.appliedAt ?? null,
  };
}
