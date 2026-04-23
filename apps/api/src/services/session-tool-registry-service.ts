import { and, eq } from "drizzle-orm";

import {
  evaluateToolReplaySafety,
  PresetToolProvider,
  ToolRegistry,
  type InstanceSlot,
  type PresetToolInput,
  type ToolDefinition,
  type ToolProvider,
  type ToolReplaySafety,
  type ToolProviderType,
  type ToolSideEffectLevel,
} from "@tavern/core";

import type { AppDb } from "../db/client.js";
import { sessions, toolDefinitions } from "../db/schema.js";
import { parseJsonField } from "../lib/http.js";
import type { McpToolCatalogSource } from "../mcp/mcp-tool-provider.js";
import type { McpConnectionManager } from "../mcp/mcp-connection-manager.js";
import { InMemoryMcpToolCatalogSnapshotStore, type McpToolCatalogSnapshotStore } from "../mcp/mcp-tool-catalog-snapshot-store.js";
import { McpToolProviderFactory } from "../mcp/mcp-tool-provider-factory.js";
import { McpService } from "./mcp-service.js";
import type { ToolRuntimePolicy } from "./tool-runtime-policy.js";

const INSTANCE_SLOTS = new Set<InstanceSlot>([
  "narrator",
  "director",
  "verifier",
  "memory",
]);

const SCRIPT_HANDLER_UNAVAILABLE_REASON =
  'Script handler execution is disabled by server policy. Set ENABLE_UNSAFE_SCRIPT_HANDLER=true only in a trusted environment.';

export type SessionRuntimeToolSource =
  | "builtin"
  | "resource"
  | "custom"
  | "preset"
  | "character"
  | "mcp";

export type SessionRuntimeToolReplaySafety = ToolReplaySafety;

export type SessionRuntimeToolCatalogSource = McpToolCatalogSource;

/**
 * runtime catalog 中治理字段的来源依据（basis）。
 *
 * 该枚举不是 trust score。它只描述“这个字段是从哪里来的”。
 *
 * - `tool_declared` — 值直接来自本地明确定义或工具自身声明
 * - `server_default` — 值来自服务器级（MCP server）默认配置
 * - `platform_default` — 值来自平台硬编码的默认值
 * - `inferred_from_execution_policy` — 值由 replay/副作用策略推导得出
 * - `shallow_schema_projection` — 值由浅层 schema 投影得出（如参数 schema 的浅拷贝）
 */
export type RuntimeMetadataBasis =
  | "tool_declared"
  | "server_default"
  | "platform_default"
  | "inferred_from_execution_policy"
  | "shallow_schema_projection";

export interface SessionRuntimeToolCatalogEntry {
  name: string;
  providerId: string;
  providerType: ToolProviderType;
  source: SessionRuntimeToolSource;
  sideEffectLevel: ToolSideEffectLevel;
  allowedSlots: InstanceSlot[];
  availability: "available" | "unavailable" | "conflict";
  availabilityReason?: string;
  replaySafety: SessionRuntimeToolReplaySafety;
  asyncCapability: "inline_only" | "deferred_ok";
  defaultDeliveryMode: "inline" | "async_job";
  catalogSource?: SessionRuntimeToolCatalogSource;
  resultVisibility: "immediate" | "deferred_receipt";
  sideEffectLevelBasis?: RuntimeMetadataBasis;
  allowedSlotsBasis?: RuntimeMetadataBasis;
  parameterSchemaBasis?: RuntimeMetadataBasis;
  replaySafetyBasis?: RuntimeMetadataBasis;
}

export interface SessionRuntimeToolCatalogConflict {
  toolName: string;
  providerIds: string[];
  reason: "name_conflict";
}

export interface SessionRuntimeToolCatalogSnapshot {
  sessionId: string;
  generatedAt: number;
  tools: SessionRuntimeToolCatalogEntry[];
  conflicts: SessionRuntimeToolCatalogConflict[];
}

