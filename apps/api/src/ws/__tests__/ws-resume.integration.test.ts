/**
 * RT3 WS resume/ack 集成测试
 *
 * 用 `buildApp` 装配真实的 WS 插件（启用 orchestration → FloorRunService 兜底来源就绪，
 * 因此 resume/ack 协调器被启用），并验证以下端到端行为：
 *   - 断连重连后 resume 能补齐缺口并续上 live（真实 RealtimeRunLog +真实协调器）。
 *   - ack 能释放 buffer 已确认前缀（窗口 minSeq 前移）。
 *   - run 仅存在于 DB 时走 FloorRunService 的最终态兜底回放。
 *   - 旧式连接（不发 resume）仍按 WsMessage 瞬时转发，行为不回归；session 握手帧为新增。
 *
 * 与 `resume-coordinator.test.ts` 的单元测试相比，本文件不使用 fake reader，而是验证
 * `buildApp` 的真实接线：runLog 订阅真实orchestration eventBus、协调器注入真实
 * FloorRunService、WS 路由在连接建立后下发 session 帧并解析上行控制帧。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  FloorRunSnapshot,
  FloorRunStatus,
  RealtimeErrorControl,
  RealtimeEventEnvelope,
  RealtimeServerFrame,
} from "@tavern/core";
import type { WebSocket as WsWebSocket } from "ws";

import { buildApp, type BuildAppResult } from "../../app.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { floors, floorRunStates, sessions } from "../../db/schema.js";
import type { RealtimeConnectionContext, RealtimeSocketLike } from "../../realtime/resume/index.js";

// ── 测试辅助 ───────────────────────────────────────────

/** 协调器用的最小 mock socket（仅记录下行 JSON 文本） */
function createCoordinatorSocket() {
  const sent: string[] = [];
  const socket: RealtimeSocketLike & { _sent: string[] } = {
    readyState: 1,
    send(data: string) {
      sent.push(data);
    },
    _sent: sent,
  };
  return socket;
}

type CoordinatorSocket = ReturnType<typeof createCoordinatorSocket>;

function framesOf(socket: CoordinatorSocket): RealtimeServerFrame[] {
  return socket._sent.map((raw) => JSON.parse(raw) as RealtimeServerFrame);
}

function eventEnvelopes(socket: CoordinatorSocket): RealtimeEventEnvelope[] {
  return framesOf(socket).flatMap((frame) => (frame.kind === "event" ? [frame.envelope] : []));
}

function errorFrames(socket: CoordinatorSocket): RealtimeErrorControl[] {
  return framesOf(socket).filter((frame): frame is RealtimeErrorControl => frame.kind === "error");
}

