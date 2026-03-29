import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';

import type { CoreEventBus } from '@tavern/core';
import type { AppDb } from '../db/client.js';
import { sendError } from '../lib/http.js';
import { getRequestAuthContext } from '../plugins/auth.js';
import { getOwnedSessionIds } from '../services/resource-ownership.js';
import { WsBridge } from './ws-bridge.js';

export { WsBridge } from './ws-bridge.js';
export type { WsMessage } from './ws-bridge.js';

export interface WsPluginOptions {
  eventBus: CoreEventBus;
  db: AppDb;
}

function normalizeSessionId(rawValue: unknown): string | undefined {
  if (typeof rawValue === 'string') {
    const trimmedValue = rawValue.trim();
    return trimmedValue.length > 0 ? trimmedValue : undefined;
  }

  if (Array.isArray(rawValue)) {
    const firstValue = rawValue.find((item): item is string => typeof item === 'string' && item.trim().length > 0);
    if (firstValue) {
      return firstValue.trim();
    }
  }

  return undefined;
}

/**
 * 注册 WebSocket 插件。
 *
 * 路由：GET /ws?session_id=xxx
 * - session_id 可选：设置后只接收该会话的事件
 * - 不设置则接收所有事件（管理员模式）
 */
export async function registerWsPlugin(
  app: FastifyInstance,
  options: WsPluginOptions,
): Promise<WsBridge> {
  await app.register(websocket);

  const bridge = new WsBridge(options.eventBus);
  bridge.start();

  app.get('/ws', {
    websocket: true,
    preValidation: async (request, reply) => {
      const auth = getRequestAuthContext(request);
      const query = request.query as Record<string, unknown>;
      const sessionId = normalizeSessionId(query.session_id);

      if (sessionId) {
        const ownedSessionIds = await getOwnedSessionIds(options.db, auth.accountId, [sessionId]);
        if (ownedSessionIds.length === 0) {
          return sendError(reply, 404, 'not_found', 'Session not found');
        }
        return;
      }

      if (auth.role !== 'admin') {
        return sendError(reply, 403, 'ws_forbidden', 'Only admin can open a global websocket subscription');
      }
    },
  }, (socket, request) => {
    const query = request.query as Record<string, unknown>;
    const sessionId = normalizeSessionId(query.session_id);

    bridge.addClient(socket, sessionId);
  });

  // 在服务关闭时停止桥接
  app.addHook('onClose', async () => {
    bridge.stop();
  });

  return bridge;
}
