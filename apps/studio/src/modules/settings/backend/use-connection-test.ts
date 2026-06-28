/**
 * 后端引擎实例「测试连接」composable（ENG10 / 阶段 A）。
 *
 * 对任意连接配置（不一定是当前/已保存连接）发起两步探测，故用原生 fetch（不走当前 SDK 单例）：
 * 1) 可达性：GET `${baseUrl}/health`（后端公开路径，无需鉴权）。
 * 2) 鉴权：GET `${baseUrl}/llm-profiles`（account 作用域，需鉴权），带该连接的鉴权头。
 *    200 → 鉴权通过；401/403 → 鉴权失败；其余 → 其他错误。
 */
import { ref } from "vue";

import { buildAuthHeaders, normalizeBaseUrl, type BackendConnection } from "../../../lib/backend/connection";

export type ConnectionTestStatus = "idle" | "testing" | "ok" | "unreachable" | "auth_failed" | "error";

export interface ConnectionTestResult {
  reachable: boolean | null;
  authed: boolean | null;
  status: ConnectionTestStatus;
  detail?: string;
}

const AUTH_PROBE_PATH = "/llm-profiles";
const HEALTH_PATH = "/health";

export async function testBackendConnection(connection: BackendConnection): Promise<ConnectionTestResult> {
  const baseUrl = normalizeBaseUrl(connection.baseUrl);
  const authHeaders = buildAuthHeaders(connection) ?? {};

  let reachable: boolean | null = null;
  try {
    const health = await fetch(`${baseUrl}${HEALTH_PATH}`, { headers: { accept: "application/json" } });
    reachable = health.ok;
    if (!health.ok) {
      return { reachable, authed: null, status: "unreachable", detail: `health ${health.status}` };
    }
  } catch (cause) {
    return {
      reachable: false,
      authed: null,
      status: "unreachable",
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }

  try {
    const authResp = await fetch(`${baseUrl}${AUTH_PROBE_PATH}`, {
      headers: { accept: "application/json", ...authHeaders },
    });
    if (authResp.ok) {
      return { reachable, authed: true, status: "ok" };
    }
    if (authResp.status === 401 || authResp.status === 403) {
      return { reachable, authed: false, status: "auth_failed", detail: `auth ${authResp.status}` };
    }
    return { reachable, authed: null, status: "error", detail: `status ${authResp.status}` };
  } catch (cause) {
    return {
      reachable,
      authed: null,
      status: "error",
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export function useConnectionTest() {
  const status = ref<ConnectionTestStatus>("idle");
  const result = ref<ConnectionTestResult | null>(null);

  async function run(connection: BackendConnection): Promise<ConnectionTestResult> {
    status.value = "testing";
    result.value = null;
    const outcome = await testBackendConnection(connection);
    status.value = outcome.status;
    result.value = outcome;
    return outcome;
  }

  function reset(): void {
    status.value = "idle";
    result.value = null;
  }

  return { status, result, run, reset };
}
