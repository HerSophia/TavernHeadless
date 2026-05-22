import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { agentTypes, projectAgentBindings } from "../db/schema.js";
import {
  AGENT_SCOPE_KIND_VALUES,
  AGENT_TYPE_STATUS_VALUES,
  type AgentEventSubscription,
  type AgentMcpBindingEntry,
  type AgentScopeKind,
  type AgentTypeDefaults,
  type AgentTypeStatus,
} from "./agent-scope-types.js";
import {
  AgentPermissionPolicyError,
  assertAgentScopeKind,
  assertAllowedOutputTargets,
} from "./agent-permission-policy.js";

export type AgentTypeServiceErrorCode =
  | "agent_type_key_conflict"
  | "agent_type_not_found"
  | "agent_type_workspace_required"
  | "agent_type_in_use"
  | "agent_type_account_only";

export class AgentTypeServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 403 | 404 | 409,
    public readonly code: AgentTypeServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentTypeServiceError";
  }
}

export type AgentTypeRecord = {
  id: string;
  workspaceId: string;
  accountId: string;
  key: string;
  name: string;
  scopeKind: AgentScopeKind;
  status: AgentTypeStatus;
  defaults: AgentTypeDefaults;
  createdAt: number;
  updatedAt: number;
};

export interface CreateAgentTypeInput {
  workspaceId: string;
  accountId: string;
  key: string;
  name: string;
  scopeKind: AgentScopeKind | string;
  defaults?: Partial<AgentTypeDefaults>;
}

export interface UpdateAgentTypeInput {
  name?: string;
  status?: AgentTypeStatus;
  defaults?: Partial<AgentTypeDefaults>;
}

