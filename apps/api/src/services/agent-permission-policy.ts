/**
 *Phase 5 agent permission policy.
 *
 * Centralises the shared invariants that AgentTypeService,
 * ProjectAgentBindingService and AgentJobTriggerService must all enforce.
 *
 * Rules enforced here (matching the Phase 5 design draft):
 *
 * - allowed_output_targets must be a subset of
 *   {@link DEFAULT_AGENT_ALLOWED_OUTPUT_TARGETS}.
 * - Targets listed in {@link FORBIDDEN_AGENT_OUTPUT_TARGETS} must never appear
 *   in any agent type default, project binding override or runtime trigger
 *   request. This is the main-narrative write protection.
 * - scope_kind must be one of {@link AGENT_SCOPE_KINDS}.
 * - project_agent_binding overrides may only narrow the agent type defaults,
 *   never expand them.
 */
import type { AgentScopeKind } from "./agent-scope-types.js";

export const AGENT_SCOPE_KINDS = [
  "floor",
  "session",
  "project",
  "workspace",
] as const;

export type AgentAllowedOutputTarget =
  | "page_staged_write"
  | "derived_output"
  | "project_inbox"
  | "session_state_proposal"
  | "client_data"
  | "plugin_data";

export const DEFAULT_AGENT_ALLOWED_OUTPUT_TARGETS: ReadonlySet<AgentAllowedOutputTarget> = new Set([
  "page_staged_write",
  "derived_output",
  "project_inbox",
  "session_state_proposal",
  "client_data",
  "plugin_data",
]);

export const FORBIDDEN_AGENT_OUTPUT_TARGETS: ReadonlySet<string> = new Set([
  "session_messages",
  "floor",
  "page_active",
  "variable_live",
  "memory_live",
  "session_state_live_head",
]);

export type AgentPermissionViolationCode =
  | "agent_allowed_output_target_invalid"
  | "agent_allowed_output_target_forbidden"
| "agent_scope_kind_invalid"
  | "agent_override_expands_grants"
  | "agent_override_expands_subscriptions"
  | "agent_override_expands_output_targets"
  | "agent_override_expands_mcp";

export class AgentPermissionPolicyError extends Error {
  constructor(
    public readonly statusCode: 400 | 403,
    public readonly code: AgentPermissionViolationCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
this.name = "AgentPermissionPolicyError";
  }
}

export function assertAgentScopeKind(scopeKind: string): AgentScopeKind {
  if ((AGENT_SCOPE_KINDS as readonly string[]).includes(scopeKind)) {
    return scopeKind as AgentScopeKind;
  }
  throw new AgentPermissionPolicyError(
    400,
    "agent_scope_kind_invalid",
    `Unsupported agent scope_kind: ${scopeKind}`,
    { scopeKind },
  );
}

export function assertAllowedOutputTargets(
  targets: readonly string[],
): AgentAllowedOutputTarget[] {
  const normalised: AgentAllowedOutputTarget[] = [];
  for (const raw of targets) {
    const target = raw?.trim?.() ?? "";
    if (target.length === 0) continue;

    if (FORBIDDEN_AGENT_OUTPUT_TARGETS.has(target)) {
      throw new AgentPermissionPolicyError(
        403,
        "agent_allowed_output_target_forbidden",
        `Agent output target is reserved for the main narrative path: ${target}`,
        { target },
      );
    }

    if (!DEFAULT_AGENT_ALLOWED_OUTPUT_TARGETS.has(target as AgentAllowedOutputTarget)) {
      throw new AgentPermissionPolicyError(
   400,
        "agent_allowed_output_target_invalid",
        `Unknown agent output target: ${target}`,
        { target },
      );
    }

    if (!normalised.includes(target as AgentAllowedOutputTarget)) {
      normalised.push(target as AgentAllowedOutputTarget);
    }
  }
  return normalised;
}

/**
 * Verifies that the override targets are a subset of the agent type defaults.
 */
export function assertOutputTargetsNarrowing(
  defaults: readonly AgentAllowedOutputTarget[],
  overrides: readonly AgentAllowedOutputTarget[],
): void {
  const defaultsSet = new Set(defaults);
  for (const target of overrides) {
    if (!defaultsSet.has(target)) {
      throw new AgentPermissionPolicyError(
        403,
        "agent_override_expands_output_targets",
        `Project binding cannot expand allowed_output_targets beyond the agent type default: ${target}`,
        { target },
      );
    }
  }
}

/**
 * Verifies that the override grant map is a subset of the agent type defaults.
 */
export function assertGrantsNarrowing(
  defaults: Record<string, unknown>,
  overrides: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(overrides)) {
    if (!(key in defaults)) {
      throw new AgentPermissionPolicyError(
        403,
        "agent_override_expands_grants",
        `Project binding cannot grant capability that is not in agent type defaults: ${key}`,
        { key },
      );
    }
    const defaultValue = defaults[key];
    if (Array.isArray(defaultValue) && Array.isArray(value)) {
      const defaultsSet = new Set(defaultValue);
      for (const v of value) {
        if (!defaultsSet.has(v)) {
          throw new AgentPermissionPolicyError(
            403,
            "agent_override_expands_grants",
            `Project binding cannot expand capability '${key}' beyond agent type default: ${String(v)}`,
            { key, value: v },
          );
        }
      }
    } else if (defaultValue === false && value === true) {
      throw new AgentPermissionPolicyError(
        403,
        "agent_override_expands_grants",
        `Project binding cannot enable capability '${key}' when agent type default disables it`,
        { key },
      );
    }
  }
}

export function assertSubscriptionsNarrowing(
  defaults: readonly string[],
  overrides: readonly string[],
): void {
  const defaultsSet = new Set(defaults);
  for (const subscription of overrides) {
    if (!defaultsSet.has(subscription)) {
      throw new AgentPermissionPolicyError(
        403,
        "agent_override_expands_subscriptions",
        `Project binding cannot subscribe to events not in agent type defaults: ${subscription}`,
        { subscription },
      );
    }
  }
}

export function assertMcpNarrowing(
  defaults: Record<string, { allowedTools?: readonly string[] }>,
  overrides: Record<string, { allowedTools?: readonly string[] }>,
): void {
  for (const [serverId, override] of Object.entries(overrides)) {
    const defaultEntry = defaults[serverId];
    if (!defaultEntry) {
      throw new AgentPermissionPolicyError(
        403,
        "agent_override_expands_mcp",
        `Project binding cannot bind to MCP server not in agent type defaults: ${serverId}`,
        { serverId },
      );
    }

    const defaultTools = new Set(defaultEntry.allowedTools ?? []);
    if (defaultTools.size === 0) {
      continue;
    }

    for (const tool of override.allowedTools ?? []) {
      if (!defaultTools.has(tool)) {
        throw new AgentPermissionPolicyError(
          403,
          "agent_override_expands_mcp",
          `Project binding cannot allow MCP tool not in agent type defaults: ${serverId}/${tool}`,
          { serverId, tool },
        );
      }
    }
  }
}
