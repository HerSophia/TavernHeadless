import type { RealtimeEventEnvelope } from '@tavern/core';

/**
 * RealtimeRunEventBuffer（RT2）
 *
 * 按 run 维度组织的有界内存 ring buffer，存储带连续 `seq` 的 `RealtimeEventEnvelope`。
 * 提供「按 seq 区间取回」查询，供 RT3 缺口补发使用。容量三重有界：
 *   - 单 run 最多保留条数（FIFO 淘汰最旧，minSeq 前移）
 *   - 全局最多保留 run 数（超限淘汰最久未活动 / 最早结束的整个 run）
 *   - run 结束后保留一段时间再释放（给 RT3 补发留窗口）
 *
 * 本结构是纯数据结构：不持有定时器。到期释放由外部（RealtimeRunLog）周期调用 `sweep()` 驱动。
 */

const DEFAULT_MAX_EVENTS_PER_RUN = 2000;
const DEFAULT_MAX_RUNS = 256;
const DEFAULT_RETAIN_AFTER_END_MS = 60_000;

export interface RealtimeRunEventBufferOptions {
  /** 单个 run 最多保留的事件条数（默认 2000） */
  maxEventsPerRun?: number;
  /** 全局最多保留的 run 数（默认 256） */
  maxRuns?: number;
  /** run 结束后保留多久再释放（ms，默认 60000） */
  retainAfterEndMs?: number;
  /** 注入时钟（默认 Date.now），便于测试 */
  now?: () => number;
  /** 某个 run 被释放（结束到期 / 超限淘汰）时回调，供回收 sequencer 等 */
  onRelease?: (runId: string) => void;
}

/** 某个 run 当前可补发窗口（对应 RT0 的 RealtimeActiveRunHint，额外带 ended） */
export interface RealtimeRunWindow {
  runId: string;
  /** buffer 中当前最小可补发 seq（淘汰后前移） */
  minSeq: number;
  /** 当前最大 seq */
  maxSeq: number;
  /** run 是否已结束（completed/failed） */
  ended: boolean;
}

/** 区间查询结果（判别联合） */
export type RealtimeReplayResult =
  | {
      /** 正常：返回 lastSeq 之后的有序信封（可能为空表示无缺口） */
      status: 'ok';
      runId: string;
      /** 本次补发的起始 seq（= lastSeq + 1） */
      fromSeq: number;
      /** 本次补发覆盖到的最大 seq（= 当前 maxSeq） */
      toSeq: number;
      envelopes: RealtimeEventEnvelope[];
    }
  | {
      /** 请求起点早于可补发窗口：内存已淘汰，需走 DB 最终态回放（RT3） */
      status: 'evicted';
      runId: string;
      minSeq: number;
      maxSeq: number;
    }
  | {
      /** run 不存在或已被整体释放 */
      status: 'unknown_run';
      runId: string;
    };

interface RunEntry {
  runId: string;
  /** 按 seq 升序的有序事件 */
  events: RealtimeEventEnvelope[];
  minSeq: number;
  maxSeq: number;
  ended: boolean;
  endedAt: number | null;
  lastActivityAt: number;
}

export class RealtimeRunEventBuffer {
  private readonly runs = new Map<string, RunEntry>();
  private readonly maxEventsPerRun: number;
  private readonly maxRuns: number;
  private readonly retainAfterEndMs: number;
  private readonly now: () => number;
  private readonly onRelease?: (runId: string) => void;

  constructor(options: RealtimeRunEventBufferOptions = {}) {
    this.maxEventsPerRun = Math.max(1, Math.floor(options.maxEventsPerRun ?? DEFAULT_MAX_EVENTS_PER_RUN));
    this.maxRuns = Math.max(1, Math.floor(options.maxRuns ?? DEFAULT_MAX_RUNS));
    this.retainAfterEndMs = Math.max(0, Math.floor(options.retainAfterEndMs ?? DEFAULT_RETAIN_AFTER_END_MS));
    this.now = options.now ?? (() => Date.now());
    this.onRelease = options.onRelease;
  }

  /** 当前跟踪的 run 数量（测试 / 可观测用） */
  get runCount(): number {
    return this.runs.size;
  }

  /**
   * 追加一条信封到对应 run。无 `runId` 的信封被忽略（防御，RealtimeRunLog 已过滤）。
   * 超过单 run 条数上限时 FIFO 淘汰最旧，minSeq 随之前移。
   */
  append(envelope: RealtimeEventEnvelope): void {
    const runId = envelope.runId;
    if (!runId) {
      return;
    }

    const nowMs = this.now();
    let entry = this.runs.get(runId);

    if (!entry) {
      if (this.runs.size >= this.maxRuns) {
        this.evictOne();
      }
      entry = {
        runId,
        events: [],
        minSeq: envelope.seq,
        maxSeq: envelope.seq,
        ended: false,
        endedAt: null,
        lastActivityAt: nowMs,
      };
      this.runs.set(runId, entry);
    }

    entry.events.push(envelope);
    entry.maxSeq = envelope.seq;
    entry.lastActivityAt = nowMs;

    while (entry.events.length > this.maxEventsPerRun) {
      entry.events.shift();
    }

    const oldest = entry.events[0];
    entry.minSeq = oldest ? oldest.seq : envelope.seq;
  }