export class AgentTypeService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  list(input: { workspaceId: string; accountId: string }): AgentTypeRecord[] {
    const rows = this.db
      .select()
      .from(agentTypes)
     .where(and(
        eq(agentTypes.workspaceId, input.workspaceId),
        eq(agentTypes.accountId, input.accountId),
      ))
      .all();
    return rows.map(rowToRecord);
  }

  getById(input: { id: string; accountId: string }): AgentTypeRecord {
    const row = this.db
      .select()
      .from(agentTypes)
      .where(and(eq(agentTypes.id, input.id), eq(agentTypes.accountId, input.accountId)))
      .limit(1)
      .all()[0];
    if (!row) {
      throw new AgentTypeServiceError(404, "agent_type_not_found", `Agent type not found: ${input.id}`);
    }
    return rowToRecord(row);
  }

  create(input: CreateAgentTypeInput, now = Date.now()): AgentTypeRecord {
    const scopeKind = assertAgentScopeKind(input.scopeKind as string);
    const defaults = normaliseDefaults(input.defaults);

    const existing = this.db
      .select({ id: agentTypes.id })
      .from(agentTypes)
     .where(and(
        eq(agentTypes.workspaceId, input.workspaceId),
        eq(agentTypes.key, input.key),
      ))
      .limit(1)
      .all()[0];
    if (existing) {
      throw new AgentTypeServiceError(409, "agent_type_key_conflict", `Agent type key already exists: ${input.key}`);
    }

    const id = `agt_${nanoid(16)}`;
    this.db
      .insert(agentTypes)
      .values({
        id,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        key: input.key,
        name: input.name,
        scopeKind,
        status: "active",
        defaultLlmProfileId: defaults.llmProfileId ?? null,
        defaultToolPolicyId: defaults.toolPolicyId ?? null,
        defaultMcpBindingJson: JSON.stringify({ servers: defaults.mcpBindings }),
        defaultEventSubscriptionsJson: JSON.stringify(defaults.eventSubscriptions),
        defaultGrantsJson: JSON.stringify(defaults.grants),
        metadataJson: JSON.stringify(defaults.metadata),
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return this.getById({ id, accountId: input.accountId });
  }

  update(
    input: { id: string; accountId: string },
    patch: UpdateAgentTypeInput,
    now = Date.now(),
  ): AgentTypeRecord {
    const existing = this.getById(input);
    const merged: AgentTypeDefaults = patch.defaults
      ? normaliseDefaults({ ...existing.defaults, ...patch.defaults })
      : existing.defaults;

    const nextStatus = patch.status ?? existing.status;
    if (!(AGENT_TYPE_STATUS_VALUES as readonly string[]).includes(nextStatus)) {
      throw new AgentTypeServiceError(400, "agent_type_not_found", `Invalid status: ${nextStatus}`);
    }

    this.db
      .update(agentTypes)
      .set({
        name: patch.name ?? existing.name,
        status: nextStatus,
        defaultLlmProfileId: merged.llmProfileId ?? null,
        defaultToolPolicyId: merged.toolPolicyId ?? null,
        defaultMcpBindingJson: JSON.stringify({ servers: merged.mcpBindings }),
        defaultEventSubscriptionsJson: JSON.stringify(merged.eventSubscriptions),
        defaultGrantsJson: JSON.stringify(merged.grants),
        metadataJson: JSON.stringify(merged.metadata),
        updatedAt: now,
      })
      .where(and(eq(agentTypes.id, input.id), eq(agentTypes.accountId, input.accountId)))
      .run();

    return this.getById(input);
  }

  setStatus(
    input: { id: string; accountId: string; status: AgentTypeStatus },
    now = Date.now(),
  ): AgentTypeRecord {
    const existing = this.getById({ id: input.id, accountId: input.accountId });
    if (existing.status === input.status) {
      return existing;
    }

    if (input.status === "disabled") {
      const enabledBinding = this.db
        .select({ id: projectAgentBindings.id })
        .from(projectAgentBindings)
        .where(and(
          eq(projectAgentBindings.agentTypeId, input.id),
          eq(projectAgentBindings.accountId, input.accountId),
          eq(projectAgentBindings.status, "enabled"),
        ))
        .limit(1)
        .all()[0];
      if (enabledBinding) {
        throw new AgentTypeServiceError(409, "agent_type_in_use", `Agent type is still enabled by project binding: ${enabledBinding.id}`);
      }
    }

    return this.update({ id: input.id, accountId: input.accountId }, { status: input.status }, now);
  }
}

function normaliseDefaults(defaults: Partial<AgentTypeDefaults> | undefined): AgentTypeDefaults {
  const grants = { ...(defaults?.grants ?? {}) };
  const allowedTargets = grants["allowed_output_targets"];
  if (Array.isArray(allowedTargets)) {
    grants["allowed_output_targets"] = assertAllowedOutputTargets(allowedTargets as string[]);
  }

  return {
    llmProfileId: defaults?.llmProfileId ?? null,
    toolPolicyId: defaults?.toolPolicyId ?? null,
    mcpBindings: (defaults?.mcpBindings ?? []).map(normaliseMcp),
    eventSubscriptions: (defaults?.eventSubscriptions ?? []).map(normaliseSubscription),
    grants,
    metadata: defaults?.metadata ?? {},
  };
}

function normaliseMcp(entry: AgentMcpBindingEntry): AgentMcpBindingEntry {
  return {
    mcpServerId: entry.mcpServerId,
    allowedTools: entry.allowedTools ? Array.from(new Set(entry.allowedTools)) : undefined,
    configOverrideJson: entry.configOverrideJson ?? null,
  };
}

function normaliseSubscription(entry: AgentEventSubscription): AgentEventSubscription {
  return {
    type: entry.type,
    filterJson: entry.filterJson ?? null,
  };
}

function rowToRecord(row: typeof agentTypes.$inferSelect): AgentTypeRecord {
  const mcpBindings = parseMcpBindingsJson(row.defaultMcpBindingJson);
  const eventSubscriptions = parseSubscriptionsJson(row.defaultEventSubscriptionsJson);
  const grants = parseRecordJson(row.defaultGrantsJson);
  const metadata = parseRecordJson(row.metadataJson);

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    accountId: row.accountId,
    key: row.key,
    name: row.name,
    scopeKind: row.scopeKind,
    status: row.status,
    defaults: {
      llmProfileId: row.defaultLlmProfileId,
      toolPolicyId: row.defaultToolPolicyId,
      mcpBindings,
      eventSubscriptions,
      grants,
      metadata,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseRecordJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseMcpBindingsJson(raw: string | null | undefined): AgentMcpBindingEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray((parsed as { servers?: unknown }).servers)) {
      return ((parsed as { servers: AgentMcpBindingEntry[] }).servers ?? []).map((entry) => ({
        mcpServerId: String(entry.mcpServerId ?? ""),
        allowedTools: Array.isArray(entry.allowedTools) ? entry.allowedTools.map(String) : undefined,
        configOverrideJson: (entry.configOverrideJson ?? null) as Record<string, unknown> | null,
      })).filter((entry) => entry.mcpServerId.length > 0);
    }
    return [];
  } catch {
    return [];
  }
}

function parseSubscriptionsJson(raw: string | null | undefined): AgentEventSubscription[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry: unknown) => ({
          type: String((entry as { type?: unknown })?.type ?? ""),
          filterJson: ((entry as { filterJson?: Record<string, unknown> | null })?.filterJson ?? null) as Record<string, unknown> | null,
        }))
        .filter((entry) => entry.type.length > 0);
    }
    return [];
  } catch {
    return [];
  }
}

export const __testing__ = {
  AGENT_SCOPE_KIND_VALUES,
  AgentPermissionPolicyError,
};
