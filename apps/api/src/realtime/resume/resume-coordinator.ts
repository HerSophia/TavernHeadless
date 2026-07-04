import type {
  RealtimeAckControl,
  RealtimeClientFrame,
  RealtimeEventEnvelope,
  RealtimeResumeControl,
  RealtimeServerControl,
  RealtimeServerFrame,
  RealtimeSessionControl,
} from '@tavern/core';

import type { FloorRunRecord } from '../../services/floor-run-service.js';
import type { RealtimeRunLog } from '../run-log/index.js';

const PROTOCOL_VERSION = 1 as const;
const WS_OPEN = 1;

/**
 * RealtimeResumeCoordinator（RT3）
 *
 * 在 RT2 的 per-run 事件日志之上，为 WS 连接补齐「断线补发 + 确认释放」能力：
 *
 * - `session` 握手帧：连接建立后下发协议版本与该连接可见的活动 run 窗口提示。
 * - `resume`（runId + lastSeq）：从内存 buffer 补发缺口信封，再切 live；buffer 已淘汰 / run 已结束
 *   时走 `FloorRunService` 的 DB 最终态兜底回放。
 * - `ack`（runId + ackSeq）：按「该 run 所有订阅连接 ackSeq 的最小值」释放 buffer 已确认前缀。
 *
 * 兼容取舍（见 RT3 设计 §1）：默认连接（未发过 resume）仍走 `WsBridge` 的瞬时 `WsMessage` 转发，
 * 行为不回归。只有发过 `resume` 的连接，其对应 run 的事件才额外以 `RealtimeServerFrame` 信封形态
 * （带 `seq`）下发，新客户端据 `seq` 去重续接。WsBridge 完全不感知本协调器，职责清晰。
 */

/** 协调器所需的最小 socket 能力（与 ws.WebSocket 结构兼容，便于测试用 mock 注入） */
export interface RealtimeSocketLike {
  readyState: number;
  send(data: string): void;
}

/** 一个 WS 连接的归属上下文 */
export interface RealtimeConnectionContext {
  /** 该连接订阅的 sessionId；admin 全局连接为 undefined */
  sessionId?: string;
  /** 是否 admin 全局连接（可见所有 run） */
  isAdmin: boolean;
}

/** 协调器对 FloorRunService 的最小只读依赖（DB 最终态兜底来源） */
export interface FloorRunRecordReader {
  getFloorRunRecordByRunId(runId: string): Promise<FloorRunRecord | null>;
}

export interface RealtimeResumeCoordinatorOptions {
  /** 注入时钟（默认 Date.now），用于 DB 兜底回放信封的 timestamp */
  now?: () => number;
}

type SubscriptionMode = 'resuming' | 'live';

interface RunSubscription {
  socket: RealtimeSocketLike;
  context: RealtimeConnectionContext;
  mode: SubscriptionMode;
  /** 补发期暂存的 live 信封，补发完成后按 seq 顺序 flush（保证不乱序） */
  liveQueue: RealtimeEventEnvelope[];
  /** 已向该连接下发的该 run 最大 seq（去重游标，保证不重复） */
  lastSentSeq: number;
  /** 该连接对该 run 的最新 ackSeq（多连接释放取最小值） */
  ackSeq: number;
}

export class RealtimeResumeCoordinator {
  /** runId -> (socket -> subscription)；只保留已成功转 live 的连接（其余补发/兜底完成即移除） */
  private readonly runSubscriptions = new Map<string, Map<RealtimeSocketLike, RunSubscription>>();
  /** socket -> 其订阅的 runId 集合（供 close 清理） */
  private readonly socketRuns = new Map<RealtimeSocketLike, Set<string>>();
  private readonly unsubscribeEnvelopes: () => void;
  private readonly now: () => number;

  constructor(
    private readonly runLog: RealtimeRunLog,
    private readonly floorRunReader: FloorRunRecordReader,
    options: RealtimeResumeCoordinatorOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.unsubscribeEnvelopes = this.runLog.onEnvelope((envelope) => {
      this.routeLiveEnvelope(envelope);
    });
  }

