import { and, eq } from "drizzle-orm";

import type { AppDb } from "../../../db/client.js";
import { projects, sessions } from "../../../db/schema.js";
import { ProjectMcpBindingService, type ProjectMcpBindingRecord } from "../../project-mcp-binding-service.js";
import { WorkspaceScopeService } from "../../workspace-scope-service.js";
import type { McpConnectionManager } from "./mcp-connection-manager.js";
import {
  InMemoryMcpToolCatalogSnapshotStore,
  type McpToolCatalogSnapshotStore,
} from "./mcp-tool-catalog-snapshot-store.js";
import { McpToolProviderFactory } from "./mcp-tool-provider-factory.js";
import { McpService } from "./mcp-service.js";
import type { McpToolCatalogSource } from "./mcp-tool-provider.js";
import type { McpConnectionStatus, McpServerConfig, McpTransportType } from "./types.js";

export type McpCapabilitySnapshotScope = "workspace" | "project" | "session" | "agent";
export type McpCapabilitySnapshotState = "live" | "cached" | "unavailable" | "disabled" | "not_attached";
export type McpCapabilityIntegrationState = "integrated" | "not_integrated";
export type McpCapabilityBindingScope = "legacy" | "project_binding";

export interface McpCapabilitySnapshotToolItem {
  name: string;
  sideEffectLevel: string;
  asyncCapability?: string;
  resultVisibility?: string;
  replaySafety?: string;
}

export interface McpCapabilitySnapshotToolFacet {
  integrationState: McpCapabilityIntegrationState;
  source: McpToolCatalogSource | null;
  items: McpCapabilitySnapshotToolItem[];
}

export interface McpCapabilitySnapshotStaticFacet {
  integrationState: "not_integrated";
}

export interface McpCapabilitySnapshotBindingView {
  scope: McpCapabilityBindingScope;
  status: "enabled" | "disabled";
  allowedToolsMode: "all" | "allow_list";
  allowedTools: string[];
  configOverrideJson: Record<string, unknown> | null;
}

export interface McpCapabilitySnapshotServer {
  serverId: string;
  serverName: string;
  transport: McpTransportType | null;
  state: McpCapabilitySnapshotState;
  reconnectRequired: boolean;
  toolCount: number;
  binding: McpCapabilitySnapshotBindingView | null;
  tools: McpCapabilitySnapshotToolFacet;
  prompts: McpCapabilitySnapshotStaticFacet;
  resources: McpCapabilitySnapshotStaticFacet;
}

export interface McpCapabilitySnapshot {
  generatedAt: number;
  scope: McpCapabilitySnapshotScope;
  workspaceId: string;
  projectId: string | null;
  sessionId: string | null;
  servers: McpCapabilitySnapshotServer[];
}

export type McpCapabilitySnapshotServiceErrorCode = "project_not_found" | "session_not_found";

export class McpCapabilitySnapshotServiceError extends Error {
  constructor(
    public readonly code: McpCapabilitySnapshotServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "McpCapabilitySnapshotServiceError";
  }
}

interface SnapshotServerInput {
  config: McpServerConfig | null;
  binding: ProjectMcpBindingRecord | null;
  bindingScope: McpCapabilityBindingScope;
}

function normalizeAllowedTools(allowedTools?: string[]): string[] {
  return Array.from(new Set(
    (allowedTools ?? [])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )).sort();
}

function toToolItem(tool: {
  name: string;
  sideEffectLevel: string;
  asyncCapability?: string;
  resultVisibility?: string;
  replaySafety?: string;
}): McpCapabilitySnapshotToolItem {
  return {
    name: tool.name,
    sideEffectLevel: tool.sideEffectLevel,
    ...(tool.asyncCapability ? { asyncCapability: tool.asyncCapability } : {}),
    ...(tool.resultVisibility ? { resultVisibility: tool.resultVisibility } : {}),
    ...(tool.replaySafety ? { replaySafety: tool.replaySafety } : {}),
  };
}

function createStaticFacet(): McpCapabilitySnapshotStaticFacet {
  return { integrationState: "not_integrated" };
}

function createEmptyToolFacet(state: McpCapabilitySnapshotState): McpCapabilitySnapshotToolFacet {
  return {
    integrationState: "integrated",
    source: null,
    items: [],
  };
}

function mapCatalogSourceToState(source: McpToolCatalogSource): McpCapabilitySnapshotState {
  if (source === "live") {
    return "live";
  }
  if (source === "cached") {
    return "cached";
  }
  return "unavailable";
}

