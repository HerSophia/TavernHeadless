import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';

import type { CoreEventBus } from '@tavern/core';
import { WsBridge } from './ws-bridge.js';

export { WsBridge } from './ws-bridge.js';
export type { WsMessage } from './ws-bridge.js';

export interface WsPluginOptions {
  eventBus: CoreEventBus;
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

  app.get('/ws', { websocket: true }, (socket, request) => {
    const query = request.query as Record<string, string | undefined>;
    const sessionId = query.session_id;

    bridge.addClient(socket, sessionId);
  });

  // 在服务关闭时停止桥接
  app.addHook('onClose', async () => {
    bridge.stop();
  });

  return bridge;
}