  /** 连接建立、鉴权通过后下发 session 握手帧（含 activeRuns 窗口提示） */
  sendSessionFrame(socket: RealtimeSocketLike, context: RealtimeConnectionContext): void {
    const frame: RealtimeSessionControl = {
      kind: 'session',
      ...(context.sessionId !== undefined ? { sessionId: context.sessionId } : {}),
      protocolVersion: PROTOCOL_VERSION,
      activeRuns: this.runLog.listActiveRunHints(context.sessionId),
    };
    this.sendFrame(socket, frame);
  }

  /**
   * 处理一条客户端上行原始消息：解析为 `RealtimeClientFrame` 后分派。
   * 非法 JSON / 无法识别的帧：回 `error: 'malformed_control'`，连接不断开。
   */
  handleClientMessage(
    socket: RealtimeSocketLike,
    context: RealtimeConnectionContext,
    raw: string | Buffer,
  ): void {
    let parsed: unknown;
    try {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      parsed = JSON.parse(text);
    } catch {
      this.sendControl(socket, {
        kind: 'error',
        code: 'malformed_control',
        message: 'Control frame is not valid JSON',
      });
      return;
    }

    const frame = parseClientFrame(parsed);
    if (!frame) {
      this.sendControl(socket, {
        kind: 'error',
        code: 'malformed_control',
        message: 'Unrecognized realtime control frame',
      });
      return;
    }

    if (frame.kind === 'resume') {
      void this.handleResume(socket, context, frame);
    } else {
      this.handleAck(socket, frame);
    }
  }

  /** 连接关闭：从协调表移除该 socket 的全部订阅 */
  handleConnectionClose(socket: RealtimeSocketLike): void {
    const runIds = this.socketRuns.get(socket);
    if (!runIds) {
      return;
    }
    for (const runId of runIds) {
      const subs = this.runSubscriptions.get(runId);
      if (subs) {
        subs.delete(socket);
        if (subs.size === 0) {
          this.runSubscriptions.delete(runId);
        }
      }
    }
    this.socketRuns.delete(socket);
  }

  /** 释放对 RunLog 的信封订阅并清空协调表（装配处 onClose 调用） */
  dispose(): void {
    this.unsubscribeEnvelopes();
    this.runSubscriptions.clear();
    this.socketRuns.clear();
  }

  // ── resume ────────────────────────────────────────────

  private async handleResume(
    socket: RealtimeSocketLike,
    context: RealtimeConnectionContext,
    control: RealtimeResumeControl,
  ): Promise<void> {
    const runId = control.runId;
    const lastSeq = Math.max(0, Math.floor(control.lastSeq));

    // 立即进入补发模式：补发期间产生的 live 信封先入队，待补发完成后按序 flush。
    const sub = this.ensureSubscription(runId, socket, context);
    sub.mode = 'resuming';
    sub.liveQueue = [];
    sub.lastSentSeq = lastSeq;

    // 1. 解析 run 归属（先内存，后 DB）。
    const memWindow = this.runLog.getWindow(runId);
    const memMeta = this.runLog.getRunMeta(runId);
    let ownerSessionId = memMeta?.sessionId;
    let dbRecord: FloorRunRecord | null = null;

    if (!memWindow && ownerSessionId === undefined) {
      dbRecord = await this.floorRunReader.getFloorRunRecordByRunId(runId);
      ownerSessionId = dbRecord?.run?.sessionId;
    }

    // 2. 鉴权（admin 可见所有 run；session 连接仅可见同会话的 run）。
    if (!context.isAdmin) {
      if (ownerSessionId === undefined) {
        this.removeSubscription(runId, socket);
        this.sendControl(socket, {
          kind: 'error',
          code: 'unknown_run',
          message: `Unknown run '${runId}'`,
          runId,
        });
        return;
      }
      if (ownerSessionId !== context.sessionId) {
        this.removeSubscription(runId, socket);
        this.sendControl(socket, {
          kind: 'error',
          code: 'resume_rejected',
          message: `Run '${runId}' is not visible to this session`,
          runId,
        });
        return;
      }
    }

    // 3. 命中内存 buffer：补发缺口 → flush live 队列 → 转 live。
    if (memWindow) {
      const replay = this.runLog.getEnvelopesSince(runId, lastSeq);
      if (replay.status === 'ok') {
        this.deliverEnvelopes(sub, replay.envelopes);
        this.flushLiveQueue(sub);
        sub.mode = 'live';
        return;
      }
      // status === 'evicted' / 'unknown_run'（竞态）→ 落到 DB 兜底。
    }

    // 4. DB 最终态兜底回放。
    if (!dbRecord) {
      dbRecord = await this.floorRunReader.getFloorRunRecordByRunId(runId);
    }
    this.replayFromStore(socket, context, runId, dbRecord, memWindow?.maxSeq ?? null);
    this.removeSubscription(runId, socket);
  }