function buildStatusFallback(
  config: McpServerConfig,
  status: McpConnectionStatus | null,
): McpConnectionStatus {
  return {
    serverId: config.id,
    serverName: config.name,
    transport: config.transport,
    state: status?.state ?? "disconnected",
    toolCount: status?.toolCount ?? 0,
    connectedAt: status?.connectedAt,
    toolsRefreshedAt: status?.toolsRefreshedAt,
    error: status?.error,
    reconnectRequired: status?.reconnectRequired ?? false,
    lastTimeoutAt: status?.lastTimeoutAt,
  };
}

export class McpCapabilitySnapshotService {
  private readonly mcpService: McpService;
  private readonly projectMcpBindingService: ProjectMcpBindingService;
  private readonly snapshotStore: McpToolCatalogSnapshotStore;
  private readonly providerFactory: McpToolProviderFactory;

  constructor(
    private readonly db: AppDb,
    private readonly manager: McpConnectionManager,
    options: {
      mcpService?: McpService;
      projectMcpBindingService?: ProjectMcpBindingService;
      snapshotStore?: McpToolCatalogSnapshotStore;
      providerFactory?: McpToolProviderFactory;
    } = {},
  ) {
    this.mcpService = options.mcpService ?? new McpService(db);
    this.projectMcpBindingService = options.projectMcpBindingService ?? new ProjectMcpBindingService(db);
    this.snapshotStore = options.snapshotStore ?? new InMemoryMcpToolCatalogSnapshotStore();
    this.providerFactory = options.providerFactory ?? new McpToolProviderFactory({
      connectionManager: manager,
      snapshotStore: this.snapshotStore,
    });
  }

  async snapshotForWorkspace(input: {
    accountId: string;
    workspaceId?: string;
  }): Promise<McpCapabilitySnapshot> {
    const workspaceId = input.workspaceId ?? new WorkspaceScopeService(this.db).getDefaultWorkspace(input.accountId).id;
    const configs = await this.mcpService.listEnabledConfigs(input.accountId, { workspaceId });
    const servers = await Promise.all(configs.map((config) => this.buildServerSnapshot({
      config,
      binding: null,
      bindingScope: "legacy",
    })));

    return {
      generatedAt: Date.now(),
      scope: "workspace",
      workspaceId,
      projectId: null,
      sessionId: null,
      servers: servers.sort(compareServers),
    };
  }

  async snapshotForProject(input: {
    accountId: string;
    projectId: string;
  }): Promise<McpCapabilitySnapshot> {
    const project = await this.db
      .select({
        id: projects.id,
        workspaceId: projects.workspaceId,
      })
      .from(projects)
      .where(and(
        eq(projects.id, input.projectId),
        eq(projects.accountId, input.accountId),
      ))
      .limit(1);

    const row = project[0] ?? null;
    if (!row) {
      throw new McpCapabilitySnapshotServiceError(
        "project_not_found",
        `Project not found: ${input.projectId}`,
      );
    }

    const servers = await this.buildProjectScopedServers({
      accountId: input.accountId,
      projectId: row.id,
      workspaceId: row.workspaceId,
    });

    return {
      generatedAt: Date.now(),
      scope: "project",
      workspaceId: row.workspaceId,
      projectId: row.id,
      sessionId: null,
      servers: servers.sort(compareServers),
    };
  }

  async snapshotForSession(input: {
    accountId: string;
    sessionId: string;
  }): Promise<McpCapabilitySnapshot> {
    const session = await this.db
      .select({
        id: sessions.id,
        workspaceId: sessions.workspaceId,
        projectId: sessions.projectId,
      })
      .from(sessions)
      .where(and(
        eq(sessions.id, input.sessionId),
        eq(sessions.accountId, input.accountId),
      ))
      .limit(1);

    const row = session[0] ?? null;
    if (!row) {
      throw new McpCapabilitySnapshotServiceError(
        "session_not_found",
        `Session not found: ${input.sessionId}`,
      );
    }

    const workspaceId = row.workspaceId ?? new WorkspaceScopeService(this.db).getDefaultWorkspace(input.accountId).id;
    const servers = row.projectId
      ? await this.buildProjectScopedServers({
          accountId: input.accountId,
          projectId: row.projectId,
          workspaceId,
        })
      : await this.buildLegacyScopedServers({
          accountId: input.accountId,
          workspaceId,
        });

    return {
      generatedAt: Date.now(),
      scope: "session",
      workspaceId,
      projectId: row.projectId,
      sessionId: row.id,
      servers: servers.sort(compareServers),
    };
  }

