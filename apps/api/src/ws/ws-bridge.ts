import type { WebSocket } from 'ws';
import type { CoreEventBus, CoreEventMap } from '@tavern/core';

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
  /** 如果设置了 sessionId，只接收该会话的事件 */
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
      'memory.consolidated',
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
      // 如果客户端设置了 sessionId 过滤，且事件有 sessionId 信息，
      // 则只转发匹配的事件。如果事件没有 sessionId（全局事件），则总是转发。
      if (client.sessionId && sessionId && client.sessionId !== sessionId) {
        continue;
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
 * 从事件数据中提取 sessionId。
 *
 * 优先级：
 * - floor 事件：data.floor.sessionId
 * - 通用直接字段：data.sessionId
 * - memory 事件兜底：data.item.scope === 'chat' 时使用 data.item.scopeId
 * - memory 汇总兜底：data.scope === 'chat' 时使用 data.scopeId
 */
function extractSessionId(_eventName: string, data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;

  const d = data as Record<string, unknown>;

  if (d.floor && typeof d.floor === 'object') {
    return (d.floor as Record<string, unknown>).sessionId as string | undefined;
  }

  if (typeof d.sessionId === 'string') {
    return d.sessionId;
  }

  const item = d.item;
  if (item && typeof item === 'object') {
    const itemRecord = item as Record<string, unknown>;
    if (itemRecord.scope === 'chat' && typeof itemRecord.scopeId === 'string') {
      return itemRecord.scopeId;
    }
  }

  if (d.scope === 'chat' && typeof d.scopeId === 'string') {
    return d.scopeId;
  }

  return undefined;
}