  /**
   * 取回某个 run 中 seq > lastSeq 的有序信封。
   * - run 不存在 → unknown_run
   * - 请求起点早于可补发窗口（lastSeq < minSeq - 1）→ evicted（RT3 走 DB 兜底）
   * - 否则 → ok（envelopes 可能为空，表示客户端已是最新、无缺口）
   */
  getEnvelopesSince(runId: string, lastSeq: number): RealtimeReplayResult {
    const entry = this.runs.get(runId);
    if (!entry) {
      return { status: 'unknown_run', runId };
    }

    if (lastSeq >= entry.maxSeq) {
      return { status: 'ok', runId, fromSeq: entry.maxSeq + 1, toSeq: entry.maxSeq, envelopes: [] };
    }

    if (lastSeq < entry.minSeq - 1) {
      return { status: 'evicted', runId, minSeq: entry.minSeq, maxSeq: entry.maxSeq };
    }

    const envelopes = entry.events.filter((envelope) => envelope.seq > lastSeq);
    return { status: 'ok', runId, fromSeq: lastSeq + 1, toSeq: entry.maxSeq, envelopes };
  }

  /** 返回某个 run 的当前补发窗口；不存在返回 null */
  getWindow(runId: string): RealtimeRunWindow | null {
    const entry = this.runs.get(runId);
    if (!entry) {
      return null;
    }
    return { runId, minSeq: entry.minSeq, maxSeq: entry.maxSeq, ended: entry.ended };
  }

  /** 返回当前所有 run 的补发窗口（供 RT3 session 握手帧组装 activeRuns 用） */
  listWindows(): RealtimeRunWindow[] {
    const windows: RealtimeRunWindow[] = [];
    for (const entry of this.runs.values()) {
      windows.push({ runId: entry.runId, minSeq: entry.minSeq, maxSeq: entry.maxSeq, ended: entry.ended });
    }
    return windows;
  }

  /**
   * 释放某个 run 中 `seq <= ackSeq` 的已确认前缀信封，`minSeq` 前移（RT3 ack 释放）。
   *
   * - run 不存在：no-op。
   * - `ackSeq` 截断到不超过 `maxSeq`（越界确认按 maxSeq 处理）。
   * - 截断后若已无更早可释放的（`ackSeq < minSeq`）：no-op。
   * - 全部释放后 buffer 变空时，`minSeq` 前移到 `maxSeq + 1`，表示「无可补发、下一条从 maxSeq+1 起」。
   *
   * 与 FIFO 容量淘汰不同：这是「客户端已确认 → 主动释放」的前缀裁剪，不删除 run 条目本身
   * （run 可能仍在继续产生事件）。
   */
  releaseUpTo(runId: string, ackSeq: number): void {
    const entry = this.runs.get(runId);
    if (!entry) {
      return;
    }

    const effectiveAck = Math.min(ackSeq, entry.maxSeq);
    if (effectiveAck < entry.minSeq) {
      return;
    }

    let removeCount = 0;
    while (removeCount < entry.events.length && entry.events[removeCount]!.seq <= effectiveAck) {
      removeCount += 1;
    }
    if (removeCount > 0) {
      entry.events.splice(0, removeCount);
    }

    const oldest = entry.events[0];
    entry.minSeq = oldest ? oldest.seq : entry.maxSeq + 1;
    entry.lastActivityAt = this.now();
  }

  /** 标记某个 run 已结束，开始计时；到期后由 sweep() 释放 */
  markEnded(runId: string): void {
    const entry = this.runs.get(runId);
    if (!entry) {
      return;
    }
    const nowMs = this.now();
    entry.ended = true;
    entry.endedAt = nowMs;
    entry.lastActivityAt = nowMs;
  }

  /** 释放所有「已结束且保留期已过」的 run。由外部定时器周期调用 */
  sweep(nowMs: number = this.now()): void {
    const expired: string[] = [];
    for (const [runId, entry] of this.runs) {
      if (entry.ended && entry.endedAt !== null && nowMs - entry.endedAt >= this.retainAfterEndMs) {
        expired.push(runId);
      }
    }
    for (const runId of expired) {
      this.release(runId);
    }
  }

  /** 立即释放某个 run（测试 / 显式回收用） */
  release(runId: string): void {
    if (this.runs.delete(runId)) {
      this.onRelease?.(runId);
    }
  }

  /**
   * 超 maxRuns 时淘汰一个 run：优先淘汰已结束的（按 endedAt 升序），
   * 否则淘汰最久未活动的（按 lastActivityAt 升序）。
   */
  private evictOne(): void {
    let victimId: string | null = null;
    let victimKey: [number, number] | null = null;

    for (const [runId, entry] of this.runs) {
      const key: [number, number] = entry.ended ? [0, entry.endedAt ?? 0] : [1, entry.lastActivityAt];
      if (
        victimKey === null ||
        key[0] < victimKey[0] ||
        (key[0] === victimKey[0] && key[1] < victimKey[1])
      ) {
        victimKey = key;
        victimId = runId;
      }
    }

    if (victimId !== null) {
      this.release(victimId);
    }
  }
}
