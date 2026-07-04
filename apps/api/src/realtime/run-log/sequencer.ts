/**
 * RealtimeSequencer（RT2）
 *
 * 为每个 `runId` 维护一个单调递增的实时事件序号，从 1 开始、连续无空洞。
 *
 * 注意：这里的 `seq` 是「实时事件流位置」，与 `FloorRunSnapshot.phaseSeq`（快照修订号）
 * 是两个完全不同的概念，互不复用、互不混用（详见 RT2 设计 §「seq ≠ phaseSeq」）。
 */
export class RealtimeSequencer {
  /** runId -> 已分配的最后一个 seq */
  private readonly counters = new Map<string, number>();

  /** 为指定 run 分配下一个连续序号（从 1 开始） */
  next(runId: string): number {
    const next = (this.counters.get(runId) ?? 0) + 1;
    this.counters.set(runId, next);
    return next;
  }

  /** 返回指定 run 当前已分配的最大 seq；从未分配过返回 0 */
  current(runId: string): number {
    return this.counters.get(runId) ?? 0;
  }

  /** 回收某个 run 的计数（run 释放时调用），避免 map 无限增长 */
  reset(runId: string): void {
    this.counters.delete(runId);
  }

  /** 当前正在跟踪的 run 数量（测试 / 可观测用） */
  get size(): number {
    return this.counters.size;
  }
}
