import { describe, it, expect } from 'vitest';
import type { RealtimeEventEnvelope } from '@tavern/core';

import { RealtimeRunEventBuffer } from '../run-event-buffer';

function makeEnvelope(runId: string, seq: number, sessionId = 'session-1'): RealtimeEventEnvelope<'generation.chunk'> {
  return {
    v: 1,
    type: 'generation.chunk',
    seq,
    runId,
    sessionId,
    payload: { sessionId, floorId: 'floor-1', chunk: `c${seq}`, accumulatedLength: seq },
    timestamp: seq,
  };
}

describe('RealtimeRunEventBuffer', () => {
  it('returns the ordered envelopes after lastSeq', () => {
    const buffer = new RealtimeRunEventBuffer();
    for (let seq = 1; seq <= 5; seq += 1) {
      buffer.append(makeEnvelope('run-1', seq));
    }

    const result = buffer.getEnvelopesSince('run-1', 2);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.fromSeq).toBe(3);
    expect(result.toSeq).toBe(5);
    expect(result.envelopes.map((envelope) => envelope.seq)).toEqual([3, 4, 5]);
  });

  it('returns an empty ok result when the client is already up to date', () => {
    const buffer = new RealtimeRunEventBuffer();
    buffer.append(makeEnvelope('run-1', 1));
    buffer.append(makeEnvelope('run-1', 2));

    expect(buffer.getEnvelopesSince('run-1', 2)).toMatchObject({ status: 'ok', envelopes: [] });
    // lastSeq beyond maxSeq must not produce negative gaps.
    expect(buffer.getEnvelopesSince('run-1', 9)).toMatchObject({ status: 'ok', envelopes: [] });
  });

  it('reports unknown_run for runs it has never seen', () => {
    const buffer = new RealtimeRunEventBuffer();

    expect(buffer.getEnvelopesSince('nope', 0)).toEqual({ status: 'unknown_run', runId: 'nope' });
    expect(buffer.getWindow('nope')).toBeNull();
  });

  it('evicts oldest events per run when exceeding maxEventsPerRun and advances minSeq', () => {
    const buffer = new RealtimeRunEventBuffer({ maxEventsPerRun: 3 });
    for (let seq = 1; seq <= 5; seq += 1) {
      buffer.append(makeEnvelope('run-1', seq));
    }

    expect(buffer.getWindow('run-1')).toEqual({ runId: 'run-1', minSeq: 3, maxSeq: 5, ended: false });

    const result = buffer.getEnvelopesSince('run-1', 2);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.envelopes.map((envelope) => envelope.seq)).toEqual([3, 4, 5]);
  });

  it('returns evicted when the requested start is older than the retained window', () => {
    const buffer = new RealtimeRunEventBuffer({ maxEventsPerRun: 3 });
    for (let seq = 1; seq <= 5; seq += 1) {
      buffer.append(makeEnvelope('run-1', seq));
    }

    expect(buffer.getEnvelopesSince('run-1', 1)).toEqual({ status: 'evicted', runId: 'run-1', minSeq: 3, maxSeq: 5 });
    // A full replay request is also evicted because seq 1..2 are gone.
    expect(buffer.getEnvelopesSince('run-1', 0).status).toBe('evicted');
  });

  it('releases ended runs only after the retain window elapses', () => {
    let clock = 1_000;
    const released: string[] = [];
    const buffer = new RealtimeRunEventBuffer({
      retainAfterEndMs: 500,
      now: () => clock,
      onRelease: (runId) => released.push(runId),
    });

    buffer.append(makeEnvelope('run-1', 1));
    buffer.markEnded('run-1');
    expect(buffer.getWindow('run-1')?.ended).toBe(true);

    clock = 1_499;
    buffer.sweep();
    expect(buffer.getWindow('run-1')).not.toBeNull();
    expect(released).toEqual([]);

    clock = 1_500;
    buffer.sweep();
    expect(buffer.getWindow('run-1')).toBeNull();
    expect(released).toEqual(['run-1']);
  });

  it('evicts the least-recently-active run when exceeding maxRuns', () => {
    let clock = 0;
    const released: string[] = [];
    const buffer = new RealtimeRunEventBuffer({
      maxRuns: 2,
      now: () => clock,
      onRelease: (runId) => released.push(runId),
    });

    clock = 10;
    buffer.append(makeEnvelope('run-a', 1));
    clock = 20;
    buffer.append(makeEnvelope('run-b', 1));
    clock = 30;
    buffer.append(makeEnvelope('run-c', 1));

    expect(buffer.getWindow('run-a')).toBeNull();
    expect(buffer.getWindow('run-b')).not.toBeNull();
    expect(buffer.getWindow('run-c')).not.toBeNull();
    expect(released).toEqual(['run-a']);
    expect(buffer.runCount).toBe(2);
  });

  it('prefers evicting ended runs over active ones when exceeding maxRuns', () => {
    let clock = 0;
    const released: string[] = [];
    const buffer = new RealtimeRunEventBuffer({
      maxRuns: 2,
      retainAfterEndMs: 10_000,
      now: () => clock,
      onRelease: (runId) => released.push(runId),
    });

    clock = 10;
    buffer.append(makeEnvelope('run-a', 1));
    clock = 50;
    buffer.append(makeEnvelope('run-b', 1));
    buffer.markEnded('run-b');
    clock = 60;
    buffer.append(makeEnvelope('run-c', 1));

    expect(buffer.getWindow('run-b')).toBeNull();
    expect(buffer.getWindow('run-a')).not.toBeNull();
    expect(buffer.getWindow('run-c')).not.toBeNull();
    expect(released).toEqual(['run-b']);
  });

  it('release removes a run immediately and fires onRelease exactly once', () => {
    const released: string[] = [];
    const buffer = new RealtimeRunEventBuffer({ onRelease: (runId) => released.push(runId) });

    buffer.append(makeEnvelope('run-1', 1));
    buffer.release('run-1');
    expect(buffer.getWindow('run-1')).toBeNull();
    expect(released).toEqual(['run-1']);

    buffer.release('run-1');
    expect(released).toEqual(['run-1']);
  });

  it('ignores envelopes without a runId', () => {
    const buffer = new RealtimeRunEventBuffer();
    const envelope: RealtimeEventEnvelope<'mcp.connected'> = {
      v: 1,
      type: 'mcp.connected',
      seq: 0,
      payload: { serverId: 'srv-1', serverName: 'srv', transport: 'http', toolCount: 1 },
      timestamp: 1,
    };

    buffer.append(envelope);
    expect(buffer.runCount).toBe(0);
  });

  // ── releaseUpTo（RT3 ack 释放） ──────────────────────

  it('releaseUpTo drops the acknowledged prefix and advances minSeq', () => {
    const buffer = new RealtimeRunEventBuffer();
    for (let seq = 1; seq <= 5; seq += 1) {
      buffer.append(makeEnvelope('run-1', seq));
    }

    buffer.releaseUpTo('run-1', 2);
    expect(buffer.getWindow('run-1')).toEqual({ runId: 'run-1', minSeq: 3, maxSeq: 5, ended: false });

    const result = buffer.getEnvelopesSince('run-1', 2);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.envelopes.map((envelope) => envelope.seq)).toEqual([3, 4, 5]);
    // Requesting an already-released seq now reports evicted (must fall back to the store).
    expect(buffer.getEnvelopesSince('run-1', 1).status).toBe('evicted');
  });

  it('releaseUpTo can empty the run buffer and parks minSeq at maxSeq + 1', () => {
    const buffer = new RealtimeRunEventBuffer();
    for (let seq = 1; seq <= 3; seq += 1) {
      buffer.append(makeEnvelope('run-1', seq));
    }

    buffer.releaseUpTo('run-1', 3);
    expect(buffer.getWindow('run-1')).toEqual({ runId: 'run-1', minSeq: 4, maxSeq: 3, ended: false });
    // A client already at seq 3 has no gap; older requests are evicted.
    expect(buffer.getEnvelopesSince('run-1', 3)).toMatchObject({ status: 'ok', envelopes: [] });
    expect(buffer.getEnvelopesSince('run-1', 2).status).toBe('evicted');

    // The run keeps growing afterwards from the next seq.
    buffer.append(makeEnvelope('run-1', 4));
    const result = buffer.getEnvelopesSince('run-1', 3);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.envelopes.map((envelope) => envelope.seq)).toEqual([4]);
  });

  it('releaseUpTo clamps to maxSeq and is a no-op below the current window', () => {
    const buffer = new RealtimeRunEventBuffer();
    for (let seq = 1; seq <= 3; seq += 1) {
      buffer.append(makeEnvelope('run-1', seq));
    }

    // Over-ack clamps to maxSeq (releases everything).
    buffer.releaseUpTo('run-1', 99);
    expect(buffer.getWindow('run-1')).toEqual({ runId: 'run-1', minSeq: 4, maxSeq: 3, ended: false });

    // Releasing below the (already advanced) window does nothing.
    buffer.releaseUpTo('run-1', 1);
    expect(buffer.getWindow('run-1')).toEqual({ runId: 'run-1', minSeq: 4, maxSeq: 3, ended: false });
  });

  it('releaseUpTo on an unknown run is a no-op', () => {
    const buffer = new RealtimeRunEventBuffer();
    expect(() => buffer.releaseUpTo('nope', 5)).not.toThrow();
    expect(buffer.getWindow('nope')).toBeNull();
  });

  // ── listWindows（RT3 session 握手 activeRuns） ────────

  it('listWindows reports every tracked run window', () => {
    const buffer = new RealtimeRunEventBuffer();
    buffer.append(makeEnvelope('run-a', 1));
    buffer.append(makeEnvelope('run-a', 2));
    buffer.append(makeEnvelope('run-b', 1));
    buffer.markEnded('run-b');

    const windows = buffer.listWindows().sort((a, b) => a.runId.localeCompare(b.runId));
    expect(windows).toEqual([
      { runId: 'run-a', minSeq: 1, maxSeq: 2, ended: false },
      { runId: 'run-b', minSeq: 1, maxSeq: 1, ended: true },
    ]);
  });
});
