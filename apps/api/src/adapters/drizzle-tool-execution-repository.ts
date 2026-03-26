import { asc, eq } from "drizzle-orm";
import type {
  ExecutedToolCallRecord,
  InstanceSlot,
  ToolExecutionRepository,
} from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import { toolExecutionRecords } from "../db/schema.js";

type ToolExecutionRow = typeof toolExecutionRecords.$inferSelect;

function toRecord(row: ToolExecutionRow): ExecutedToolCallRecord {
  return {
    id: row.id,
    runId: row.runId,
    floorId: row.floorId,
    pageId: row.pageId ?? undefined,
    callerSlot: row.callerSlot as InstanceSlot,
    providerId: row.providerId,
    toolName: row.toolName,
    argsJson: row.argsJson,
    resultJson: row.resultJson,
    status: row.status as ExecutedToolCallRecord["status"],
    errorMessage: row.errorMessage ?? undefined,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
  };
}

function toRow(record: ExecutedToolCallRecord): typeof toolExecutionRecords.$inferInsert {
  return {
    id: record.id,
    runId: record.runId,
    floorId: record.floorId,
    pageId: record.pageId ?? null,
    callerSlot: record.callerSlot,
    providerId: record.providerId,
    toolName: record.toolName,
    argsJson: record.argsJson,
    resultJson: record.resultJson,
    status: record.status,
    errorMessage: record.errorMessage ?? null,
    durationMs: record.durationMs,
    createdAt: record.createdAt,
  };
}

export class DrizzleToolExecutionRepository implements ToolExecutionRepository {
  constructor(private readonly db: AppDb | DbExecutor) {}

  async insertMany(records: ExecutedToolCallRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    await this.db
      .insert(toolExecutionRecords)
      .values(records.map(toRow))
      .run();
  }

  async findByFloorId(floorId: string): Promise<ExecutedToolCallRecord[]> {
    const rows = await this.db
      .select()
      .from(toolExecutionRecords)
      .where(eq(toolExecutionRecords.floorId, floorId))
      .orderBy(asc(toolExecutionRecords.createdAt));

    return rows.map(toRecord);
  }

  async findByRunId(runId: string): Promise<ExecutedToolCallRecord[]> {
    const rows = await this.db
      .select()
      .from(toolExecutionRecords)
      .where(eq(toolExecutionRecords.runId, runId))
      .orderBy(asc(toolExecutionRecords.createdAt));

    return rows.map(toRecord);
  }
}