export interface SessionToolRegistryBuildResult {
  registry: ToolRegistry;
  catalog: SessionRuntimeToolCatalogSnapshot;
}

export type SessionToolRegistryServiceErrorCode =
  | "session_not_found"
  | "tool_catalog_conflict";

export class SessionToolRegistryServiceError extends Error {
  constructor(
    public readonly code: SessionToolRegistryServiceErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "SessionToolRegistryServiceError";
  }
}

export interface SessionToolRegistryServiceOptions {
  baseRegistry: ToolRegistry;
  mcpManager?: McpConnectionManager;
  mcpSnapshotStore?: McpToolCatalogSnapshotStore;
  mcpToolProviderFactory?: McpToolProviderFactory;
  toolRuntimePolicy?: ToolRuntimePolicy;
  enableUnsafeScriptHandler?: boolean;
}

interface RuntimeToolCandidate {
  name: string;
  catalogSource?: SessionRuntimeToolCatalogSource;
  providerId: string;
  providerType: ToolProviderType;
  source: SessionRuntimeToolSource;
  sideEffectLevel: ToolSideEffectLevel;
  allowedSlots: InstanceSlot[];
  asyncCapability: "inline_only" | "deferred_ok";
  defaultDeliveryMode: "inline" | "async_job";
  resultVisibility: "immediate" | "deferred_receipt";
  sideEffectLevelBasis?: RuntimeMetadataBasis;
  allowedSlotsBasis?: RuntimeMetadataBasis;
  parameterSchemaBasis?: RuntimeMetadataBasis;
  replaySafetyBasis?: RuntimeMetadataBasis;
}

interface DefinitionProviderDescriptor {
  providerId: string;
  providerType: ToolProviderType;
  source: "custom" | "preset" | "character";
  tools: PresetToolInput[];
}

class FilteredToolProvider implements ToolProvider {
  readonly id: string;
  readonly type: ToolProviderType;

  constructor(
    private readonly delegate: ToolProvider,
    private readonly allowedToolNames: Set<string>,
  ) {
    this.id = delegate.id;
    this.type = delegate.type;
  }

  async listTools(): Promise<ToolDefinition[]> {
    const tools = await this.delegate.listTools();
    return tools.filter((tool) => this.allowedToolNames.has(tool.name));
  }

  async executeTool(name: string, args: Record<string, unknown>, context: Parameters<ToolProvider["executeTool"]>[2]) {
    if (!this.allowedToolNames.has(name)) {
      return { error: `Tool '${name}' is not available in the runtime catalog` };
    }

    return this.delegate.executeTool(name, args, context);
  }
}

function isInstanceSlot(value: unknown): value is InstanceSlot {
  return typeof value === "string" && INSTANCE_SLOTS.has(value as InstanceSlot);
}

function normalizeAllowedSlots(value: unknown): InstanceSlot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isInstanceSlot);
}

function normalizeParameterSchema(value: unknown): PresetToolInput["parameters"] {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "object"
  ) {
    const record = value as {
      type: "object";
      properties?: Record<string, unknown>;
      required?: unknown;
    };

    return {
      type: "object",
      properties: record.properties && typeof record.properties === "object"
        ? record.properties
        : {},
      required: Array.isArray(record.required)
        ? record.required.filter((item): item is string => typeof item === "string")
        : undefined,
    };
  }

  return {
    type: "object",
    properties: {},
  };
}

