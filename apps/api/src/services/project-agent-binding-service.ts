import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { projectAgentBindings } from "../db/schema.js";
import {
  AGENT_SCOPE_KIND_VALUES,
  PROJECT_AGENT_BINDING_STATUS_VALUES,
  type AgentEventSubscription,
  type AgentMcpBindingEntry,
  type AgentScopeKind,
  type AgentTypeDefaults,
  type ProjectAgentBindingStatus,
} from "./agent-scope-types.js";
import {
  AgentPermissionPolicyError,
  assertAgentScopeKind,
  assertAllowedOutputTargets,
  assertGrantsNarrowing,
  assertMcpNarrowing,
  assertOutputTargetsNarrowing,
  assertSubscriptionsNarrowing,
  type AgentAllowedOutputTarget,
} from "./agent-permission-policy.js";
import {
  AgentTypeService,
  AgentTypeServiceError,
  type AgentTypeRecord,
} from "./agent-type-service.js";

export type ProjectAgentBindingServiceErrorCode =
  | "binding_not_found"
  | "binding_already_exists"
  | "agent_type_disabled"
  | "agent_type_workspace_mismatch"
  | "binding_invalid_status";

export class ProjectAgentBindingServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 403 | 404 | 409,
    public readonly code: ProjectAgentBindingServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectAgentBindingServiceError";
  }
}

