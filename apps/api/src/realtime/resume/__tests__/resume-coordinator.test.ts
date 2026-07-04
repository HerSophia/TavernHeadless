import { describe, it, expect } from 'vitest';
import { createEventBus } from '@tavern/core';
import type {
  FloorRunSnapshot,
  FloorRunStatus,
  RealtimeErrorControl,
  RealtimeEventEnvelope,
  RealtimeServerFrame,
  RealtimeSessionControl,
} from '@tavern/core';

import { createRealtimeRunLog } from '../../run-log/index.js';
import type { FloorRunRecord } from '../../../services/floor-run-service.js';
import {
  RealtimeResumeCoordinator,
  type FloorRunRecordReader,
  type RealtimeConnectionContext,
} from '../resume-coordinator.js';

// ── 测试辅助 ───────────────────────────────────────────

function createMockSocket() {
  const sent: string[] = [];
  const socket = {
    readyState: 1, // OPEN
    send(data: string) {
      sent.push(data);
    },
    _sent: sent,
  };
  return socket;
}

type MockSocket = ReturnType<typeof createMockSocket>;

function framesOf(socket: MockSocket): RealtimeServerFrame[] {
  return socket._sent.map((raw) => JSON.parse(raw) as RealtimeServerFrame);
}

function eventEnvelopes(socket: MockSocket): RealtimeEventEnvelope[] {
  return framesOf(socket).flatMap((frame) => (frame.kind === 'event' ? [frame.envelope] : []));
}

function errorFrames(socket: MockSocket): RealtimeErrorControl[] {
  return framesOf(socket).filter((frame): frame is RealtimeErrorControl => frame.kind === 'error');
}

function sessionFrames(socket: MockSocket): RealtimeSessionControl[] {
  return framesOf(socket).filter((frame): frame is RealtimeSessionControl => frame.kind === 'session');
}

function makeSnapshot(
  runId: string,
  floorId: string,
  sessionId: string,
  status: FloorRunStatus = 'running',
): FloorRunSnapshot {
  return {
    sessionId,
    floorId,
    runId,
    runType: 'respond',
    status,
    phase: 'page_generating',
    publicPhase: 'generating',
    phaseSeq: 1,
    attemptNo: 1,
    startedAt: 100,
    updatedAt: 120,
  };
}

function makeRecord(
  snapshot: FloorRunSnapshot | null,
  state: FloorRunRecord['state'] = 'committed',
): FloorRunRecord {
  return { floorId: snapshot?.floorId ?? 'floor-x', state, run: snapshot };
}

