import type { CoreEventMap } from '../events/event-types.js';

/**
 * Realtime Protocol 契约（RT0，实验性）。
 *
 * 本文件只定义统一的实时协议表达：事件信封 + 控制消息 + 帧联合 + 错误码。
 * 不引入任何运行时行为。WS / SSE 等 transport 在后续批次（RT2~RT5）逐步接到本契约上。
 *
 * 命名遵守 docs/contributing.md 概念命名边界：统一 `Realtime` 前缀，`runId` 沿用聊天主链路
 * 的 `Run` 语义（即 FloorRunSnapshot.runId），绝不写成 `RealtimeRuntime*`。
 */

/** 协议信封版本号，便于后续无破坏演进 */
export type RealtimeProtocolVersion = 1;

/**
 * 统一事件信封：对一条 CoreEventMap 业务事件的包裹，附带 `seq` 与 `runId`。
 *
 * - `payload` 直接复用 `CoreEventMap[TType]`，与 EventBus 事件一一对应，不重新发明结构。
 * - `seq` 是 run 维度的连续序号（从 1 开始，由 RT2 分配），不是全局序号；
 *   与 `FloorRunSnapshot.phaseSeq`（快照修订号）是两个不同的东西，切勿混用。
 * - 与某个 run 无关的全局事件（如 mcp.* / scope=global 的 memory 事件）`seq` 为 0、
 *   `runId` 缺省，表示「不参与 resume/ack」。
 */
export interface RealtimeEventEnvelope<TType extends keyof CoreEventMap = keyof CoreEventMap> {
  /** 协议版本，固定为 1 */
  v: RealtimeProtocolVersion;
  /** 业务事件类型，对齐 CoreEventMap 的 key，例如 'generation.chunk' */
  type: TType;
  /** 单个 run 内连续递增的序号，从 1 开始；全局事件为 0 */
  seq: number;
  /** 关联的 floor_run runId（即 FloorRunSnapshot.runId）；全局事件缺省 */
  runId?: string;
  /** 事件归属的会话，用于 transport 侧按 session 路由 */
  sessionId?: string;
  /** 业务事件负载，与 CoreEventMap[TType] 同构 */
  payload: CoreEventMap[TType];
  /** 服务端产出该信封的时间戳（epoch ms） */
  timestamp: number;
}

// ── 控制消息：客户端 → 服务端 ──────────────────────────

/** 客户端请求从某个 run 的 lastSeq 之后补发（断线重连） */
export interface RealtimeResumeControl {
  kind: 'resume';
  runId: string;
  /** 客户端已成功处理的最后一个 seq；0 表示要求全量补发 */
  lastSeq: number;
}

/** 客户端确认已处理到 ackSeq，允许服务端释放该 run 不再需要的 buffer 区间 */
export interface RealtimeAckControl {
  kind: 'ack';
  runId: string;
  ackSeq: number;
}

/** 客户端上行控制消息判别联合 */
export type RealtimeClientControl = RealtimeResumeControl | RealtimeAckControl;

// ── 控制消息：服务端 → 客户端 ──────────────────────────

/** 服务端已知的、与该连接相关的活动 run 概览（buffer 窗口） */
export interface RealtimeActiveRunHint {
  runId: string;
  /** 该 run 当前可补发的最小 seq（淘汰后前移） */
  minSeq: number;
  /** 该 run 当前最大 seq */
  maxSeq: number;
}

/** 连接建立后，服务端下发的会话级握手信息 */
export interface RealtimeSessionControl {
  kind: 'session';
  sessionId?: string;
  /** 服务端协议版本，便于客户端做兼容判断 */
  protocolVersion: RealtimeProtocolVersion;
  /** 与该连接相关的活动 run 概览（可选，RT3 起填充） */
  activeRuns?: RealtimeActiveRunHint[];
}

/** 稳定的错误原因码枚举，供后续批次复用 */
export type RealtimeErrorCode =
  /** resume 指定的 runId 不存在或不可见 */
  | 'unknown_run'
  /** 请求的 lastSeq 已被 buffer 释放，无法从内存补发（需走 DB 最终态回放） */
  | 'seq_window_evicted'
  /** resume 被拒绝（鉴权、会话不匹配等） */
  | 'resume_rejected'
  /** 控制消息结构非法 */
  | 'malformed_control'
  /** 服务端内部错误 */
  | 'internal_error';

/** 服务端错误下行 */
export interface RealtimeErrorControl {
  kind: 'error';
  code: RealtimeErrorCode;
  message: string;
  /** 出错关联的 run（如果适用） */
  runId?: string;
}

/** 服务端下行控制消息判别联合 */
export type RealtimeServerControl = RealtimeSessionControl | RealtimeErrorControl;

// ── 帧联合：WS / SSE 共同协议表达 ──────────────────────

/** 事件帧：包裹一个事件信封 */
export interface RealtimeEventFrame {
  kind: 'event';
  envelope: RealtimeEventEnvelope;
}

/** 服务端 → 客户端：事件帧或控制帧 */
export type RealtimeServerFrame = RealtimeEventFrame | RealtimeServerControl;

/** 客户端 → 服务端：当前仅控制帧 */
export type RealtimeClientFrame = RealtimeClientControl;
