import { getActiveAuthHeaders, getActiveBaseUrl } from "../backend/active";
import type {
  ListPendingToolCallsResponse,
  ResolvePendingToolCallDecision,
  ResolvePendingToolCallResponse,
} from "./types";

export class GraphAssistantConfirmationApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
    message?: string,
  ) {
    super(message ?? `Graph assistant confirmation request failed with status ${status}`);
    this.name = "GraphAssistantConfirmationApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const authHeaders = getActiveAuthHeaders();
  if (authHeaders) {
    Object.assign(headers, authHeaders);
  }

  const response = await fetch(`${getActiveBaseUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    let detail: unknown;
    try {
      detail = await response.json();
    } catch {
      detail = null;
    }
    throw new GraphAssistantConfirmationApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

const enc = encodeURIComponent;

function pendingPath(conversationId: string): string {
  return `/temporary-conversations/${enc(conversationId)}/pending-tool-calls`;
}

function resolvePath(conversationId: string, confirmationId: string): string {
  return `${pendingPath(conversationId)}/${enc(confirmationId)}`;
}

/**
 * 第一方图助手「执行前确认闸」恢复接口客户端：直连 apps/api
 * `routes/temporary-conversations.ts` 的 pending-tool-calls 路由（临时对话作用域），
 * 不经公共 SDK（这些路由刻意不进入 OpenAPI 生成面）。鉴权与 baseUrl 随当前后端连接动态注入。
 */
export const graphAssistantConfirmationApi = {
  /** 列出某临时对话当前处于 pending 的待确认工具调用。 */
  listPending(conversationId: string): Promise<ListPendingToolCallsResponse> {
    return request("GET", pendingPath(conversationId));
  },
  /**
   * 解决一条待确认：approve（批准并自动续跑）或 reject（拒绝并把控制权交回用户）。
   * approve 返回续跑后的最终结果；可能再次进入待确认。
   */
  resolve(
    conversationId: string,
    confirmationId: string,
    decision: ResolvePendingToolCallDecision,
  ): Promise<ResolvePendingToolCallResponse> {
    return request("POST", resolvePath(conversationId, confirmationId), { decision });
  },
};
