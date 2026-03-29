import { and, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { MemoryScope } from "@tavern/shared";

import type { AppDb, DbExecutor } from "../db/client.js";
import { memoryItems } from "../db/schema.js";

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

export class MemoryMaintenanceService {
  constructor(private readonly db: AppDb) {}

  async run(options: MemoryMaintenanceRunOptions = {}): Promise<MemoryMaintenanceRunResult> {
    return this.runWithExecutor(this.db, options);
  }

  runInTransaction(tx: DbExecutor, options: MemoryMaintenanceRunOptions = {}): MemoryMaintenanceRunResult {
    return this.runWithExecutor(tx, options);
  }

  private runWithExecutor(
    executor: MaintenanceExecutor,
    options: MemoryMaintenanceRunOptions,
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
        : this.deprecateActiveBefore(executor, "summary", createdBefore, batchSize, now, scope);
    }

    if (policy.openLoopMaxAgeMs !== undefined && policy.openLoopMaxAgeMs > 0) {
      const createdBefore = now - policy.openLoopMaxAgeMs;
      deprecatedOpenLoop = dryRun
        ? this.countActiveBefore(executor, "open_loop", createdBefore, scope)
        : this.deprecateActiveBefore(executor, "open_loop", createdBefore, batchSize, now, scope);
    }

    if (policy.deprecatedPurgeAgeMs !== undefined && policy.deprecatedPurgeAgeMs > 0) {
      const deprecatedUntouchedBefore = now - policy.deprecatedPurgeAgeMs;
      purged = dryRun
        ? this.countDeprecatedBefore(executor, deprecatedUntouchedBefore, scope)
        : this.purgeDeprecatedBefore(executor, deprecatedUntouchedBefore, batchSize, scope);
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
  ): number {
    let total = 0;

    while (true) {
      const rows = executor
        .select({ id: memoryItems.id })
        .from(memoryItems)
        .where(and(
          ...buildScopeFilters(scope),
          eq(memoryItems.status, "active"),
          eq(memoryItems.type, type),
          lt(memoryItems.createdAt, createdBefore),
        ))
        .limit(batchSize)
        .all();

      const ids = rows.map((row) => row.id);
      if (ids.length === 0) {
        break;
      }

      executor
        .update(memoryItems)
        .set({ status: "deprecated", lifecycleStatus: "deprecated", updatedAt: now })
        .where(inArray(memoryItems.id, ids))
        .run();

      total += ids.length;

      if (ids.length < batchSize) {
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
  ): number {
    let total = 0;

    while (true) {
      const rows = executor
        .select({ id: memoryItems.id })
        .from(memoryItems)
        .where(and(
          ...buildScopeFilters(scope),
          eq(memoryItems.status, "deprecated"),
          lt(memoryItems.updatedAt, deprecatedUntouchedBefore),
        ))
        .limit(batchSize)
        .all();

      const ids = rows.map((row) => row.id);
      if (ids.length === 0) {
        break;
      }

      executor.delete(memoryItems).where(inArray(memoryItems.id, ids)).run();
      total += ids.length;

      if (ids.length < batchSize) {
        break;
      }
    }

    return total;
  }
}
