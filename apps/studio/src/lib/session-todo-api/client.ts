import { getActiveAuthHeaders, getActiveBaseUrl } from "../backend/active";
import type { SessionTodoListResponse, SessionTodoListSnapshot } from "./types";

export class SessionTodoApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
    message?: string,
  ) {
    super(message ?? `Session todo request failed with status ${status}`);
    this.name = "SessionTodoApiError";
  }
}

async function request<T>(method: string, path: string): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  const authHeaders = getActiveAuthHeaders();
  if (authHeaders) {
    Object.assign(headers, authHeaders);
  }

  const response = await fetch(`${getActiveBaseUrl()}${path}`, { method, headers });

  if (!response.ok) {
    let detail: unknown;
    try {
      detail = await response.json();
    } catch {
      detail = null;
    }
    throw new SessionTodoApiError(response.status, detail);
  }

  return (await response.json()) as T;
}

const enc = encodeURIComponent;

/**
 * 第一方会话待办清单 API 客户端：直连 apps/api `routes/session-todo-list.ts`，
 * 不经公共 SDK。鉴权与 baseUrl 随当前后端连接动态注入。
 */
export const sessionTodoApi = {
  /** 读取会话当前待办快照（无记录时返回空清单，revision 0）。 */
  async get(sessionId: string): Promise<SessionTodoListSnapshot> {
    const res = await request<SessionTodoListResponse>(
      "GET",
      `/sessions/${enc(sessionId)}/todo-list`,
    );
    return res.data;
  },
};
