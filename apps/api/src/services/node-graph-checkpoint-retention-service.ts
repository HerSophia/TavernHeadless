import { and, eq, isNull, lte } from "drizzle-orm";

import type { AppDb } from "../db/client.js";
import { nodeGraphCheckpoints } from "../db/schema.js";

const DEFAULT_CLEANUP_LIMIT = 500;

export interface NodeGraphCheckpointRetentionRunInput {
  now?: number;
  /** 写入后保留多久（ms）再裁剪 checkpoint 的 output_json 正文。 */
  retentionGraceMs?: number;
  /** 单次最多裁剪的 checkpoint 数。 */
  cleanupLimit?: number;
}

export interface NodeGraphCheckpointRetentionRunResult {
  now: number;
  cleaned: number;
}

/**
 * NG2-CORE（批次 9）checkpoint 保留清理。
 *
 * 复用 R6-3 NodeGraph run 清理模式：仅依赖 db；宽限期过后把 checkpoint 的
 * `output_json` 正文裁剪为 null、写 `cleaned_at`，保留结构、hash、phase、scope 供审计；
 * 已清理 checkpoint 不再重复清理。结果只含摘要计数，不含 output 正文。
 *
 * 注意：清理只移除可复用正文（之后该节点重试将 miss 并重算），不删除 checkpoint 行，
 * 因此 input/config hash 与时间戳仍可用于追踪与复用命中率统计。
 */
export class NodeGraphCheckpointRetentionService {
  constructor(private readonly db: AppDb) {}

  run(input: NodeGraphCheckpointRetentionRunInput = {}): NodeGraphCheckpointRetentionRunResult {
    const now = input.now ?? Date.now();
    const retentionGraceMs = Math.max(0, input.retentionGraceMs ?? 0);
    const limit = Math.max(1, input.cleanupLimit ?? DEFAULT_CLEANUP_LIMIT);

    const candidates = this.db
      .select({ id: nodeGraphCheckpoints.id })
      .from(nodeGraphCheckpoints)
      .where(and(
        isNull(nodeGraphCheckpoints.cleanedAt),
        lte(nodeGraphCheckpoints.createdAt, now - retentionGraceMs),
      ))
      .limit(limit)
      .all();

    let cleaned = 0;
    for (const candidate of candidates) {
      this.db
        .update(nodeGraphCheckpoints)
        .set({ outputJson: null, cleanedAt: now, updatedAt: now })
        .where(eq(nodeGraphCheckpoints.id, candidate.id))
        .run();
      cleaned += 1;
    }

    return { now, cleaned };
  }
}
