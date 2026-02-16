import { and, asc, desc, eq, gte, or, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  MemoryItem,
  MemoryEdge,
  MemoryQuery,
  MemoryRepository,
} from "@tavern/core";
import type { MemoryRelation, MemoryScope, MemoryStatus, MemoryType } from "@tavern/shared";

import type { AppDb } from "../db/client.js";
import { memoryItems, memoryEdges } from "../db/schema.js";

// ── 内部映射 ──────────────────────────────────────────

type MemoryItemRow = typeof memoryItems.$inferSelect;
type MemoryEdgeRow = typeof memoryEdges.$inferSelect;

function toMemoryItem(row: MemoryItemRow): MemoryItem {
  return {
    id: row.id,
    scope: row.scope as MemoryScope,
    scopeId: row.scopeId,
    type: row.type as MemoryType,
    content: parseContent(row.contentJson),
    importance: row.importance,
    confidence: row.confidence,
    sourceFloorId: row.sourceFloorId ?? undefined,
    sourceMessageId: row.sourceMessageId ?? undefined,
    status: row.status as MemoryStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseContent(contentJson: string): string {
  try {
    const parsed = JSON.parse(contentJson);
    // 支持 {"text": "..."} 格式和纯字符串 JSON
    if (typeof parsed === "string") return parsed;
    if (typeof parsed === "object" && parsed !== null && typeof parsed.text === "string") {
      return parsed.text;
    }
    return contentJson;
  } catch {
    return contentJson;
  }
}

function toContentJson(content: string): string {
  return JSON.stringify(content);
}

function toMemoryEdge(row: MemoryEdgeRow): MemoryEdge {
  return {
    id: row.id,
    fromId: row.fromId,
    toId: row.toId,
    relation: row.relation as MemoryRelation,
    createdAt: row.createdAt,
  };
}

// ── Adapter ───────────────────────────────────────────

export class DrizzleMemoryRepository implements MemoryRepository {
  constructor(private readonly db: AppDb) {}

  async findById(id: string): Promise<MemoryItem | null> {
    const [row] = await this.db
      .select()
      .from(memoryItems)
      .where(eq(memoryItems.id, id));

    return row ? toMemoryItem(row) : null;
  }

  async findMany(query: MemoryQuery): Promise<MemoryItem[]> {
    const conditions: SQL[] = [];

    if (query.scope !== undefined) {
      conditions.push(eq(memoryItems.scope, query.scope));
    }
    if (query.scopeId !== undefined) {
      conditions.push(eq(memoryItems.scopeId, query.scopeId));
    }
    if (query.type !== undefined) {
      conditions.push(eq(memoryItems.type, query.type));
    }
    if (query.status !== undefined) {
      conditions.push(eq(memoryItems.status, query.status));
    }
    if (query.minImportance !== undefined) {
      conditions.push(gte(memoryItems.importance, query.minImportance));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // 排序
    const orderColumn =
      query.orderBy === "importance"
        ? memoryItems.importance
        : query.orderBy === "updatedAt"
          ? memoryItems.updatedAt
          : memoryItems.createdAt;

    const orderFn = query.orderDir === "asc" ? asc : desc;

    let builder = this.db
      .select()
      .from(memoryItems)
      .$dynamic();

    if (whereClause) {
      builder = builder.where(whereClause);
    }

    builder = builder.orderBy(orderFn(orderColumn));

    if (query.limit !== undefined) {
      builder = builder.limit(query.limit);
    }

    const rows = await builder;
    return rows.map(toMemoryItem);
  }

  async create(
    item: Omit<MemoryItem, "id" | "createdAt" | "updatedAt">,
  ): Promise<MemoryItem> {
    const now = Date.now();

    const [row] = await this.db
      .insert(memoryItems)
      .values({
        id: nanoid(),
        scope: item.scope,
        scopeId: item.scopeId,
        type: item.type,
        contentJson: toContentJson(item.content),
        importance: item.importance,
        confidence: item.confidence,
        sourceFloorId: item.sourceFloorId ?? null,
        sourceMessageId: item.sourceMessageId ?? null,
        status: item.status,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return toMemoryItem(row!);
  }

  async update(
    id: string,
    patch: Partial<Pick<MemoryItem, "content" | "importance" | "confidence" | "status">>,
  ): Promise<MemoryItem | null> {
    const updates: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (patch.content !== undefined) {
      updates.contentJson = toContentJson(patch.content);
    }
    if (patch.importance !== undefined) {
      updates.importance = patch.importance;
    }
    if (patch.confidence !== undefined) {
      updates.confidence = patch.confidence;
    }
    if (patch.status !== undefined) {
      updates.status = patch.status;
    }

    const [row] = await this.db
      .update(memoryItems)
      .set(updates)
      .where(eq(memoryItems.id, id))
      .returning();

    return row ? toMemoryItem(row) : null;
  }

  async deprecate(id: string): Promise<MemoryItem | null> {
    return this.update(id, { status: "deprecated" as MemoryStatus });
  }

  // ── 关系边操作 ──

  async createEdge(
    edge: Omit<MemoryEdge, "id" | "createdAt">,
  ): Promise<MemoryEdge> {
    const now = Date.now();

    const [row] = await this.db
      .insert(memoryEdges)
      .values({
        id: nanoid(),
        fromId: edge.fromId,
        toId: edge.toId,
        relation: edge.relation,
        createdAt: now,
      })
      .returning();

    return toMemoryEdge(row!);
  }

  async findEdges(itemId: string): Promise<MemoryEdge[]> {
    const rows = await this.db
      .select()
      .from(memoryEdges)
      .where(
        or(
          eq(memoryEdges.fromId, itemId),
          eq(memoryEdges.toId, itemId),
        ),
      );

    return rows.map(toMemoryEdge);
  }
}
