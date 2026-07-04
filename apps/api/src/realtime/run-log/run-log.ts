import type {
  CoreEventBus,
  CoreEventMap,
  FloorRunSnapshot,
  GenerationChunkEvent,
  GenerationCompletedEvent,
  GenerationFailedEvent,
  GenerationStartedEvent,
  RealtimeActiveRunHint,
  RealtimeEventEnvelope,
} from '@tavern/core';

import { RealtimeSequencer } from './sequencer.js';
import {
  RealtimeRunEventBuffer,
  type RealtimeReplayResult,
  type RealtimeRunEventBufferOptions,
  type RealtimeRunWindow,
} from './run-event-buffer.js';

/**
 * RealtimeRunLog（RT2）
 *
 * 订阅 EventBus 上「属于某个 run 且需要可重放」的事件，为其分配连续 `seq`、填上
 * `runId` / `sessionId`，包装成 RT0 的 `RealtimeEventEnvelope` 后写入有界内存 buffer。
 *
 * 与 WsBridge 并列订阅同一 `eventBus`：WsBridge 只做瞬时转发，RunLog 只做「分配序号 + 缓冲」，
 * 互不影响。RT2 不把 buffer 内容推给任何客户端（那是 RT3 的事）。
 */

const FLOOR_RUN_EVENTS = ['floor.run.updated', 'floor.run.completed', 'floor.run.failed'] as const;
const GENERATION_EVENTS = [
  'generation.started',
  'generation.chunk',
  'generation.completed',
  'generation.failed',
] as const;

type FloorRunEventType = (typeof FLOOR_RUN_EVENTS)[number];
type GenerationEventType = (typeof GENERATION_EVENTS)[number];
type GenerationEventPayload =
  | GenerationStartedEvent
  | GenerationChunkEvent
  | GenerationCompletedEvent
  | GenerationFailedEvent;

const DEFAULT_SWEEP_INTERVAL_MS = 15_000;
const MIN_SWEEP_INTERVAL_MS = 1_000;

export interface RealtimeRunLogOptions {
  /** 注入时钟（默认 Date.now），用于信封 timestamp 与 buffer sweep */
  now?: () => number;
  /** buffer 到期释放的扫描周期（ms，默认 15000，最小 1000） */
  sweepIntervalMs?: number;
}

export interface CreateRealtimeRunLogOptions extends RealtimeRunLogOptions {
  /** 透传给内部 buffer 的有界参数 */
  buffer?: RealtimeRunEventBufferOptions;
}

export class RealtimeRunLog {
  /** floorId -> 当前活动 run 的 { runId, sessionId }（由 floor.run.updated 维护） */
  private readonly floorToRun = new Map<string, { runId: string; sessionId: string }>();
  /** runId -> { floorId, sessionId }（floorToRun 的反向索引，供 RT3 鉴权 / DB 兜底定位 floor 用） */
  private readonly runToFloor = new Map<string, { floorId: string; sessionId: string }>();
  /** 新信封的实时订阅者（RT3 ResumeCoordinator 据此把 live 信封路由给已 resume 的连接） */
  private readonly envelopeListeners = new Set<(envelope: RealtimeEventEnvelope) => void>();
  private readonly unsubscribers: Array<() => void> = [];
  private started = false;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  /** 解析不到 runId 的 generation.* 计数（可观测） */
  private unresolvedRunIdCount = 0;
  private readonly now: () => number;
  private readonly sweepIntervalMs: number;

  constructor(
    private readonly eventBus: CoreEventBus,
    private readonly sequencer: RealtimeSequencer,
    private readonly buffer: RealtimeRunEventBuffer,
    options: RealtimeRunLogOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.sweepIntervalMs = Math.max(MIN_SWEEP_INTERVAL_MS, Math.floor(options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS));
  }

  /** 订阅选定事件并启动到期释放定时器 */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;

    for (const eventName of FLOOR_RUN_EVENTS) {
      const handler = (snapshot: FloorRunSnapshot) => {
        this.handleFloorRun(eventName, snapshot);
      };
      this.eventBus.on(eventName, handler);
      this.unsubscribers.push(() => {
        this.eventBus.off(eventName, handler);
      });
    }

    for (const eventName of GENERATION_EVENTS) {
      const handler = (payload: CoreEventMap[typeof eventName]) => {
        this.handleGeneration(eventName, payload);
      };
      this.eventBus.on(eventName, handler);
      this.unsubscribers.push(() => {
        this.eventBus.off(eventName, handler);
      });
    }

