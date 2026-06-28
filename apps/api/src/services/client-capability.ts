import type { ClientKind } from "./client-service.js";

/**
 * WP-B2：Client 能力（capability）模型。
 *
 * Client capability 不再只表达“属于哪个 account”，而是显式声明一个客户端在平台上
 * 可以请求的最小权限集合（对齐《Workspace 与平台基础后续 TODO 清单》第 8 节横切约束 1）。
 *
 * 解析顺序（{@link resolveClientCapabilities}）：
 * 1. 默认 Client（is_default）等价于账户主人，拥有全部能力，永远忽略显式 override。
 * 2. 非默认 Client 若声明了显式 capability override，则完全以 override 为准。
 * 3. 否则按 client kind 的默认能力模板解析。
 *
 * API Key 通过 scope 声明可以进一步收窄（{@link resolveEffectiveKeyCapabilities}），
 * 但 scope 必须是所属 Client 有效能力的子集（最小 scope）。
 */
export const CLIENT_CAPABILITIES = [
  "session.read",
  "session.write",
  "project.config.read",
  "project.config.write",
  "tool.catalog.read",
  "tool.execution.read",
  "tool.policy.write",
  "mcp.binding.write",
  "mcp.server.manage",
  "tool.definition.write",
  "client.manage",
  "workspace.manage",
  "project.manage",
  "audit.read",
] as const;

export type ClientCapability = (typeof CLIENT_CAPABILITIES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(CLIENT_CAPABILITIES);

/**
 * 各 client kind 的默认能力模板。
 *
 * - basic：最基础的聊天接入方，只读工具目录 + 会话读写。
 * - advanced：高级客户端，可读写项目配置、读取工具执行、收窄工具策略与 MCP 绑定。
 * - deriver：派生器，偏只读 + 工具执行观测，不做会话主写入。
 * - worker：后台 worker，可写会话、读项目配置与工具执行。
 * - custom：默认无能力，必须通过显式 capability override 声明（最小授权）。
 */
export const CLIENT_KIND_CAPABILITY_TEMPLATES: Record<ClientKind, readonly ClientCapability[]> = {
  basic: ["session.read", "session.write", "tool.catalog.read"],
  advanced: [
    "session.read",
    "session.write",
    "project.config.read",
    "project.config.write",
    "tool.catalog.read",
    "tool.execution.read",
    "tool.policy.write",
    "mcp.binding.write",
  ],
  deriver: ["session.read", "project.config.read", "tool.catalog.read", "tool.execution.read"],
  worker: [
    "session.read",
    "session.write",
    "project.config.read",
    "tool.catalog.read",
    "tool.execution.read",
  ],
  custom: [],
};

export type ResolveClientCapabilitiesInput = {
  kind: ClientKind;
  isDefault: boolean;
  /** 显式 capability override（JSON array）。null/undefined 表示按 kind 模板解析。 */
  explicit?: readonly string[] | null;
};

/** 返回一个 Client 的有效能力集合（已去重、按 {@link CLIENT_CAPABILITIES} 顺序排序）。 */
export function resolveClientCapabilities(input: ResolveClientCapabilitiesInput): ClientCapability[] {
  if (input.isDefault) {
    return [...CLIENT_CAPABILITIES];
  }

  if (input.explicit !== null && input.explicit !== undefined) {
    return sortCapabilities(filterKnownCapabilities(input.explicit));
  }

  return sortCapabilities(CLIENT_KIND_CAPABILITY_TEMPLATES[input.kind] ?? []);
}

/**
 * 计算 API Key 的有效能力 = Client 有效能力 ∩ key scope。
 *
 * scope 为 null/undefined 时表示继承 Client 的全部有效能力。
 */
export function resolveEffectiveKeyCapabilities(
  clientCapabilities: readonly ClientCapability[],
  scopes: readonly string[] | null | undefined,
): ClientCapability[] {
  if (scopes === null || scopes === undefined) {
    return sortCapabilities(clientCapabilities);
  }
  const allowed = new Set<string>(clientCapabilities);
  return sortCapabilities(filterKnownCapabilities(scopes).filter((capability) => allowed.has(capability)));
}

export class ClientCapabilityError extends Error {
  constructor(
    public readonly code: "client_capability_unknown" | "client_capability_scope_exceeds_client",
    message: string,
    public readonly capabilities: string[] = [],
  ) {
    super(message);
    this.name = "ClientCapabilityError";
  }
}

/**
 * 归一化一组显式 capability：去重、排序、拒绝未知 capability。
 *
 * 用于 Client capability override 的写入校验。
 */
export function normalizeCapabilities(values: readonly string[]): ClientCapability[] {
  const unknown = findUnknownCapabilities(values);
  if (unknown.length > 0) {
    throw new ClientCapabilityError(
      "client_capability_unknown",
      `Unknown client capabilities: ${unknown.join(", ")}`,
      unknown,
    );
  }
  return sortCapabilities(values as readonly ClientCapability[]);
}

/**
 * 归一化 API Key scope：去重、排序、拒绝未知 capability，并保证是 Client 有效能力的子集。
 *
 * 这是“最小 scope 声明”的强制校验：API Key 不能声明超出其 Client 的能力。
 */
export function normalizeKeyScopes(
  values: readonly string[],
  clientCapabilities: readonly ClientCapability[],
): ClientCapability[] {
  const normalized = normalizeCapabilities(values);
  const allowed = new Set<string>(clientCapabilities);
  const exceeding = normalized.filter((capability) => !allowed.has(capability));
  if (exceeding.length > 0) {
    throw new ClientCapabilityError(
      "client_capability_scope_exceeds_client",
      `API key scope exceeds client capabilities: ${exceeding.join(", ")}`,
      exceeding,
    );
  }
  return normalized;
}

/** Parses a stored capability JSON column into a known-capability array, or null if absent. */
export function parseCapabilityJson(value: string | null | undefined): ClientCapability[] | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) {
    return null;
  }
  return sortCapabilities(filterKnownCapabilities(parsed));
}

/** Serializes a capability array to a stable JSON column value, or null when absent. */
export function stringifyCapabilityJson(values: readonly ClientCapability[] | null | undefined): string | null {
  if (values === null || values === undefined) {
    return null;
  }
  return JSON.stringify(sortCapabilities(values));
}

export function isClientCapability(value: unknown): value is ClientCapability {
  return typeof value === "string" && CAPABILITY_SET.has(value);
}

function filterKnownCapabilities(values: readonly unknown[]): ClientCapability[] {
  const result: ClientCapability[] = [];
  for (const value of values) {
    if (isClientCapability(value)) {
      result.push(value);
    }
  }
  return result;
}

function findUnknownCapabilities(values: readonly string[]): string[] {
  const unknown: string[] = [];
  for (const value of values) {
    if (!isClientCapability(value) && !unknown.includes(value)) {
      unknown.push(value);
    }
  }
  return unknown;
}

function sortCapabilities(values: readonly ClientCapability[]): ClientCapability[] {
  const unique = Array.from(new Set(values));
  return unique.sort((left, right) => CLIENT_CAPABILITIES.indexOf(left) - CLIENT_CAPABILITIES.indexOf(right));
}
