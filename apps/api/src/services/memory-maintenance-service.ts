import { and, eq, inArray, lt, sql } from "drizzle-orm";

import type { AppDb } from "../db/client.js";
import { memoryItems } from "../db/schema.js";

export type MemoryMaintenancePolicy = {
  /** 将超过该 age 的 summary 标记为 deprecated（按 createdAt 计算）。 */
  summaryMaxAgeMs?: number;
  /** 将超过该 age 的 open_loop 标记为 deprecated（按 createdAt 计算）。 */
  openLoopMaxAgeMs?: number;
  /**
   * 清理超过该 age 的 deprecated 记忆（按 updatedAt 计算，通常等同于 deprecatedAt）。
   *
   * 注意：当前 schema 未单独记录 deprecatedAt，因此这里用 updatedAt 近似表示。
   */
  deprecatedPurgeAgeMs?: number;
};

export type MemoryMaintenanceRunOptions = {
  /** 运行时刻（ms），默认 Date.now() */
  now?: number;
  /** dry-run：仅统计，不写入/删除 */
  dryRun?: boolean;
  /** 批处理大小（默认 500） */
  batchSize?: number;
  /** 清理策略 */
  policy?: MemoryMaintenancePolicy;
};

export type MemoryMaintenanceRunResult = {
  now: number;
  dryRun: boolean;
  batchSize: number;
  policy: MemoryMaintenancePolicy;
  deprecated: {
    summary: number;
    openLoop: number;
    total: number;
  };
  purged: number;
  durationMs: number;
};

export class MemoryMaintenanceService {
  constructor(private readonly db: AppDb) {}

  async run(options: MemoryMaintenanceRunOptions = {}): Promise<MemoryMaintenanceRunResult> {
    const startedAt = Date.now();
    const now = options.now ?? Date.now();
    const dryRun = options.dryRun === true;
    const batchSize = Math.max(1, Math.floor(options.batchSize ?? 500));
    const policy = options.policy ?? {};

    let deprecatedSummary = 0;
    let deprecatedOpenLoop = 0;
    let purged = 0;

    if (policy.summaryMaxAgeMs !== undefined && policy.summaryMaxAgeMs > 0) {
      const createdBefore = now - policy.summaryMaxAgeMs;
      deprecatedSummary = dryRun
        ? await this.countActiveBefore("summary", createdBefore)
        : await this.deprecateActiveBefore("summary", createdBefore, batchSize, now);
    }

    if (policy.openLoopMaxAgeMs !== undefined && policy.openLoopMaxAgeMs > 0) {
      const createdBefore = now - policy.openLoopMaxAgeMs;
      deprecatedOpenLoop = dryRun
        ? await this.countActiveBefore("open_loop", createdBefore)
        : await this.deprecateActiveBefore("open_loop", createdBefore, batchSize, now);
    }

    if (policy.deprecatedPurgeAgeMs !== undefined && policy.deprecatedPurgeAgeMs > 0) {
      const updatedBefore = now - policy.deprecatedPurgeAgeMs;
      purged = dryRun
        ? await this.countDeprecatedBefore(updatedBefore)
        : await this.purgeDeprecatedBefore(updatedBefore, batchSize);
    }

    const durationMs = Date.now() - startedAt;

    return {
      now,
      dryRun,
      batchSize,
      policy,
      deprecated: {
        summary: deprecatedSummary,
        openLoop: deprecatedOpenLoop,
        total: deprecatedSummary + deprecatedOpenLoop,
      },
      purged,
      durationMs,
    };
  }

  private async countActiveBefore(
    type: "summary" | "open_loop",
    createdBefore: number,
  ): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(memoryItems)
      .where(
        and(
          eq(memoryItems.status, "active"),
          eq(memoryItems.type, type),
          lt(memoryItems.createdAt, createdBefore),
        ),
      );

    return row?.count ?? 0;
  }

  private async countDeprecatedBefore(updatedBefore: number): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(memoryItems)
      .where(and(eq(memoryItems.status, "deprecated"), lt(memoryItems.updatedAt, updatedBefore)));

    return row?.count ?? 0;
  }

  private async deprecateActiveBefore(
    type: "summary" | "open_loop",
    createdBefore: number,
    batchSize: number,
    now: number,
  ): Promise<number> {
    let total = 0;

    while (true) {
      const rows = await this.db
        .select({ id: memoryItems.id })
        .from(memoryItems)
        .where(
          and(
            eq(memoryItems.status, "active"),
            eq(memoryItems.type, type),
            lt(memoryItems.createdAt, createdBefore),
          ),
        )
        .limit(batchSize);

      const ids = rows.map((row) => row.id);
      if (ids.length === 0) break;

      await this.db
        .update(memoryItems)
        .set({ status: "deprecated", updatedAt: now })
        .where(inArray(memoryItems.id, ids));

      total += ids.length;

      if (ids.length < batchSize) break;
    }

    return total;
  }

  private async purgeDeprecatedBefore(updatedBefore: number, batchSize: number): Promise<number> {
    let total = 0;

    while (true) {
      const rows = await this.db
        .select({ id: memoryItems.id })
        .from(memoryItems)
        .where(and(eq(memoryItems.status, "deprecated"), lt(memoryItems.updatedAt, updatedBefore)))
        .limit(batchSize);

      const ids = rows.map((row) => row.id);
      if (ids.length === 0) break;

      await this.db.delete(memoryItems).where(inArray(memoryItems.id, ids));

      total += ids.length;

      if (ids.length < batchSize) break;
    }

    return total;
  }
}
