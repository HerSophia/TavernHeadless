import { and, asc, desc, eq, gte, or, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  MemoryAccessOptions,
  MemoryEdge,
  MemoryItem,
  MemoryItemUpdatePatch,
  MemoryQuery,
  MemoryRepository,
} from "@tavern/core";
import type {
  MemoryLifecycleStatus,
  MemoryRelation,
  MemoryScope,
  MemoryStatus,
  MemorySummaryTier,
  MemoryType,
} from "@tavern/shared";

import type { AccountContextOptions } from "../accounts/account-context.js";
import { resolveAccountIdOrThrow } from "../accounts/account-context.js";
import type { AppDb, DbExecutor } from "../db/client.js";
import { memoryEdges, memoryItems } from "../db/schema.js";

// ── 内部映射 ──────────────────────────────────────────

type MemoryItemRow = typeof memoryItems.$inferSelect;
type MemoryEdgeRow = typeof memoryEdges.$inferSelect;

function toLifecycleStatus(status: MemoryStatus): MemoryLifecycleStatus {
  return status === "deprecated" ? "deprecated" : "active";
}

function resolveLifecycleStatus(
  status: MemoryStatus,
  lifecycleStatus: MemoryLifecycleStatus | undefined,
): MemoryLifecycleStatus {
  return lifecycleStatus ?? toLifecycleStatus(status);
}

