import { describe, it, expect } from 'vitest';
import type {
  RealtimeClientControl,
  RealtimeErrorCode,
  RealtimeEventEnvelope,
  RealtimeServerControl,
  RealtimeServerFrame,
} from '../protocol-types';

describe('Realtime protocol contract (RT0)', () => {
  it('builds a generation.chunk envelope whose payload aligns with CoreEventMap', () => {
    const envelope: RealtimeEventEnvelope<'generation.chunk'> = {
      v: 1,
      type: 'generation.chunk',
      seq: 1,
      runId: 'run-1',
      sessionId: 'session-1',
      payload: { sessionId: 'session-1', floorId: 'floor-1', chunk: 'Hello', accumulatedLength: 5 },
      timestamp: 1_700_000_000_000,
    };

    expect(envelope.v).toBe(1);
    expect(envelope.payload.chunk).toBe('Hello');
    expect(envelope.payload.accumulatedLength).toBe(5);
  });

  it('allows global events to carry seq 0 with no runId', () => {
    const envelope: RealtimeEventEnvelope<'mcp.connected'> = {
      v: 1,
      type: 'mcp.connected',
      seq: 0,
      payload: { serverId: 'srv-1', serverName: 'srv', transport: 'http', toolCount: 3 },
      timestamp: 1,
    };

    expect(envelope.seq).toBe(0);
    expect(envelope.runId).toBeUndefined();
  });

  it('exhaustively narrows RealtimeServerFrame by kind', () => {
    function describeFrame(frame: RealtimeServerFrame): string {
      switch (frame.kind) {
        case 'event':
          return `event:${frame.envelope.type}`;
        case 'session':
          return `session:v${frame.protocolVersion}`;
        case 'error':
          return `error:${frame.code}`;
        default: {
          const exhaustive: never = frame;
          return exhaustive;
        }
      }
    }

    const eventFrame: RealtimeServerFrame = {
      kind: 'event',
      envelope: {
        v: 1,
        type: 'generation.started',
        seq: 1,
        runId: 'run-1',
        payload: { sessionId: 'session-1', floorId: 'floor-1' },
        timestamp: 1,
      },
    };
    const sessionFrame: RealtimeServerFrame = { kind: 'session', protocolVersion: 1, sessionId: 'session-1' };
    const errorFrame: RealtimeServerFrame = { kind: 'error', code: 'unknown_run', message: 'nope' };

    expect(describeFrame(eventFrame)).toBe('event:generation.started');
    expect(describeFrame(sessionFrame)).toBe('session:v1');
    expect(describeFrame(errorFrame)).toBe('error:unknown_run');
  });

  it('exhaustively narrows RealtimeClientControl by kind', () => {
    function nextExpectedSeq(control: RealtimeClientControl): number {
      switch (control.kind) {
        case 'resume':
          return control.lastSeq + 1;
        case 'ack':
          return control.ackSeq;
        default: {
          const exhaustive: never = control;
          return exhaustive;
        }
      }
    }

    expect(nextExpectedSeq({ kind: 'resume', runId: 'run-1', lastSeq: 4 })).toBe(5);
    expect(nextExpectedSeq({ kind: 'ack', runId: 'run-1', ackSeq: 7 })).toBe(7);
  });

  it('composes an error control for every RealtimeErrorCode', () => {
    const codes: RealtimeErrorCode[] = [
      'unknown_run',
      'seq_window_evicted',
      'resume_rejected',
      'malformed_control',
      'internal_error',
    ];
    const controls: RealtimeServerControl[] = codes.map((code) => ({ kind: 'error', code, message: code }));

    expect(controls).toHaveLength(5);
    expect(controls.every((control) => control.kind === 'error')).toBe(true);
  });
});
