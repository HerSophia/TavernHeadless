import { and, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { CoreEventBus, MemoryMutationSource } from "@tavern/core";
import type { MemoryScope } from "@tavern/shared";

import type { AppDb, DbExecutor } from "../db/client.js";
import { memoryEdges, memoryItems } from "../db/schema.js";
import {
  createEventContextResolver,
  queueMemoryDeletedEvent,
  queueMemoryDeprecatedEvent,
  queueMemoryEdgeDeletedEvent,
} from "./manual-memory-mutation-service.js";
import {
  emitPendingCoreEvents,
  type PendingCoreEvent,
} from "./memory-transaction-mutations.js";

type MemoryItemRow = typeof memoryItems.$inferSelect;
type MemoryEdgeRow = typeof memoryEdges.$inferSelect;

export type MemoryMaintenancePolicy = {
  /** 将超过该 age 的 summary 标记为 deprecated（按 createdAt 计算）。 */
  summaryMaxAgeMs?: number;
  /** 将超过该 age 的 open_loop 标记为 deprecated（按 createdAt 计算）。 */
  openLoopMaxAgeMs?: number;
  /**
   * 清理超过该 age 的 deprecated 记忆。
   *
   * 当前以 updatedAt 作为 deprecated 状态下的最后变更时间：
   * - 自动 deprecate 时，会把 updatedAt 置为当前时间
   * - 如果 deprecated 条目之后又被手工更新，purge 计时也会随 updatedAt 顺延
   *
   * 也就是说，这里的语义是“deprecated 且自上次更新后超过 N 天”，
   * 而不是独立 deprecatedAt 字段意义上的“弃用后超过 N 天”。
   */
  deprecatedPurgeAgeMs?: number;
};

export interface MemoryMaintenanceScopeFilter {
  accountId: string;
  scope: MemoryScope;
  scopeId: string;
}

export type MemoryMaintenanceRunOptions = {
  /** 运行时刻（ms），默认 Date.now() */
  now?: number;
  /** dry-run：仅统计，不写入/删除 */
  dryRun?: boolean;
  /** 批处理大小（默认 500） */
  batchSize?: number;
  /** 清理策略 */
  policy?: MemoryMaintenancePolicy;
  /** 可选：只处理单个 scope。 */
  scope?: MemoryMaintenanceScopeFilter;
};

export type MemoryMaintenanceRunResult = {
  now: number;
  dryRun: boolean;
  batchSize: number;
  policy: MemoryMaintenancePolicy;
  scope?: MemoryMaintenanceScopeFilter;
  deprecated: {
    summary: number;
    openLoop: number;
    total: number;
  };
  purged: number;
  durationMs: number;
};

export interface MemoryMaintenanceServiceOptions {
  eventBus?: CoreEventBus;
}

type MaintenanceExecutor = AppDb | DbExecutor;

function buildScopeFilters(scope: MemoryMaintenanceScopeFilter | undefined): SQL[] {
  if (!scope) {
    return [];
  }

  return [
    eq(memoryItems.accountId, scope.accountId),
    eq(memoryItems.scope, scope.scope),
    eq(memoryItems.scopeId, scope.scopeId),
  ];
}

function countRows(executor: MaintenanceExecutor, whereClause: SQL | undefined): number {
  const [row] = whereClause === undefined
    ? executor.select({ count: sql<number>`count(*)` }).from(memoryItems).all()
    : executor.select({ count: sql<number>`count(*)` }).from(memoryItems).where(whereClause).all();

  return row?.count ?? 0;
}

function loadEdgesForItems(
  executor: MaintenanceExecutor,
  accountId: string,
  itemIds: readonly string[],
): MemoryEdgeRow[] {
  if (itemIds.length === 0) {
    return [];
  }

  const uniqueIds = [...new Set(itemIds)];
  return executor
    .select()
    .from(memoryEdges)
    .where(
      and(
        eq(memoryEdges.accountId, accountId),
        or(
          inArray(memoryEdges.fromId, uniqueIds),
          inArray(memoryEdges.toId, uniqueIds),
        ),
      ),
    )
    .all();
}

export class MemoryMaintenanceService {
  private readonly eventBus?: CoreEventBus;

  constructor(
    private readonly db: AppDb,
    options: MemoryMaintenanceServiceOptions = {},
  ) {
    this.eventBus = options.eventBus;
  }

  async run(options: MemoryMaintenanceRunOptions = {}): Promise<MemoryMaintenanceRunResult> {
    const pendingEvents: PendingCoreEvent[] = [];
    const dryRun = options.dryRun === true;
    const result = dryRun
      ? this.runWithExecutor(this.db, options, pendingEvents)
      : this.db.transaction((tx) => this.runWithExecutor(tx, options, pendingEvents));

    if (this.eventBus && pendingEvents.length > 0) {
      await emitPendingCoreEvents(this.eventBus, pendingEvents);
    }

    return result;
  }

  /**
   * Run inside an existing transaction. Events are appended to `pendingEvents` and must
   * be emitted by the caller only after the outer transaction commits durably.
   */
  runInTransaction(
    tx: DbExecutor,
    options: MemoryMaintenanceRunOptions = {},
    pendingEvents: PendingCoreEvent[] = [],
  ): MemoryMaintenanceRunResult {
    return this.runWithExecutor(tx, options, pendingEvents);
  }

  private runWithExecutor(
    executor: MaintenanceExecutor,
    options: MemoryMaintenanceRunOptions,
    pendingEvents: PendingCoreEvent[],
  ): MemoryMaintenanceRunResult {
    const startedAt = Date.now();
    const now = options.now ?? Date.now();
    const dryRun = options.dryRun === true;
    const batchSize = Math.max(1, Math.floor(options.batchSize ?? 500));
    const policy = options.policy ?? {};
    const scope = options.scope;

    let deprecatedSummary = 0;
    let deprecatedOpenLoop = 0;
    let purged = 0;

    if (policy.summaryMaxAgeMs !== undefined && policy.summaryMaxAgeMs > 0) {
      const createdBefore = now - policy.summaryMaxAgeMs;
      deprecatedSummary = dryRun
        ? this.countActiveBefore(executor, "summary", createdBefore, scope)
        : this.deprecateActiveBefore(executor, "summary", createdBefore, batchSize, now, scope, pendingEvents);
    }

    if (policy.openLoopMaxAgeMs !== undefined && policy.openLoopMaxAgeMs > 0) {
      const createdBefore = now - policy.openLoopMaxAgeMs;
      deprecatedOpenLoop = dryRun
        ? this.countActiveBefore(executor, "open_loop", createdBefore, scope)
        : this.deprecateActiveBefore(executor, "open_loop", createdBefore, batchSize, now, scope, pendingEvents);
    }

    if (policy.deprecatedPurgeAgeMs !== undefined && policy.deprecatedPurgeAgeMs > 0) {
      const deprecatedUntouchedBefore = now - policy.deprecatedPurgeAgeMs;
      purged = dryRun
        ? this.countDeprecatedBefore(executor, deprecatedUntouchedBefore, scope)
        : this.purgeDeprecatedBefore(executor, deprecatedUntouchedBefore, batchSize, scope, pendingEvents);
    }

    const durationMs = Date.now() - startedAt;

    return {
      now,
      dryRun,
      batchSize,
      policy,
      ...(scope ? { scope } : {}),
      deprecated: {
        summary: deprecatedSummary,
        openLoop: deprecatedOpenLoop,
        total: deprecatedSummary + deprecatedOpenLoop,
      },
      purged,
      durationMs,
    };
  }

  private countActiveBefore(
    executor: MaintenanceExecutor,
    type: "summary" | "open_loop",
    createdBefore: number,
    scope: MemoryMaintenanceScopeFilter | undefined,
  ): number {
    const whereClause = and(
      ...buildScopeFilters(scope),
      eq(memoryItems.status, "active"),
      eq(memoryItems.type, type),
      lt(memoryItems.createdAt, createdBefore),
    );

    return countRows(executor, whereClause);
  }

  private countDeprecatedBefore(
    executor: MaintenanceExecutor,
    deprecatedUntouchedBefore: number,
    scope: MemoryMaintenanceScopeFilter | undefined,
  ): number {
    const whereClause = and(
      ...buildScopeFilters(scope),
      eq(memoryItems.status, "deprecated"),
      lt(memoryItems.updatedAt, deprecatedUntouchedBefore),
    );

    return countRows(executor, whereClause);
  }

  private deprecateActiveBefore(
    executor: MaintenanceExecutor,
    type: "summary" | "open_loop",
    createdBefore: number,
    batchSize: number,
    now: number,
    scope: MemoryMaintenanceScopeFilter | undefined,
    pendingEvents: PendingCoreEvent[],
  ): number {
    let total = 0;
    const source: MemoryMutationSource = "maintenance";

    while (true) {
      const rows = executor
        .select()
        .from(memoryItems)
        .where(and(
          ...buildScopeFilters(scope),
          eq(memoryItems.status, "active"),
          eq(memoryItems.type, type),
          lt(memoryItems.createdAt, createdBefore),
        ))
        .limit(batchSize)
        .all();

      if (rows.length === 0) {
        break;
      }

      const ids = rows.map((row) => row.id);

      executor
        .update(memoryItems)
        .set({ status: "deprecated", lifecycleStatus: "deprecated", updatedAt: now })
        .where(inArray(memoryItems.id, ids))
        .run();

      // Group rows by accountId so event contexts stay account-isolated.
      const rowsByAccount = new Map<string, MemoryItemRow[]>();
      for (const row of rows) {
        const bucket = rowsByAccount.get(row.accountId) ?? [];
        bucket.push(row);
        rowsByAccount.set(row.accountId, bucket);
      }

      const mutationId = nanoid();

      for (const [accountId, accountRows] of rowsByAccount) {
        const resolver = createEventContextResolver(executor as DbExecutor, accountId);
        for (const beforeRow of accountRows) {
          const afterRow: MemoryItemRow = {
            ...beforeRow,
            status: "deprecated",
            lifecycleStatus: "deprecated",
            updatedAt: now,
          };
          queueMemoryDeprecatedEvent(
            pendingEvents,
            resolver,
            beforeRow,
            afterRow,
            mutationId,
            "maintenance",
            source,
          );
        }
      }

      total += rows.length;

      if (rows.length < batchSize) {
        break;
      }
    }

    return total;
  }

  private purgeDeprecatedBefore(
    executor: MaintenanceExecutor,
    deprecatedUntouchedBefore: number,
    batchSize: number,
    scope: MemoryMaintenanceScopeFilter | undefined,
    pendingEvents: PendingCoreEvent[],
  ): number {
    let total = 0;
    const source: MemoryMutationSource = "maintenance";

    while (true) {
      const rows = executor
        .select()
        .from(memoryItems)
        .where(and(
          ...buildScopeFilters(scope),
          eq(memoryItems.status, "deprecated"),
          lt(memoryItems.updatedAt, deprecatedUntouchedBefore),
        ))
        .limit(batchSize)
        .all();

      if (rows.length === 0) {
        break;
      }

      const ids = rows.map((row) => row.id);

      const rowsByAccount = new Map<string, MemoryItemRow[]>();
      for (const row of rows) {
        const bucket = rowsByAccount.get(row.accountId) ?? [];
        bucket.push(row);
        rowsByAccount.set(row.accountId, bucket);
      }

      const mutationId = nanoid();

      for (const [accountId, accountRows] of rowsByAccount) {
        const accountIds = accountRows.map((row) => row.id);
        const accountRowsById = new Map(accountRows.map((row) => [row.id, row]));
        const relatedEdges = loadEdgesForItems(executor, accountId, accountIds);
        const resolver = createEventContextResolver(executor as DbExecutor, accountId);

        // Delete the items' edges and items themselves for this account.
        executor
          .delete(memoryItems)
          .where(and(
            eq(memoryItems.accountId, accountId),
            inArray(memoryItems.id, accountIds),
          ))
          .run();

        for (const edge of relatedEdges) {
          const sourceItem = accountRowsById.get(edge.fromId) ?? accountRowsById.get(edge.toId) ?? null;
          queueMemoryEdgeDeletedEvent(
            pendingEvents,
            resolver,
            edge,
            mutationId,
            sourceItem,
            source,
          );
        }

        for (const row of accountRows) {
          queueMemoryDeletedEvent(pendingEvents, resolver, row, mutationId, source);
        }
      }

      total += rows.length;

      if (rows.length < batchSize) {
        break;
      }
    }

    return total;
  }
}
