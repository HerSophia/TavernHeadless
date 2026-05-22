import { buildAccountHeaders, type AccountIdHint, type TransportClient } from "../client/transport.js";
import {
  compactObject,
  readArray,
  readNullableString,
  readNumber,
  readRecord,
  readString,
} from "./utils.js";

export type AgentScopeKind = "floor" | "session" | "project" | "workspace";
export type AgentTypeStatus = "active" | "disabled";

export type AgentMcpBindingEntry = {
  mcpServerId: string;
  allowedTools: string[] | null;
  configOverrideJson: Record<string, unknown> | null;
};

export type AgentEventSubscription = {
  type: string;
  filterJson: Record<string, unknown> | null;
};

export type AgentTypeDefaults = {
  llmProfileId: string | null;
  toolPolicyId: string | null;
  mcpBindings: AgentMcpBindingEntry[];
  eventSubscriptions: AgentEventSubscription[];
  grants: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

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

export type WorkspaceAgentTypesListOptions = {
  accountId?: AccountIdHint;
};

export type WorkspaceAgentTypesCreateInput = {
  key: string;
  name: string;
  scopeKind: AgentScopeKind;
  defaults?: Partial<{
    llmProfileId: string | null;
    toolPolicyId: string | null;
    mcpBindings: Array<{
      mcpServerId: string;
      allowedTools?: string[];
      configOverrideJson?: Record<string, unknown> | null;
    }>;
    eventSubscriptions: Array<{
      type: string;
      filterJson?: Record<string, unknown> | null;
    }>;
    grants: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }>;
};

export type WorkspaceAgentTypesUpdateInput = {
  name?: string;
  status?: AgentTypeStatus;
  defaults?: Partial<{
    llmProfileId: string | null;
    toolPolicyId: string | null;
    mcpBindings: Array<{
      mcpServerId: string;
      allowedTools?: string[];
      configOverrideJson?: Record<string, unknown> | null;
    }>;
    eventSubscriptions: Array<{
      type: string;
      filterJson?: Record<string, unknown> | null;
    }>;
    grants: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }>;
};

export type WorkspaceAgentTypesRequestOptions = {
  accountId?: AccountIdHint;
};

export type WorkspaceAgentTypesResource = {
  list(workspaceId: string, options?: WorkspaceAgentTypesListOptions): Promise<AgentTypeRecord[]>;
  get(workspaceId: string, agentTypeId: string, options?: WorkspaceAgentTypesRequestOptions): Promise<AgentTypeRecord>;
  create(workspaceId: string, input: WorkspaceAgentTypesCreateInput, options?: WorkspaceAgentTypesRequestOptions): Promise<AgentTypeRecord>;
  update(workspaceId: string, agentTypeId: string, input: WorkspaceAgentTypesUpdateInput, options?: WorkspaceAgentTypesRequestOptions): Promise<AgentTypeRecord>;
  disable(workspaceId: string, agentTypeId: string, options?: WorkspaceAgentTypesRequestOptions): Promise<AgentTypeRecord>;
  enable(workspaceId: string, agentTypeId: string, options?: WorkspaceAgentTypesRequestOptions): Promise<AgentTypeRecord>;
};

export type WorkspacesResource = {
  agentTypes: WorkspaceAgentTypesResource;
};

export function createWorkspacesResource(client: TransportClient): WorkspacesResource {
  return {
    agentTypes: createWorkspaceAgentTypesResource(client),
  };
}

function createWorkspaceAgentTypesResource(client: TransportClient): WorkspaceAgentTypesResource {
  return {
    async list(workspaceId, options = {}): Promise<AgentTypeRecord[]> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/workspaces/${encodeURIComponent(workspaceId)}/agent-types`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );
      const body = readRecord(response.body);
      return readArray(body?.items)
        .map(mapAgentTypeRecord)
        .filter((item): item is AgentTypeRecord => item !== null);
    },
    async get(workspaceId, agentTypeId, options = {}): Promise<AgentTypeRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/workspaces/${encodeURIComponent(workspaceId)}/agent-types/${encodeURIComponent(agentTypeId)}`,
        {
          headers: buildAccountHeaders(options.accountId),
          method: "GET",
        },
      );
      const record = mapAgentTypeRecord(response.body);
      if (!record) {
        throw new Error("Agent type payload is missing");
      }
      return record;
    },
    async create(workspaceId, input, options = {}): Promise<AgentTypeRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/workspaces/${encodeURIComponent(workspaceId)}/agent-types`,
        {
          body: mapAgentTypeWriteInput(input),
          headers: buildAccountHeaders(options.accountId),
          method: "POST",
        },
      );
      const record = mapAgentTypeRecord(response.body);
      if (!record) {
        throw new Error("Agent type payload is missing");
      }
      return record;
    },
    async update(workspaceId, agentTypeId, input, options = {}): Promise<AgentTypeRecord> {
      const response = await client.fetchJson<Record<string, unknown>>(
        `/workspaces/${encodeURIComponent(workspaceId)}/agent-types/${encodeURIComponent(agentTypeId)}`,
        {
          body: mapAgentTypePatchInput(input),
          headers: buildAccountHeaders(options.accountId),
          method: "PATCH",
        },
      );
      const record = mapAgentTypeRecord(response.body);
      if (!record) {
        throw new Error("Agent type payload is missing");
      }
      return record;
    },
    async disable(workspaceId, agentTypeId, options = {}): Promise<AgentTypeRecord> {
      return changeAgentTypeStatus(client, workspaceId, agentTypeId, "disable", options);
    },
    async enable(workspaceId, agentTypeId, options = {}): Promise<AgentTypeRecord> {
      return changeAgentTypeStatus(client, workspaceId, agentTypeId, "enable", options);
    },
  };
}

async function changeAgentTypeStatus(
  client: TransportClient,
  workspaceId: string,
  agentTypeId: string,
  action: "enable" | "disable",
  options: WorkspaceAgentTypesRequestOptions,
): Promise<AgentTypeRecord> {
  const response = await client.fetchJson<Record<string, unknown>>(
    `/workspaces/${encodeURIComponent(workspaceId)}/agent-types/${encodeURIComponent(agentTypeId)}/${action}`,
    {
      headers: buildAccountHeaders(options.accountId),
      method: "POST",
    },
  );
  const record = mapAgentTypeRecord(response.body);
  if (!record) {
    throw new Error("Agent type payload is missing");
  }
  return record;
}

function mapAgentTypeWriteInput(input: WorkspaceAgentTypesCreateInput): Record<string, unknown> {
  return compactObject({
    key: input.key,
    name: input.name,
    scope_kind: input.scopeKind,
    defaults: mapAgentTypeDefaultsInput(input.defaults),
  });
}

function mapAgentTypePatchInput(input: WorkspaceAgentTypesUpdateInput): Record<string, unknown> {
  return compactObject({
    name: input.name,
    status: input.status,
    defaults: mapAgentTypeDefaultsInput(input.defaults),
  });
}

function mapAgentTypeDefaultsInput(
  defaults: WorkspaceAgentTypesCreateInput["defaults"] | WorkspaceAgentTypesUpdateInput["defaults"] | undefined,
): Record<string, unknown> | undefined {
  if (!defaults) {
    return undefined;
  }
  const mapped = compactObject({
    llm_profile_id: defaults.llmProfileId,
    tool_policy_id: defaults.toolPolicyId,
    mcp_bindings: defaults.mcpBindings?.map((entry) => compactObject({
      mcp_server_id: entry.mcpServerId,
      allowed_tools: entry.allowedTools,
      config_override_json: entry.configOverrideJson ?? undefined,
    })),
    event_subscriptions: defaults.eventSubscriptions?.map((entry) => compactObject({
      type: entry.type,
      filter_json: entry.filterJson ?? undefined,
    })),
    grants: defaults.grants,
    metadata: defaults.metadata,
  });
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

function mapAgentTypeRecord(value: unknown): AgentTypeRecord | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  const scopeKind = readString(record.scope_kind) as AgentScopeKind;
  if (scopeKind !== "floor" && scopeKind !== "session" && scopeKind !== "project" && scopeKind !== "workspace") {
    return null;
  }
  const status = readString(record.status) as AgentTypeStatus;
  if (status !== "active" && status !== "disabled") {
    return null;
  }
  const defaults = readRecord(record.defaults);
  return {
    id: readString(record.id),
    workspaceId: readString(record.workspace_id),
    accountId: readString(record.account_id),
    key: readString(record.key),
    name: readString(record.name),
    scopeKind,
    status,
    defaults: {
      llmProfileId: readNullableString(defaults?.llm_profile_id),
      toolPolicyId: readNullableString(defaults?.tool_policy_id),
      mcpBindings: readArray(defaults?.mcp_bindings)
        .map(mapAgentMcpBindingEntry)
        .filter((item): item is AgentMcpBindingEntry => item !== null),
      eventSubscriptions: readArray(defaults?.event_subscriptions)
        .map(mapAgentEventSubscription)
        .filter((item): item is AgentEventSubscription => item !== null),
      grants: readRecord(defaults?.grants) ?? {},
      metadata: readRecord(defaults?.metadata) ?? {},
    },
    createdAt: readNumber(record.created_at),
    updatedAt: readNumber(record.updated_at),
  };
}

function mapAgentMcpBindingEntry(value: unknown): AgentMcpBindingEntry | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  return {
    mcpServerId: readString(record.mcp_server_id),
    allowedTools: readArray(record.allowed_tools).map((item) => readString(item)).filter((item) => item.length > 0),
    configOverrideJson: readRecord(record.config_override_json),
  };
}

function mapAgentEventSubscription(value: unknown): AgentEventSubscription | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }
  return {
    type: readString(record.type),
    filterJson: readRecord(record.filter_json),
  };
}