function normalizeHandler(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function buildCatalogEntry(candidate: RuntimeToolCandidate, availability: SessionRuntimeToolCatalogEntry["availability"], availabilityReason?: string): SessionRuntimeToolCatalogEntry {
  const replaySafety = evaluateToolReplaySafety({
    providerId: candidate.providerId,
    providerType: candidate.providerType,
    toolName: candidate.name,
    sideEffectLevel: candidate.sideEffectLevel,
    status: "success",
    lifecycleState: "finished",
  }).replaySafety;

  return {
    name: candidate.name,
    providerId: candidate.providerId,
    providerType: candidate.providerType,
    source: candidate.source,
    sideEffectLevel: candidate.sideEffectLevel,
    allowedSlots: [...candidate.allowedSlots],
    availability,
    ...(availabilityReason ? { availabilityReason } : {}),
    asyncCapability: candidate.asyncCapability,
    ...(candidate.catalogSource ? { catalogSource: candidate.catalogSource } : {}),
    defaultDeliveryMode: candidate.defaultDeliveryMode,
    resultVisibility: candidate.resultVisibility,
    replaySafety,
    ...(candidate.sideEffectLevelBasis ? { sideEffectLevelBasis: candidate.sideEffectLevelBasis } : {}),
    ...(candidate.allowedSlotsBasis ? { allowedSlotsBasis: candidate.allowedSlotsBasis } : {}),
    ...(candidate.parameterSchemaBasis ? { parameterSchemaBasis: candidate.parameterSchemaBasis } : {}),
    ...(candidate.replaySafetyBasis ? { replaySafetyBasis: candidate.replaySafetyBasis } : {}),
  };
}

function pushConflict(
  snapshot: SessionRuntimeToolCatalogSnapshot,
  toolName: string,
  providerIds: Iterable<string>,
): void {
  const uniqueProviderIds = Array.from(new Set(providerIds)).sort();
  if (uniqueProviderIds.length === 0) {
    return;
  }

  snapshot.conflicts.push({
    toolName,
    providerIds: uniqueProviderIds,
    reason: "name_conflict",
  });
}

function sortSnapshot(snapshot: SessionRuntimeToolCatalogSnapshot): void {
  snapshot.tools.sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) {
      return byName;
    }

    return a.providerId.localeCompare(b.providerId);
  });

  snapshot.conflicts.sort((a, b) => a.toolName.localeCompare(b.toolName));
}

function createConflictMessage(conflicts: SessionRuntimeToolCatalogConflict[]): string {
  const names = conflicts.map((conflict) => conflict.toolName).sort();
  return `Runtime tool catalog conflict: ${names.join(", ")}`;
}

function toPresetToolInput(row: typeof toolDefinitions.$inferSelect): PresetToolInput {
  const parameters = normalizeParameterSchema(parseJsonField(row.parametersJson));
  const allowedSlots = normalizeAllowedSlots(parseJsonField(row.allowedSlotsJson));
  const handler = normalizeHandler(parseJsonField(row.handlerJson));

  return {
    name: row.name,
    description: row.description,
    parameters,
    sideEffectLevel: row.sideEffectLevel,
    allowedSlots,
    handlerType: row.handlerType,
    handler,
  };
}

export class SessionToolRegistryService {
  private readonly mcpService?: McpService;
  private readonly mcpSnapshotStore?: McpToolCatalogSnapshotStore;
  private readonly mcpToolProviderFactory?: McpToolProviderFactory;

  constructor(
    private readonly db: AppDb,
    private readonly options: SessionToolRegistryServiceOptions,
  ) {
    this.mcpService = options.mcpManager ? new McpService(db) : undefined;
    this.mcpSnapshotStore = options.mcpManager
      ? options.mcpSnapshotStore ?? new InMemoryMcpToolCatalogSnapshotStore()
      : undefined;

    if (options.mcpToolProviderFactory) {
      this.mcpToolProviderFactory = options.mcpToolProviderFactory;
    } else if (options.mcpManager) {
      this.mcpToolProviderFactory = new McpToolProviderFactory({
        connectionManager: options.mcpManager,
        ...(options.toolRuntimePolicy ? { toolRuntimePolicy: options.toolRuntimePolicy } : {}),
        ...(this.mcpSnapshotStore ? { snapshotStore: this.mcpSnapshotStore } : {}),
      });
    }
  }

