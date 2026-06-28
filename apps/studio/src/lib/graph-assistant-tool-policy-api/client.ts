import { getActiveAuthHeaders, getActiveBaseUrl } from "../backend/active";
import type {
  GraphAssistantToolPolicyResponse,
  GraphAssistantToolPolicyUpdateItem,
} from "./types";

export class GraphAssistantToolPolicyApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
    message?: string,
  ) {
    super(message ?? `Graph assistant tool policy request failed with status ${status}`);
    this.name = "GraphAssistantToolPolicyApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined){
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
    throw new GraphAssistantToolPolicyApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

const enc = encodeURIComponent;

function policyPath(projectId: string): string {
  return `/projects/${enc(projectId)}/graph-assistant/tool-policy`;
}

/**
 * 第一方图助手工具策略 API 客户端：直连 apps/api `routes/graph-assistant-tool-policy.ts`
 *（project 作用域），不经公共 SDK。鉴权与 baseUrl 随当前后端连接动态注入。
 */
export const graphAssistantToolPolicyApi = {
  get(projectId: string): Promise<GraphAssistantToolPolicyResponse> {
    return request("GET", policyPath(projectId));
  },
  update(
    projectId: string,
    policies: GraphAssistantToolPolicyUpdateItem[],
  ): Promise<GraphAssistantToolPolicyResponse> {
    return request("PUT", policyPath(projectId), { policies });
  },
};
