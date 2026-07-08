import { getActiveAuthHeaders, getActiveBaseUrl } from "../backend/active";
import type {
  ToolPolicyPresetConfigInput,
  ToolPolicyPresetCreateInput,
  ToolPolicyPresetDetail,
  ToolPolicyPresetListResponse,
} from "./types";

export class ToolPolicyPresetApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
    message?: string,
  ) {
    super(message ?? `Tool policy preset request failed with status ${status}`);
    this.name = "ToolPolicyPresetApiError";
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
    throw new ToolPolicyPresetApiError(response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

const enc = encodeURIComponent;

function basePath(projectId: string): string {
  return `/projects/${enc(projectId)}/tool-policy-presets`;
}

function presetPath(projectId: string, presetKey: string): string {
  return `${basePath(projectId)}/${enc(presetKey)}`;
}

/**
 * 第一方工具策略预设 API 客户端：直连 apps/api `routes/tool-policy-presets.ts`
 *（project 作用域），不经公共 SDK。鉴权与 baseUrl 随当前后端连接动态注入。
 */
export const toolPolicyPresetApi = {
  /** 列出项目下全部预设 + 统一工具目录。 */
  list(projectId: string): Promise<ToolPolicyPresetListResponse> {
    return request("GET", basePath(projectId));
  },
  /** 单个预设明细（逐工具 effective 策略）。 */
  getDetail(projectId: string, presetKey: string): Promise<ToolPolicyPresetDetail> {
    return request("GET", presetPath(projectId, presetKey));
  },
  /** 更新已存在预设（内置 → 写覆盖；自定义 → 更新）。 */
  update(
    projectId: string,
    presetKey: string,
    config: ToolPolicyPresetConfigInput,
  ): Promise<ToolPolicyPresetDetail> {
    return request("PUT", presetPath(projectId, presetKey), config);
  },
  /** 重置预设（内置 → 删除覆盖回 baseline；自定义 → 后端拒绝）。 */
  reset(projectId: string, presetKey: string): Promise<ToolPolicyPresetDetail> {
    return request("POST", `${presetPath(projectId, presetKey)}/reset`);
  },
  /** 新建自定义预设。 */
  create(
    projectId: string,
    input: ToolPolicyPresetCreateInput,
  ): Promise<ToolPolicyPresetDetail> {
    return request("POST", basePath(projectId), input);
  },
  /** 删除自定义预设（内置 → 后端拒绝 409 builtin_preset_immutable）。 */
  remove(projectId: string, presetKey: string): Promise<{ ok: boolean }> {
    return request("DELETE", presetPath(projectId, presetKey));
  },
};
