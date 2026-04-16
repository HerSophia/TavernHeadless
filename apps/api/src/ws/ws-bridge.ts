import type { WebSocket } from 'ws';
import type { CoreEventBus, CoreEventMap } from '@tavern/core';
import { parseBranchMemoryScopeId } from '@tavern/shared';

// ── 推送协议 ──────────────────────────────────────────

export interface WsMessage {
  type: 'event';
  event: string;
  data: unknown;
  timestamp: number;
}

// ── 客户端信息 ────────────────────────────────────────

interface ClientInfo {
  socket: WebSocket;
  /** 如果设置了 sessionId，则该客户端为 session client，只接收已解析出相同 sessionId 的事件 */
  sessionId?: string;
}

// ── WsBridge ──────────────────────────────────────────

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

  // ── 内部方法 ────────────────────────────────────────

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

// ── 工具函数 ──────────────────────────────────────────

/**
 * 从事件 payload 中提取 sessionId 用于 WS 客户端过滤。
 *
 * Workstream 5 的 resolution order（从高到低）：
 * 1. 顶层 `data.sessionId`
 * 2. `data.floor.sessionId`
 * 3. `data.scope === 'chat'`：使用 `data.scopeId`
 * 4. `data.scope === 'branch'`：使用 publisher attached `data.sessionId`，
 *    否则 `parseBranchMemoryScopeId(data.scopeId).sessionId`
 * 5. `data.scope === 'floor'`：仅在 publisher attached 显式 `data.sessionId`
 *    存在时才能推导（不再从 scopeId 猜，避免误投递）。
 * 6. item 级（`data.item`）按同样规则。
 * 7. edge 级（`data.edge`）暂时只有顶层 sessionId 可用；不做 scope 推导，
 *    避免在没有 attached session 时误投。
 *
 * 任意路径都没解析出 sessionId 时返回 undefined：根据 broadcast 的
 * 过滤规则，session client 不会收到该事件，等价于 fail-closed。
 */
function extractSessionId(_eventName: string, data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;

  const d = data as Record<string, unknown>;

  if (typeof d.sessionId === 'string' && d.sessionId.length > 0) {
    return d.sessionId;
  }

  if (d.floor && typeof d.floor === 'object') {
    const floorSession = (d.floor as Record<string, unknown>).sessionId;
    if (typeof floorSession === 'string' && floorSession.length > 0) {
      return floorSession;
    }
  }

  // 顶层 scope 推导（覆盖 memory.created / updated / deprecated /
  // deleted / consolidated 的常见 envelope）
  const topResolved = resolveScopeSessionId(d.scope, d.scopeId);
  if (topResolved) return topResolved;

  // item 级 scope 推导（兼容历史 envelope，比如部分早期 memory 事件
  // 只在 item 上带 scope/scopeId）
  const item = d.item;
  if (item && typeof item === 'object') {
    const itemRecord = item as Record<string, unknown>;
    const itemResolved = resolveScopeSessionId(itemRecord.scope, itemRecord.scopeId);
    if (itemResolved) return itemResolved;
  }

  return undefined;
}

function resolveScopeSessionId(scope: unknown, scopeId: unknown): string | undefined {
  if (typeof scopeId !== 'string' || scopeId.length === 0) return undefined;

  if (scope === 'chat') {
    return scopeId;
  }

  if (scope === 'branch') {
    const parsed = parseBranchMemoryScopeId(scopeId);
    return parsed?.sessionId;
  }

  // floor scope 不做隐式推导：必须由 publisher 显式 attach 顶层 sessionId
  // 才会被路由到 session client，避免在 scopeId = floorId 的情况下
  // 错把 floor id 当成 session id 投递给错误的订阅者。
  return undefined;
}
