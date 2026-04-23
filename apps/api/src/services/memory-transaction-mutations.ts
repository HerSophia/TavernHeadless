import { and, asc, desc, eq, gte, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  CoreEventBus,
  CoreEventMap,
  MemoryConsolidationOutput,
  MemoryIngestOutput,
  MemoryCompactionOutput,
  MemoryItem,
  MemoryMutationEvent,
  MemoryQuery,
} from "@tavern/core";
import {
  MemoryMutationApplier,
  MemoryScopeResolver,
  type MemoryScopeResolutionContext,
} from "@tavern/core";
import type {
  MemoryLifecycleStatus,
  MemoryRelation,
  MemoryScope,
  MemoryStatus,
  MemorySummaryTier,
} from "@tavern/shared";

import type { DbExecutor } from "../db/client.js";
import { memoryEdges, memoryItems } from "../db/schema.js";

export type PendingCoreEvent = {
  [K in keyof CoreEventMap]: {
    name: K;
    payload: CoreEventMap[K];
  };
}[keyof CoreEventMap];

export interface TransactionalMemoryMutationInput {
  tx: DbExecutor;
  accountId: string;
  timestamp: number;
  pendingEvents: PendingCoreEvent[];
  mutationId?: string;
  summaries?: string[];
  consolidationOutput?: MemoryConsolidationOutput;
  ingestOutput?: MemoryIngestOutput;
  compactionOutput?: MemoryCompactionOutput;
  sourceFloorNo?: number;
  sourceJobId?: string;
  compactionSourceIds?: string[];
  defaultScope: MemoryScope;
  defaultScopeId: string;
  scopeContext: MemoryScopeResolutionContext;
  sourceFloorId?: string;
  sourceMessageId?: string;
}

export interface TransactionalMemoryMutationCounts {
  created: number;
  updated: number;
  deprecated: number;
}

type MemoryItemRow = typeof memoryItems.$inferSelect;

type MemoryItemCreateInput = {
  scope: MemoryScope;
  scopeId: string;
  type: MemoryItem["type"];
  content: string;
  factKey?: string;
  importance: number;
  confidence: number;
  sourceFloorId?: string;
  sourceMessageId?: string;
  status: MemoryItem["status"];
  summaryTier?: MemoryItem["summaryTier"];
  lifecycleStatus?: MemoryItem["lifecycleStatus"];
  sourceJobId?: MemoryItem["sourceJobId"];
  tokenCountEstimate?: MemoryItem["tokenCountEstimate"];
  lastUsedAt?: MemoryItem["lastUsedAt"];
  coverageStartFloorNo?: MemoryItem["coverageStartFloorNo"];
  coverageEndFloorNo?: MemoryItem["coverageEndFloorNo"];
  derivedFromCount?: MemoryItem["derivedFromCount"];
};

type MemoryUpdatePatch = Partial<
  Pick<MemoryItem, "content" | "factKey" | "importance" | "confidence" | "status" | "lifecycleStatus">
>;

