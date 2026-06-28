/**
 * 后端引擎实例（连接）模型与鉴权头构造（ENG10 / 阶段 0 地基）。
 *
 * 「后端引擎实例」= studio 连接的 TavernHeadless 后端服务实例本身：URL + 鉴权。
 * 鉴权方式对齐后端 `apps/api/src/plugins/auth.ts`：
 * - dev：无鉴权后端，仅用 `x-account-id` 兼容提示选账号（开发默认）。
 * - api_key：静态 API Key（`x-api-key`）。
 * - client_api_key：Client API Key（`x-tavern-client-key`，可经 `clients` 资源创建/吊销）。
 * - jwt：外部签发的 JWT（`Authorization: Bearer <jwt>`）。
 *
 * 后端**没有「用户名+密码」登录端点**（方向 A 已确认）；「鉴权」即落到上述凭证之一。
 */

export type BackendAuthMode = "dev" | "api_key" | "client_api_key" | "jwt";

export interface BackendConnection {
  /** 稳定 id（默认连接固定为 `default`）。 */
  id: string;
  /** 人类可读名称。 */
  name: string;
  /** 后端基址（规整后末尾不带斜杠）。 */
  baseUrl: string;
  /** 鉴权方式。 */
  authMode: BackendAuthMode;
  /**
   * 鉴权凭证（只写语义）：api_key / client_api_key / jwt 模式下的密钥/令牌。
   * dev 模式不使用。UI 列表只显掩码，不显明文。
   */
  credential?: string | null;
  /** 兼容账号提示（`x-account-id`），主要用于 dev 单账号开发。 */
  accountHint?: string | null;
  /** 是否把 `credential` 持久化到 localStorage（false = 仅会话内存，刷新即失）。 */
  persistCredential?: boolean;
}

/** 规整 baseUrl：去掉末尾斜杠。 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/**
 * 由连接构造鉴权请求头（纯函数，可单测）。
 *
 * - 缺对应凭证时不产出该鉴权头；
 * - 有 `accountHint` 时附带 `x-account-id`（兼容提示，不单独完成认证）；
 * - 无任何头时返回 `undefined`（与 transport `getHeaders` 约定一致）。
 */
export function buildAuthHeaders(connection: BackendConnection): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  const credential = connection.credential?.trim();

  switch (connection.authMode) {
    case "api_key":
      if (credential) {
        headers["x-api-key"] = credential;
      }
      break;
    case "client_api_key":
      if (credential) {
        headers["x-tavern-client-key"] = credential;
      }
      break;
    case "jwt":
      if (credential) {
        headers["authorization"] = `Bearer ${credential}`;
      }
      break;
    case "dev":
    default:
      break;
  }

  const accountHint = connection.accountHint?.trim();
  if (accountHint) {
    headers["x-account-id"] = accountHint;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

/** 把凭证裁剪为掩码（仅显示尾部少量字符），用于列表/详情展示，不回显明文。 */
export function maskCredential(credential: string | null | undefined): string {
  const value = credential?.trim();
  if (!value) {
    return "";
  }
  if (value.length <= 4) {
    return "••••";
  }
  return `••••${value.slice(-4)}`;
}