function makeSnapshot(
  runId: string,
  floorId: string,
  sessionId: string,
  status: FloorRunStatus = "running",
): FloorRunSnapshot {
  return {
    sessionId,
    floorId,
    runId,
    runType: "respond",
    status,
    phase: "page_generating",
    publicPhase: "generating",
    phaseSeq: 1,
    attemptNo: 1,
    startedAt: 100,
    updatedAt: 120,
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("RT3 WS resume/ack integration", () => {
  let tempDir: string;
  let databasePath: string;
  let buildResult: BuildAppResult;
  let directDatabase: DatabaseConnection;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "tavern-rt3-"));
    databasePath = join(tempDir, "rt3.sqlite");

    buildResult = await buildApp({
      databasePath,
      logger: false,
      enableWebSocket: true,
      orchestration: {
        providers: [
          {
            id: "test-provider",
            type: "openai-compatible",
            apiKey: "sk-test",
          },
        ],
        defaultModel: {
          providerId: "test-provider",
          modelId: "gpt-4o-mini",
        },
      },
    });

    directDatabase = createDatabase(databasePath);
  });

  afterEach(async () => {
    directDatabase.close();
    await buildResult.app.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("wires the resume coordinator and run log when orchestration is enabled", () => {
    expect(buildResult.realtimeRunLog).toBeDefined();
    expect(buildResult.realtimeResumeCoordinator).toBeDefined();
    expect(buildResult.orchestrationContext).toBeDefined();
  });

  it("replays the buffered gap after a reconnect and continues live without duplication", async () => {
    const eventBus = buildResult.orchestrationContext!.eventBus;
    const coordinator = buildResult.realtimeResumeCoordinator!;
    const context: RealtimeConnectionContext = { sessionId: "session-1", isAdmin: false };

    // 旧连接已看到 seq 1..3，然后断开（产生缺口）。
    await eventBus.emit("floor.run.updated", makeSnapshot("run-1", "floor-1", "session-1")); // seq 1
    await eventBus.emit("generation.started", { sessionId: "session-1", floorId: "floor-1" }); // seq 2
    await eventBus.emit("generation.chunk", {
      sessionId: "session-1",
      floorId: "floor-1",
      chunk: "A",
      accumulatedLength: 1,
    }); // seq 3

    const socket = createCoordinatorSocket();
    coordinator.handleClientMessage(
      socket,
      context,
      JSON.stringify({ kind: "resume", runId: "run-1", lastSeq: 1 }),
    );
    await tick();

    // 缺口 seq 2、3 按序补发。
    expect(eventEnvelopes(socket).map((envelope) => envelope.seq)).toEqual([2, 3]);
    expect(errorFrames(socket)).toHaveLength(0);

    // 续 live 不重复已补发的 seq。
    await eventBus.emit("generation.chunk", {
      sessionId: "session-1",
      floorId: "floor-1",
      chunk: "B",
      accumulatedLength: 2,
    }); // seq 4
    expect(eventEnvelopes(socket).map((envelope) => envelope.seq)).toEqual([2, 3, 4]);
  });

  it("releases the buffer prefix up to the acked seq", async () => {
    const eventBus = buildResult.orchestrationContext!.eventBus;
    const runLog = buildResult.realtimeRunLog!;
    const coordinator = buildResult.realtimeResumeCoordinator!;
    const context: RealtimeConnectionContext = { sessionId: "session-1", isAdmin: false };

    await eventBus.emit("floor.run.updated", makeSnapshot("run-1", "floor-1", "session-1")); // seq 1
    for (let i = 0; i < 4; i += 1) {
      await eventBus.emit("generation.chunk", {
        sessionId: "session-1",
        floorId: "floor-1",
        chunk: "x",
        accumulatedLength: i + 1,
      }); // seq 2..5
    }

    expect(runLog.getWindow("run-1")).toMatchObject({ minSeq: 1, maxSeq: 5 });

    const socket = createCoordinatorSocket();
    coordinator.handleClientMessage(
      socket,
      context,
      JSON.stringify({ kind: "resume", runId: "run-1", lastSeq: 5 }),
    );
    await tick();

    coordinator.handleClientMessage(
      socket,
      context,
      JSON.stringify({ kind: "ack", runId: "run-1", ackSeq: 3 }),
    );

    expect(runLog.getWindow("run-1")).toMatchObject({ minSeq: 4, maxSeq: 5 });
  });

  it("falls back to the FloorRunService final state when the run only exists in the store", async () => {
    const coordinator = buildResult.realtimeResumeCoordinator!;
    const now = Date.now();
    const sessionId = `rt3-session-${nanoid()}`;
    const floorId = `rt3-floor-${nanoid()}`;
    const runId = `rt3-run-${nanoid()}`;

    await directDatabase.db.insert(sessions).values({
      id: sessionId,
      title: "RT3 Fallback Session",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await directDatabase.db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo: 0,
      branchId: "main",
      state: "committed",
      tokenIn: 0,
      tokenOut: 0,
      createdAt: now,
      updatedAt: now,
    });
    await directDatabase.db.insert(floorRunStates).values({
      floorId,
      runId,
      runType: "respond",
      status: "completed",
      phase: "transaction_committed",
      publicPhase: "committing",
      phaseSeq: 1,
      attemptNo: 1,
      startedAt: now,
      updatedAt: now,
      completedAt: now,
    });

    const context: RealtimeConnectionContext = { sessionId, isAdmin: false };
    const socket = createCoordinatorSocket();
    coordinator.handleClientMessage(
      socket,
      context,
      JSON.stringify({ kind: "resume", runId, lastSeq: 0 }),
    );
    await tick();

    const envelopes = eventEnvelopes(socket);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({ type: "floor.run.completed", seq: 0, runId });
    expect((envelopes[0]!.payload as FloorRunSnapshot).status).toBe("completed");

    // 最终态回放不可继续 resume，附 seq_window_evicted 说明。
    expect(errorFrames(socket).map((error) => error.code)).toEqual(["seq_window_evicted"]);
  });

  it("rejects a resume for a run that belongs to a different session", async () => {
    const eventBus = buildResult.orchestrationContext!.eventBus;
    const coordinator = buildResult.realtimeResumeCoordinator!;

    await eventBus.emit("floor.run.updated", makeSnapshot("run-1", "floor-1", "session-1")); // seq 1

    const socket = createCoordinatorSocket();
    coordinator.handleClientMessage(
      socket,
      { sessionId: "session-2", isAdmin: false },
      JSON.stringify({ kind: "resume", runId: "run-1", lastSeq: 0 }),
    );
    await tick();

    expect(eventEnvelopes(socket)).toHaveLength(0);
    expect(errorFrames(socket).map((error) => error.code)).toEqual(["resume_rejected"]);
  });

  it("keeps the legacy connection on transient WsMessage forwarding while emitting a session handshake frame", async () => {
    const eventBus = buildResult.orchestrationContext!.eventBus;
    const bridge = buildResult.wsBridge!;
    const coordinator = buildResult.realtimeResumeCoordinator!;
    const context: RealtimeConnectionContext = { sessionId: "session-legacy", isAdmin: false };

    // 同一 mock socket 同时被WsBridge（瞬时转发）与协调器（握手帧）写入，
    // 复现路由在连接建立后同时挂 bridge client 与下发 session 帧的行为。
    const sent: string[] = [];
    const socket= {
      readyState: 1,
  send(data: string) {
        sent.push(data);
      },
      on() {
        return socket;
      },
    } as unknown as RealtimeSocketLike & WsWebSocket;

    // 路由在连接建立后立即下发 session 握手帧。
    coordinator.sendSessionFrame(socket, context);
    // 默认（未发 resume）连接仍走 WsBridge 瞬时转发。
    bridge.addClient(socket, "session-legacy");

    await eventBus.emit("generation.started", { sessionId: "session-legacy", floorId: "legacy-floor" });

    const frames = sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);

    // 第一帧是 session 握手帧。
    expect(frames[0]).toMatchObject({ kind: "session", protocolVersion: 1 });

    // 未 resume 的连接仍然收到 WsMessage 瞬时转发。
    const transient = frames.filter(
            (frame) => frame.type === "event" && frame.event === "generation.started",
    );
    expect(transient).toHaveLength(1);

    // 未 resume 的连接不会收到 RealtimeServerFrame 的 event 信封（仅在 resume 会话下才切信封）。
    const eventFrames = frames.filter((frame) => frame.kind === "event");
    expect(eventFrames).toHaveLength(0);
  });
});
