import { getActiveAuthHeaders, getActiveBaseUrl } from "../backend/active";
import type {
  GraphAssistantPromptConfigResponse,
  GraphAssistantPromptConfigUpdateInput,
} from "./types";

export class GraphAssistantPromptConfigApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
    message?: string,
  ) {
    super(message ?? `Graph assistant prompt config request failed with status ${status}`);
    this.name = "GraphAssistantPromptConfigApiError";
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
    throw new GraphAssistantPromptConfigApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

const enc = encodeURIComponent;

function configPath(projectId: string): string {
  return `/projects/${enc(projectId)}/graph-assistant/prompt-config`;
}

/**
 * 第一方图助手「上下文与提示词」配置 API 客户端：直连 apps/api
 * `routes/graph-assistant-prompt-config.ts`（project 作用域），不经公共 SDK。
 * 鉴权与 baseUrl 随当前后端连接动态注入。
 */
export const graphAssistantPromptConfigApi = {
  get(projectId: string): Promise<GraphAssistantPromptConfigResponse> {
    return request("GET", configPath(projectId));
  },
  update(
    projectId: string,
    input: GraphAssistantPromptConfigUpdateInput,
  ): Promise<GraphAssistantPromptConfigResponse> {
    return request("PUT", configPath(projectId), input);
  },
};
