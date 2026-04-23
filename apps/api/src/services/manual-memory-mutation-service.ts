import { and, eq, inArray, ne, or, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  CoreEventBus,
  CoreEventMap,
  MemoryEdge,
  MemoryItem,
  MemoryMutationSource,
} from "@tavern/core";
import { parseBranchMemoryScopeId } from "@tavern/shared";
import type {
  MemoryLifecycleStatus,
  MemoryRelation,
  MemoryScope,
  MemoryStatus,
  MemorySummaryTier,
  MemoryType,
} from "@tavern/shared";

import type { AppDb, DbExecutor } from "../db/client.js";
import { floors, memoryEdges, memoryItems, sessions } from "../db/schema.js";
import { emitPendingCoreEvents, type PendingCoreEvent } from "./memory-transaction-mutations.js";

type MemoryItemRow = typeof memoryItems.$inferSelect;
type MemoryEdgeRow = typeof memoryEdges.$inferSelect;

type OwnedFloorContext = {
  sessionId: string;
  branchId: string;
  floorId: string;
};

type CommittedMemoryTransactionContext = {
  timestamp: number;
  mutationId: string;
  pendingEvents: PendingCoreEvent[];
};

type EventContextResolver = ReturnType<typeof createEventContextResolver>;

export type ManualMemoryMutationServiceErrorCode =
  | "memory_edge_conflict"
  | "memory_edge_node_not_found"
  | "not_found";

export class ManualMemoryMutationServiceError extends Error {
  constructor(
    public readonly statusCode: 404 | 409,
    public readonly code: ManualMemoryMutationServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ManualMemoryMutationServiceError";
  }
}

export interface ManualMemoryMutationServiceOptions {
  eventBus?: CoreEventBus;
  now?: () => number;
}

export interface CreateManualMemoryItemInput {
  accountId: string;
  scope: MemoryScope;
  scopeId: string;
  type: MemoryType;
  summaryTier?: MemorySummaryTier;
  contentJson: string;
  factKey?: string | null;
  importance?: number;
  confidence?: number;
  sourceFloorId?: string;
  sourceMessageId?: string;
  status?: MemoryStatus;
  lifecycleStatus?: MemoryLifecycleStatus;
}

export interface UpdateManualMemoryItemInput {
  accountId: string;
  id: string;
  scope?: MemoryScope;
  scopeId?: string;
  type?: MemoryType;
  summaryTier?: MemorySummaryTier;
  contentJson?: string;
  factKey?: string | null;
  importance?: number;
  confidence?: number;
  sourceFloorId?: string;
  sourceMessageId?: string;
  status?: MemoryStatus;
  lifecycleStatus?: MemoryLifecycleStatus;
}

export interface BatchUpdateManualMemoryItemStatusInput {
  accountId: string;
  ids: readonly string[];
  status: MemoryStatus;
}

export interface DeleteManualMemoryItemInput {
  accountId: string;
  id: string;
}

export interface DeleteManualMemoryItemsInput {
  accountId: string;
  ids: readonly string[];
}

export interface CreateManualMemoryEdgeInput {
  accountId: string;
  fromId: string;
  toId: string;
  relation: MemoryRelation;
}

export interface UpdateManualMemoryEdgeRelationInput {
  accountId: string;
  id: string;
  relation: MemoryRelation;
}

export interface DeleteManualMemoryEdgeInput {
  accountId: string;
  id: string;
}

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

