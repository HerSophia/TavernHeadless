import { and, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import { parseBranchMemoryScopeId, type MemoryScope } from "@tavern/shared";
import type { CoreEventBus, MemoryItem } from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import { memoryItems } from "../db/schema.js";

type MemoryItemRow = typeof memoryItems.$inferSelect;

function rowToMemoryItem(row: MemoryItemRow): MemoryItem {
  // 仅用于 maintenance 事件 payload，因此对 content 解析采取宽松策略：
  // 失败时退回原 string，不影响主路径。
  let content: string;
  try {
    const parsed = JSON.parse(row.contentJson) as unknown;
    if (typeof parsed === "string") {
      content = parsed;
    } else if (parsed && typeof parsed === "object" && "text" in parsed && typeof (parsed as { text: unknown }).text === "string") {
      content = (parsed as { text: string }).text;
    } else {
      content = row.contentJson;
    }
  } catch {
    content = row.contentJson;
  }

  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scopeId,
    type: row.type,
    ...(row.summaryTier ? { summaryTier: row.summaryTier } : {}),
    content,
    ...(row.factKey ? { factKey: row.factKey } : {}),
    importance: row.importance,
    confidence: row.confidence,
    ...(row.sourceFloorId ? { sourceFloorId: row.sourceFloorId } : {}),
    ...(row.sourceMessageId ? { sourceMessageId: row.sourceMessageId } : {}),
    status: row.status,
    ...(row.lifecycleStatus ? { lifecycleStatus: row.lifecycleStatus } : {}),
    ...(row.sourceJobId ? { sourceJobId: row.sourceJobId } : {}),
    ...(row.tokenCountEstimate !== null ? { tokenCountEstimate: row.tokenCountEstimate } : {}),
    ...(row.lastUsedAt !== null ? { lastUsedAt: row.lastUsedAt } : {}),
    ...(row.coverageStartFloorNo !== null ? { coverageStartFloorNo: row.coverageStartFloorNo } : {}),
    ...(row.coverageEndFloorNo !== null ? { coverageEndFloorNo: row.coverageEndFloorNo } : {}),
    ...(row.derivedFromCount !== null ? { derivedFromCount: row.derivedFromCount } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function resolveMaintenanceEventSessionId(item: MemoryItem): string | undefined {
  if (item.scope === "chat") {
    return item.scopeId;
  }
  if (item.scope === "branch") {
    return parseBranchMemoryScopeId(item.scopeId)?.sessionId;
  }
  return undefined;
}

function buildMaintenanceEventContext(item: MemoryItem) {
  return {
    sessionId: resolveMaintenanceEventSessionId(item),
    scope: item.scope,
    scopeId: item.scopeId,
    ...(item.sourceFloorId ? { floorId: item.sourceFloorId } : {}),
  };
}

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
  constructor(
    private readonly db: AppDb,
    private readonly options: { eventBus?: CoreEventBus } = {},
  ) {}

  async run(options: MemoryMaintenanceRunOptions = {}): Promise<MemoryMaintenanceRunResult> {
    // 收集 maintenance affected rows，便于在同步 SQL 完成后按 item
    // 粒度发出 committed 事件（与手动 / 主链 mutation 保持事件面一致）。
    const collected = {
      deprecated: [] as MemoryItem[],
      purged: [] as MemoryItem[],
    };
    const result = this.runWithExecutor(this.db, options, collected);

    if (this.options.eventBus && !options.dryRun) {
      for (const item of collected.deprecated) {
        await this.options.eventBus.emit("memory.deprecated", {
          ...buildMaintenanceEventContext(item),
          item,
          reason: "maintenance",
        });
      }
      for (const item of collected.purged) {
        await this.options.eventBus.emit("memory.deleted", {
          ...buildMaintenanceEventContext(item),
          item,
          source: "maintenance",
          reason: "purge",
        });
      }
    }

    return result;
  }

  /**
   * 在外部事务里同步执行维护。
   *
   * 注意：本入口不会发出 memory.deprecated / memory.deleted 事件——
   * 因为外部事务的 commit 时机由调用方掌控。如果需要事件面，
   * 调用方应在事务成功提交后通过 eventBus 自行 emit。
   */
  runInTransaction(tx: DbExecutor, options: MemoryMaintenanceRunOptions = {}): MemoryMaintenanceRunResult {
    return this.runWithExecutor(tx, options);
  }

  private runWithExecutor(
    executor: MaintenanceExecutor,
    options: MemoryMaintenanceRunOptions,
    collected?: { deprecated: MemoryItem[]; purged: MemoryItem[] },
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
        : this.deprecateActiveBefore(executor, "summary", createdBefore, batchSize, now, scope, collected);
    }

    if (policy.openLoopMaxAgeMs !== undefined && policy.openLoopMaxAgeMs > 0) {
      const createdBefore = now - policy.openLoopMaxAgeMs;
      deprecatedOpenLoop = dryRun
        ? this.countActiveBefore(executor, "open_loop", createdBefore, scope)
        : this.deprecateActiveBefore(executor, "open_loop", createdBefore, batchSize, now, scope, collected);
    }

    if (policy.deprecatedPurgeAgeMs !== undefined && policy.deprecatedPurgeAgeMs > 0) {
      const deprecatedUntouchedBefore = now - policy.deprecatedPurgeAgeMs;
      purged = dryRun
        ? this.countDeprecatedBefore(executor, deprecatedUntouchedBefore, scope)
        : this.purgeDeprecatedBefore(executor, deprecatedUntouchedBefore, batchSize, scope, collected);
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
    collected?: { deprecated: MemoryItem[]; purged: MemoryItem[] },
  ): number {
    let total = 0;

    while (true) {
      // collected!=undefined 时取整行用于事件 payload；否则只取 id 节省 IO
      const rows = collected
        ? executor
            .select()
            .from(memoryItems)
            .where(and(
              ...buildScopeFilters(scope),
              eq(memoryItems.status, "active"),
              eq(memoryItems.type, type),
              lt(memoryItems.createdAt, createdBefore),
            ))
            .limit(batchSize)
            .all()
        : executor
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

      if (collected) {
        for (const row of rows as MemoryItemRow[]) {
          // event 携带 deprecate 后的状态，与单条 deprecate 路径保持一致
          collected.deprecated.push(rowToMemoryItem({
            ...row,
            status: "deprecated",
            lifecycleStatus: "deprecated",
            updatedAt: now,
          }));
        }
      }

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
    collected?: { deprecated: MemoryItem[]; purged: MemoryItem[] },
  ): number {
    let total = 0;

    while (true) {
      // collected!=undefined 时取整行用于 memory.deleted 事件 payload
      const rows = collected
        ? executor
            .select()
            .from(memoryItems)
            .where(and(
              ...buildScopeFilters(scope),
              eq(memoryItems.status, "deprecated"),
              lt(memoryItems.updatedAt, deprecatedUntouchedBefore),
            ))
            .limit(batchSize)
            .all()
        : executor
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

      if (collected) {
        for (const row of rows as MemoryItemRow[]) {
          collected.purged.push(rowToMemoryItem(row));
        }
      }

      if (ids.length < batchSize) {
        break;
      }
    }

    return total;
  }
}
