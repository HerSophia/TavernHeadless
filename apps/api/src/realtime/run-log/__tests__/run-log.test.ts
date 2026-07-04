import { describe, it, expect } from 'vitest';
import { createEventBus } from '@tavern/core';
import type { CoreEventBus, FloorRunSnapshot, FloorRunStatus } from '@tavern/core';

import { RealtimeSequencer } from '../sequencer';
import { RealtimeRunEventBuffer } from '../run-event-buffer';
import { RealtimeRunLog, createRealtimeRunLog } from '../run-log';

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

function setup() {
  const eventBus = createEventBus();
  const sequencer = new RealtimeSequencer();
  const buffer = new RealtimeRunEventBuffer();
  const runLog = new RealtimeRunLog(eventBus, sequencer, buffer, { now: () => 1234 });
  runLog.start();
  return { eventBus, sequencer, buffer, runLog };
}

describe('RealtimeRunLog', () => {
  it('assigns continuous seq across a floor.run + generation sequence with homogeneous payloads', async () => {
    const { eventBus, runLog } = setup();

    await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1'));
    await eventBus.emit('generation.started', { sessionId: 'session-1', floorId: 'floor-1' });
    await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'Hi', accumulatedLength: 2 });
    await eventBus.emit('generation.completed', {
      sessionId: 'session-1',
      floorId: 'floor-1',
      text: 'Hi',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
      summaries: [],
    });

    const result = runLog.getEnvelopesSince('run-1', 0);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    expect(result.envelopes.map((envelope) => envelope.seq)).toEqual([1, 2, 3, 4]);
    expect(result.envelopes.map((envelope) => envelope.type)).toEqual([
      'floor.run.updated',
      'generation.started',
      'generation.chunk',
      'generation.completed',
    ]);
    expect(result.envelopes.every((envelope) => envelope.runId === 'run-1')).toBe(true);
    expect(result.envelopes.every((envelope) => envelope.sessionId === 'session-1')).toBe(true);
    expect(result.envelopes.every((envelope) => envelope.v === 1)).toBe(true);
    expect(result.envelopes.every((envelope) => envelope.timestamp === 1234)).toBe(true);

    const chunk = result.envelopes[2];
    expect(chunk?.type).toBe('generation.chunk');
    expect(chunk?.payload).toMatchObject({ chunk: 'Hi', accumulatedLength: 2 });

    runLog.stop();
  });

  it('resolves runId for generation events via the floorId mapping and inherits the mapped sessionId', async () => {
    const { eventBus, runLog } = setup();

    await eventBus.emit('floor.run.updated', makeSnapshot('run-7', 'floor-7', 'session-7'));
    // generation.chunk without its own sessionId must inherit the mapped session.
    await eventBus.emit('generation.chunk', { floorId: 'floor-7', chunk: 'x', accumulatedLength: 1 });

    const result = runLog.getEnvelopesSince('run-7', 0);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }

    const generation = result.envelopes.find((envelope) => envelope.type === 'generation.chunk');
    expect(generation?.runId).toBe('run-7');
    expect(generation?.sessionId).toBe('session-7');

    runLog.stop();
  });

  it('does not log global events such as mcp.connected', async () => {
    const { eventBus, buffer, runLog } = setup();

    await eventBus.emit('mcp.connected', { serverId: 'srv-1', serverName: 'srv', transport: 'http', toolCount: 2 });

    expect(buffer.runCount).toBe(0);
    runLog.stop();
  });

  it('marks the run ended on floor.run.completed', async () => {
    const { eventBus, runLog } = setup();

    await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1'));
    expect(runLog.getWindow('run-1')?.ended).toBe(false);

    await eventBus.emit('floor.run.completed', makeSnapshot('run-1', 'floor-1', 'session-1', 'completed'));
    expect(runLog.getWindow('run-1')?.ended).toBe(true);

    runLog.stop();
  });

  it('counts and skips generation events whose runId cannot be resolved', async () => {
    const { eventBus, buffer, runLog } = setup();

    await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-unknown', chunk: 'x', accumulatedLength: 1 });
    await eventBus.emit('generation.started', { sessionId: 'session-1' });

    expect(runLog.unresolvedCount).toBe(2);
    expect(buffer.runCount).toBe(0);

    runLog.stop();
  });

  it('stops logging after stop()', async () => {
    const { eventBus, buffer, runLog } = setup();
    runLog.stop();

    await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1'));

    expect(buffer.runCount).toBe(0);
  });

  it('forgetRun drops the floorId mapping so later generation events no longer resolve', async () => {
    const { eventBus, runLog } = setup();

    await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1'));
    await eventBus.emit('generation.chunk', { floorId: 'floor-1', chunk: 'a', accumulatedLength: 1 });
    expect(runLog.unresolvedCount).toBe(0);

    runLog.forgetRun('run-1');
    await eventBus.emit('generation.chunk', { floorId: 'floor-1', chunk: 'b', accumulatedLength: 2 });
    expect(runLog.unresolvedCount).toBe(1);

    runLog.stop();
  });

  // ── RT3 增补：反向映射 / activeRuns / 信封订阅 / 释放 ──

  it('exposes runId -> floorId/session reverse mapping for floor runs', async () => {
    const { eventBus, runLog } = setup();

    await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1'));

    expect(runLog.getFloorIdByRunId('run-1')).toBe('floor-1');
    expect(runLog.getRunMeta('run-1')).toEqual({ floorId: 'floor-1', sessionId: 'session-1' });
    expect(runLog.getFloorIdByRunId('missing')).toBeUndefined();
    expect(runLog.getRunMeta('missing')).toBeUndefined();

    runLog.stop();
  });

  it('lists active run hints filtered by session and unfiltered for admin', async () => {
    const { eventBus, runLog } = setup();

    await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1'));
    await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'a', accumulatedLength: 1 });
    await eventBus.emit('floor.run.updated', makeSnapshot('run-2', 'floor-2', 'session-2'));

    const session1Hints = runLog.listActiveRunHints('session-1');
    expect(session1Hints).toEqual([{ runId: 'run-1', minSeq: 1, maxSeq: 2 }]);

    const adminHints = runLog.listActiveRunHints().sort((a, b) => a.runId.localeCompare(b.runId));
    expect(adminHints).toEqual([
      { runId: 'run-1', minSeq: 1, maxSeq: 2 },
      { runId: 'run-2', minSeq: 1, maxSeq: 1 },
    ]);

    runLog.stop();
  });

  it('notifies envelope subscribers for each ingested envelope and stops after unsubscribe', async () => {
    const { eventBus, runLog } = setup();
    const seen: Array<{ type: string; seq: number; runId?: string }> = [];
    const unsubscribe = runLog.onEnvelope((envelope) => {
      seen.push({ type: envelope.type, seq: envelope.seq, runId: envelope.runId });
    });

    await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1'));
    await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'a', accumulatedLength: 1 });

    expect(seen).toEqual([
      { type: 'floor.run.updated', seq: 1, runId: 'run-1' },
      { type: 'generation.chunk', seq: 2, runId: 'run-1' },
    ]);

    unsubscribe();
    await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'b', accumulatedLength: 2 });
    expect(seen).toHaveLength(2);

    runLog.stop();
  });

  it('releaseUpTo forwards to the buffer and advances the window', async () => {
    const { eventBus, runLog } = setup();

    await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1'));
    await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'a', accumulatedLength: 1 });
    await eventBus.emit('generation.chunk', { sessionId: 'session-1', floorId: 'floor-1', chunk: 'b', accumulatedLength: 2 });

    runLog.releaseUpTo('run-1', 2);
    expect(runLog.getWindow('run-1')).toMatchObject({ minSeq: 3, maxSeq: 3 });

    runLog.stop();
  });

  it('createRealtimeRunLog resets the sequencer and forgets the mapping when a run is evicted', async () => {
    const eventBus: CoreEventBus = createEventBus();
    const runLog = createRealtimeRunLog(eventBus, { now: () => 1, buffer: { maxRuns: 1 } });
    runLog.start();

    await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1'));
    await eventBus.emit('generation.chunk', { floorId: 'floor-1', chunk: 'a', accumulatedLength: 1 });
    // Adding a second run evicts run-1 because maxRuns is 1.
    await eventBus.emit('floor.run.updated', makeSnapshot('run-2', 'floor-2', 'session-2'));

    expect(runLog.getWindow('run-1')).toBeNull();

    // Re-introduce run-1: seq must restart at 1, proving the sequencer was reset on release.
    await eventBus.emit('floor.run.updated', makeSnapshot('run-1', 'floor-1', 'session-1'));
    const result = runLog.getEnvelopesSince('run-1', 0);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.envelopes[0]?.seq).toBe(1);

    runLog.stop();
  });
});