  /**
   * DB 兜底回放：
   * - 无最终态：内存仍有窗口 → `seq_window_evicted`（并补发 session 窗口提示让客户端重新对齐）；
   *   否则 → `unknown_run`。
   * - 仍在运行（status=running）：窗口已不可补，回 `seq_window_evicted` + 窗口提示，等待客户端重新 resume。
   * - 已终结（completed/failed/cancelled）：合成一条最终态快照信封下发；若拿不到曾经的 maxSeq（seq=0）
   *   则附 `error` 说明这是最终态回放、不可继续 resume。
   */
  private replayFromStore(
    socket: RealtimeSocketLike,
    context: RealtimeConnectionContext,
    runId: string,
    record: FloorRunRecord | null,
    knownMaxSeq: number | null,
  ): void {
    const snapshot = record?.run ?? null;

    if (!snapshot) {
      if (knownMaxSeq !== null) {
        this.sendControl(socket, {
          kind: 'error',
          code: 'seq_window_evicted',
          message: `Replay window for run '${runId}' was evicted and no final state is available`,
          runId,
        });
        this.sendSessionFrame(socket, context);
      } else {
        this.sendControl(socket, {
          kind: 'error',
          code: 'unknown_run',
          message: `Unknown run '${runId}'`,
          runId,
        });
      }
      return;
    }

    if (snapshot.status === 'running') {
      this.sendControl(socket, {
        kind: 'error',
        code: 'seq_window_evicted',
        message: `Replay window for run '${runId}' was evicted; re-align from the current window`,
        runId,
      });
      this.sendSessionFrame(socket, context);
      return;
    }

    const finalSeq = knownMaxSeq ?? 0;
    const type: 'floor.run.completed' | 'floor.run.failed' =
      snapshot.status === 'completed' ? 'floor.run.completed' : 'floor.run.failed';
    const envelope: RealtimeEventEnvelope<typeof type> = {
      v: 1,
      type,
      seq: finalSeq,
      runId,
      ...(snapshot.sessionId !== undefined ? { sessionId: snapshot.sessionId } : {}),
      payload: snapshot,
      timestamp: this.now(),
    };
    this.sendFrame(socket, { kind: 'event', envelope });

    if (finalSeq === 0) {
      this.sendControl(socket, {
        kind: 'error',
        code: 'seq_window_evicted',
        message: `Final-state replay for run '${runId}' from store; run already ended and is not resumable`,
        runId,
      });
    }
  }

  // ── ack ───────────────────────────────────────────────

  /**
   * 处理 ack：仅对「已 resume 过该 run」的连接生效（鉴权已在 resume 阶段完成）。
   * 释放阈值取该 run 所有订阅连接 ackSeq 的最小值；越界由 buffer.releaseUpTo 自行截断到 maxSeq。
   */
  private handleAck(socket: RealtimeSocketLike, control: RealtimeAckControl): void {
    const runId = control.runId;
    const ackSeq = Math.max(0, Math.floor(control.ackSeq));

    const subs = this.runSubscriptions.get(runId);
    const sub = subs?.get(socket);
    if (!subs || !sub) {
      // 非订阅者（未对该 run resume）的 ack：best-effort 忽略。
      return;
    }

    sub.ackSeq = Math.max(sub.ackSeq, ackSeq);

    let releaseSeq = Number.POSITIVE_INFINITY;
    for (const candidate of subs.values()) {
      releaseSeq = Math.min(releaseSeq, candidate.ackSeq);
    }

    if (Number.isFinite(releaseSeq) && releaseSeq > 0) {
      this.runLog.releaseUpTo(runId, releaseSeq);
    }
  }