  async buildRuntime(
    sessionId: string,
    accountId: string,
  ): Promise<SessionToolRegistryBuildResult> {
    const session = await this.loadSession(sessionId, accountId);
    if (!session) {
      throw new SessionToolRegistryServiceError(
        "session_not_found",
        `Session '${sessionId}' not found`,
      );
    }

    const generatedAt = Date.now();
    const registry = new ToolRegistry();
    const snapshot: SessionRuntimeToolCatalogSnapshot = {
      sessionId,
      generatedAt,
      tools: [],
      conflicts: [],
    };
    const callableOwners = new Map<string, RuntimeToolCandidate>();

    await this.appendBaseProviders(registry, snapshot, callableOwners);

    const definitionDescriptors = await this.loadDefinitionDescriptors(session, accountId);
    const definitionCandidates = definitionDescriptors.flatMap((descriptor) =>
      descriptor.tools.map<RuntimeToolCandidate>((tool) => ({
        name: tool.name,
        providerId: descriptor.providerId,
        providerType: descriptor.providerType,
        source: descriptor.source,
        sideEffectLevel: tool.sideEffectLevel,
        allowedSlots: [...tool.allowedSlots],
        asyncCapability: "inline_only",
        defaultDeliveryMode: "inline",
        resultVisibility: "immediate",
        sideEffectLevelBasis: "tool_declared",
        allowedSlotsBasis: "tool_declared",
        parameterSchemaBasis: "tool_declared",
        replaySafetyBasis: "inferred_from_execution_policy",
      })),
    );

    if (this.options.enableUnsafeScriptHandler !== true) {
      for (const candidate of definitionCandidates) {
        snapshot.tools.push(buildCatalogEntry(candidate, "unavailable", SCRIPT_HANDLER_UNAVAILABLE_REASON));
      }

      await this.appendMcpProviders(registry, snapshot, callableOwners, accountId);
      sortSnapshot(snapshot);
      return {
        registry,
        catalog: snapshot,
      };
    }

    const definitionCandidatesByName = new Map<string, RuntimeToolCandidate[]>();
    for (const candidate of definitionCandidates) {
      const existing = definitionCandidatesByName.get(candidate.name) ?? [];
      existing.push(candidate);
      definitionCandidatesByName.set(candidate.name, existing);
    }

    const definitionConflictNames = new Set<string>();
    for (const [toolName, candidates] of definitionCandidatesByName) {
      const existingOwner = callableOwners.get(toolName);
      const hasConflict = Boolean(existingOwner) || candidates.length > 1;
      if (!hasConflict) {
        continue;
      }

      definitionConflictNames.add(toolName);
      pushConflict(snapshot, toolName, [
        ...(existingOwner ? [existingOwner.providerId] : []),
        ...candidates.map((candidate) => candidate.providerId),
      ]);

      const reason = existingOwner
        ? `Tool name '${toolName}' is reserved by provider '${existingOwner.providerId}'`
        : `Tool name '${toolName}' is declared by multiple definition-backed providers`;

      for (const candidate of candidates) {
        snapshot.tools.push(buildCatalogEntry(candidate, "conflict", reason));
      }
    }

    for (const candidate of definitionCandidates) {
      if (definitionConflictNames.has(candidate.name)) {
        continue;
      }

      snapshot.tools.push(buildCatalogEntry(candidate, "available"));
      callableOwners.set(candidate.name, candidate);
    }

    if (definitionConflictNames.size > 0) {
      sortSnapshot(snapshot);
      throw new SessionToolRegistryServiceError(
        "tool_catalog_conflict",
        createConflictMessage(snapshot.conflicts),
        {
          conflicts: snapshot.conflicts,
          catalog: snapshot,
        },
      );
    }

    for (const descriptor of definitionDescriptors) {
      if (descriptor.tools.length === 0) {
        continue;
      }

      registry.register(new PresetToolProvider(descriptor.providerId, descriptor.tools, {
        allowUnsafeScriptHandlerExecution: true,
        disabledErrorMessage: SCRIPT_HANDLER_UNAVAILABLE_REASON,
      }));
    }

    await this.appendMcpProviders(registry, snapshot, callableOwners, accountId);

    sortSnapshot(snapshot);

    return {
      registry,
      catalog: snapshot,
    };
  }

