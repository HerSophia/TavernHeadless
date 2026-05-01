import type { WebSocket } from 'ws';
import type { CoreEventBus, CoreEventMap } from '@tavern/core';
import { parseBranchMemoryScopeId } from '@tavern/shared';

import { resolveMemorySessionIdFromScopeCarrier } from '../services/memory/observe/memory-ws-payload-builder.js';

// ── 推送协议 ──────────────────────────────

export interface WsMessage {
  type: 'event';
  event: string;
  data: unknown;
  timestamp: number;
}

// ── 客户端信息 ────────────────────────────

interface ClientInfo {
  socket: WebSocket;
  /** 如果设置了 sessionId，则该客户端为 session client，只接收已解析出相同 sessionId 的事件 */
  sessionId?: string;
}

// ── WsBridge ───────────────────────────────

/**
 * EventBus → WebSocket 桥接器
 *
 * 监听 CoreEventBus 上的所有事件，将它们转发到已连接的 WebSocket 客户端。
 * 客户端可以通过 sessionId 过滤，只接收特定会话的事件。
 */
export class WsBridge {
  private readonly clients = new Set<ClientInfo>();
  private readonly unsubscribers: Array<() => void> = [];
  private started = false;

  constructor(private readonly eventBus: CoreEventBus) {}

  /** 注册一个 WebSocket 客户端 */
  addClient(socket: WebSocket, sessionId?: string): void {
    const client: ClientInfo = { socket, sessionId };
    this.clients.add(client);

    socket.on('close', () => {
      this.clients.delete(client);
    });
  }

  /** 移除一个 WebSocket 客户端 */
  removeClient(socket: WebSocket): void {
    for (const client of this.clients) {
      if (client.socket === socket) {
        this.clients.delete(client);
        break;
      }
    }
  }

  /** 当前连接的客户端数量 */
  get clientCount(): number {
    return this.clients.size;
  }

  /** 开始监听 EventBus 事件并转发到 WebSocket 客户端 */
  start(): void {
    if (this.started) return;
    this.started = true;

    const events: (keyof CoreEventMap)[] = [
      'floor.stateChanged',
      'floor.committed',
      'floor.failed',
      'floor.run.updated',
      'floor.run.completed',
      'floor.run.failed',
      'variable.set',
      'variable.promoted',
      'variable.deleted',
      'generation.started',
      'generation.chunk',
      'generation.completed',
      'generation.failed',
      'commit.retry',
      'commit.busy',
      'commit.succeeded_after_retry',
      'memory.created',
      'memory.updated',
      'memory.deprecated',
      'memory.deleted',
      'memory.edge.created',
      'memory.edge.deleted',
      'memory.consolidated',
      'runtime.job_enqueued',
      'runtime.job_leased',
      'runtime.job_started',
      'runtime.job_progress_updated',
      'runtime.job_succeeded',
      'runtime.job_retry_scheduled',
      'runtime.job_dead_lettered',
      'runtime.job_cancelled',
      'runtime.job_lease_lost',
      'mcp.connected',
      'mcp.disconnected',
      'mcp.error',
    ];

    for (const eventName of events) {
      const handler = (data: CoreEventMap[typeof eventName]) => {
        this.broadcast(eventName, data);
      };

      this.eventBus.on(eventName, handler);
      this.unsubscribers.push(() => {
        this.eventBus.off(eventName, handler);
      });
    }
  }

  /** 停止监听事件 */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
  }

  // ── 内部方法 ────────────────────────────

  private broadcast(eventName: string, data: unknown): void {
    const message: WsMessage = {
      type: 'event',
      event: eventName,
      data,
      timestamp: Date.now(),
    };

    const payload = JSON.stringify(message);
    const sessionId = extractSessionId(eventName, data);

    for (const client of this.clients) {
      // session client 只接收已解析出相同 sessionId 的事件。
      // 不带 sessionId 的事件只发给全局客户端。
      if (client.sessionId) {
        if (!sessionId || client.sessionId !== sessionId) {
          continue;
        }
      }

      try {
        if (client.socket.readyState === 1 /* WebSocket.OPEN */) {
          client.socket.send(payload);
        }
      } catch {
        // 发送失败，忽略（客户端可能已断开）
      }
    }
  }
}

// ── 工具函数 ──────────────────────────────

/**
 * 从事件数据中提取 sessionId。
 *
 * 解析顺序（fail closed，解析不到返回 undefined，session client 会丢弃该事件）：
 *   1. 顶层 data.sessionId
 *   2. data.floor.sessionId
 *   3. data.item.scope === 'chat' 时的 data.item.scopeId
 *   4. data.item.scope === 'branch' 时 parseBranchMemoryScopeId(data.item.scopeId).sessionId
 *   5. data.scope === 'chat' 时的 data.scopeId
 *   6. data.scope === 'branch' 时 parseBranchMemoryScopeId(data.scopeId).sessionId
 *   7. data.scope === 'floor' 时仅在有显式 data.sessionId 时才解析（已在第 1 步命中）
 *
 * 注意：
 * • scope === 'global' 的记忆事件本身没有 sessionId 归属，因此 session client 不会接收，全局客户端仍然接收。
 * • scope === 'floor' 且未携带顶层 sessionId 的事件也归类为解析不到；调用方应以 MemoryEventContext.sessionId 显式携带。
 */
function extractSessionId(_eventName: string, data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;

  const d = data as Record<string, unknown>;

  if (typeof d.sessionId === 'string' && d.sessionId.length > 0) {
    return d.sessionId;
  }

  if (d.floor && typeof d.floor === 'object') {
    const floorSessionId = (d.floor as Record<string, unknown>).sessionId;
    if (typeof floorSessionId === 'string' && floorSessionId.length > 0) {
      return floorSessionId;
    }
  }

  const item = d.item;
  if (item && typeof item === 'object') {
    const resolved = resolveSessionFromScopeCarrier(item as Record<string, unknown>);
    if (resolved) {
      return resolved;
    }
  }

  const resolvedTopLevel = resolveSessionFromScopeCarrier(d);
  if (resolvedTopLevel) {
    return resolvedTopLevel;
  }

  return undefined;
}

function resolveSessionFromScopeCarrier(carrier: Record<string, unknown>): string | undefined {
  const scope = typeof carrier.scope === 'string' ? carrier.scope : undefined;
  const scopeId = typeof carrier.scopeId === 'string' ? carrier.scopeId : undefined;

  if (!scope || !scopeId) {
    return undefined;
  }

  const resolvedMemorySessionId = resolveMemorySessionIdFromScopeCarrier(carrier);
  if (resolvedMemorySessionId) {
    return resolvedMemorySessionId;
  }

  if (scope === 'chat') {
    return scopeId;
  }

  if (scope === 'branch') {
    const parsed = parseBranchMemoryScopeId(scopeId);
    if (parsed?.sessionId) {
      return parsed.sessionId;
    }
    return undefined;
  }

  // scope === 'floor' 或 scope === 'global'：仅依赖显式的顶层 sessionId。
  return undefined;
}