  // ── live 路由 ─────────────────────────────────────────

  private routeLiveEnvelope(envelope: RealtimeEventEnvelope): void {
    const runId = envelope.runId;
    if (!runId) {
      return;
    }
    const subs = this.runSubscriptions.get(runId);
    if (!subs) {
      return;
    }
    for (const sub of subs.values()) {
      if (sub.mode === 'resuming') {
        sub.liveQueue.push(envelope);
        continue;
      }
      if (envelope.seq > sub.lastSentSeq) {
        this.sendFrame(sub.socket, { kind: 'event', envelope });
        sub.lastSentSeq = envelope.seq;
      }
    }
  }

  // ── 内部工具 ──────────────────────────────────────────

  private deliverEnvelopes(sub: RunSubscription, envelopes: RealtimeEventEnvelope[]): void {
    for (const envelope of envelopes) {
      if (envelope.seq > sub.lastSentSeq) {
        this.sendFrame(sub.socket, { kind: 'event', envelope });
        sub.lastSentSeq = envelope.seq;
      }
    }
  }

  private flushLiveQueue(sub: RunSubscription): void {
    if (sub.liveQueue.length > 0) {
      const ordered = [...sub.liveQueue].sort((a, b) => a.seq - b.seq);
      this.deliverEnvelopes(sub, ordered);
    }
    sub.liveQueue = [];
  }

  private ensureSubscription(
    runId: string,
    socket: RealtimeSocketLike,
    context: RealtimeConnectionContext,
  ): RunSubscription {
    let subs = this.runSubscriptions.get(runId);
    if (!subs) {
      subs = new Map();
      this.runSubscriptions.set(runId, subs);
    }
    let sub = subs.get(socket);
    if (!sub) {
      sub = { socket, context, mode: 'resuming', liveQueue: [], lastSentSeq: 0, ackSeq: 0 };
      subs.set(socket, sub);
      let runIds = this.socketRuns.get(socket);
      if (!runIds) {
        runIds = new Set();
        this.socketRuns.set(socket, runIds);
      }
      runIds.add(runId);
    } else {
      // 同一连接对同一 run 再次 resume：以最后一次为准，重置上下文。
      sub.context = context;
    }
    return sub;
  }

  private removeSubscription(runId: string, socket: RealtimeSocketLike): void {
    const subs = this.runSubscriptions.get(runId);
    if (subs) {
      subs.delete(socket);
      if (subs.size === 0) {
        this.runSubscriptions.delete(runId);
      }
    }
    const runIds = this.socketRuns.get(socket);
    if (runIds) {
      runIds.delete(runId);
      if (runIds.size === 0) {
        this.socketRuns.delete(socket);
      }
    }
  }

  private sendControl(socket: RealtimeSocketLike, control: RealtimeServerControl): void {
    this.sendFrame(socket, control);
  }

  private sendFrame(socket: RealtimeSocketLike, frame: RealtimeServerFrame): void {
    try {
      if (socket.readyState === WS_OPEN) {
        socket.send(JSON.stringify(frame));
      }
    } catch {
      // 发送失败（连接可能正在关闭）忽略，与 WsBridge 行为一致。
    }
  }
}

function parseClientFrame(value: unknown): RealtimeClientFrame | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;

  if (candidate.kind === 'resume') {
    if (typeof candidate.runId !== 'string' || candidate.runId.length === 0) {
      return null;
    }
    if (typeof candidate.lastSeq !== 'number' || !Number.isFinite(candidate.lastSeq)) {
      return null;
    }
    const frame: RealtimeResumeControl = { kind: 'resume', runId: candidate.runId, lastSeq: candidate.lastSeq };
    return frame;
  }

  if (candidate.kind === 'ack') {
    if (typeof candidate.runId !== 'string' || candidate.runId.length === 0) {
      return null;
    }
    if (typeof candidate.ackSeq !== 'number' || !Number.isFinite(candidate.ackSeq)) {
      return null;
    }
    const frame: RealtimeAckControl = { kind: 'ack', runId: candidate.runId, ackSeq: candidate.ackSeq };
    return frame;
  }

  return null;
}
