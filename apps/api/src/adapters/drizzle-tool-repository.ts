/**
 * Drizzle Tool Repository
 *
 * 工具调用记录与自定义工具定义的持久化层。
 */

import { eq, and, desc, asc, sql } from "drizzle-orm";
import type { AppDb } from "../db/client.js";
import { messagePages, toolCallRecords, toolDefinitions } from "../db/schema.js";
import type { ToolCallRecord, ToolCallStatus } from "@tavern/core";
import type { InstanceSlot } from "@tavern/core";

// ── ToolCallRecord 持久化 ────────────────────────────

export interface ToolCallRecordInsert {
  id: string;
  pageId: string;
  seq: number;
  callerSlot: string;
  toolName: string;
  argsJson: string;
  resultJson: string;
  status: ToolCallStatus;
  durationMs: number;
  createdAt: number;
}

export interface ToolCallRecordQuery {
  pageId?: string;
  floorId?: string;
  callerSlot?: string;
  status?: ToolCallStatus;
  limit?: number;
  offset?: number;
  sortOrder?: 'asc' | 'desc';
  sortBy?: 'seq' | 'created_at';
}

// ── ToolDefinition 持久化 ────────────────────────────

export type ToolDefinitionRow = typeof toolDefinitions.$inferSelect;

export interface ToolDefinitionInsert {
  id: string;
  name: string;
  description: string;
  parametersJson: string;
  sideEffectLevel: 'none' | 'sandbox' | 'irreversible';
  allowedSlotsJson: string;
  source: 'preset' | 'character' | 'custom';
  sourceId?: string | null;
  enabled?: boolean;
  handlerType: 'script' | 'prompt' | 'delegate';
  handlerJson: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
}

export interface ToolDefinitionQuery {
  accountId?: string;
  source?: string;
  sourceId?: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

// ── DrizzleToolRepository ──────────────────────────

export class DrizzleToolRepository {
  constructor(private readonly db: AppDb) {}

  // ── Tool Call Records ──

  /**
   * 批量插入工具调用记录。
   */
  async insertCallRecords(records: ToolCallRecordInsert[]): Promise<void> {
    if (records.length === 0) return;

    for (const record of records) {
      await this.db.insert(toolCallRecords).values({
        id: record.id,
        pageId: record.pageId,
        seq: record.seq,
        callerSlot: record.callerSlot,
        toolName: record.toolName,
        argsJson: record.argsJson,
        resultJson: record.resultJson,
        status: record.status,
        durationMs: record.durationMs,
        createdAt: record.createdAt,
      });
    }
  }

  /**
   * 按条件查询工具调用记录。
   */
  async queryCallRecords(query: ToolCallRecordQuery): Promise<{
    records: ToolCallRecord[];
    total: number;
  }> {
    const conditions = [];


    if (query.pageId) {
      conditions.push(eq(toolCallRecords.pageId, query.pageId));
    }
    if (query.callerSlot) {
      conditions.push(eq(toolCallRecords.callerSlot, query.callerSlot));
    }
    if (query.status) {
      conditions.push(eq(toolCallRecords.status, query.status));
    }
    if (query.floorId) {
      conditions.push(eq(messagePages.floorId, query.floorId));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const sortColumn = query.sortBy === 'created_at'
      ? toolCallRecords.createdAt
      : toolCallRecords.seq;
    const order = query.sortOrder === 'desc' ? desc(sortColumn) : asc(sortColumn);

    const rows = await this.db
      .select({ row: toolCallRecords })
      .from(toolCallRecords)
      .innerJoin(messagePages, eq(toolCallRecords.pageId, messagePages.id))
      .where(where)
      .orderBy(order, asc(toolCallRecords.seq))
      .limit(limit)
      .offset(offset);

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(toolCallRecords)
      .innerJoin(messagePages, eq(toolCallRecords.pageId, messagePages.id))
      .where(where);

    const total = countRow?.count ?? 0;

    return {
      records: rows.map(({ row }) => ({
        id: row.id,
        pageId: row.pageId,
        seq: row.seq,
        callerSlot: row.callerSlot as InstanceSlot,
        toolName: row.toolName,
        argsJson: row.argsJson,
        resultJson: row.resultJson,
        status: row.status as ToolCallStatus,
        durationMs: row.durationMs,
        createdAt: row.createdAt,
      })),
      total,
    };
  }

  // ── Tool Definitions ──

  /**
   * 插入自定义工具定义。
   */
  async insertDefinition(data: ToolDefinitionInsert): Promise<ToolDefinitionRow> {
    await this.db.insert(toolDefinitions).values({
      id: data.id,
      name: data.name,
      description: data.description,
      parametersJson: data.parametersJson,
      sideEffectLevel: data.sideEffectLevel,
      allowedSlotsJson: data.allowedSlotsJson,
      source: data.source,
      sourceId: data.sourceId ?? null,
      enabled: data.enabled ?? true,
      handlerType: data.handlerType,
      handlerJson: data.handlerJson,
      accountId: data.accountId,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });

    const [row] = await this.db
      .select()
      .from(toolDefinitions)
      .where(eq(toolDefinitions.id, data.id))
      .limit(1);

    return row!;
  }

  /**
   * 按 ID 获取工具定义。
   */
  async getDefinitionById(id: string): Promise<ToolDefinitionRow | null> {
    const [row] = await this.db
      .select()
      .from(toolDefinitions)
      .where(eq(toolDefinitions.id, id))
      .limit(1);

    return row ?? null;
  }

  /**
   * 查询工具定义列表。
   */
  async queryDefinitions(query: ToolDefinitionQuery): Promise<{
    definitions: ToolDefinitionRow[];
    total: number;
  }> {
    const conditions = [];

    if (query.accountId) {
      conditions.push(eq(toolDefinitions.accountId, query.accountId));
    }
    if (query.source) {
      conditions.push(eq(toolDefinitions.source, query.source as 'preset' | 'character' | 'custom'));
    }
    if (query.sourceId) {
      conditions.push(eq(toolDefinitions.sourceId, query.sourceId));
    }
    if (query.enabled !== undefined) {
      conditions.push(eq(toolDefinitions.enabled, query.enabled));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const definitions = await this.db
      .select()
      .from(toolDefinitions)
      .where(where)
      .orderBy(desc(toolDefinitions.updatedAt))
      .limit(limit)
      .offset(offset);

    const [countRow] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(toolDefinitions)
      .where(where);

    return {
      definitions,
      total: countRow?.count ?? 0,
    };
  }

  /**
   * 更新工具定义。
   */
  async updateDefinition(
    id: string,
    data: Partial<Omit<ToolDefinitionInsert, 'id' | 'createdAt'>>,
  ): Promise<ToolDefinitionRow | null> {
    const existing = await this.getDefinitionById(id);
    if (!existing) return null;

    await this.db
      .update(toolDefinitions)
      .set({
        ...data,
        updatedAt: Date.now(),
      })
      .where(eq(toolDefinitions.id, id));

    return this.getDefinitionById(id);
  }

  /**
   * 删除工具定义。
   */
  async deleteDefinition(id: string): Promise<boolean> {
    const result = await this.db
      .delete(toolDefinitions)
      .where(eq(toolDefinitions.id, id));

    return (result.changes ?? 0) > 0;
  }

  /**
   * 启用/禁用工具定义。
   */
  async toggleDefinition(id: string, enabled: boolean): Promise<ToolDefinitionRow | null> {
    return this.updateDefinition(id, { enabled });
  }
}