  private async buildLegacyScopedServers(input: {
    accountId: string;
    workspaceId: string;
  }): Promise<McpCapabilitySnapshotServer[]> {
    const configs = await this.mcpService.listEnabledConfigs(input.accountId, { workspaceId: input.workspaceId });
    return Promise.all(configs.map((config) => this.buildServerSnapshot({
      config,
      binding: null,
      bindingScope: "legacy",
    })));
  }

  private async buildProjectScopedServers(input: {
    accountId: string;
    projectId: string;
    workspaceId: string;
  }): Promise<McpCapabilitySnapshotServer[]> {
    const bindings = this.projectMcpBindingService.listByProject({
      projectId: input.projectId,
      accountId: input.accountId,
    });

    return Promise.all(bindings.map(async (binding) => {
      const config = await this.mcpService.getConfigEntity(binding.mcpServerId, input.accountId, input.workspaceId);
      return this.buildServerSnapshot({
        config,
        binding,
        bindingScope: "project_binding",
      });
    }));
  }

  private async buildServerSnapshot(input: SnapshotServerInput): Promise<McpCapabilitySnapshotServer> {
    const allowedTools = normalizeAllowedTools(input.binding?.allowedTools);
    const allowedToolsMode: McpCapabilitySnapshotBindingView["allowedToolsMode"] = allowedTools.length > 0 ? "allow_list" : "all";
    const binding = input.binding
      ? {
          scope: input.bindingScope,
          status: input.binding.status,
          allowedToolsMode,
          allowedTools,
          configOverrideJson: input.binding.configOverrideJson,
        }
      : null;

    const config = input.config;
    if (!config) {
      return {
        serverId: input.binding?.mcpServerId ?? "unknown",
        serverName: input.binding?.mcpServerId ?? "unknown",
        transport: null,
        state: "unavailable",
        reconnectRequired: false,
        toolCount: 0,
        binding,
        tools: createEmptyToolFacet("unavailable"),
        prompts: createStaticFacet(),
        resources: createStaticFacet(),
      };
    }

    if (input.binding?.status === "disabled" || config.enabled !== true) {
      return {
        serverId: config.id,
        serverName: config.name,
        transport: config.transport,
        state: "disabled",
        reconnectRequired: false,
        toolCount: 0,
        binding,
        tools: createEmptyToolFacet("disabled"),
        prompts: createStaticFacet(),
        resources: createStaticFacet(),
      };
    }

    const attached = this.manager.hasServer(config.id);
    const status = buildStatusFallback(config, this.manager.getStatus(config.id));

    if (!attached) {
      return {
        serverId: config.id,
        serverName: config.name,
        transport: config.transport,
        state: "not_attached",
        reconnectRequired: status.reconnectRequired ?? false,
        toolCount: 0,
        binding,
        tools: createEmptyToolFacet("not_attached"),
        prompts: createStaticFacet(),
        resources: createStaticFacet(),
      };
    }

    const provider = this.providerFactory.create(config);
    const catalog = await provider.listToolsWithMetadata();
    const filteredTools = catalog.tools
      .filter((entry) => allowedTools.length === 0 || allowedTools.includes(entry.tool.name))
      .map((entry) => toToolItem({
        name: entry.tool.name,
        sideEffectLevel: entry.tool.sideEffectLevel,
        asyncCapability: entry.tool.asyncCapability,
        resultVisibility: entry.tool.resultVisibility,
        replaySafety: entry.replaySafety,
      }));
    const state = mapCatalogSourceToState(catalog.source);

    return {
      serverId: config.id,
      serverName: config.name,
      transport: config.transport,
      state,
      reconnectRequired: status.reconnectRequired ?? false,
      toolCount: filteredTools.length,
      binding,
      tools: {
        integrationState: "integrated",
        source: catalog.source,
        items: filteredTools,
      },
      prompts: createStaticFacet(),
      resources: createStaticFacet(),
    };
  }
}

function compareServers(left: McpCapabilitySnapshotServer, right: McpCapabilitySnapshotServer): number {
  const byName = left.serverName.localeCompare(right.serverName);
  if (byName !== 0) {
    return byName;
  }

  return left.serverId.localeCompare(right.serverId);
}
