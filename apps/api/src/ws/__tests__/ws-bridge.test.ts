import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createEventBus } from '@tavern/core';
import type { CoreEventBus } from '@tavern/core';
import { WsBridge, type WsMessage } from '../ws-bridge';

// ── Mock WebSocket ────────────────────────────────────

/** 模拟 ws.WebSocket，只需要 send / readyState / on 方法 */
function createMockSocket() {
  const emitter = new EventEmitter();
  const sent: string[] = [];

  const socket = {
    readyState: 1, // OPEN
    send: vi.fn((data: string) => sent.push(data)),
    on: (event: string, handler: (...args: any[]) => void) => {
      emitter.on(event, handler);
      return socket;
    },
    close: () => {
      socket.readyState = 3; // CLOSED
      emitter.emit('close');
    },
    // 测试辅助
    _sent: sent,
    _emitter: emitter,
  };

  return socket as any;
}

function parseSent(socket: ReturnType<typeof createMockSocket>): WsMessage[] {
  return socket._sent.map((s: string) => JSON.parse(s));
}

// ── Tests ─────────────────────────────────────────────

describe('WsBridge', () => {
  let eventBus: CoreEventBus;
  let bridge: WsBridge;

  beforeEach(() => {
    eventBus = createEventBus();
    bridge = new WsBridge(eventBus);
    bridge.start();
  });

  afterEach(() => {
    bridge.stop();
  });

  // ── 客户端管理 ──────────────────────────────────────

  it('adds and tracks clients', () => {
    const socket = createMockSocket();
    bridge.addClient(socket);

    expect(bridge.clientCount).toBe(1);
  });

  it('removes client on close', () => {
    const socket = createMockSocket();
    bridge.addClient(socket);
    expect(bridge.clientCount).toBe(1);

    socket.close();
    expect(bridge.clientCount).toBe(0);
  });

  it('removes client manually', () => {
    const socket = createMockSocket();
    bridge.addClient(socket);
    expect(bridge.clientCount).toBe(1);

    bridge.removeClient(socket);
    expect(bridge.clientCount).toBe(0);
  });

  // ── 事件转发 ────────────────────────────────────────

  it('forwards generation.started event to client', async () => {
    const socket = createMockSocket();
    bridge.addClient(socket);

    await eventBus.emit('generation.started', {
      floorId: 'floor-1',
    });

    const messages = parseSent(socket);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.type).toBe('event');
    expect(messages[0]!.event).toBe('generation.started');
    expect(messages[0]!.data).toEqual({ floorId: 'floor-1' });
    expect(typeof messages[0]!.timestamp).toBe('number');
  });

  it('forwards generation.chunk event', async () => {
    const socket = createMockSocket();
    bridge.addClient(socket);

    await eventBus.emit('generation.chunk', {
      floorId: 'floor-1',
      chunk: 'Hello ',
      accumulatedLength: 6,
    });

    const messages = parseSent(socket);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.event).toBe('generation.chunk');
    expect((messages[0]!.data as any).chunk).toBe('Hello ');
  });

  it('forwards commit.retry event and respects session filters', async () => {
    const socket1 = createMockSocket();
    const socket2 = createMockSocket();
    bridge.addClient(socket1, 'session-1');
    bridge.addClient(socket2, 'session-2');

    await eventBus.emit('commit.retry', {
      sessionId: 'session-1',
      branchId: 'main',
      floorId: 'floor-1',
      attempt: 1,
      backoffMs: 100,
      message: 'database is locked',
    });

    const messages1 = parseSent(socket1);
    const messages2 = parseSent(socket2);

    expect(messages1).toHaveLength(1);
    expect(messages1[0]!.event).toBe('commit.retry');
    expect(messages1[0]!.data).toEqual({
      sessionId: 'session-1',
      branchId: 'main',
      floorId: 'floor-1',
      attempt: 1,
      backoffMs: 100,
      message: 'database is locked',
    });
    expect(messages2).toHaveLength(0);
  });

  it('forwards floor.committed event', async () => {
    const socket = createMockSocket();
    bridge.addClient(socket);

    await eventBus.emit('floor.committed', {
      floor: {
        id: 'floor-1',
        sessionId: 'session-1',
        floorNo: 1,
        branchId: 'main',
        parentFloorId: null,
        state: 'committed',
        tokenIn: 100,
        tokenOut: 50,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      promotedVariables: [],
    });

    const messages = parseSent(socket);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.event).toBe('floor.committed');
  });

  it('forwards variable.promoted event', async () => {
    const socket = createMockSocket();
    bridge.addClient(socket);

    await eventBus.emit('variable.promoted', {
      sessionId: 'session-1',
      key: 'mood',
      fromScope: 'page',
      toScope: 'floor',
      value: 'steady',
    });

    const messages = parseSent(socket);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.event).toBe('variable.promoted');
    expect(messages[0]!.data).toEqual({
      sessionId: 'session-1',
      key: 'mood',
      fromScope: 'page',
      toScope: 'floor',
      value: 'steady',
    });
  });

  it('forwards runtime job events and respects session filters', async () => {
    const socket1 = createMockSocket();
    const socket2 = createMockSocket();
    bridge.addClient(socket1, 'session-1');
    bridge.addClient(socket2, 'session-2');

    await eventBus.emit('runtime.job_progress_updated', {
      jobId: 'runtime-job-1',
      jobType: 'chat_transfer.export_chat',
      accountId: 'default-admin',
      scopeType: 'chat_transfer',
      scopeKey: 'session:session-1',
      sessionId: 'session-1',
      status: 'running',
      phase: 'rendering',
      attemptCount: 1,
      maxAttempts: 5,
      availableAt: 100,
      startedAt: 120,
      finishedAt: null,
      workerId: 'worker-1',
      basedOnRevision: null,
      dedupeKey: null,
      progressCurrent: 2,
      progressTotal: 4,
      progressMessage: 'rendering export artifact',
      errorCode: null,
      errorClass: null,
      message: null,
      durationMs: null,
    });

    const messages1 = parseSent(socket1);
    const messages2 = parseSent(socket2);
    expect(messages1).toHaveLength(1);
    expect(messages1[0]!.event).toBe('runtime.job_progress_updated');
    expect((messages1[0]!.data as any).jobId).toBe('runtime-job-1');
    expect(messages2).toHaveLength(0);
  });

  it('filters memory.created event by top-level sessionId', async () => {
    const socket1 = createMockSocket();
    const socket2 = createMockSocket();
    bridge.addClient(socket1, 'session-1');
    bridge.addClient(socket2, 'session-2');

    await eventBus.emit('memory.created', {
      sessionId: 'session-1',
      scope: 'chat',
      scopeId: 'session-1',
      floorId: 'floor-1',
      sourceJobId: 'memory-job:ingest_turn:floor-1',
      item: {
        id: 'mem-1',
        scope: 'chat',
        scopeId: 'session-1',
        type: 'summary',
        summaryTier: 'micro',
        content: 'Alice keeps the key.',
        importance: 0.7,
        confidence: 1,
        sourceFloorId: 'floor-1',
        sourceMessageId: 'msg-1',
        status: 'active',
        lifecycleStatus: 'active',
        sourceJobId: 'memory-job:ingest_turn:floor-1',
        tokenCountEstimate: 6,
        coverageStartFloorNo: 3,
        coverageEndFloorNo: 3,
        createdAt: 123,
        updatedAt: 123,
      },
      source: 'consolidation',
    });

    expect(parseSent(socket1)).toHaveLength(1);
    expect(parseSent(socket2)).toHaveLength(0);
  });

  it('falls back to memory item chat scope when memory sessionId is absent', async () => {
    const socket1 = createMockSocket();
    const socket2 = createMockSocket();
    bridge.addClient(socket1, 'session-1');
    bridge.addClient(socket2, 'session-2');

    await eventBus.emit('memory.updated', {
      scope: 'chat',
      scopeId: 'session-1',
      floorId: 'floor-1',
      item: {
        id: 'mem-2',
        scope: 'chat',
        scopeId: 'session-1',
        type: 'fact',
        content: 'key_owner: Alice',
        factKey: 'key_owner',
        importance: 0.9,
        confidence: 1,
        status: 'active',
        lifecycleStatus: 'active',
        createdAt: 123,
        updatedAt: 456,
      },
      previousContent: 'key_owner: unknown',
    });

    expect(parseSent(socket1)).toHaveLength(1);
    expect(parseSent(socket2)).toHaveLength(0);
  });

  it('filters variable.set event by sessionId', async () => {
    const socket1 = createMockSocket();
    const socket2 = createMockSocket();
    bridge.addClient(socket1, 'session-1');
    bridge.addClient(socket2, 'session-2');

    await eventBus.emit('variable.set', {
      sessionId: 'session-1',
      entry: {
        id: 'var-1',
        scope: 'chat',
        scopeId: 'session-1',
        key: 'mood',
        value: 'steady',
        updatedAt: 123,
      },
      isNew: true,
    });

    expect(parseSent(socket1)).toHaveLength(1);
    expect(parseSent(socket2)).toHaveLength(0);
  });

  // ── 多客户端广播 ────────────────────────────────────

  it('broadcasts to all connected clients', async () => {
    const socket1 = createMockSocket();
    const socket2 = createMockSocket();
    bridge.addClient(socket1);
    bridge.addClient(socket2);

    await eventBus.emit('generation.started', { floorId: 'floor-1' });

    expect(parseSent(socket1)).toHaveLength(1);
    expect(parseSent(socket2)).toHaveLength(1);
  });

  // ── sessionId 过滤 ─────────────────────────────────

  it('filters events by sessionId', async () => {
    const socket1 = createMockSocket();
    const socket2 = createMockSocket();
    bridge.addClient(socket1, 'session-1');
    bridge.addClient(socket2, 'session-2');

    await eventBus.emit('floor.committed', {
      floor: {
        id: 'floor-1',
        sessionId: 'session-1',
        floorNo: 1,
        branchId: 'main',
        parentFloorId: null,
        state: 'committed',
        tokenIn: 0,
        tokenOut: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      promotedVariables: [],
    });

    // socket1 subscribed to session-1, should receive
    expect(parseSent(socket1)).toHaveLength(1);
    // socket2 subscribed to session-2, should NOT receive
    expect(parseSent(socket2)).toHaveLength(0);
  });

  it('forwards memory.consolidated job metadata and filters by sessionId', async () => {
    const socket1 = createMockSocket();
    const socket2 = createMockSocket();
    bridge.addClient(socket1, 'session-1');
    bridge.addClient(socket2, 'session-2');

    await eventBus.emit('memory.consolidated', {
      sessionId: 'session-1',
      scope: 'chat',
      scopeId: 'session-1',
      floorId: 'floor-9',
      sourceJobId: 'memory-job:compact_macro:session-1:micro-9',
      created: 1,
      updated: 3,
      deprecated: 0,
      jobType: 'compact_macro',
    });

    const messages1 = parseSent(socket1);
    const messages2 = parseSent(socket2);

    expect(messages1).toHaveLength(1);
    expect(messages2).toHaveLength(0);
    expect(messages1[0]!.event).toBe('memory.consolidated');
    expect(messages1[0]!.data).toEqual(expect.objectContaining({
      jobType: 'compact_macro',
      sourceJobId: 'memory-job:compact_macro:session-1:micro-9',
    }));
  });

  it('does not send events without sessionId to session-scoped clients, but still sends them to global clients', async () => {
    const sessionSocket = createMockSocket();
    const globalSocket = createMockSocket();
    bridge.addClient(sessionSocket, 'session-1');
    bridge.addClient(globalSocket);

    // generation.started has floorId but no sessionId in data.
    await eventBus.emit('generation.started', {
      floorId: 'floor-1',
    });

    expect(parseSent(sessionSocket)).toHaveLength(0);
    expect(parseSent(globalSocket)).toHaveLength(1);
  });

  it('client without sessionId receives all events', async () => {
    const adminSocket = createMockSocket();
    bridge.addClient(adminSocket); // no sessionId filter

    await eventBus.emit('floor.committed', {
      floor: {
        id: 'floor-1',
        sessionId: 'session-1',
        floorNo: 1,
        branchId: 'main',
        parentFloorId: null,
        state: 'committed',
        tokenIn: 0,
        tokenOut: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      promotedVariables: [],
    });

    expect(parseSent(adminSocket)).toHaveLength(1);
  });

  // ── 异常处理 ────────────────────────────────────────

  it('skips closed sockets without error', async () => {
    const socket = createMockSocket();
    bridge.addClient(socket);

    // Simulate socket closed
    socket.readyState = 3; // CLOSED

    await eventBus.emit('generation.started', { floorId: 'floor-1' });

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('handles send errors gracefully', async () => {
    const socket = createMockSocket();
    socket.send = vi.fn().mockImplementation(() => { throw new Error('Send failed'); });
    bridge.addClient(socket);

    // Should not throw
    await eventBus.emit('generation.started', { floorId: 'floor-1' });
  });

  // ── start / stop ───────────────────────────────────

  it('does not forward events after stop', async () => {
    const socket = createMockSocket();
    bridge.addClient(socket);

    bridge.stop();

    await eventBus.emit('generation.started', { floorId: 'floor-1' });

    expect(parseSent(socket)).toHaveLength(0);
  });

  it('start is idempotent', () => {
    bridge.start(); // already started in beforeEach
    expect(bridge.clientCount).toBe(0); // no error
  });
});
