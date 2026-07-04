import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';

import type { CoreEventBus } from '@tavern/core';
import type { AppDb } from '../db/client.js';
import { sendError } from '../lib/http.js';
import { getRequestAuthContext } from '../plugins/auth.js';
import { getOwnedSessionIds } from '../services/resource-ownership.js';
import { createRealtimeRunLog, type RealtimeRunLog } from '../realtime/run-log/index.js';
import {
  RealtimeResumeCoordinator,
  type FloorRunRecordReader,
  type RealtimeConnectionContext,
} from '../realtime/resume/index.js';
import { WsBridge } from './ws-bridge.js';

export { WsBridge } from './ws-bridge.js';
export type { WsMessage } from './ws-bridge.js';
export type { RealtimeRunLog } from '../realtime/run-log/index.js';
export type { RealtimeResumeCoordinator } from '../realtime/resume/index.js';

export interface WsPluginOptions {
  eventBus: CoreEventBus;
  db: AppDb;
  /**
   * RT3：DB 最终态兜底来源。提供后启用 resume/ack 协议（session 握手 + 缺口补发 + ack 释放）。
   * 不提供则退化为 RT2 旁路缓冲（连接仍只走 WsBridge 瞬时转发）。
   */
  floorRunReader?: FloorRunRecordReader;
}

export interface WsPluginResult {
  bridge: WsBridge;
  /** RT2：per-run 内存事件日志（旁路缓冲，供 RT3 缺口补发使用） */
  runLog: RealtimeRunLog;
  /** RT3：resume/ack 协调器（仅当提供了 floorRunReader 时存在） */
  coordinator?: RealtimeResumeCoordinator;
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
): Promise<WsPluginResult> {
  await app.register(websocket);

  const bridge = new WsBridge(options.eventBus);
  bridge.start();

  // RT2：与 WsBridge 并列订阅同一 eventBus，旁路缓冲带序号的 per-run 事件流。
  // 纯增量、不影响既有转发；不 start() 即等价于关闭 RT2。
  const runLog = createRealtimeRunLog(options.eventBus);
  runLog.start();

  // RT3：在 RT2 事件日志之上接入 resume/ack 协调器（仅当提供 DB 兜底来源时启用）。
  // 默认连接（未发 resume）行为不回归：仍走 WsBridge 瞬时转发；session 帧为新增、旧客户端可忽略。
  const coordinator = options.floorRunReader
    ? new RealtimeResumeCoordinator(runLog, options.floorRunReader)
    : undefined;

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

    if (coordinator) {
      // 无 sessionId 的连接已由 preValidation 限定为 admin（可见所有 run）。
      const context: RealtimeConnectionContext = {
        ...(sessionId !== undefined ? { sessionId } : {}),
        isAdmin: sessionId === undefined,
      };

      // 连接建立后立即下发 session 握手帧（协议版本 + 活动 run 窗口提示）。
      coordinator.sendSessionFrame(socket, context);

      // 上行控制帧（resume / ack）。
      socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
        const text = Array.isArray(raw)
          ? Buffer.concat(raw).toString('utf8')
          : raw instanceof ArrayBuffer
            ? Buffer.from(raw).toString('utf8')
            : raw.toString('utf8');
        coordinator.handleClientMessage(socket, context, text);
      });

      // 连接关闭：清理该 socket 的协调状态。
      socket.on('close', () => {
        coordinator.handleConnectionClose(socket);
      });
    }
  });

  // 在服务关闭时停止桥接、事件日志与协调器（清理订阅与定时器）
  app.addHook('onClose', async () => {
    bridge.stop();
    runLog.stop();
    coordinator?.dispose();
  });

  return { bridge, runLog, ...(coordinator ? { coordinator } : {}) };
}