function toCoreMemoryItem(row: MemoryItemRow): MemoryItem {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scopeId,
    type: row.type,
    summaryTier: row.summaryTier ?? undefined,
    content: parseContent(row.contentJson),
    factKey: row.factKey ?? undefined,
    importance: row.importance,
    confidence: row.confidence,
    sourceFloorId: row.sourceFloorId ?? undefined,
    sourceMessageId: row.sourceMessageId ?? undefined,
    status: row.status,
    lifecycleStatus: row.lifecycleStatus ?? toLifecycleStatus(row.status),
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

function toCoreMemoryEdge(row: MemoryEdgeRow): MemoryEdge {
  return {
    id: row.id,
    fromId: row.fromId,
    toId: row.toId,
    relation: row.relation,
    createdAt: row.createdAt,
  };
}

function normalizeFactKey(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolveStoredFactKey(type: MemoryType, value: string | null | undefined): string | null {
  if (type !== "fact") {
    return null;
  }

  return normalizeFactKey(value) ?? null;
}

function toLifecycleStatus(status: MemoryStatus): MemoryLifecycleStatus {
  return status === "deprecated" ? "deprecated" : "active";
}

function resolveStoredStatus(
  status: MemoryStatus | undefined,
  lifecycleStatus: MemoryLifecycleStatus | undefined,
): MemoryStatus {
  if (status !== undefined) {
    return status;
  }

  return lifecycleStatus === "deprecated" ? "deprecated" : "active";
}

function resolveStoredLifecycleStatus(
  status: MemoryStatus,
  lifecycleStatus: MemoryLifecycleStatus | undefined,
): MemoryLifecycleStatus {
  return lifecycleStatus ?? toLifecycleStatus(status);
}

function mapMemoryEdgeWriteError(error: unknown): ManualMemoryMutationServiceError | null {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;

  if (code?.startsWith("SQLITE_CONSTRAINT_FOREIGNKEY")) {
    return new ManualMemoryMutationServiceError(
      404,
      "memory_edge_node_not_found",
      "Memory edge endpoints must reference existing memory items in the current account",
    );
  }

  if (code?.startsWith("SQLITE_CONSTRAINT")) {
    return new ManualMemoryMutationServiceError(
      409,
      "memory_edge_conflict",
      "Memory edge already exists in the current account",
    );
  }

  return null;
}

function findMemoryItemRowById(tx: DbExecutor, accountId: string, id: string): MemoryItemRow | null {
  const row = tx
    .select()
    .from(memoryItems)
    .where(and(eq(memoryItems.accountId, accountId), eq(memoryItems.id, id)))
    .limit(1)
    .all()[0];

  return row ?? null;
}

function findMemoryItemRowsByIds(tx: DbExecutor, accountId: string, ids: readonly string[]): MemoryItemRow[] {
  if (ids.length === 0) {
    return [];
  }

  return tx
    .select()
    .from(memoryItems)
    .where(and(eq(memoryItems.accountId, accountId), inArray(memoryItems.id, [...new Set(ids)])))
    .all();
}

function findMemoryEdgeRowById(tx: DbExecutor, accountId: string, id: string): MemoryEdgeRow | null {
  const row = tx
    .select()
    .from(memoryEdges)
    .where(and(eq(memoryEdges.accountId, accountId), eq(memoryEdges.id, id)))
    .limit(1)
    .all()[0];

  return row ?? null;
}

function findMemoryEdgeRowsByItemIds(tx: DbExecutor, accountId: string, itemIds: readonly string[]): MemoryEdgeRow[] {
  if (itemIds.length === 0) {
    return [];
  }

  const uniqueItemIds = [...new Set(itemIds)];
  return tx
    .select()
    .from(memoryEdges)
    .where(
      and(
        eq(memoryEdges.accountId, accountId),
        or(
          inArray(memoryEdges.fromId, uniqueItemIds),
          inArray(memoryEdges.toId, uniqueItemIds),
        ),
      ),
    )
    .all();
}

function findConflictingMemoryEdge(
  tx: DbExecutor,
  accountId: string,
  input: { fromId: string; toId: string; relation: MemoryRelation },
  excludeId?: string,
): { id: string } | null {
  const filters: SQL[] = [
    eq(memoryEdges.accountId, accountId),
    eq(memoryEdges.fromId, input.fromId),
    eq(memoryEdges.toId, input.toId),
    eq(memoryEdges.relation, input.relation),
  ];

  if (excludeId) {
    filters.push(ne(memoryEdges.id, excludeId));
  }

  const row = tx
    .select({ id: memoryEdges.id })
    .from(memoryEdges)
    .where(and(...filters))
    .limit(1)
    .all()[0];

  return row ?? null;
}

export function createEventContextResolver(tx: DbExecutor, accountId: string) {
  const floorCache = new Map<string, OwnedFloorContext | null>();
  const itemCache = new Map<string, MemoryItemRow | null>();

  const getOwnedFloorContext = (floorId: string): OwnedFloorContext | null => {
    if (floorCache.has(floorId)) {
      return floorCache.get(floorId) ?? null;
    }

    const row = tx
      .select({ floor: floors })
      .from(floors)
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(and(eq(floors.id, floorId), eq(sessions.accountId, accountId)))
      .limit(1)
      .all()[0];

    const resolved = row?.floor
      ? {
          sessionId: row.floor.sessionId,
          branchId: row.floor.branchId,
          floorId: row.floor.id,
        }
      : null;

    floorCache.set(floorId, resolved);
    return resolved;
  };

  const getItemRow = (id: string): MemoryItemRow | null => {
    if (itemCache.has(id)) {
      return itemCache.get(id) ?? null;
    }

    const row = findMemoryItemRowById(tx, accountId, id);
    itemCache.set(id, row);
    return row;
  };

  const resolveScopeContext = (
    scope: MemoryScope,
    scopeId: string,
    fallbackFloorId?: string,
  ): { sessionId?: string; branchId?: string; floorId?: string } => {
    if (scope === "chat") {
      return { sessionId: scopeId, floorId: fallbackFloorId };
    }

    if (scope === "branch") {
      const parsed = parseBranchMemoryScopeId(scopeId);
      return {
        sessionId: parsed?.sessionId,
        branchId: parsed?.branchId,
        floorId: fallbackFloorId,
      };
    }

    const effectiveFloorId = scope === "floor" ? scopeId : fallbackFloorId;
    const ownedFloor = effectiveFloorId ? getOwnedFloorContext(effectiveFloorId) : null;

    return {
      sessionId: ownedFloor?.sessionId,
      branchId: ownedFloor?.branchId,
      floorId: effectiveFloorId ?? undefined,
    };
  };

  const buildItemEventContext = (row: MemoryItemRow, mutationId: string) => {
    const fallbackFloorId = row.scope === "floor" ? row.scopeId : row.sourceFloorId ?? undefined;
    const resolvedScope = resolveScopeContext(row.scope, row.scopeId, fallbackFloorId);

    return {
      mutationId,
      accountId,
      sessionId: resolvedScope.sessionId,
      branchId: resolvedScope.branchId,
      scope: row.scope,
      scopeId: row.scopeId,
      floorId: resolvedScope.floorId,
      sourceJobId: row.sourceJobId ?? undefined,
      entityType: "memory_item" as const,
      entityId: row.id,
    };
  };

  const buildEdgeEventContext = (
    row: MemoryEdgeRow,
    mutationId: string,
    preferredItem?: MemoryItemRow | null,
  ) => {
    const sourceItem = preferredItem ?? getItemRow(row.fromId) ?? getItemRow(row.toId);

    if (!sourceItem) {
      throw new Error(`Memory edge '${row.id}' is missing both endpoint items`);
    }

    const fallbackFloorId = sourceItem.scope === "floor" ? sourceItem.scopeId : sourceItem.sourceFloorId ?? undefined;
    const resolvedScope = resolveScopeContext(sourceItem.scope, sourceItem.scopeId, fallbackFloorId);

    return {
      mutationId,
      accountId,
      sessionId: resolvedScope.sessionId,
      branchId: resolvedScope.branchId,
      scope: sourceItem.scope,
      scopeId: sourceItem.scopeId,
      floorId: resolvedScope.floorId,
      entityType: "memory_edge" as const,
      entityId: row.id,
    };
  };

  return {
    getItemRow,
    buildItemEventContext,
    buildEdgeEventContext,
  };
}

export function pushPendingEvent<K extends keyof CoreEventMap>(
  pendingEvents: PendingCoreEvent[],
  name: K,
  payload: CoreEventMap[K],
): void {
  pendingEvents.push({ name, payload } as PendingCoreEvent);
}

export function queueMemoryCreatedEvent(
  pendingEvents: PendingCoreEvent[],
  resolver: EventContextResolver,
  row: MemoryItemRow,
  mutationId: string,
  source: MemoryMutationSource = "manual",
): void {
  const item = toCoreMemoryItem(row);
  pushPendingEvent(pendingEvents, "memory.created", {
    ...resolver.buildItemEventContext(row, mutationId),
    item,
    after: item,
    source,
  });
}

export function queueMemoryUpdatedEvent(
  pendingEvents: PendingCoreEvent[],
  resolver: EventContextResolver,
  beforeRow: MemoryItemRow,
  afterRow: MemoryItemRow,
  mutationId: string,
  source: MemoryMutationSource = "manual",
): void {
  const before = toCoreMemoryItem(beforeRow);
  const after = toCoreMemoryItem(afterRow);
  pushPendingEvent(pendingEvents, "memory.updated", {
    ...resolver.buildItemEventContext(afterRow, mutationId),
    item: after,
    previousContent: before.content,
    before,
    after,
    source,
  });
}

export function queueMemoryDeprecatedEvent(
  pendingEvents: PendingCoreEvent[],
  resolver: EventContextResolver,
  beforeRow: MemoryItemRow,
  afterRow: MemoryItemRow,
  mutationId: string,
  reason = "manual",
  source: MemoryMutationSource = "manual",
): void {
  const before = toCoreMemoryItem(beforeRow);
  const after = toCoreMemoryItem(afterRow);
  pushPendingEvent(pendingEvents, "memory.deprecated", {
    ...resolver.buildItemEventContext(afterRow, mutationId),
    item: after,
    reason,
    before,
    after,
    source,
  });
}

export function queueMemoryDeletedEvent(
  pendingEvents: PendingCoreEvent[],
  resolver: EventContextResolver,
  row: MemoryItemRow,
  mutationId: string,
  source: MemoryMutationSource = "manual",
): void {
  const item = toCoreMemoryItem(row);
  pushPendingEvent(pendingEvents, "memory.deleted", {
    ...resolver.buildItemEventContext(row, mutationId),
    item,
    before: item,
    source,
  });
}

export function queueMemoryEdgeCreatedEvent(
  pendingEvents: PendingCoreEvent[],
  resolver: EventContextResolver,
  row: MemoryEdgeRow,
  mutationId: string,
  sourceItem?: MemoryItemRow | null,
  source: MemoryMutationSource = "manual",
): void {
  const edge = toCoreMemoryEdge(row);
  pushPendingEvent(pendingEvents, "memory.edge.created", {
    ...resolver.buildEdgeEventContext(row, mutationId, sourceItem),
    edge,
    after: edge,
    source,
  });
}

export function queueMemoryEdgeDeletedEvent(
  pendingEvents: PendingCoreEvent[],
  resolver: EventContextResolver,
  row: MemoryEdgeRow,
  mutationId: string,
  sourceItem?: MemoryItemRow | null,
  source: MemoryMutationSource = "manual",
): void {
  const edge = toCoreMemoryEdge(row);
  pushPendingEvent(pendingEvents, "memory.edge.deleted", {
    ...resolver.buildEdgeEventContext(row, mutationId, sourceItem),
    edge,
    before: edge,
    source,
  });
}

export async function executeCommittedMemoryTransaction<T>(options: {
  db: AppDb;
  eventBus?: CoreEventBus;
  now?: () => number;
  commit: (tx: DbExecutor, context: CommittedMemoryTransactionContext) => T;
}): Promise<T> {
  const pendingEvents: PendingCoreEvent[] = [];
  const timestamp = options.now?.() ?? Date.now();
  const mutationId = nanoid();

  const result = options.db.transaction((tx) => options.commit(tx, {
    timestamp,
    mutationId,
    pendingEvents,
  }));

  if (options.eventBus && pendingEvents.length > 0) {
    await emitPendingCoreEvents(options.eventBus, pendingEvents);
  }

  return result;
}

export class ManualMemoryMutationService {
  private readonly eventBus?: CoreEventBus;
  private readonly now: () => number;

  constructor(
    private readonly db: AppDb,
    options: ManualMemoryMutationServiceOptions = {},
  ) {
    this.eventBus = options.eventBus;
    this.now = options.now ?? (() => Date.now());
  }

  async createItem(input: CreateManualMemoryItemInput): Promise<MemoryItemRow> {
    return executeCommittedMemoryTransaction({
      db: this.db,
      eventBus: this.eventBus,
      now: this.now,
      commit: (tx, context) => {
        const id = nanoid();
        const storedStatus = resolveStoredStatus(input.status, input.lifecycleStatus);
        const storedLifecycleStatus = resolveStoredLifecycleStatus(storedStatus, input.lifecycleStatus);

        tx.insert(memoryItems)
          .values({
            id,
            accountId: input.accountId,
            scope: input.scope,
            scopeId: input.scopeId,
            type: input.type,
            summaryTier: input.type === "summary" ? input.summaryTier ?? null : null,
            contentJson: input.contentJson,
            factKey: resolveStoredFactKey(input.type, input.factKey),
            importance: input.importance ?? 0.5,
            confidence: input.confidence ?? 1,
            sourceFloorId: input.sourceFloorId ?? null,
            sourceMessageId: input.sourceMessageId ?? null,
            status: storedStatus,
            lifecycleStatus: storedLifecycleStatus,
            sourceJobId: null,
            tokenCountEstimate: null,
            lastUsedAt: null,
            coverageStartFloorNo: null,
            coverageEndFloorNo: null,
            derivedFromCount: null,
            createdAt: context.timestamp,
            updatedAt: context.timestamp,
          })
          .run();

        const created = findMemoryItemRowById(tx, input.accountId, id);
        if (!created) {
          throw new Error("Failed to create memory item");
        }

        const resolver = createEventContextResolver(tx, input.accountId);
        queueMemoryCreatedEvent(context.pendingEvents, resolver, created, context.mutationId);
        return created;
      },
    });
  }

  async updateItem(input: UpdateManualMemoryItemInput): Promise<MemoryItemRow | null> {
    return executeCommittedMemoryTransaction({
      db: this.db,
      eventBus: this.eventBus,
      now: this.now,
      commit: (tx, context) => {
        const existing = findMemoryItemRowById(tx, input.accountId, input.id);
        if (!existing) {
          return null;
        }

        const updates: Partial<typeof memoryItems.$inferInsert> = {
          updatedAt: context.timestamp,
        };
        const nextType = input.type ?? existing.type;

        if (input.scope !== undefined) {
          updates.scope = input.scope;
        }

        if (input.scopeId !== undefined) {
          updates.scopeId = input.scopeId;
        }

        if (input.type !== undefined) {
          updates.type = input.type;
        }

        if (nextType === "summary") {
          if (input.summaryTier !== undefined) {
            updates.summaryTier = input.summaryTier;
          }
        } else if (input.type !== undefined || input.summaryTier !== undefined) {
          updates.summaryTier = null;
        }

        if (input.contentJson !== undefined) {
          updates.contentJson = input.contentJson;
        }

        if (input.importance !== undefined) {
          updates.importance = input.importance;
        }

        if (input.confidence !== undefined) {
          updates.confidence = input.confidence;
        }

        if (nextType === "fact") {
          if (input.factKey !== undefined) {
            updates.factKey = resolveStoredFactKey(nextType, input.factKey);
          }
        } else if (input.type !== undefined || input.factKey !== undefined) {
          updates.factKey = null;
        }

        if (input.sourceFloorId !== undefined) {
          updates.sourceFloorId = input.sourceFloorId;
        }

        if (input.sourceMessageId !== undefined) {
          updates.sourceMessageId = input.sourceMessageId;
        }

        if (input.status !== undefined) {
          updates.status = input.status;
        }

        if (input.lifecycleStatus !== undefined) {
          updates.lifecycleStatus = input.lifecycleStatus;
        } else if (input.status !== undefined) {
          updates.lifecycleStatus = toLifecycleStatus(input.status);
        }

        tx.update(memoryItems)
          .set(updates)
          .where(and(eq(memoryItems.id, input.id), eq(memoryItems.accountId, input.accountId)))
          .run();

        const updated = findMemoryItemRowById(tx, input.accountId, input.id);
        if (!updated) {
          return null;
        }

        const resolver = createEventContextResolver(tx, input.accountId);
        if (existing.status !== "deprecated" && updated.status === "deprecated") {
          queueMemoryDeprecatedEvent(context.pendingEvents, resolver, existing, updated, context.mutationId);
        } else {
          queueMemoryUpdatedEvent(context.pendingEvents, resolver, existing, updated, context.mutationId);
        }

        return updated;
      },
    });
  }

  async batchUpdateItemStatus(input: BatchUpdateManualMemoryItemStatusInput): Promise<MemoryItemRow[]> {
    return executeCommittedMemoryTransaction({
      db: this.db,
      eventBus: this.eventBus,
      now: this.now,
      commit: (tx, context) => {
        const existingRows = findMemoryItemRowsByIds(tx, input.accountId, input.ids);
        if (existingRows.length === 0) {
          return [];
        }

        tx.update(memoryItems)
          .set({
            status: input.status,
            lifecycleStatus: toLifecycleStatus(input.status),
            updatedAt: context.timestamp,
          })
          .where(and(eq(memoryItems.accountId, input.accountId), inArray(memoryItems.id, [...input.ids])))
          .run();

        const updatedRows = findMemoryItemRowsByIds(tx, input.accountId, existingRows.map((row) => row.id));
        const existingById = new Map(existingRows.map((row) => [row.id, row]));
        const updatedById = new Map(updatedRows.map((row) => [row.id, row]));
        const resolver = createEventContextResolver(tx, input.accountId);

        for (const row of updatedRows) {
          const existing = existingById.get(row.id);
          if (!existing) {
            continue;
          }

          if (input.status === "deprecated" && existing.status !== "deprecated") {
            queueMemoryDeprecatedEvent(context.pendingEvents, resolver, existing, row, context.mutationId);
          } else {
            queueMemoryUpdatedEvent(context.pendingEvents, resolver, existing, row, context.mutationId);
          }
        }

        return input.ids
          .map((id) => updatedById.get(id))
          .filter((row): row is MemoryItemRow => row !== undefined);
      },
    });
  }

  async deleteItem(input: DeleteManualMemoryItemInput): Promise<MemoryItemRow | null> {
    return executeCommittedMemoryTransaction({
      db: this.db,
      eventBus: this.eventBus,
      now: this.now,
      commit: (tx, context) => {
        const existing = findMemoryItemRowById(tx, input.accountId, input.id);
        if (!existing) {
          return null;
        }

        const relatedEdges = findMemoryEdgeRowsByItemIds(tx, input.accountId, [input.id]);
        const resolver = createEventContextResolver(tx, input.accountId);

        tx.delete(memoryItems)
          .where(and(eq(memoryItems.accountId, input.accountId), eq(memoryItems.id, input.id)))
          .run();

        for (const edge of relatedEdges) {
          queueMemoryEdgeDeletedEvent(context.pendingEvents, resolver, edge, context.mutationId, existing);
        }

        queueMemoryDeletedEvent(context.pendingEvents, resolver, existing, context.mutationId);
        return existing;
      },
    });
  }

  async deleteItems(input: DeleteManualMemoryItemsInput): Promise<MemoryItemRow[]> {
    return executeCommittedMemoryTransaction({
      db: this.db,
      eventBus: this.eventBus,
      now: this.now,
      commit: (tx, context) => {
        const existingRows = findMemoryItemRowsByIds(tx, input.accountId, input.ids);
        if (existingRows.length === 0) {
          return [];
        }

        const existingById = new Map(existingRows.map((row) => [row.id, row]));
        const relatedEdges = findMemoryEdgeRowsByItemIds(tx, input.accountId, existingRows.map((row) => row.id));
        const resolver = createEventContextResolver(tx, input.accountId);

        tx.delete(memoryItems)
          .where(and(eq(memoryItems.accountId, input.accountId), inArray(memoryItems.id, [...existingRows.map((row) => row.id)])))
          .run();

        for (const edge of relatedEdges) {
          const sourceItem = existingById.get(edge.fromId)
            ?? existingById.get(edge.toId)
            ?? resolver.getItemRow(edge.fromId)
            ?? resolver.getItemRow(edge.toId);
          queueMemoryEdgeDeletedEvent(context.pendingEvents, resolver, edge, context.mutationId, sourceItem);
        }

        for (const row of existingRows) {
          queueMemoryDeletedEvent(context.pendingEvents, resolver, row, context.mutationId);
        }

        return input.ids
          .map((id) => existingById.get(id))
          .filter((row): row is MemoryItemRow => row !== undefined);
      },
    });
  }

  async createEdge(input: CreateManualMemoryEdgeInput): Promise<MemoryEdgeRow> {
    try {
      return await executeCommittedMemoryTransaction({
        db: this.db,
        eventBus: this.eventBus,
        now: this.now,
        commit: (tx, context) => {
          const nodeRows = findMemoryItemRowsByIds(tx, input.accountId, [input.fromId, input.toId]);
          const nodesById = new Map(nodeRows.map((row) => [row.id, row]));
          if (!nodesById.has(input.fromId) || !nodesById.has(input.toId)) {
            throw new ManualMemoryMutationServiceError(
              404,
              "memory_edge_node_not_found",
              "Memory edge endpoints must reference existing memory items in the current account",
            );
          }

          const duplicate = findConflictingMemoryEdge(tx, input.accountId, {
            fromId: input.fromId,
            toId: input.toId,
            relation: input.relation,
          });
          if (duplicate) {
            throw new ManualMemoryMutationServiceError(
              409,
              "memory_edge_conflict",
              "Memory edge already exists in the current account",
            );
          }

          const id = nanoid();
          tx.insert(memoryEdges)
            .values({
              id,
              accountId: input.accountId,
              fromId: input.fromId,
              toId: input.toId,
              relation: input.relation,
              createdAt: context.timestamp,
            })
            .run();

          const created = findMemoryEdgeRowById(tx, input.accountId, id);
          if (!created) {
            throw new Error("Failed to create memory edge");
          }

          const resolver = createEventContextResolver(tx, input.accountId);
          queueMemoryEdgeCreatedEvent(
            context.pendingEvents,
            resolver,
            created,
            context.mutationId,
            nodesById.get(input.fromId) ?? nodesById.get(input.toId) ?? null,
          );

          return created;
        },
      });
    } catch (error) {
      if (error instanceof ManualMemoryMutationServiceError) {
        throw error;
      }

      const mapped = mapMemoryEdgeWriteError(error);
      if (mapped) {
        throw mapped;
      }

      throw error;
    }
  }

  async updateEdgeRelation(input: UpdateManualMemoryEdgeRelationInput): Promise<MemoryEdgeRow | null> {
    try {
      return await executeCommittedMemoryTransaction({
        db: this.db,
        eventBus: this.eventBus,
        now: this.now,
        commit: (tx, context) => {
          const existing = findMemoryEdgeRowById(tx, input.accountId, input.id);
          if (!existing) {
            return null;
          }

          const nodeRows = findMemoryItemRowsByIds(tx, input.accountId, [existing.fromId, existing.toId]);
          const nodesById = new Map(nodeRows.map((row) => [row.id, row]));
          if (!nodesById.has(existing.fromId) || !nodesById.has(existing.toId)) {
            throw new ManualMemoryMutationServiceError(
              404,
              "memory_edge_node_not_found",
              "Memory edge endpoints must reference existing memory items in the current account",
            );
          }

          const duplicate = findConflictingMemoryEdge(
            tx,
            input.accountId,
            {
              fromId: existing.fromId,
              toId: existing.toId,
              relation: input.relation,
            },
            existing.id,
          );
          if (duplicate) {
            throw new ManualMemoryMutationServiceError(
              409,
              "memory_edge_conflict",
              "Memory edge already exists in the current account",
            );
          }

          tx.update(memoryEdges)
            .set({ relation: input.relation })
            .where(and(eq(memoryEdges.accountId, input.accountId), eq(memoryEdges.id, input.id)))
            .run();

          const updated = findMemoryEdgeRowById(tx, input.accountId, input.id);
          if (!updated) {
            return null;
          }

          const resolver = createEventContextResolver(tx, input.accountId);
          const sourceItem = nodesById.get(existing.fromId) ?? nodesById.get(existing.toId) ?? null;
          queueMemoryEdgeDeletedEvent(context.pendingEvents, resolver, existing, context.mutationId, sourceItem);
          queueMemoryEdgeCreatedEvent(context.pendingEvents, resolver, updated, context.mutationId, sourceItem);
          return updated;
        },
      });
    } catch (error) {
      if (error instanceof ManualMemoryMutationServiceError) {
        throw error;
      }

      const mapped = mapMemoryEdgeWriteError(error);
      if (mapped) {
        throw mapped;
      }

      throw error;
    }
  }

  async deleteEdge(input: DeleteManualMemoryEdgeInput): Promise<MemoryEdgeRow | null> {
    return executeCommittedMemoryTransaction({
      db: this.db,
      eventBus: this.eventBus,
      now: this.now,
      commit: (tx, context) => {
        const existing = findMemoryEdgeRowById(tx, input.accountId, input.id);
        if (!existing) {
          return null;
        }

        const resolver = createEventContextResolver(tx, input.accountId);
        const sourceItem = resolver.getItemRow(existing.fromId) ?? resolver.getItemRow(existing.toId);

        tx.delete(memoryEdges)
          .where(and(eq(memoryEdges.accountId, input.accountId), eq(memoryEdges.id, input.id)))
          .run();

        queueMemoryEdgeDeletedEvent(context.pendingEvents, resolver, existing, context.mutationId, sourceItem);
        return existing;
      },
    });
  }
}
