import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type {
  ExecutedToolCallRecord,
  InstanceSlot,
  ToolExecutionCommitOutcome,
  ToolExecutionDeliveryMode,
  ToolExecutionFinishPatch,
  ToolExecutionLifecycleState,
  ToolExecutionOpenRecord,
  ToolExecutionProviderType,
  ToolExecutionRepository,
  ToolExecutionStatus,
} from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import { floors, sessions, toolExecutionRecords } from "../db/schema.js";

type ToolExecutionRow = typeof toolExecutionRecords.$inferSelect;

export type ToolExecutionSortBy = "created_at" | "started_at" | "finished_at";

export interface ToolExecutionRecordQuery {
  accountId?: string;
  sessionId?: string;
  floorId?: string;
  runId?: string;
  callerSlot?: InstanceSlot;
  toolName?: string;
  providerType?: ToolExecutionProviderType;
  status?: ToolExecutionStatus;
  lifecycleState?: ToolExecutionLifecycleState;
  commitOutcome?: ToolExecutionCommitOutcome;
  limit?: number;
  offset?: number;
  sortBy?: ToolExecutionSortBy;
  sortOrder?: "asc" | "desc";
}

function toRecord(row: ToolExecutionRow): ExecutedToolCallRecord {
  return {
    id: row.id,
    runId: row.runId,
    deliveryMode: (row.deliveryMode ?? "inline") as ToolExecutionDeliveryMode,
    floorId: row.floorId,
    pageId: row.pageId ?? undefined,
    callerSlot: row.callerSlot as InstanceSlot,
    providerId: row.providerId,
    providerType: (row.providerType ?? "unknown") as ToolExecutionProviderType,
    toolName: row.toolName,
    argsJson: row.argsJson,
    resultJson: row.resultJson,
    status: (row.status ?? (row.lifecycleState === "opened" ? "running" : "error")) as ToolExecutionStatus,
    lifecycleState: (row.lifecycleState ?? "finished") as ToolExecutionLifecycleState,
    commitOutcome: (row.commitOutcome ?? "pending") as ToolExecutionCommitOutcome,
    sideEffectLevel: (row.sideEffectLevel ?? undefined) as ExecutedToolCallRecord["sideEffectLevel"],
    errorMessage: row.errorMessage ?? undefined,
    durationMs: row.durationMs,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? undefined,
    attemptNo: row.attemptNo,
    replayParentExecutionId: row.replayParentExecutionId ?? undefined,
    runtimeJobId: row.runtimeJobId ?? undefined,
    createdAt: row.createdAt,
  };
}

function toFinishedRow(record: ExecutedToolCallRecord): typeof toolExecutionRecords.$inferInsert {
  return {
    id: record.id,
    runId: record.runId,
    floorId: record.floorId,
    pageId: record.pageId ?? null,
    deliveryMode: record.deliveryMode ?? "inline",
    callerSlot: record.callerSlot,
    providerId: record.providerId,
    providerType: record.providerType ?? "unknown",
    toolName: record.toolName,
    argsJson: record.argsJson,
    resultJson: record.resultJson,
    status: record.status,
    lifecycleState: record.lifecycleState ?? "finished",
    commitOutcome: record.commitOutcome ?? "pending",
    sideEffectLevel: record.sideEffectLevel ?? null,
    errorMessage: record.errorMessage ?? null,
    durationMs: record.durationMs,
    startedAt: record.startedAt ?? record.createdAt,
    finishedAt: record.finishedAt ?? record.createdAt,
    attemptNo: record.attemptNo ?? 1,
    replayParentExecutionId: record.replayParentExecutionId ?? null,
    createdAt: record.createdAt,
    runtimeJobId: record.runtimeJobId ?? null,
  };
}

function toOpenRow(record: ToolExecutionOpenRecord): typeof toolExecutionRecords.$inferInsert {
  return {
    id: record.id,
    runId: record.runId,
    floorId: record.floorId,
    pageId: record.pageId ?? null,
    deliveryMode: record.deliveryMode ?? "inline",
    callerSlot: record.callerSlot,
    providerId: record.providerId,
    providerType: record.providerType,
    toolName: record.toolName,
    argsJson: record.argsJson,
    resultJson: record.resultJson ?? "null",
    status: record.status ?? "running",
    lifecycleState: "opened",
    commitOutcome: "pending",
    runtimeJobId: record.runtimeJobId ?? null,
    sideEffectLevel: record.sideEffectLevel ?? null,
    errorMessage: null,
    durationMs: 0,
    startedAt: record.startedAt,
    finishedAt: null,
    attemptNo: record.attemptNo,
    replayParentExecutionId: record.replayParentExecutionId ?? null,
    createdAt: record.createdAt,
  };
}