  async getRuntimeCatalog(
    sessionId: string,
    accountId: string,
  ): Promise<SessionRuntimeToolCatalogSnapshot> {
    const runtime = await this.buildRuntime(sessionId, accountId);
    return runtime.catalog;
  }

  private async loadSession(sessionId: string, accountId: string) {
    const [session] = await this.db
      .select({
        id: sessions.id,
        presetId: sessions.presetId,
        characterId: sessions.characterId,
      })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)))
      .limit(1);

    return session ?? null;
  }

  private async appendBaseProviders(
    registry: ToolRegistry,
    snapshot: SessionRuntimeToolCatalogSnapshot,
    callableOwners: Map<string, RuntimeToolCandidate>,
  ): Promise<void> {
    for (const provider of this.options.baseRegistry.getAllProviders()) {
      registry.register(provider);

      const tools = await provider.listTools();
      for (const tool of tools) {
        const source = provider.id === "resource"
          ? "resource"
          : "builtin";
        const candidate: RuntimeToolCandidate = {
          name: tool.name,
          providerId: provider.id,
          providerType: provider.type,
          source,
          sideEffectLevel: tool.sideEffectLevel,
          allowedSlots: [...tool.allowedSlots],
          asyncCapability: tool.asyncCapability ?? "inline_only",
          defaultDeliveryMode: tool.defaultDeliveryMode ?? "inline",
          resultVisibility: tool.resultVisibility ?? "immediate",
          sideEffectLevelBasis: "tool_declared",
          allowedSlotsBasis: "tool_declared",
          parameterSchemaBasis: "tool_declared",
          replaySafetyBasis: "inferred_from_execution_policy",
        };

        snapshot.tools.push(buildCatalogEntry(candidate, "available"));
        callableOwners.set(tool.name, candidate);
      }
    }
  }

  private async loadDefinitionDescriptors(
    session: { id: string; presetId: string | null; characterId: string | null },
    accountId: string,
  ): Promise<DefinitionProviderDescriptor[]> {
    const descriptors: DefinitionProviderDescriptor[] = [];

    const customRows = await this.db
      .select()
      .from(toolDefinitions)
      .where(and(
        eq(toolDefinitions.accountId, accountId),
        eq(toolDefinitions.source, "custom"),
        eq(toolDefinitions.handlerType, "script"),
        eq(toolDefinitions.enabled, true),
      ));

    descriptors.push({
      providerId: `custom:${accountId}`,
      providerType: "preset",
      source: "custom",
      tools: customRows.map(toPresetToolInput),
    });

    if (session.presetId) {
      const presetRows = await this.db
        .select()
        .from(toolDefinitions)
        .where(and(
          eq(toolDefinitions.accountId, accountId),
          eq(toolDefinitions.source, "preset"),
          eq(toolDefinitions.handlerType, "script"),
          eq(toolDefinitions.sourceId, session.presetId),
          eq(toolDefinitions.enabled, true),
        ));

      descriptors.push({
        providerId: `preset:${session.presetId}`,
        providerType: "preset",
        source: "preset",
        tools: presetRows.map(toPresetToolInput),
      });
    }

    if (session.characterId) {
      const characterRows = await this.db
        .select()
        .from(toolDefinitions)
        .where(and(
          eq(toolDefinitions.accountId, accountId),
          eq(toolDefinitions.source, "character"),
          eq(toolDefinitions.handlerType, "script"),
          eq(toolDefinitions.sourceId, session.characterId),
          eq(toolDefinitions.enabled, true),
        ));

      descriptors.push({
        providerId: `character:${session.characterId}`,
        providerType: "preset",
        source: "character",
        tools: characterRows.map(toPresetToolInput),
      });
    }

    return descriptors.filter((descriptor) => descriptor.tools.length > 0);
  }

  private async appendMcpProviders(
    registry: ToolRegistry,
    snapshot: SessionRuntimeToolCatalogSnapshot,
    callableOwners: Map<string, RuntimeToolCandidate>,
    accountId: string,
  ): Promise<void> {
    if (!this.options.mcpManager || !this.mcpService) {
      return;
    }

    const configs = await this.mcpService.listEnabledConfigs(accountId);
    if (configs.length === 0) {
      return;
    }

    const providerToolCandidates = new Map<string, {
      provider: ToolProvider;
      tools: RuntimeToolCandidate[];
    }>();
    const mcpCandidatesByName = new Map<string, RuntimeToolCandidate[]>();

    const factory = this.mcpToolProviderFactory
      ?? new McpToolProviderFactory({
        connectionManager: this.options.mcpManager,
        ...(this.options.toolRuntimePolicy ? { toolRuntimePolicy: this.options.toolRuntimePolicy } : {}),
        ...(this.mcpSnapshotStore ? { snapshotStore: this.mcpSnapshotStore } : {}),
      });

    for (const config of configs) {
      const provider = factory.create(config);
      const catalog = await provider.listToolsWithMetadata();
      const candidates = catalog.tools.map<RuntimeToolCandidate>((tool) => ({
        name: tool.name,
        catalogSource: catalog.source,
        providerId: provider.id,
        providerType: provider.type,
        source: "mcp",
        sideEffectLevel: tool.sideEffectLevel,
        allowedSlots: [...tool.allowedSlots],
        asyncCapability: tool.asyncCapability ?? "inline_only",
        defaultDeliveryMode: tool.defaultDeliveryMode ?? "inline",
        resultVisibility: tool.resultVisibility ?? "immediate",
        sideEffectLevelBasis: "server_default",
        allowedSlotsBasis: "platform_default",
        parameterSchemaBasis: "shallow_schema_projection",
        replaySafetyBasis: "inferred_from_execution_policy",
      }));

      providerToolCandidates.set(provider.id, {
        provider,
        tools: candidates,
      });

      for (const candidate of candidates) {
        const existing = mcpCandidatesByName.get(candidate.name) ?? [];
        existing.push(candidate);
        mcpCandidatesByName.set(candidate.name, existing);
      }
    }

    const mcpConflictNames = new Set<string>();
    for (const [toolName, candidates] of mcpCandidatesByName) {
      const existingOwner = callableOwners.get(toolName);
      const hasConflict = Boolean(existingOwner) || candidates.length > 1;
      if (!hasConflict) {
        continue;
      }

      mcpConflictNames.add(toolName);
      pushConflict(snapshot, toolName, [
        ...(existingOwner ? [existingOwner.providerId] : []),
        ...candidates.map((candidate) => candidate.providerId),
      ]);

      const reason = existingOwner
        ? `Tool name '${toolName}' conflicts with provider '${existingOwner.providerId}'`
        : `Tool name '${toolName}' conflicts across multiple MCP providers`;

      for (const candidate of candidates) {
        snapshot.tools.push(buildCatalogEntry(candidate, "conflict", reason));
      }
    }

    for (const { provider, tools } of providerToolCandidates.values()) {
      const allowedToolNames = tools
        .filter((tool) => !mcpConflictNames.has(tool.name))
        .map((tool) => tool.name);

      for (const tool of tools) {
        if (mcpConflictNames.has(tool.name)) {
          continue;
        }

        snapshot.tools.push(buildCatalogEntry(tool, "available"));
        callableOwners.set(tool.name, tool);
      }

      if (allowedToolNames.length === 0) {
        continue;
      }

      const allowedToolNameSet = new Set(allowedToolNames);
      const shouldWrap = allowedToolNames.length !== tools.length;
      registry.register(shouldWrap
        ? new FilteredToolProvider(provider, allowedToolNameSet)
        : provider);
    }
  }
}
