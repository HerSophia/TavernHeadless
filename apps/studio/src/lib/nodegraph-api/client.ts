import type { NodeGraphDocument } from "@tavern/core/node-graph";

import { apiBaseUrl } from "../sdk";
import type {
  NodeGraphArchiveResponse,
  NodeGraphGetResponse,
  NodeGraphImportPreflightResponse,
  NodeGraphListResponse,
  NodeGraphMutationResponse,
  NodeGraphPreviewInput,
  NodeGraphPreviewResponse,
  NodeGraphRunEnqueueResponse,
  NodeGraphRunInput,
  NodeGraphRunRecordResponse,
  NodeGraphSetVersionResponse,
  NodeGraphValidationResponse,
  NodeGraphVersionsResponse,
} from "./types";

/** 兼容用途的账号提示（dev 可不设）。设置后以 `x-account-id` 头透传，与 SDK 口径一致。 */
const accountIdHint = import.meta.env.VITE_ACCOUNT_ID;

export class NodeGraphApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
    message?: string,
  ) {
    super(message ?? `NodeGraph API request failed with status ${status}`);
    this.name = "NodeGraphApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (accountIdHint) {
    headers["x-account-id"] = accountIdHint;
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
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
    throw new NodeGraphApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

const enc = encodeURIComponent;

function graphsPath(projectId: string): string {
  return `/projects/${enc(projectId)}/node-graphs`;
}

function graphPath(projectId: string, graphId: string): string {
  return `${graphsPath(projectId)}/${enc(graphId)}`;
}

/**
 * 第一方 NodeGraph API 客户端：直连 apps/api `routes/node-graphs.ts`（project 作用域），
 * 用 `@tavern/core` 类型标注，不经公共 SDK。
 */
export const nodeGraphApi = {
  list(projectId: string): Promise<NodeGraphListResponse> {
    return request("GET", graphsPath(projectId));
  },
  get(projectId: string, graphId: string): Promise<NodeGraphGetResponse> {
    return request("GET", graphPath(projectId, graphId));
  },
  create(projectId: string, document: NodeGraphDocument, name?: string | null): Promise<NodeGraphMutationResponse> {
    return request("POST", graphsPath(projectId), { name: name ?? null, document });
  },
  listVersions(projectId: string, graphId: string): Promise<NodeGraphVersionsResponse> {
    return request("GET", `${graphPath(projectId, graphId)}/versions`);
  },
  createVersion(
    projectId: string,
    graphId: string,
    document: NodeGraphDocument,
    parentVersionId?: string | null,
  ): Promise<NodeGraphMutationResponse> {
    return request("POST", `${graphPath(projectId, graphId)}/versions`, {
      document,
      parent_version_id: parentVersionId ?? null,
    });
  },
  validate(projectId: string, graphId: string, document?: NodeGraphDocument): Promise<NodeGraphValidationResponse> {
    return request("POST", `${graphPath(projectId, graphId)}/validate`, document ? { document } : undefined);
  },
  preview(projectId: string, graphId: string, input?: NodeGraphPreviewInput): Promise<NodeGraphPreviewResponse> {
    return request("POST", `${graphPath(projectId, graphId)}/preview`, input);
  },
  run(projectId: string, graphId: string, input?: NodeGraphRunInput): Promise<NodeGraphRunEnqueueResponse> {
    return request("POST", `${graphPath(projectId, graphId)}/run`, input);
  },
  getRun(projectId: string, runId: string): Promise<NodeGraphRunRecordResponse> {
    return request("GET", `/projects/${enc(projectId)}/node-graph-runs/${enc(runId)}`);
  },
  setCurrentVersion(projectId: string, graphId: string, versionId: string): Promise<NodeGraphSetVersionResponse> {
    return request("POST", `${graphPath(projectId, graphId)}/current-version`, { version_id: versionId });
  },
  archive(projectId: string, graphId: string): Promise<NodeGraphArchiveResponse> {
    return request("POST", `${graphPath(projectId, graphId)}/archive`);
  },
  unarchive(projectId: string, graphId: string): Promise<NodeGraphArchiveResponse> {
    return request("POST", `${graphPath(projectId, graphId)}/unarchive`);
  },
  exportPackage(projectId: string, graphId: string, body?: { version_id?: string; package_version?: string }): Promise<unknown> {
    return request("POST", `${graphPath(projectId, graphId)}/export`, body);
  },
  importPreflight(projectId: string, pkg: unknown): Promise<NodeGraphImportPreflightResponse> {
    return request("POST", `/projects/${enc(projectId)}/node-graph-imports/preflight`, { package: pkg });
  },
  importPackage(projectId: string, pkg: unknown, options?: { confirm?: boolean; name?: string | null }): Promise<unknown> {
    return request("POST", `/projects/${enc(projectId)}/node-graph-imports`, {
      package: pkg,
      confirm: options?.confirm,
      name: options?.name ?? null,
    });
  },
};