function toMemoryItem(row: MemoryItemRow): MemoryItem {
  return {
    id: row.id,
    scope: row.scope as MemoryScope,
    scopeId: row.scopeId,
    type: row.type as MemoryType,
    content: parseContent(row.contentJson),
    summaryTier: (row.summaryTier as MemorySummaryTier | null) ?? undefined,
    factKey: row.factKey ?? undefined,
    importance: row.importance,
    confidence: row.confidence,
    sourceFloorId: row.sourceFloorId ?? undefined,
    sourceMessageId: row.sourceMessageId ?? undefined,
    status: row.status as MemoryStatus,
    createdAt: row.createdAt,
    lifecycleStatus: (row.lifecycleStatus as MemoryLifecycleStatus | null) ?? toLifecycleStatus(row.status as MemoryStatus),
    sourceJobId: row.sourceJobId ?? undefined,
    tokenCountEstimate: row.tokenCountEstimate ?? undefined,
    lastUsedAt: row.lastUsedAt ?? undefined,
    coverageStartFloorNo: row.coverageStartFloorNo ?? undefined,
    coverageEndFloorNo: row.coverageEndFloorNo ?? undefined,
    derivedFromCount: row.derivedFromCount ?? undefined,
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

function normalizeFactKey(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

// ── Adapter ───────────────────────────────────────────

type DrizzleMemoryRepositoryOptions = AccountContextOptions & {
  accountId?: string;
};

export class DrizzleMemoryRepository implements MemoryRepository {
  private readonly accountContext: AccountContextOptions;
  private readonly configuredAccountId?: string;

  constructor(db: AppDb, options?: string | DrizzleMemoryRepositoryOptions);
  constructor(db: DbExecutor, options?: string | DrizzleMemoryRepositoryOptions);
  constructor(
    private readonly db: AppDb | DbExecutor,
    options?: string | DrizzleMemoryRepositoryOptions,
  ) {
    if (typeof options === "string") {
      this.accountContext = {
        accountMode: "single",
        defaultAccountId: options,
      };
      this.configuredAccountId = options;
      return;
    }

    this.accountContext = {
      accountMode: options?.accountMode,
      defaultAccountId: options?.defaultAccountId,
    };
    this.configuredAccountId = options?.accountId;
  }

  private resolveAccountId(queryAccountId?: string, options?: MemoryAccessOptions): string {
    return resolveAccountIdOrThrow(
      queryAccountId ?? options?.accountId ?? this.configuredAccountId,
      this.accountContext,
    );
  }

  async findById(id: string, options?: MemoryAccessOptions): Promise<MemoryItem | null> {
    const accountId = this.resolveAccountId(undefined, options);
    const [row] = await this.db
      .select()
      .from(memoryItems)
      .where(and(eq(memoryItems.id, id), eq(memoryItems.accountId, accountId)));

    return row ? toMemoryItem(row) : null;
  }

  async findMany(query: MemoryQuery): Promise<MemoryItem[]> {
    const accountId = this.resolveAccountId(query.accountId);
    const conditions: SQL[] = [eq(memoryItems.accountId, accountId)];

    if (query.scopeRefs !== undefined) {
      if (query.scopeRefs.length === 0) {
        return [];
      }

      const scopeConditions = query.scopeRefs.map((scopeRef) => and(
        eq(memoryItems.scope, scopeRef.scope),
        eq(memoryItems.scopeId, scopeRef.scopeId),
      ));

      conditions.push(scopeConditions.length === 1 ? scopeConditions[0]! : or(...scopeConditions)!);
    } else {
      if (query.scope !== undefined) {
        conditions.push(eq(memoryItems.scope, query.scope));
      }
      if (query.scopeId !== undefined) {
        conditions.push(eq(memoryItems.scopeId, query.scopeId));
      }
    }

    if (query.type !== undefined) {
      conditions.push(eq(memoryItems.type, query.type));
    }
    if (query.summaryTier !== undefined) {
      conditions.push(eq(memoryItems.summaryTier, query.summaryTier));
    }
    if (query.lifecycleStatus !== undefined) {
      conditions.push(eq(memoryItems.lifecycleStatus, query.lifecycleStatus));
    }
    if (query.status !== undefined) {
      conditions.push(eq(memoryItems.status, query.status));
    }
    if (query.factKey !== undefined) {
      conditions.push(eq(memoryItems.factKey, normalizeFactKey(query.factKey) ?? query.factKey));
    }
    if (query.minImportance !== undefined) {
      conditions.push(gte(memoryItems.importance, query.minImportance));
    }

    const whereClause = and(...conditions);

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
      .where(whereClause)
      .$dynamic();

    builder = builder.orderBy(orderFn(orderColumn));

    if (query.limit !== undefined) {
      builder = builder.limit(query.limit);
    }

    const rows = await builder;
    return rows.map(toMemoryItem);
  }

  async create(
    item: Omit<MemoryItem, "id" | "createdAt" | "updatedAt">,
    options?: MemoryAccessOptions,
  ): Promise<MemoryItem> {
    const now = Date.now();
    const accountId = this.resolveAccountId(undefined, options);
    const lifecycleStatus = resolveLifecycleStatus(item.status, item.lifecycleStatus);
    const normalizedFactKey = item.type === "fact" ? normalizeFactKey(item.factKey) : undefined;

    const [row] = await this.db
      .insert(memoryItems)
      .values({
        id: nanoid(),
        accountId,
        scope: item.scope,
        scopeId: item.scopeId,
        type: item.type,
        summaryTier: item.type === "summary" ? item.summaryTier ?? null : null,
        factKey: normalizedFactKey ?? null,
        contentJson: toContentJson(item.content),
        importance: item.importance,
        confidence: item.confidence,
        sourceFloorId: item.sourceFloorId ?? null,
        sourceMessageId: item.sourceMessageId ?? null,
        status: item.status,
        lifecycleStatus,
        sourceJobId: item.sourceJobId ?? null,
        tokenCountEstimate: item.tokenCountEstimate ?? null,
        lastUsedAt: item.lastUsedAt ?? null,
        coverageStartFloorNo: item.type === "summary" ? item.coverageStartFloorNo ?? null : null,
        coverageEndFloorNo: item.type === "summary" ? item.coverageEndFloorNo ?? null : null,
        derivedFromCount: item.type === "summary" ? item.derivedFromCount ?? null : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return toMemoryItem(row!);
  }

  async update(
    id: string,
    patch: MemoryItemUpdatePatch,
    options?: MemoryAccessOptions,
  ): Promise<MemoryItem | null> {
    const accountId = this.resolveAccountId(undefined, options);
    const updates: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    // 标量重定位字段：scope / scopeId / type / summaryTier / 源信息
    if (patch.scope !== undefined) {
      updates.scope = patch.scope;
    }
    if (patch.scopeId !== undefined) {
      updates.scopeId = patch.scopeId;
    }
    if (patch.type !== undefined) {
      updates.type = patch.type;
    }
    if (patch.summaryTier !== undefined) {
      updates.summaryTier = patch.summaryTier ?? null;
    }
    if (patch.sourceFloorId !== undefined) {
      updates.sourceFloorId = patch.sourceFloorId ?? null;
    }
    if (patch.sourceMessageId !== undefined) {
      updates.sourceMessageId = patch.sourceMessageId ?? null;
    }

    if (patch.content !== undefined) {
      updates.contentJson = toContentJson(patch.content);
    }
    if (patch.factKey !== undefined) {
      // factKey 可显式 null 来清空；否则归一化非空字符串
      updates.factKey = patch.factKey === null
        ? null
        : (normalizeFactKey(patch.factKey) ?? null);
    }
    if (patch.importance !== undefined) {
      updates.importance = patch.importance;
    }
    if (patch.confidence !== undefined) {
      updates.confidence = patch.confidence;
    }

    if (patch.lifecycleStatus !== undefined) {
      updates.lifecycleStatus = patch.lifecycleStatus;
    }

    if (patch.status !== undefined) {
      updates.status = patch.status;
      if (patch.lifecycleStatus === undefined) {
        updates.lifecycleStatus = toLifecycleStatus(patch.status);
      }
    }

    const [row] = await this.db
      .update(memoryItems)
      .set(updates)
      .where(and(eq(memoryItems.id, id), eq(memoryItems.accountId, accountId)))
      .returning();

    return row ? toMemoryItem(row) : null;
  }

  async deprecate(id: string, options?: MemoryAccessOptions): Promise<MemoryItem | null> {
    return this.update(id, { status: "deprecated" as MemoryStatus }, options);
  }

  // ── 关系边操作 ──

  async createEdge(
    edge: Omit<MemoryEdge, "id" | "createdAt">,
    options?: MemoryAccessOptions,
  ): Promise<MemoryEdge> {
    const now = Date.now();
    const accountId = this.resolveAccountId(undefined, options);

    const [row] = await this.db
      .insert(memoryEdges)
      .values({
        id: nanoid(),
        accountId,
        fromId: edge.fromId,
        toId: edge.toId,
        relation: edge.relation,
        createdAt: now,
      })
      .returning();

    return toMemoryEdge(row!);
  }

  async findEdges(itemId: string, options?: MemoryAccessOptions): Promise<MemoryEdge[]> {
    const accountId = this.resolveAccountId(undefined, options);
    const rows = await this.db
      .select()
      .from(memoryEdges)
      .where(
        and(
          eq(memoryEdges.accountId, accountId),
          or(
            eq(memoryEdges.fromId, itemId),
            eq(memoryEdges.toId, itemId),
          ),
        ),
      );

    return rows.map(toMemoryEdge);
  }
}
