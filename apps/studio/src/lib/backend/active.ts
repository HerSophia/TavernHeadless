/**
 * 当前生效的后端引擎实例（连接）持有处（ENG10 / 阶段 0 地基）。
 *
 * 这是 `lib/sdk`（SDK 客户端工厂）与 `lib/nodegraph-api`（第一方客户端）读取
 * 「连哪个后端、带什么鉴权」的单一运行时来源。默认连接由编译期环境变量派生
 * （保持 v0 行为：`VITE_API_BASE_URL` + `VITE_ACCOUNT_ID`）；`backend-connection`
 * store 初始化后会以持久化/默认连接覆盖之。
 */
import { buildAuthHeaders, normalizeBaseUrl, type BackendConnection } from "./connection";

const ENV_BASE_URL = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000");
const ENV_ACCOUNT_HINT = import.meta.env.VITE_ACCOUNT_ID || null;

/** 编译期环境派生的默认连接（dev 模式，保持 v0 零回归）。 */
export const DEFAULT_BACKEND_CONNECTION: BackendConnection = {
  id: "default",
  name: "Default",
  baseUrl: ENV_BASE_URL,
  authMode: "dev",
  credential: null,
  accountHint: ENV_ACCOUNT_HINT,
  persistCredential: false,
};

let active: BackendConnection = { ...DEFAULT_BACKEND_CONNECTION };

export function getActiveConnection(): BackendConnection {
  return active;
}

export function setActiveConnection(connection: BackendConnection): void {
  active = { ...connection, baseUrl: normalizeBaseUrl(connection.baseUrl) };
}

/** 当前后端基址（供第一方 NodeGraph 客户端与 SDK 工厂使用）。 */
export function getActiveBaseUrl(): string {
  return active.baseUrl;
}

/** 当前后端鉴权头（动态读取，切换凭证无需重建客户端）。 */
export function getActiveAuthHeaders(): Record<string, string> | undefined {
  return buildAuthHeaders(active);
}