function parseContent(contentJson: string): string {
  try {
    const parsed = JSON.parse(contentJson);
    if (typeof parsed === "string") {
      return parsed;
    }

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

function normalizeFactKey(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function toLifecycleStatus(status: MemoryStatus): MemoryLifecycleStatus {
  return status === "deprecated" ? "deprecated" : "active";
}

function resolveLifecycleStatus(
  status: MemoryStatus,
  lifecycleStatus: MemoryLifecycleStatus | undefined,
): MemoryLifecycleStatus {
  return lifecycleStatus ?? toLifecycleStatus(status);
}

function toMemoryOrderByColumn(orderBy: MemoryQuery["orderBy"] | undefined) {
  if (orderBy === "importance") {
    return memoryItems.importance;
  }

  return orderBy === "updatedAt" ? memoryItems.updatedAt : memoryItems.createdAt;
}

function toMemoryItem(row: MemoryItemRow): MemoryItem {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scopeId,
    type: row.type,
    content: parseContent(row.contentJson),
    summaryTier: (row.summaryTier as MemorySummaryTier | null) ?? undefined,
    factKey: row.factKey ?? undefined,
    importance: row.importance,
    confidence: row.confidence,
    sourceFloorId: row.sourceFloorId ?? undefined,
    sourceMessageId: row.sourceMessageId ?? undefined,
    status: row.status,
    lifecycleStatus: (row.lifecycleStatus as MemoryLifecycleStatus | null) ?? toLifecycleStatus(row.status),
    sourceJobId: row.sourceJobId ?? undefined,
    tokenCountEstimate: row.tokenCountEstimate ?? undefined,
    lastUsedAt: row.lastUsedAt ?? undefined,
    coverageStartFloorNo: row.coverageStartFloorNo ?? undefined,
    coverageEndFloorNo: row.coverageEndFloorNo ?? undefined,
    derivedFromCount: row.derivedFromCount ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function findMemoryItemById(tx: DbExecutor, id: string, accountId: string): MemoryItem | null {
  const row = tx
    .select()
    .from(memoryItems)
    .where(and(eq(memoryItems.id, id), eq(memoryItems.accountId, accountId)))
    .limit(1)
    .all()[0];

  return row ? toMemoryItem(row) : null;
}

function findManyMemoryItems(tx: DbExecutor, query: MemoryQuery, accountId: string): MemoryItem[] {
  const conditions: SQL[] = [eq(memoryItems.accountId, accountId)];

  if (query.scope !== undefined) {
    conditions.push(eq(memoryItems.scope, query.scope));
  }

  if (query.scopeId !== undefined) {
    conditions.push(eq(memoryItems.scopeId, query.scopeId));
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

  let builder = tx
    .select()
    .from(memoryItems)
    .where(and(...conditions))
    .$dynamic();

  builder = builder.orderBy((query.orderDir === "asc" ? asc : desc)(toMemoryOrderByColumn(query.orderBy)));

  if (query.limit !== undefined) {
    builder = builder.limit(query.limit);
  }

  return builder.all().map(toMemoryItem);
}

function createMemoryItem(
  tx: DbExecutor,
  input: MemoryItemCreateInput,
  accountId: string,
  timestamp: number,
): MemoryItem {
  const id = nanoid();
  const factKey = input.type === "fact" ? normalizeFactKey(input.factKey) : undefined;
  const lifecycleStatus = resolveLifecycleStatus(input.status, input.lifecycleStatus);

  tx.insert(memoryItems)
    .values({
      id,
      accountId,
      scope: input.scope,
      scopeId: input.scopeId,
      type: input.type,
      summaryTier: input.type === "summary" ? input.summaryTier ?? null : null,
      contentJson: toContentJson(input.content),
      factKey: factKey ?? null,
      importance: input.importance,
      confidence: input.confidence,
      sourceFloorId: input.sourceFloorId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      status: input.status,
      lifecycleStatus,
      sourceJobId: input.sourceJobId ?? null,
      tokenCountEstimate: input.tokenCountEstimate ?? null,
      lastUsedAt: input.lastUsedAt ?? null,
      coverageStartFloorNo: input.type === "summary" ? input.coverageStartFloorNo ?? null : null,
      coverageEndFloorNo: input.type === "summary" ? input.coverageEndFloorNo ?? null : null,
      derivedFromCount: input.type === "summary" ? input.derivedFromCount ?? null : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  return {
    id,
    scope: input.scope,
    scopeId: input.scopeId,
    type: input.type,
    content: input.content,
    summaryTier: input.type === "summary" ? input.summaryTier : undefined,
    factKey,
    importance: input.importance,
    confidence: input.confidence,
    sourceFloorId: input.sourceFloorId,
    sourceMessageId: input.sourceMessageId,
    status: input.status,
    lifecycleStatus,
    sourceJobId: input.sourceJobId,
    tokenCountEstimate: input.tokenCountEstimate,
    lastUsedAt: input.lastUsedAt,
    coverageStartFloorNo: input.type === "summary" ? input.coverageStartFloorNo : undefined,
    coverageEndFloorNo: input.type === "summary" ? input.coverageEndFloorNo : undefined,
    derivedFromCount: input.type === "summary" ? input.derivedFromCount : undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function updateMemoryItem(
  tx: DbExecutor,
  id: string,
  patch: MemoryUpdatePatch,
  accountId: string,
  timestamp: number,
): MemoryItem | null {
  const existing = findMemoryItemById(tx, id, accountId);
  if (!existing) {
    return null;
  }

  const factKey = normalizeFactKey(patch.factKey);

  const updates: Partial<typeof memoryItems.$inferInsert> = {
    updatedAt: timestamp,
  };

  if (patch.content !== undefined) {
    updates.contentJson = toContentJson(patch.content);
  }

  if (patch.factKey !== undefined) {
    updates.factKey = factKey ?? null;
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

  const updateResult = tx.update(memoryItems)
    .set(updates)
    .where(and(eq(memoryItems.id, id), eq(memoryItems.accountId, accountId)))
    .run();
  if (updateResult.changes !== 1) {
    return null;
  }

  return {
    ...existing,
    content: patch.content ?? existing.content,
    factKey: patch.factKey !== undefined ? factKey : existing.factKey,
    importance: patch.importance ?? existing.importance,
    confidence: patch.confidence ?? existing.confidence,
    status: patch.status ?? existing.status,
    lifecycleStatus: patch.lifecycleStatus
      ?? (patch.status !== undefined ? toLifecycleStatus(patch.status) : existing.lifecycleStatus),
    updatedAt: timestamp,
  };
}

function deprecateMemoryItem(tx: DbExecutor, id: string, accountId: string, timestamp: number): MemoryItem | null {
  return updateMemoryItem(tx, id, { status: "deprecated" }, accountId, timestamp);
}

function createMemoryEdge(
  tx: DbExecutor,
  fromId: string,
  toId: string,
  relation: MemoryRelation,
  accountId: string,
  timestamp: number,
): { id: string; fromId: string; toId: string; relation: MemoryRelation; createdAt: number } {
  const id = nanoid();
  tx.insert(memoryEdges)
    .values({
      id,
      accountId,
      fromId,
      toId,
      relation,
      createdAt: timestamp,
    })
    .run();

  return {
    id,
    fromId,
    toId,
    relation,
    createdAt: timestamp,
  };
}

function unwrapSyncResult<T>(value: T | Promise<T>): T {
  if (value && typeof value === "object" && typeof (value as Promise<T>).then === "function") {
    throw new Error("Expected synchronous memory mutation execution inside database transaction");
  }

  return value as T;
}

function createTransactionMemoryMutationApplier(args: {
  tx: DbExecutor;
  accountId: string;
  timestamp: number;
  pendingEvents: PendingCoreEvent[];
}): MemoryMutationApplier {
  return new MemoryMutationApplier(
    {
      findById: (id) => findMemoryItemById(args.tx, id, args.accountId),
      findMany: (query) => findManyMemoryItems(args.tx, query, args.accountId),
      create: (item) => createMemoryItem(args.tx, item, args.accountId, args.timestamp),
      update: (id, patch) => updateMemoryItem(args.tx, id, patch, args.accountId, args.timestamp),
      deprecate: (id) => deprecateMemoryItem(args.tx, id, args.accountId, args.timestamp),
      createEdge: (edge) => createMemoryEdge(
        args.tx,
        edge.fromId,
        edge.toId,
        edge.relation,
        args.accountId,
        args.timestamp,
      ),
    },
    new MemoryScopeResolver(),
    (event: MemoryMutationEvent) => {
      args.pendingEvents.push(event as PendingCoreEvent);
    },
  );
}

export function applyTransactionalMemoryMutations(
  input: TransactionalMemoryMutationInput,
): TransactionalMemoryMutationCounts {
  const applier = createTransactionMemoryMutationApplier({
    tx: input.tx,
    accountId: input.accountId,
    timestamp: input.timestamp,
    pendingEvents: input.pendingEvents,
  });

  let created = 0;
  let updated = 0;
  let deprecated = 0;

  const mutationId = input.mutationId ?? nanoid();

  const summaries = input.summaries ?? [];
  if (summaries.length > 0) {
    const summaryResult = unwrapSyncResult(applier.ingestSummaries({
      summaries,
      defaultScope: input.defaultScope,
      defaultScopeId: input.defaultScopeId,
      context: input.scopeContext,
      sourceFloorId: input.sourceFloorId,
      sourceMessageId: input.sourceMessageId,
      source: "extraction",
      mutationId,
    }));
    created += summaryResult.created;
    updated += summaryResult.updated;
    deprecated += summaryResult.deprecated;
  }

  if (input.ingestOutput) {
    const ingestResult = unwrapSyncResult(applier.applyIngestOutput({
      output: input.ingestOutput,
      defaultScope: input.defaultScope,
      defaultScopeId: input.defaultScopeId,
      context: input.scopeContext,
      sourceFloorId: input.sourceFloorId!,
      sourceFloorNo: input.sourceFloorNo,
      sourceMessageId: input.sourceMessageId,
      sourceJobId: input.sourceJobId,
      mutationId,
    }));
    created += ingestResult.created;
    updated += ingestResult.updated;
    deprecated += ingestResult.deprecated;

    return { created, updated, deprecated };
  }

  if (input.compactionOutput) {
    const compactionResult = unwrapSyncResult(applier.applyCompactionOutput({
      output: input.compactionOutput,
      sourceMicroIds: input.compactionSourceIds ?? [],
      defaultScope: input.defaultScope,
      defaultScopeId: input.defaultScopeId,
      context: input.scopeContext,
      sourceFloorId: input.sourceFloorId,
      sourceJobId: input.sourceJobId,
      mutationId,
    }));
    created += compactionResult.created;
    updated += compactionResult.updated;
    deprecated += compactionResult.deprecated;

    return { created, updated, deprecated };
  }

  if (input.consolidationOutput) {
    const consolidationResult = unwrapSyncResult(applier.applyConsolidation({
      output: input.consolidationOutput,
      defaultScope: input.defaultScope,
      defaultScopeId: input.defaultScopeId,
      context: input.scopeContext,
      sourceFloorId: input.sourceFloorId!,
      sourceMessageId: input.sourceMessageId,
      mutationId,
    }));
    created += consolidationResult.created;
    updated += consolidationResult.updated;
    deprecated += consolidationResult.deprecated;
  }

  return {
    created,
    updated,
    deprecated,
  };
}

export async function emitPendingCoreEvents(
  eventBus: CoreEventBus,
  pendingEvents: PendingCoreEvent[],
): Promise<void> {
  for (const event of pendingEvents) {
    try {
      await eventBus.emit(event.name, event.payload as never);
    } catch {
      // 事务后的事件广播属于 best-effort，不能反向影响已完成的事务。
    }
  }
}
