import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq } from "drizzle-orm";

import type { DatabaseConnection } from "../db/client.js";
import { parseWithSchema, sendError } from "../lib/http.js";
import { getRequestAuthContext } from "../plugins/auth.js";
import { sessions } from "../db/schema.js";
import {
  SessionTodoListService,
  type SessionTodoListSnapshot,
} from "../services/session-todo-list-service.js";

const sessionParamsSchema = z.object({ id: z.string().min(1) });

/** 快照 → HTTP 响应（snake_case，对齐第一方路由风格）。 */
function toTodoListResponse(snapshot: SessionTodoListSnapshot) {
  return {
    session_id: snapshot.sessionId,
    revision: snapshot.revision,
    updated_at: snapshot.updatedAt,
    counts: snapshot.counts,
    items: snapshot.items.map((item) => ({
      id: item.id,
      title: item.title,
      status: item.status,
      ...(item.note !== undefined ? { note: item.note } : {}),
    })),
  };
}

/**
 * 注册会话待办事项清单读取路由（SC2-12 / #b4-9）。
 *
 * `GET /sessions/:id/todo-list` 返回会话当前 TODO 快照，供主聊天顶部的待办摘要卡渲染。
 * 属于第一方接入面，不进入 OpenAPI / @tavern/sdk 生成面；studio 经薄客户端直连。
 * 按会话所有者账户读取（与工具写入时的 accountId 一致）。
 */
export async function registerSessionTodoListRoutes(
  app: FastifyInstance,
  connection: DatabaseConnection,
): Promise<void> {
  const db = connection.db;

  app.get("/sessions/:id/todo-list", async (request, reply) => {
    const params = parseWithSchema(sessionParamsSchema, request.params, reply);
    if (!params.ok) return;

    const auth = getRequestAuthContext(request);
    const row = db
      .select({ id: sessions.id, accountId: sessions.accountId })
      .from(sessions)
      .where(and(eq(sessions.id, params.data.id), eq(sessions.accountId, auth.accountId)))
      .limit(1)
      .get();

    if (!row) {
      return sendError(reply, 404, "not_found", "Session not found");
    }

    const snapshot = new SessionTodoListService(db).getSnapshot(row.id, row.accountId);
    return reply.send({ data: toTodoListResponse(snapshot) });
  });
}