function fakeReader(records: Record<string, FloorRunRecord | null> = {}): FloorRunRecordReader {
  return {
    getFloorRunRecordByRunId: async (runId) => records[runId] ?? null,
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(reader?: FloorRunRecordReader) {
  const eventBus = createEventBus();
  const runLog = createRealtimeRunLog(eventBus, { now: () => 1000 });
  runLog.start();
  const coordinator = new RealtimeResumeCoordinator(runLog, reader ?? fakeReader(), { now: () => 2000 });
  return { eventBus, runLog, coordinator };
}

const SESSION_1: RealtimeConnectionContext = { sessionId: 'session-1', isAdmin: false };

function resume(coordinator: RealtimeResumeCoordinator, socket: MockSocket, runId: string, lastSeq: number, context = SESSION_1) {
  coordinator.handleClientMessage(socket, context, JSON.stringify({ kind: 'resume', runId, lastSeq }));
}

function ack(coordinator: RealtimeResumeCoordinator, socket: MockSocket, runId: string, ackSeq: number, context = SESSION_1) {
  coordinator.handleClientMessage(socket, context, JSON.stringify({ kind: 'ack', runId, ackSeq }));
}

// ── 测试 ───────────────────────────────────────────────

describe('RealtimeResumeCoordinator', () => {
  describe('session handshake', () => {
    it('sends a session frame with active run hints scoped to the connection session', async () => {
      const { eventBus, coordinator } = setup();
      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1'));
      await eventBus.emit('floor.run.updated', makeSnapshot('run-2', 'floor-2', 'session-2'));

      const socket = createMockSocket();
      coordinator.sendSessionFrame(socket, SESSION_1);

      const sessions = sessionFrames(socket);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ kind: 'session', sessionId: 'session-1', protocolVersion: 1 });
      expect(sessions[0]!.activeRuns).toEqual([{ runId: 'run-1', minSeq: 1, maxSeq: 1 }]);
    });

    it('admin connection sees all active runs', async () => {
      const { eventBus, coordinator } = setup();
      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1'));
      await eventBus.emit('floor.run.updated', makeSnapshot('run-2', 'floor-2', 'session-2'));

      const socket = createMockSocket();
      coordinator.sendSessionFrame(socket, { isAdmin: true });

      const hints = sessionFrames(socket)[0]!.activeRuns ?? [];
      expect(hints.map((hint) => hint.runId).sort()).toEqual(['run-1', 'run-2']);
    });
  });

  describe('resume gap replay', () => {
    it('replays the buffered gap in order and then forwards live envelopes without duplication', async () => {
      const { eventBus, coordinator } = setup();

      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1')); // seq 1
      await eventBus.emit('generation.started', { sessionId: 'session-1', floorId: 'floor-1' }); // seq 2
      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'A', accumulatedLength: 1 }); // seq 3

      const socket = createMockSocket();
      resume(coordinator, socket, 'run-1', 1); // client already saw seq 1
      await tick();

      expect(eventEnvelopes(socket).map((envelope) => envelope.seq)).toEqual([2, 3]);

      // Live continuation must not re-send the replayed seqs.
      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'B', accumulatedLength: 2 }); // seq 4
      expect(eventEnvelopes(socket).map((envelope) => envelope.seq)).toEqual([2, 3, 4]);
    });

    it('resume with lastSeq at head replays nothing but still goes live', async () => {
      const { eventBus, coordinator } = setup();
      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1')); // seq 1

      const socket = createMockSocket();
      resume(coordinator, socket, 'run-1', 1);
      await tick();
      expect(eventEnvelopes(socket)).toHaveLength(0);

      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'x', accumulatedLength: 1 }); // seq 2
      expect(eventEnvelopes(socket).map((envelope) => envelope.seq)).toEqual([2]);
    });

    it('admin can resume any run regardless of session', async () => {
      const { eventBus, coordinator } = setup();
      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1')); // seq 1
      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'x', accumulatedLength: 1 }); // seq 2

      const socket = createMockSocket();
      resume(coordinator, socket, 'run-1', 0, { isAdmin: true });
      await tick();

      expect(eventEnvelopes(socket).map((envelope) => envelope.seq)).toEqual([1, 2]);
      expect(errorFrames(socket)).toHaveLength(0);
    });

    it('re-resume from an earlier lastSeq re-delivers the requested range', async () => {
      const { eventBus, coordinator } = setup();
      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1')); // 1
      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'a', accumulatedLength: 1 }); // 2
      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'b', accumulatedLength: 2 }); // 3

      const socket = createMockSocket();
      resume(coordinator, socket, 'run-1', 2); // delivers 3
      await tick();
      expect(eventEnvelopes(socket).map((envelope) => envelope.seq)).toEqual([3]);

      // Client lost state and re-resumes from seq 1 → 2,3 re-delivered.
      resume(coordinator, socket, 'run-1', 1);
      await tick();
      expect(eventEnvelopes(socket).map((envelope) => envelope.seq)).toEqual([3, 2, 3]);
    });
  });

  describe('authorization', () => {
    it('rejects resume when the run belongs to a different session', async () => {
      const { eventBus, coordinator } = setup();
      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1'));

      const socket = createMockSocket();
      resume(coordinator, socket, 'run-1', 0, { sessionId: 'session-2', isAdmin: false });
      await tick();

      expect(eventEnvelopes(socket)).toHaveLength(0);
      const errors = errorFrames(socket);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ code: 'resume_rejected', runId: 'run-1' });
    });

    it('reports unknown_run when the run is in neither memory nor store', async () => {
      const { coordinator } = setup(fakeReader());

      const socket = createMockSocket();
      resume(coordinator, socket, 'ghost', 0);
      await tick();

      const errors = errorFrames(socket);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ code: 'unknown_run', runId: 'ghost' });
    });
  });

  describe('store fallback', () => {
    it('replays the final-state snapshot when the buffer window was evicted but the run ended', async () => {
      const completed = makeSnapshot('run-1', 'floor-1', 'session-1', 'completed');
      const { eventBus, runLog, coordinator } = setup(fakeReader({ 'run-1': makeRecord(completed) }));

      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1')); // 1
      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'a', accumulatedLength: 1 }); // 2
      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'b', accumulatedLength: 2 }); // 3
      // Simulate ack release so the early window is gone.
      runLog.releaseUpTo('run-1', 3);

      const socket = createMockSocket();
      resume(coordinator, socket, 'run-1', 0); // older than the window → evicted → store fallback
      await tick();

      const envelopes = eventEnvelopes(socket);
      expect(envelopes).toHaveLength(1);
      expect(envelopes[0]).toMatchObject({ type: 'floor.run.completed', seq: 3, runId: 'run-1', timestamp: 2000 });
      expect((envelopes[0]!.payload as FloorRunSnapshot).status).toBe('completed');
      // seq was recoverable (maxSeq=3), so no extra non-resumable notice is required.
      expect(errorFrames(socket)).toHaveLength(0);
    });

    it('replays final state with seq 0 and a non-resumable notice when only the store knows the run', async () => {
      const failed = makeSnapshot('run-9', 'floor-9', 'session-1', 'failed');
      const { coordinator } = setup(fakeReader({ 'run-9': makeRecord(failed, 'failed') }));

      const socket = createMockSocket();
      resume(coordinator, socket, 'run-9', 0);
      await tick();

      const envelopes = eventEnvelopes(socket);
      expect(envelopes).toHaveLength(1);
      expect(envelopes[0]).toMatchObject({ type: 'floor.run.failed', seq: 0, runId: 'run-9' });

      const errors = errorFrames(socket);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ code: 'seq_window_evicted', runId: 'run-9' });
    });

    it('asks the client to re-align when the window was evicted but the run is still running', async () => {
      const running = makeSnapshot('run-1', 'floor-1', 'session-1', 'running');
      const { eventBus, runLog, coordinator } = setup(fakeReader({ 'run-1': makeRecord(running, 'generating') }));

      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1')); // 1
      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'a', accumulatedLength: 1 }); // 2
      runLog.releaseUpTo('run-1', 2);

      const socket = createMockSocket();
      resume(coordinator, socket, 'run-1', 0);
      await tick();

      expect(eventEnvelopes(socket)).toHaveLength(0);
      expect(errorFrames(socket).map((error) => error.code)).toEqual(['seq_window_evicted']);
      // A fresh session frame is sent so the client can re-align from the current window.
      expect(sessionFrames(socket)).toHaveLength(1);
    });

    it('queues live envelopes that arrive while the store lookup is in-flight (resuming mode)', async () => {
      let resolveRecord: ((record: FloorRunRecord | null) => void) | undefined;
      const reader: FloorRunRecordReader = {
        getFloorRunRecordByRunId: () =>
          new Promise<FloorRunRecord | null>((resolve) => {
            resolveRecord = resolve;
          }),
      };
      const { eventBus, runLog, coordinator } = setup(reader);

      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1')); // 1
      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'a', accumulatedLength: 1 }); // 2
      runLog.releaseUpTo('run-1', 2); // evict so resume hits the store path (which is now pending)

      const socket = createMockSocket();
      resume(coordinator, socket, 'run-1', 0);
      await tick();
      // Store lookup is pending → no frames yet.
      expect(framesOf(socket)).toHaveLength(0);

      // A live envelope arrives during resuming mode → must be buffered, not crash.
      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'b', accumulatedLength: 2 }); // 3

      // Resolve as still-running → re-align path; queued live is discarded with the subscription.
      resolveRecord?.(makeRecord(makeSnapshot('run-1', 'floor-1', 'session-1', 'running'), 'generating'));
      await tick();

      expect(eventEnvelopes(socket)).toHaveLength(0);
      expect(errorFrames(socket).map((error) => error.code)).toEqual(['seq_window_evicted']);
    });
  });

  describe('ack release', () => {
    it('releases the buffer prefix up to the acked seq for a single subscriber', async () => {
      const { eventBus, runLog, coordinator } = setup();
      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1')); // 1
      for (let i = 0; i < 4; i += 1) {
        await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'x', accumulatedLength: i + 1 }); // 2..5
      }

      const socket = createMockSocket();
      resume(coordinator, socket, 'run-1', 5); // up to date → live
      await tick();

      ack(coordinator, socket, 'run-1', 3);
      expect(runLog.getWindow('run-1')).toMatchObject({ minSeq: 4, maxSeq: 5 });
    });

    it('releases only up to the minimum acked seq across multiple subscribers', async () => {
      const { eventBus, runLog, coordinator } = setup();
      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1')); // 1
      for (let i = 0; i < 4; i += 1) {
        await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'x', accumulatedLength: i + 1 }); // 2..5
      }

      const socketA = createMockSocket();
      const socketB = createMockSocket();
      resume(coordinator, socketA, 'run-1', 5);
      resume(coordinator, socketB, 'run-1', 5);
      await tick();

      // Only A acks high → B still at 0 → nothing released.
      ack(coordinator, socketA, 'run-1', 5);
      expect(runLog.getWindow('run-1')).toMatchObject({ minSeq: 1 });

      // B acks 3 → min(5,3)=3 released.
      ack(coordinator, socketB, 'run-1', 3);
      expect(runLog.getWindow('run-1')).toMatchObject({ minSeq: 4 });

      // B catches up → min(5,5)=5 released.
      ack(coordinator, socketB, 'run-1', 5);
      expect(runLog.getWindow('run-1')).toMatchObject({ minSeq: 6 });
    });

    it('clamps an out-of-range ack to the current maxSeq', async () => {
      const { eventBus, runLog, coordinator } = setup();
      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1')); // 1
      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'x', accumulatedLength: 1 }); // 2

      const socket = createMockSocket();
      resume(coordinator, socket, 'run-1', 2);
      await tick();

      ack(coordinator, socket, 'run-1', 999);
      expect(runLog.getWindow('run-1')).toMatchObject({ minSeq: 3, maxSeq: 2 });
    });

    it('ignores ack from a connection that never resumed the run', async () => {
      const { eventBus, runLog, coordinator } = setup();
      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1')); // 1
      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'x', accumulatedLength: 1 }); // 2

      const socket = createMockSocket();
      ack(coordinator, socket, 'run-1', 2); // never resumed → best-effort ignore
      expect(runLog.getWindow('run-1')).toMatchObject({ minSeq: 1, maxSeq: 2 });
    });
  });

  describe('malformed control frames', () => {
    it('replies malformed_control for non-JSON and unknown frames without throwing', () => {
      const { coordinator } = setup();
      const socket = createMockSocket();

      coordinator.handleClientMessage(socket, SESSION_1, 'not-json');
      coordinator.handleClientMessage(socket, SESSION_1, JSON.stringify({ kind: 'bogus' }));
      coordinator.handleClientMessage(socket, SESSION_1, JSON.stringify({ kind: 'resume', runId: '', lastSeq: 1 }));
      coordinator.handleClientMessage(socket, SESSION_1, JSON.stringify({ kind: 'resume', runId: 'r', lastSeq: 'x' }));
      coordinator.handleClientMessage(socket, SESSION_1, JSON.stringify({ kind: 'ack', runId: 'r' }));

      const errors = errorFrames(socket);
      expect(errors).toHaveLength(5);
      expect(errors.every((error) => error.code === 'malformed_control')).toBe(true);
    });

    it('accepts a Buffer payload as a control frame', async () => {
      const { eventBus, coordinator } = setup();
      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1')); // 1

      const socket = createMockSocket();
      coordinator.handleClientMessage(socket, SESSION_1, Buffer.from(JSON.stringify({ kind: 'resume', runId: 'run-1', lastSeq: 0 })));
      await tick();

      expect(eventEnvelopes(socket).map((envelope) => envelope.seq)).toEqual([1]);
    });
  });

  describe('lifecycle and compatibility', () => {
    it('does not push envelopes to a connection that never resumed', async () => {
      const { eventBus, coordinator } = setup();
      const socket = createMockSocket();
      // Connection only received the session frame (sent by the route), never resumes.
      coordinator.sendSessionFrame(socket, SESSION_1);

      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1'));
      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'x', accumulatedLength: 1 });

      expect(eventEnvelopes(socket)).toHaveLength(0);
    });

    it('stops forwarding live envelopes after the connection closes', async () => {
      const { eventBus, coordinator } = setup();
      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1')); // 1

      const socket = createMockSocket();
      resume(coordinator, socket, 'run-1', 0);
      await tick();
      expect(eventEnvelopes(socket).map((envelope) => envelope.seq)).toEqual([1]);

      coordinator.handleConnectionClose(socket);
      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'x', accumulatedLength: 1 }); // 2

      expect(eventEnvelopes(socket).map((envelope) => envelope.seq)).toEqual([1]);
    });

    it('dispose detaches the live feed', async () => {
      const { eventBus, coordinator } = setup();
      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1')); // 1

      const socket = createMockSocket();
      resume(coordinator, socket, 'run-1', 0);
      await tick();
      expect(eventEnvelopes(socket)).toHaveLength(1);

      coordinator.dispose();
      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'x', accumulatedLength: 1 }); // 2
      expect(eventEnvelopes(socket)).toHaveLength(1);
    });

    it('forwards live envelopes to multiple resumed connections independently', async () => {
      const { eventBus, coordinator } = setup();
      await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1')); // 1

      const socketA = createMockSocket();
      const socketB = createMockSocket();
      resume(coordinator, socketA, 'run-1', 0);
      resume(coordinator, socketB, 'run-1', 1);
      await tick();

      await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'x', accumulatedLength: 1 }); // 2

      expect(eventEnvelopes(socketA).map((envelope) => envelope.seq)).toEqual([1, 2]);
      expect(eventEnvelopes(socketB).map((envelope) => envelope.seq)).toEqual([2]);
    });
  });
});