export interface ProjectAgentBindingRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  accountId: string;
  agentTypeId: string;
  status: ProjectAgentBindingStatus;
  scopeKind: AgentScopeKind;
  llmProfileId: string | null;
  toolPolicyId: string | null;
  mcpBindings: AgentMcpBindingEntry[];
  eventSubscriptions: AgentEventSubscription[];
  grants: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface CreateProjectAgentBindingInput {
  workspaceId: string;
  projectId: string;
  accountId: string;
  agentTypeId: string;
  scopeKind?: AgentScopeKind | string;
  llmProfileId?: string | null;
  toolPolicyId?: string | null;
  mcpBindings?: AgentMcpBindingEntry[];
  eventSubscriptions?: AgentEventSubscription[];
  grants?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UpdateProjectAgentBindingInput {
  scopeKind?: AgentScopeKind | string;
  status?: ProjectAgentBindingStatus;
  llmProfileId?: string | null;
  toolPolicyId?: string | null;
  mcpBindings?: AgentMcpBindingEntry[];
  eventSubscriptions?: AgentEventSubscription[];
  grants?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ResolveEffectiveAgentBindingResult {
  agentType: AgentTypeRecord;
  binding: ProjectAgentBindingRecord;
  /**
   * Effective configuration merged from agent type defaults and the project
   * binding override. Override fields that are explicit nulls fall back to
   * defaults; otherwise the override wins.
   */
  effective: {
    llmProfileId: string | null;
    toolPolicyId: string | null;
    mcpBindings: AgentMcpBindingEntry[];
    eventSubscriptions: AgentEventSubscription[];
    grants: Record<string, unknown>;
    allowedOutputTargets: AgentAllowedOutputTarget[];
  };
}

export class ProjectAgentBindingService {
  private readonly agentTypeService: AgentTypeService;

  constructor(
    private readonly db: AppDb | DbExecutor,
    options: { agentTypeService?: AgentTypeService } = {},
  ) {
    this.agentTypeService = options.agentTypeService ?? new AgentTypeService(db);
  }

  listByProject(input: { projectId: string; accountId: string }): ProjectAgentBindingRecord[] {
    const rows = this.db
      .select()
      .from(projectAgentBindings)
      .where(and(
        eq(projectAgentBindings.projectId, input.projectId),
        eq(projectAgentBindings.accountId, input.accountId),
      ))
      .all();
    return rows.map(rowToRecord);
  }

  getById(input: { id: string; accountId: string }): ProjectAgentBindingRecord {
    const row = this.db
      .select()
      .from(projectAgentBindings)
      .where(and(
        eq(projectAgentBindings.id, input.id),
        eq(projectAgentBindings.accountId, input.accountId),
      ))
      .limit(1)
      .all()[0];
    if (!row) {
      throw new ProjectAgentBindingServiceError(
        404,
        "binding_not_found",
        `Agent binding not found: ${input.id}`,
      );
    }
    return rowToRecord(row);
  }

  create(input: CreateProjectAgentBindingInput, now = Date.now()): ProjectAgentBindingRecord {
    const agentType = this.agentTypeService.getById({
      id: input.agentTypeId,
      accountId: input.accountId,
    });

    if (agentType.workspaceId !== input.workspaceId) {
      throw new ProjectAgentBindingServiceError(
        409,
        "agent_type_workspace_mismatch",
        `Agent type belongs to another workspace: ${agentType.workspaceId}`,
      );
    }
    if (agentType.status !== "active") {
      throw new ProjectAgentBindingServiceError(
        409,
        "agent_type_disabled",
        `Agent type is not active: ${agentType.id}`,
      );
    }

    const scopeKind = assertAgentScopeKind((input.scopeKind ?? agentType.scopeKind) as string);
    if (scopeKind !== agentType.scopeKind) {
      throw new ProjectAgentBindingServiceError(
        409,
        "agent_type_workspace_mismatch",
        `Binding scope_kind must equal agent type scope_kind: ${agentType.scopeKind}`,
      );
    }
    const normalised = this.assertNarrowing(agentType, {
      llmProfileId: input.llmProfileId ?? null,
      toolPolicyId: input.toolPolicyId ?? null,
      mcpBindings: input.mcpBindings ?? [],
      eventSubscriptions: input.eventSubscriptions ?? [],
      grants: input.grants ?? {},
      metadata: input.metadata ?? {},
    });

    const existing = this.db
      .select({ id: projectAgentBindings.id })
      .from(projectAgentBindings)
      .where(and(
        eq(projectAgentBindings.projectId, input.projectId),
        eq(projectAgentBindings.agentTypeId, input.agentTypeId),
      ))
      .limit(1)
      .all()[0];
    if (existing) {
      return this.getById({ id: existing.id, accountId: input.accountId });
    }

    const id = `agb_${nanoid(16)}`;
    this.db
      .insert(projectAgentBindings)
      .values({
        id,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        accountId: input.accountId,
        agentTypeId: input.agentTypeId,
        status: "enabled",
        scopeKind,
        llmProfileId: normalised.llmProfileId,
        toolPolicyId: normalised.toolPolicyId,
        mcpBindingJson: JSON.stringify({ servers: normalised.mcpBindings }),
        eventSubscriptionsJson: JSON.stringify(normalised.eventSubscriptions),
        grantsJson: JSON.stringify(normalised.grants),
        metadataJson: JSON.stringify(normalised.metadata),
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return this.getById({ id, accountId: input.accountId });
  }

  update(
    input: { id: string; accountId: string },
    patch: UpdateProjectAgentBindingInput,
    now = Date.now(),
  ): ProjectAgentBindingRecord {
    const existing = this.getById(input);
    const agentType = this.agentTypeService.getById({
      id: existing.agentTypeId,
      accountId: input.accountId,
    });

    const scopeKind = patch.scopeKind
      ? assertAgentScopeKind(patch.scopeKind as string)
      : existing.scopeKind;
    if (scopeKind !== agentType.scopeKind) {
      throw new ProjectAgentBindingServiceError(
        409,
        "agent_type_workspace_mismatch",
        `Binding scope_kind must equal agent type scope_kind: ${agentType.scopeKind}`,
      );
    }

    const merged = this.assertNarrowing(agentType, {
      llmProfileId: patch.llmProfileId !== undefined ? patch.llmProfileId : existing.llmProfileId,
      toolPolicyId: patch.toolPolicyId !== undefined ? patch.toolPolicyId : existing.toolPolicyId,
      mcpBindings: patch.mcpBindings ?? existing.mcpBindings,
      eventSubscriptions: patch.eventSubscriptions ?? existing.eventSubscriptions,
      grants: patch.grants ?? existing.grants,
      metadata: patch.metadata ?? existing.metadata,
    });

    let nextStatus = patch.status ?? existing.status;
    if (!(PROJECT_AGENT_BINDING_STATUS_VALUES as readonly string[]).includes(nextStatus)) {
      throw new ProjectAgentBindingServiceError(
        400,
        "binding_invalid_status",
        `Invalid binding status: ${nextStatus}`,
      );
    }

    this.db
      .update(projectAgentBindings)
      .set({
        scopeKind,
        status: nextStatus,
        llmProfileId: merged.llmProfileId,
        toolPolicyId: merged.toolPolicyId,
        mcpBindingJson: JSON.stringify({ servers: merged.mcpBindings }),
        eventSubscriptionsJson: JSON.stringify(merged.eventSubscriptions),
        grantsJson: JSON.stringify(merged.grants),
        metadataJson: JSON.stringify(merged.metadata),
        updatedAt: now,
      })
      .where(and(
        eq(projectAgentBindings.id, input.id),
        eq(projectAgentBindings.accountId, input.accountId),
      ))
      .run();

    return this.getById(input);
  }

  resolveEffective(input: { id: string; accountId: string }): ResolveEffectiveAgentBindingResult {
    const binding = this.getById(input);
    const agentType = this.agentTypeService.getById({
      id: binding.agentTypeId,
      accountId: input.accountId,
    });

    const defaultsAllowed = readAllowedOutputTargets(agentType.defaults.grants);
    const overrideAllowed = readAllowedOutputTargets(binding.grants);
    const allowedOutputTargets = overrideAllowed.length > 0 ? overrideAllowed : defaultsAllowed;

    const effective = {
      llmProfileId: binding.llmProfileId ?? agentType.defaults.llmProfileId ?? null,
      toolPolicyId: binding.toolPolicyId ?? agentType.defaults.toolPolicyId ?? null,
      mcpBindings: binding.mcpBindings.length > 0 ? binding.mcpBindings : agentType.defaults.mcpBindings,
      eventSubscriptions:
        binding.eventSubscriptions.length > 0
          ? binding.eventSubscriptions
          : agentType.defaults.eventSubscriptions,
      grants: {
        ...agentType.defaults.grants,
        ...binding.grants,
      },
      allowedOutputTargets,
    };

    return { agentType, binding, effective };
  }

  private assertNarrowing(
    agentType: AgentTypeRecord,
    patch: {
      llmProfileId: string | null;
      toolPolicyId: string | null;
      mcpBindings: AgentMcpBindingEntry[];
      eventSubscriptions: AgentEventSubscription[];
      grants: Record<string, unknown>;
      metadata: Record<string, unknown>;
    },
  ): typeof patch {
    const defaults: AgentTypeDefaults = agentType.defaults;

    const defaultsAllowed = readAllowedOutputTargets(defaults.grants);
    const overrideAllowed = readAllowedOutputTargets(patch.grants);
    if (overrideAllowed.length > 0) {
      const normalised = assertAllowedOutputTargets(overrideAllowed);
      assertOutputTargetsNarrowing(defaultsAllowed, normalised);
      patch.grants = { ...patch.grants, allowed_output_targets: normalised };
    }

    assertGrantsNarrowing(
      omitKeys(defaults.grants, ["allowed_output_targets"]),
      omitKeys(patch.grants, ["allowed_output_targets"]),
    );

    const defaultSubs = defaults.eventSubscriptions.map((entry) => entry.type);
    const patchSubs = patch.eventSubscriptions.map((entry) => entry.type);
    assertSubscriptionsNarrowing(defaultSubs, patchSubs);

    const defaultMcp = Object.fromEntries(
      defaults.mcpBindings.map((entry) => [entry.mcpServerId, { allowedTools: entry.allowedTools }]),
    );
    const patchMcp = Object.fromEntries(
      patch.mcpBindings.map((entry) => [entry.mcpServerId, { allowedTools: entry.allowedTools }]),
    );
    assertMcpNarrowing(defaultMcp, patchMcp);

    return patch;
  }
}

function readAllowedOutputTargets(
  grants: Record<string, unknown>,
): AgentAllowedOutputTarget[] {
  const raw = grants["allowed_output_targets"];
  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is AgentAllowedOutputTarget => typeof entry === "string") as AgentAllowedOutputTarget[];
  }
  return [];
}

function omitKeys<T extends Record<string, unknown>>(record: T, keys: string[]): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (!keys.includes(k)) {
      next[k] = v;
    }
  }
  return next;
}

function rowToRecord(row: typeof projectAgentBindings.$inferSelect): ProjectAgentBindingRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    accountId: row.accountId,
    agentTypeId: row.agentTypeId,
    status: row.status,
    scopeKind: row.scopeKind,
    llmProfileId: row.llmProfileId,
    toolPolicyId: row.toolPolicyId,
    mcpBindings: parseMcpBindingsJson(row.mcpBindingJson),
    eventSubscriptions: parseSubscriptionsJson(row.eventSubscriptionsJson),
    grants: parseRecordJson(row.grantsJson),
    metadata: parseRecordJson(row.metadataJson),
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
  AgentTypeServiceError,
};
