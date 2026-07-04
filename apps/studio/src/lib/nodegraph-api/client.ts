import type { NodeGraphDocument } from "@tavern/core/node-graph";

import { getActiveAuthHeaders, getActiveBaseUrl } from "../backend/active";
import type {
  FloorGraphBindingClearResponse,
  FloorGraphBindingKind,
  FloorGraphBindingListResponse,
  FloorGraphBindingMutationResponse,
  FloorGraphBindingSetInput,
  NodeGraphArchiveResponse,
  NodeGraphExportResponse,
  NodeGraphGetResponse,
  NodeGraphImportPreflightResponse,
  NodeGraphImportResponse,
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
  // 鉴权头随当前后端连接动态注入（dev/api_key/client_api_key/jwt + x-account-id 提示）。
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

function floorGraphBindingsPath(projectId: string): string {
  return `/projects/${enc(projectId)}/settings/floor-graph-bindings`;
}

function floorGraphBindingPath(projectId: string, kind: FloorGraphBindingKind): string {
  return `${floorGraphBindingsPath(projectId)}/${enc(kind)}`;
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
  listFloorGraphBindings(projectId: string): Promise<FloorGraphBindingListResponse> {
    return request("GET", floorGraphBindingsPath(projectId));
  },
  setFloorGraphBinding(
    projectId: string,
    kind: FloorGraphBindingKind,
    input: FloorGraphBindingSetInput,
  ): Promise<FloorGraphBindingMutationResponse> {
    return request("PUT", floorGraphBindingPath(projectId, kind), input);
  },
  clearFloorGraphBinding(projectId: string, kind: FloorGraphBindingKind): Promise<FloorGraphBindingClearResponse> {
    return request("DELETE", floorGraphBindingPath(projectId, kind));
  },
  /** 硬删除图定义本身（连同其所有版本）。后端 DELETE，成功返回 204。 */
  remove(projectId: string, graphId: string): Promise<void> {
    return request("DELETE", graphPath(projectId, graphId));
  },
  unarchive(projectId: string, graphId: string): Promise<NodeGraphArchiveResponse> {
    return request("POST", `${graphPath(projectId, graphId)}/unarchive`);
  },
  exportPackage(
    projectId: string,
    graphId: string,
    body?: { version_id?: string; package_version?: string },
  ): Promise<NodeGraphExportResponse> {
    return request("POST", `${graphPath(projectId, graphId)}/export`, body);
  },
  importPreflight(projectId: string, pkg: unknown): Promise<NodeGraphImportPreflightResponse> {
    return request("POST", `/projects/${enc(projectId)}/node-graph-imports/preflight`, { package: pkg });
  },
  importPackage(projectId: string, pkg: unknown, options?: { confirm?: boolean; name?: string | null }): Promise<NodeGraphImportResponse> {
    return request("POST", `/projects/${enc(projectId)}/node-graph-imports`, {
      package: pkg,
      confirm: options?.confirm,
      name: options?.name ?? null,
    });
  },
};
