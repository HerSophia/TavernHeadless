/**
 * URL 安全校验模块
 *
 * 检测 URL 是否指向内网/保留地址，防止 SSRF 攻击。
 * 支持用户通过 allowPrivateNetwork 选项显式确认放行。
 */

export class UrlGuardError extends Error {
  readonly code = "ssrf_blocked" as const;
  readonly statusCode = 400;

  constructor(
    message = "The provided base_url points to a private or reserved address. Set allow_private_network to true if this is intentional.",
  ) {
    super(message);
    this.name = "UrlGuardError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * 校验 URL 是否安全。
 *
 * - 仅允许 http/https 协议（始终强制，即使 allowPrivateNetwork 为 true）。
 * - 检测内网/保留地址（loopback、RFC 1918、link-local 等）。
 * - 如果 allowPrivateNetwork 为 true，跳过内网地址检测。
 *
 * @throws {UrlGuardError} URL 不安全时抛出
 */
export function assertSafeUrl(
  rawUrl: string,
  options?: { allowPrivateNetwork?: boolean },
): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UrlGuardError(`Invalid URL: ${rawUrl}`);
  }

  // 协议校验始终强制
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new UrlGuardError(
      `Unsupported protocol: ${parsed.protocol}. Only http and https are allowed.`,
    );
  }

  // 用户确认放行则跳过地址检测
  if (options?.allowPrivateNetwork) {
    return;
  }

  if (isPrivateHostname(parsed.hostname)) {
    throw new UrlGuardError();
  }
}

// ── 内部检测函数 ────────────────────────────────────────

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // 防御性剥离 IPv6 方括号（WHATWG URL 标准的 hostname 不含方括号，但做兼容处理）
  const cleaned = lower.startsWith("[") && lower.endsWith("]")
    ? lower.slice(1, -1)
    : lower;

  // localhost 及子域名
  if (cleaned === "localhost" || cleaned.endsWith(".localhost")) {
    return true;
  }

  // IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleaned)) {
    return isPrivateIPv4(cleaned);
  }

  // IPv6（URL 解析器已移除方括号）
  if (cleaned.includes(":")) {
    return isPrivateIPv6(cleaned);
  }

  return false;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) {
    return false;
  }

  const [a, b] = parts as [number, number, number, number];

  if (a === 0 && parts.every((p) => p === 0)) return true;   // 0.0.0.0
  if (a === 127) return true;                                 // 127.0.0.0/8
  if (a === 10) return true;                                  // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;           // 172.16.0.0/12
  if (a === 192 && b === 168) return true;                    // 192.168.0.0/16
  if (a === 169 && b === 254) return true;                    // 169.254.0.0/16

  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  // ::1 loopback
  if (lower === "::1") return true;
  // :: unspecified
  if (lower === "::") return true;

  // ::ffff:x.x.x.x IPv4-mapped IPv6
  const v4mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4mapped) {
    return isPrivateIPv4(v4mapped[1]!);
  }

  // fe80::/10 link-local
  if (lower.startsWith("fe80:") || lower === "fe80") return true;

  // fc00::/7 unique local (fc00:: through fdff::)
  if (/^f[cd][0-9a-f]{0,2}:/.test(lower)) return true;

  return false;
}