    this.sweepTimer = setInterval(() => {
      this.buffer.sweep(this.now());
    }, this.sweepIntervalMs);
    const maybeUnref = this.sweepTimer as unknown as { unref?: () => void };
    if (typeof maybeUnref.unref === 'function') {
      maybeUnref.unref();
    }
  }

  /** 退订并清理定时器 */
  stop(): void {
    if (!this.started) {
      return;
    }
    this.started = false;

    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;

    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /** 取回某个 run 中 seq > lastSeq 的有序信封（RT3 缺口补发数据来源） */
  getEnvelopesSince(runId: string, lastSeq: number): RealtimeReplayResult {
    return this.buffer.getEnvelopesSince(runId, lastSeq);
  }

  /** 返回某个 run 的当前补发窗口 */
  getWindow(runId: string): RealtimeRunWindow | null {
    return this.buffer.getWindow(runId);
  }

  /** 释放某个 run 中 seq <= ackSeq 的已确认前缀（RT3 ack 释放，转发到 buffer） */
  releaseUpTo(runId: string, ackSeq: number): void {
    this.buffer.releaseUpTo(runId, ackSeq);
  }

  /** 由 runId 反查其 floorId（RT3 DB 兜底定位 floor 用）；未知返回 undefined */
  getFloorIdByRunId(runId: string): string | undefined {
    return this.runToFloor.get(runId)?.floorId;
  }

  /** 由 runId 反查内存中已知的 { floorId, sessionId }（RT3 鉴权 / 路由用）；未知返回 undefined */
  getRunMeta(runId: string): { floorId: string; sessionId: string } | undefined {
    const meta = this.runToFloor.get(runId);
    return meta ? { ...meta } : undefined;
  }

  /**
   * 列出当前内存中、与给定 session 相关的活动 run 窗口提示（RT3 session 握手帧 activeRuns）。
   * - 传入 sessionId：仅返回该会话名下的 run。
   * - 不传（admin 全局连接）：返回全部已知 run 窗口。
   */
  listActiveRunHints(sessionId?: string): RealtimeActiveRunHint[] {
    const hints: RealtimeActiveRunHint[] = [];
    for (const window of this.buffer.listWindows()) {
      if (sessionId) {
        const meta = this.runToFloor.get(window.runId);
        if (!meta || meta.sessionId !== sessionId) {
          continue;
        }
      }
      hints.push({ runId: window.runId, minSeq: window.minSeq, maxSeq: window.maxSeq });
    }
    return hints;
  }

  /**
   * 订阅新产生的实时信封（RT3 用于把 live 信封路由到已 resume 的连接）。
   * 返回退订函数。监听器内部异常被吞掉，避免影响 RunLog 主流程。
   */
  onEnvelope(listener: (envelope: RealtimeEventEnvelope) => void): () => void {
    this.envelopeListeners.add(listener);
    return () => {
      this.envelopeListeners.delete(listener);
    };
  }

  /** 解析不到 runId 的 generation.* 累计计数（可观测） */
  get unresolvedCount(): number {
    return this.unresolvedRunIdCount;
  }

  /** 清理指向某个已释放 run 的映射（由 buffer.onRelease 钩子调用） */
  forgetRun(runId: string): void {
    const meta = this.runToFloor.get(runId);
    if (!meta) {
      return;
    }
    // 仅当 floorToRun 仍指向该 runId 时才删除（该 floor 可能已被更新的 run 接管）。
    const current = this.floorToRun.get(meta.floorId);
    if (current && current.runId === runId) {
      this.floorToRun.delete(meta.floorId);
    }
    this.runToFloor.delete(runId);
  }

  private handleFloorRun(type: FloorRunEventType, snapshot: FloorRunSnapshot): void {
    if (snapshot.floorId && snapshot.runId) {
      this.floorToRun.set(snapshot.floorId, { runId: snapshot.runId, sessionId: snapshot.sessionId });
      this.runToFloor.set(snapshot.runId, { floorId: snapshot.floorId, sessionId: snapshot.sessionId });
    }

    this.ingest(type, snapshot, snapshot.runId, snapshot.sessionId);

    if (type === 'floor.run.completed' || type === 'floor.run.failed') {
      this.buffer.markEnded(snapshot.runId);
    }
  }

  private handleGeneration(type: GenerationEventType, payload: GenerationEventPayload): void {
    const floorId = payload.floorId;
    const mapping = floorId ? this.floorToRun.get(floorId) : undefined;

    if (!mapping) {
      // 正常时序下（先 floor.run.updated 后 generation.*）不应发生；记数以便观测。
      this.unresolvedRunIdCount += 1;
      return;
    }

    const sessionId = payload.sessionId ?? mapping.sessionId;
    this.ingest(type, payload, mapping.runId, sessionId);
  }

  private ingest<TType extends keyof CoreEventMap>(
    type: TType,
    payload: CoreEventMap[TType],
    runId: string,
    sessionId: string | undefined,
  ): void {
    const seq = this.sequencer.next(runId);
    const envelope: RealtimeEventEnvelope<TType> = {
      v: 1,
      type,
      seq,
      runId,
      sessionId,
      payload,
      timestamp: this.now(),
    };
    this.buffer.append(envelope);
    this.notifyEnvelope(envelope);
  }

  /** 把新信封广播给所有实时订阅者（RT3 live 路由）；订阅者异常不影响主流程 */
  private notifyEnvelope(envelope: RealtimeEventEnvelope): void {
    if (this.envelopeListeners.size === 0) {
      return;
    }
    for (const listener of this.envelopeListeners) {
      try {
        listener(envelope);
      } catch {
        // 订阅者异常被吞掉，保证日志主流程不受影响
      }
    }
  }
}

/**
 * 装配一个开箱即用的 RealtimeRunLog：内部创建 sequencer 与有界 buffer，并把 buffer 释放钩子
 * 接到 sequencer.reset + 映射清理上。装配处只需 `start()` / `stop()`。
 */
export function createRealtimeRunLog(
  eventBus: CoreEventBus,
  options: CreateRealtimeRunLogOptions = {},
): RealtimeRunLog {
  const sequencer = new RealtimeSequencer();
  let runLog: RealtimeRunLog | undefined;

  const buffer = new RealtimeRunEventBuffer({
    ...options.buffer,
    now: options.buffer?.now ?? options.now,
    onRelease: (runId) => {
      sequencer.reset(runId);
      runLog?.forgetRun(runId);
      options.buffer?.onRelease?.(runId);
    },
  });

  runLog = new RealtimeRunLog(eventBus, sequencer, buffer, options);
  return runLog;
}