function resolveSortColumn(sortBy: ToolExecutionSortBy | undefined) {
  switch (sortBy) {
    case "finished_at":
      return toolExecutionRecords.finishedAt;
    case "started_at":
      return toolExecutionRecords.startedAt;
    case "created_at":
    default:
      return toolExecutionRecords.createdAt;
  }
}

function buildQueryConditions(query: ToolExecutionRecordQuery): SQL<unknown>[] {
  const conditions: SQL<unknown>[] = [];

  if (query.accountId) {
    conditions.push(eq(sessions.accountId, query.accountId));
  }
  if (query.sessionId) {
    conditions.push(eq(sessions.id, query.sessionId));
  }
  if (query.floorId) {
    conditions.push(eq(toolExecutionRecords.floorId, query.floorId));
  }
  if (query.runId) {
    conditions.push(eq(toolExecutionRecords.runId, query.runId));
  }
  if (query.callerSlot) {
    conditions.push(eq(toolExecutionRecords.callerSlot, query.callerSlot));
  }
  if (query.toolName) {
    conditions.push(eq(toolExecutionRecords.toolName, query.toolName));
  }
  if (query.providerType) {
    conditions.push(eq(toolExecutionRecords.providerType, query.providerType));
  }
  if (query.status) {
    conditions.push(eq(toolExecutionRecords.status, query.status));
  }
  if (query.lifecycleState) {
    conditions.push(eq(toolExecutionRecords.lifecycleState, query.lifecycleState));
  }
  if (query.commitOutcome) {
    conditions.push(eq(toolExecutionRecords.commitOutcome, query.commitOutcome));
  }

  return conditions;
}

export class DrizzleToolExecutionRepository implements ToolExecutionRepository {
  constructor(private readonly db: AppDb | DbExecutor) {}

  async insertMany(records: ExecutedToolCallRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    await this.db
      .insert(toolExecutionRecords)
      .values(records.map(toFinishedRow))
      .onConflictDoNothing()
      .run();
  }

  async open(record: ToolExecutionOpenRecord): Promise<void> {
    await this.db
      .insert(toolExecutionRecords)
      .values(toOpenRow(record))
      .run();
  }

  async finish(recordId: string, patch: ToolExecutionFinishPatch): Promise<void> {
    const updateResult = await this.db
      .update(toolExecutionRecords)
      .set({
        resultJson: patch.resultJson,
        status: patch.status,
        lifecycleState: patch.lifecycleState ?? "finished",
        errorMessage: patch.errorMessage ?? null,
        durationMs: patch.durationMs,
        finishedAt: patch.finishedAt,
      })
      .where(eq(toolExecutionRecords.id, recordId))
      .run();

    if (updateResult.changes !== 1) {
      throw new Error(`Tool execution record '${recordId}' not found while finishing`);
    }
  }

  async markRunCommitOutcome(runId: string, outcome: ToolExecutionCommitOutcome): Promise<number> {
    const updateResult = await this.db
      .update(toolExecutionRecords)
      .set({ commitOutcome: outcome })
      .where(eq(toolExecutionRecords.runId, runId))
      .run();

    return updateResult.changes;
  }

  async findByFloorId(floorId: string): Promise<ExecutedToolCallRecord[]> {
    const rows = await this.db
      .select()
      .from(toolExecutionRecords)
      .where(eq(toolExecutionRecords.floorId, floorId))
      .orderBy(asc(toolExecutionRecords.startedAt), asc(toolExecutionRecords.createdAt));

    return rows.map(toRecord);
  }

  async findByRunId(runId: string): Promise<ExecutedToolCallRecord[]> {
    const rows = await this.db
      .select()
      .from(toolExecutionRecords)
      .where(eq(toolExecutionRecords.runId, runId))
      .orderBy(asc(toolExecutionRecords.startedAt), asc(toolExecutionRecords.createdAt));

    return rows.map(toRecord);
  }

  async query(query: ToolExecutionRecordQuery): Promise<{
    records: ExecutedToolCallRecord[];
    total: number;
  }> {
    const conditions = buildQueryConditions(query);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const sortColumn = resolveSortColumn(query.sortBy);
    const order = query.sortOrder === "desc"
      ? desc(sortColumn)
      : asc(sortColumn);

    const rows = await this.db
      .select({ row: toolExecutionRecords })
      .from(toolExecutionRecords)
      .innerJoin(floors, eq(toolExecutionRecords.floorId, floors.id))
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(where)
      .orderBy(order, asc(toolExecutionRecords.createdAt))
      .limit(limit)
      .offset(offset);

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(toolExecutionRecords)
      .innerJoin(floors, eq(toolExecutionRecords.floorId, floors.id))
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(where);

    return {
      records: rows.map(({ row }) => toRecord(row)),
      total: countRow?.count ?? 0,
    };
  }
}
