import Fastify, { type FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { ZodError } from "zod";
import { readFileSync } from "node:fs";

import type { GenerationParams, MemoryInjectionOptions } from "@tavern/core";

import { createDatabase, type DatabaseConnection } from "./db/client";
import { sendError, zodIssues } from "./lib/http";
import { registerCrudRoutes } from "./routes";
import { isSqliteBusyError, ResourceBusyError } from "./lib/retry.js";
import { registerChatRoutes } from "./routes/chat";
import { registerPromptRuntimeRoutes } from "./routes/prompt-runtime";
import { registerSessionStateObservationRoutes } from "./routes/session-state-observation";

import { registerWsPlugin, type WsBridge } from "./ws";
import {
  DrizzleFloorRepository,
  DrizzleMemoryRepository,
  DrizzleToolExecutionRepository,
  DrizzleVariableRepository,
} from "./adapters";
import { memoryItems, runtimeScopeStates } from "./db/schema.js";
import { MEMORY_RUNTIME_SCOPE_TYPE, parseMemoryRuntimeScopeKey } from "./services/memory-runtime-job-definitions.js";
import {
  ChatService,
  ChatServiceError,
  type ResolvedTurnModels,
} from "./services/chat-service";
import {
  InMemoryGenerationCoordinator,
  type GenerationCoordinator,
  type GenerationExecutionMode,
} from "./services/generation-guard-service";
import {
  TurnCommitService,
} from "./services/turn-commit-service.js";
import { FloorRunService } from "./services/floor-run-service.js";
import { MemoryMaintenanceService, type MemoryMaintenancePolicy } from "./services/memory-maintenance-service";
import {
  createOrchestrationContext,
  type OrchestrationConfig,
  type OrchestrationContext,
} from "./services/orchestration-factory";
import { ChatMessagePersistence } from "./services/chat-message-persistence.js";
import { LlmInstanceService } from "./services/llm-instance-service";
import { LlmProfileService, LlmProfileServiceError } from "./services/llm-profile-service";
import { registerOpenApi } from "./plugins/openapi";
import { registerRequestLogging } from "./plugins/request-logging";
import { registerAuth, type AuthConfig } from "./plugins/auth";
import { findNativePipelineError } from "./lib/native-pipeline-error";
import { ensureDefaultAdminAccount } from "./accounts/service";
import { DEFAULT_ADMIN_ACCOUNT_ID, type AccountMode } from "./accounts/constants";
import { registerCors, type CorsConfig } from "./plugins/cors";
import { McpService } from "./services/mcp-service";
import { repairCrossAccountSessionCharacterBindings } from "./services/resource-ownership";
import { McpConnectionManager } from "./mcp";
import { registerMcpRuntimeRoutes } from "./routes/mcp";
import { SessionToolRegistryService } from "./services/session-tool-registry-service";
import { ToolRegistry, BuiltinToolProvider } from "@tavern/core";
import { ResourceToolProvider } from "./tools/index.js";
import { MemoryWorker } from "./services/memory-worker.js";
import { MemoryJobScheduler } from "./services/memory-job-scheduler.js";
import { createDefaultMutationRuntimeComponents } from "./services/default-mutation-runtime.js";
import { createMutationRuntimeJobBridge } from "./services/mutation-runtime-job-bridge.js";
import { MutationWorker } from "./services/mutation-worker.js";
import { createDefaultToolRuntimeComponents } from "./services/default-tool-runtime.js";
import {
  cleanExpiredClientDataItems,
  purgeDeletedClientDataDomains,
} from "./client-data/client-data-maintenance.js";

import { PromptRuntimeControlService, PromptRuntimeControlServiceError } from "./services/prompt-runtime-control-service.js";
import { ToolWorker } from "./services/tool-worker.js";
import {
  FirstPartyGameStateService,
  SessionStateService,
} from "./session-state/index.js";
import { SessionStateObservationService } from "./session-state/session-state-observation-service.js";

const _pkgJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
const API_VERSION: string = _pkgJson.version ?? "unknown";

type FastifyValidationIssue = {
  instancePath?: string;
  message?: string;
  keyword?: string;
};

function isFastifyRequestValidationError(error: unknown): error is {
  code: "FST_ERR_VALIDATION";
  validation?: FastifyValidationIssue[];
} {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (error as { code?: string }).code === "FST_ERR_VALIDATION";
}

function toValidationDetails(error: { validation?: FastifyValidationIssue[] }) {
  return (error.validation ?? []).map((issue) => ({
    path: issue.instancePath ?? "",
    message: issue.message ?? "Invalid value",
    code: issue.keyword ?? "validation"
  }));
}

function mapSqliteConstraintErrorCode(message: string): { code: string; publicMessage: string } | null {
  if (message.includes("client_data_domain_owner_name_uq") || message.includes("client_data_domain.account_id, client_data_domain.owner_type, client_data_domain.owner_id, client_data_domain.domain_name")) {
    return {
      code: "client_data_domain_name_conflict",
      publicMessage: "Client data domain owner/name already exists",
    };
  }
  if (message.includes("client_data_collection_domain_name_uq") || message.includes("client_data_collection.domain_id, client_data_collection.collection_name")) {
    return {
      code: "client_data_collection_name_conflict",
      publicMessage: "Client data collection name already exists in domain",
    };
  }
  if (message.includes("client_data_domain_grant_unique_uq") || message.includes("client_data_domain_grant.domain_id, client_data_domain_grant.grantee_owner_type, client_data_domain_grant.grantee_owner_id")) {
    return {
      code: "client_data_domain_grant_conflict",
      publicMessage: "Client data domain grant already exists for grantee owner",
    };
  }
  if (message.includes("client_data_managed_domain_account_manager_host_namespace_uq") || message.includes("client_data_managed_domain.account_id, client_data_managed_domain.manager_kind, client_data_managed_domain.host_type, client_data_managed_domain.host_id, client_data_managed_domain.state_namespace")) {
    return {
      code: "client_data_managed_domain_conflict",
      publicMessage: "Client data managed domain registry already exists for host namespace",
    };
  }

  return null;
}

export type BuildAppOptions = {
  databasePath?: string;
  logger?: boolean;
  orchestration?: OrchestrationConfig;
  enableWebSocket?: boolean;
  chatHistoryMaxFloors?: number;
  enableMemory?: boolean;
  memoryInjectionDecay?: MemoryInjectionOptions["decay"];
  memoryMaintenance?: {
    intervalMs: number;
    batchSize?: number;
    policy?: MemoryMaintenancePolicy;
    dryRun?: boolean;
  };
  enableSseChat?: boolean;
  enablePromptDryRun?: boolean;
  enableMemoryConsolidation?: boolean;
  enableAsyncMemoryIngest?: boolean;
  enableMacroCompaction?: boolean;
  enableDualSummaryInjection?: boolean;
  enableDeferredIrreversibleTools?: boolean;
  deferredIrreversibleMcpTools?: string[];
  memoryWorker?: {
    pollIntervalMs?: number;
    leaseTtlMs?: number;
    maxConcurrentJobs?: number;
    retryBaseDelayMs?: number;
    maxRetryDelayMs?: number;
    candidateScanLimit?: number;
  };
  llmDefaultTimeoutMs?: number;
  chatTransferArtifactDir?: string;
  chatImportMaxBytes?: number;
  chatExportSyncMaxMessages?: number;
  chatExportArtifactTtlMs?: number;
  generationCoordinator?: GenerationCoordinator;
  generationQueueMode?: GenerationExecutionMode;
  generationQueueTimeoutMs?: number;
  turnCommitMaxRetries?: number;
  turnCommitRetryBaseDelayMs?: number;
  auth?: AuthConfig;
  accountMode?: AccountMode;
  cors?: CorsConfig;
  enableMcp?: boolean;
  enableUnsafeScriptHandler?: boolean;
  enableClientData?: boolean;
  clientData?: {
    expirationIntervalMs: number;
    domainPurgeGracePeriodMs: number;
    defaultMaxItemSizeBytes: number;
    defaultQuotaMaxEntries: number;
    defaultQuotaMaxBytes: number;
    maxDomainsPerAccount: number;
    maxTotalEntriesPerAccount: number;
    maxTotalBytesPerAccount: number;
  };
};

export type BuildAppResult = {
  app: FastifyInstance;
  database: DatabaseConnection["db"];
  orchestrationContext?: OrchestrationContext;
  wsBridge?: WsBridge;
  mcpManager?: McpConnectionManager;
};

export type MemoryMaintenanceScopeRef = {
  accountId: string;
  scope: "global" | "chat" | "branch" | "floor";
  scopeId: string;
};

export async function listMemoryMaintenanceScopes(
  db: DatabaseConnection["db"],
): Promise<MemoryMaintenanceScopeRef[]> {
  const [itemScopes, scopeStateScopes] = await Promise.all([
    db
      .select({
        accountId: memoryItems.accountId,
        scope: memoryItems.scope,
        scopeId: memoryItems.scopeId,
      })
      .from(memoryItems)
      .groupBy(memoryItems.accountId, memoryItems.scope, memoryItems.scopeId),
    db
      .select({
        accountId: runtimeScopeStates.accountId,
        scopeKey: runtimeScopeStates.scopeKey,
      })
      .from(runtimeScopeStates)
      .where(eq(runtimeScopeStates.scopeType, MEMORY_RUNTIME_SCOPE_TYPE)),
  ]);

  const uniqueScopes = new Map<string, MemoryMaintenanceScopeRef>();
  const parsedScopeStateScopes = scopeStateScopes.map((scopeRef) => ({
    accountId: scopeRef.accountId,
    ...parseMemoryRuntimeScopeKey(scopeRef.scopeKey),
  }));
  for (const scopeRef of [...itemScopes, ...parsedScopeStateScopes]) {
    const key = [scopeRef.accountId, scopeRef.scope, scopeRef.scopeId].join("\u0000");
    uniqueScopes.set(key, scopeRef);
  }

  return [...uniqueScopes.values()];
}

function mergeTurnGenerationParams(
  base?: Partial<GenerationParams> | null,
  override?: Partial<GenerationParams> | null,
): Partial<GenerationParams> | undefined {
  const merged = { ...(base ?? {}), ...(override ?? {}) };
  if (Object.keys(merged).length === 0) {
    return undefined;
  }

  return merged;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<BuildAppResult> {
  let clientDataExpirationTimer: NodeJS.Timeout | undefined;
  let clientDataDomainPurgeTimer: NodeJS.Timeout | undefined;

  const app = Fastify({ logger: options.logger ?? true });
  const database = createDatabase(options.databasePath);
  const accountMode = options.accountMode ?? "single";

  let memoryMaintenanceTimer: NodeJS.Timeout | undefined;
  let memoryWorker: MemoryWorker | undefined;
  let mutationWorker: MutationWorker | undefined;
  let toolWorker: ToolWorker | undefined;

  app.addHook("onClose", async () => {
    if (memoryMaintenanceTimer) {
      clearInterval(memoryMaintenanceTimer);
      memoryMaintenanceTimer = undefined;
    }
    if (clientDataExpirationTimer) {
      clearInterval(clientDataExpirationTimer);
      clientDataExpirationTimer = undefined;
    }
    if (clientDataDomainPurgeTimer) {
      clearInterval(clientDataDomainPurgeTimer);
      clientDataDomainPurgeTimer = undefined;
    }
    if (mutationWorker) {
      await mutationWorker.stop();
      mutationWorker = undefined;
    }
    if (memoryWorker) {
      await memoryWorker.stop();
      memoryWorker = undefined;
    }
    if (toolWorker) {
      await toolWorker.stop();
      toolWorker = undefined;
    }
    database.close();
  });

  await ensureDefaultAdminAccount(database.db);
  const repairedCrossAccountCharacterBindings = await repairCrossAccountSessionCharacterBindings(database.db);
  if (repairedCrossAccountCharacterBindings > 0) {
    app.log.warn({
      repaired_session_count: repairedCrossAccountCharacterBindings,
    }, "Repaired cross-account session character bindings");
  }

  const auth = options.auth ?? { mode: "off" };

  await registerCors(app, options.cors ?? { origins: true, credentials: false });

  await registerOpenApi(app, { authMode: auth.mode });
  await registerRequestLogging(app);
  await registerAuth(app, auth, {
    db: database.db,
    accountMode,
    defaultAccountId: DEFAULT_ADMIN_ACCOUNT_ID,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return sendError(reply, 400, "validation_error", "Request validation failed", zodIssues(error));
    }

    if (isFastifyRequestValidationError(error)) {
      return sendError(
        reply,
        400,
        "validation_error",
        "Request validation failed",
        toValidationDetails(error));
    }

    const nativePipelineError = findNativePipelineError(error);
    if (nativePipelineError) {
      app.log.error(
        {
          request_id: request.id,
          route: request.routeOptions.url ?? request.url.split("?")[0] ?? "/",
          error_code: "native_pipeline_failed",
          node_name: nativePipelineError.nodeName,
          input_summary: nativePipelineError.inputSummary,
          state_summary: nativePipelineError.stateSummary,
          err: error,
        },
        "native prompt pipeline failed"
      );
    }

    const code = (error as { code?: string }).code;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (code?.startsWith("SQLITE_CONSTRAINT")) {
      const mappedConstraint = mapSqliteConstraintErrorCode(errorMessage);
      if (mappedConstraint) {
        return sendError(reply, 409, mappedConstraint.code, mappedConstraint.publicMessage, {
          sqlite_code: code,
          message: errorMessage,
        });
      }
      return sendError(reply, 409, "constraint_error", "Database constraint violation", {
        sqlite_code: code,
        message: errorMessage
      });
    }

    if (error instanceof PromptRuntimeControlServiceError) {
      return sendError(reply, error.statusCode, error.code, error.message);
    }

    if (error instanceof ResourceBusyError || isSqliteBusyError(error)) {
      app.log.warn({
        err: error,
        message: errorMessage,
      }, "resource write is busy");

      return sendError(reply, 503, "resource_busy", "Resource is temporarily busy, please retry", {
        message: errorMessage,
        sqlite_code: typeof code === "string" ? code : undefined,
      });
    }

    if (!nativePipelineError) {
      app.log.error({
        err: error,
        message: errorMessage
      });
    }

    return sendError(reply, 500, "internal_error", "Unexpected server error");
  });

  app.get(
    "/health",
    {
      schema: {
        tags: ["system"],
        summary: "Health check",
        security: [],
        response: {
          200: {
            type: "object",
            required: ["ok", "service", "database"],
            properties: {
              ok: { type: "boolean" },
              service: { type: "string" },
              database: { type: "string" },
            },
          },
        },
      },
    },
    async () => {
      return {
        ok: true,
        service: "@tavern/api",
        database: "ready"
      };
    }
  );

  app.get(
    "/version",
    {
      schema: {
        tags: ["system"],
        summary: "Get service version",
        security: [],
        response: {
          200: {
            type: "object",
            required: ["version", "service", "node_version"],
            properties: {
              version: { type: "string" },
              service: { type: "string" },
              node_version: { type: "string" },
            },
            additionalProperties: false,
          },
        },
      },
    },
    async () => {
      return {
        version: API_VERSION,
        service: "@tavern/api",
        node_version: process.version,
      };
    }
  );

  app.get(
    "/test",
    {
      schema: {
        tags: ["system"],
        summary: "Built-in API test page (dev only)",
        security: [],
        hide: true,
      },
    },
    async (_request, reply) => {
      const html = readFileSync(new URL("../../../test.html", import.meta.url), "utf-8");
      reply.type("text/html; charset=utf-8").send(html);
    }
  );

  let orchestrationContext: OrchestrationContext | undefined;
  let wsBridge: WsBridge | undefined;
  let baseToolRegistry: ToolRegistry | undefined;
  let sessionToolRegistryService: SessionToolRegistryService | undefined;
  let mutationRuntimeComponents: ReturnType<typeof createDefaultMutationRuntimeComponents> | undefined;
  let toolRuntimeComponents: ReturnType<typeof createDefaultToolRuntimeComponents> | undefined;
  let floorRunService: FloorRunService | undefined;
  let promptRuntimePreviewService: Pick<ChatService, "previewPromptRuntimeText"> | undefined;
  let sessionStateService: SessionStateService | undefined;
  let firstPartyGameStateService: FirstPartyGameStateService | undefined;
  let sessionStateObservationService: SessionStateObservationService | undefined;


  if (options.orchestration) {
    const floorRepo = new DrizzleFloorRepository(database.db);
    const memoryRepo = new DrizzleMemoryRepository(database.db, {
      accountMode,
    });
    const variableRepo = new DrizzleVariableRepository(database.db, {
      accountMode,
    });
    const toolExecutionRepo = new DrizzleToolExecutionRepository(database.db);

    orchestrationContext = createOrchestrationContext(
      options.orchestration,
      floorRepo,
      memoryRepo,
      variableRepo,
      toolExecutionRepo,
    );

    floorRunService = new FloorRunService(database.db, orchestrationContext.eventBus);
  }

  if (options.enableClientData === true && options.clientData) {
    sessionStateService = new SessionStateService(database.db, {
      clientData: options.clientData,
    });
    firstPartyGameStateService = new FirstPartyGameStateService(database.db, sessionStateService);
    sessionStateObservationService = new SessionStateObservationService(database.db, sessionStateService);
  }

  const mcpService = new McpService(database.db);
  const mcpBackfill = await mcpService.backfillLegacySecretStorage();
  if (mcpBackfill.migrated > 0 || mcpBackfill.skipped > 0) {
    app.log.info(mcpBackfill, "MCP secret storage backfill completed");
  }

  let mcpManager: McpConnectionManager | undefined;

  if (options.enableMcp) {
    const resolvedMcpConfigs = await mcpService.resolveAllEnabledConfigsForManager();

    mcpManager = new McpConnectionManager(app.log);
    await mcpManager.initialize(resolvedMcpConfigs.configs);

    for (const failure of resolvedMcpConfigs.failures) {
      mcpManager.registerUnavailableServer(
        {
          id: failure.serverId,
          name: failure.serverName,
          transport: failure.transport,
        },
        failure.error,
      );
    }

    await registerMcpRuntimeRoutes(app, mcpManager, database);

    app.addHook("onClose", async () => {
      await mcpManager!.shutdown();
    });

    app.log.info({
      serverCount: resolvedMcpConfigs.configs.length,
      failedServerCount: resolvedMcpConfigs.failures.length,
    }, "MCP integration enabled");
  }

  if (options.orchestration && orchestrationContext) {
    const mutationBridge = createMutationRuntimeJobBridge(database.db, {
      eventBus: orchestrationContext.eventBus,
    });
    mutationRuntimeComponents = createDefaultMutationRuntimeComponents(database.db, {
      eventBus: orchestrationContext.eventBus,
      asyncBridge: mutationBridge,
      masterKey: process.env.APP_SECRETS_MASTER_KEY,
    });

    mutationWorker = new MutationWorker(database.db, mutationRuntimeComponents.registry, {
      eventBus: orchestrationContext.eventBus,
      logger: app.log,
    });
    mutationWorker.start();

    toolRuntimeComponents = createDefaultToolRuntimeComponents(database.db, {
      eventBus: orchestrationContext.eventBus,
      mcpManager,
      enableDeferredIrreversibleTools: options.enableDeferredIrreversibleTools,
      deferredMcpTools: options.deferredIrreversibleMcpTools,
      logger: app.log,
    });

    toolWorker = toolRuntimeComponents.worker;
    toolWorker?.start();

    baseToolRegistry = new ToolRegistry();
    baseToolRegistry.register(new BuiltinToolProvider({
      variableStore: orchestrationContext.variableStore,
      memoryStore: options.enableMemory ? orchestrationContext.memoryStore : undefined,
    }));
    baseToolRegistry.register(new ResourceToolProvider(database.db, {
      mutationRuntime: mutationRuntimeComponents.runtime,
    }));

    sessionToolRegistryService = new SessionToolRegistryService(database.db, {
      baseRegistry: baseToolRegistry,
      mcpManager,
      enableUnsafeScriptHandler: options.enableUnsafeScriptHandler,
      toolRuntimePolicy: toolRuntimeComponents.policy,
      ...(toolRuntimeComponents.mcpToolProviderFactory ? { mcpToolProviderFactory: toolRuntimeComponents.mcpToolProviderFactory } : {}),
    });
  }

  await registerCrudRoutes(app, database, {
    variableEventBus: orchestrationContext?.eventBus,
    memoryEventBus: orchestrationContext?.eventBus,
    sessionToolRegistryService,
    mutationRuntime: mutationRuntimeComponents?.runtime,
    memoryJobs: {
      enableBackgroundWorker: options.enableMemory === true && options.orchestration !== undefined && (
        options.enableAsyncMemoryIngest === true
        || options.enableMacroCompaction === true
        || options.memoryMaintenance !== undefined
      ),
      eventBus: orchestrationContext?.eventBus,
    },
    chatTransferJobs: {
      artifactDir: options.chatTransferArtifactDir,
      importMaxBytes: options.chatImportMaxBytes,
      exportSyncMaxMessages: options.chatExportSyncMaxMessages,
      exportArtifactTtlMs: options.chatExportArtifactTtlMs,
      eventBus: orchestrationContext?.eventBus,
    },
    mcpManager,
    enableUnsafeScriptHandler: options.enableUnsafeScriptHandler,
    accountMode,
    enableClientData: options.enableClientData,
    clientData: options.clientData,
  });

  const promptRuntimeControlService = new PromptRuntimeControlService(database.db, {
    enableLiveEndpoints: Boolean(options.orchestration && orchestrationContext),
    enableDryRunEndpoint: Boolean(options.orchestration && orchestrationContext) && options.enablePromptDryRun === true,
    enablePreviewEndpoint: Boolean(options.orchestration && orchestrationContext),
    enableStreamEndpoint: Boolean(options.orchestration && orchestrationContext) && options.enableSseChat === true,
  });

  if (options.orchestration && orchestrationContext) {
    const llmInstanceService = new LlmInstanceService(database.db);
    const llmProfileService = new LlmProfileService(database.db, {
      masterKey: process.env.APP_SECRETS_MASTER_KEY,
    });
    const effectiveGenerationCoordinator = options.generationCoordinator ?? new InMemoryGenerationCoordinator();

    const chatService = new ChatService(
      database.db,
      orchestrationContext.orchestrator,
      orchestrationContext.tokenCounter,
      {
        historyMaxFloors: options.chatHistoryMaxFloors,
        memoryStore: options.enableMemory ? orchestrationContext.memoryStore : undefined,
        memoryInjectionDecay: options.memoryInjectionDecay,
        enableMemoryConsolidationByDefault: options.enableMemoryConsolidation,
        enableAsyncMemoryIngest: options.enableAsyncMemoryIngest,
        enableDualSummaryInjection: options.enableDualSummaryInjection,
        resolveTurnModels: async (sessionId: string, accountId: string) => {
          try {
            const resolvedSlots = await llmInstanceService.resolveConfigs(accountId, sessionId);
            const activeProfiles = await llmProfileService.resolveActiveProfiles(sessionId, accountId);
            const result: Record<string, unknown> = {};

            for (const slot of resolvedSlots) {
              const activeProfile = activeProfiles[slot.slot as keyof typeof activeProfiles];
              if (slot.enabled !== true) {
                result[slot.slot] = {
                  enabled: false,
                  source: slot.source,
                  presetId: slot.presetId ?? undefined,
                  generationParams: slot.params ?? undefined,
                };
                continue;
              }

              if (!activeProfile) {
                result[slot.slot] = {
                  enabled: slot.enabled,
                  source: "env",
                  presetId: slot.presetId ?? undefined,
                  generationParams: slot.params ?? undefined,
                };
                continue;
              }

              const providerId = `llm-profile-${activeProfile.profileId}-turn-${nanoid(8)}`;
              const languageModel = orchestrationContext.providerRegistry.createModel({
                id: providerId,
                type: activeProfile.provider,
                apiKey: activeProfile.apiKey,
                baseURL: activeProfile.baseUrl ?? undefined,
              }, activeProfile.modelId);

              result[slot.slot] = {
                ...activeProfile,
                enabled: slot.enabled,
                presetId: slot.presetId ?? undefined,
                source: activeProfile.source === "session" ? "session_profile" : "global_profile",
                generationParams: { ...(activeProfile.params ?? {}), ...(slot.params ?? {}) },
                providerType: activeProfile.provider,
                model: {
                  providerId,
                  modelId: activeProfile.modelId,
                  languageModel,
                },
              };
            }

            return result as any;
          } catch (error) {
            if (error instanceof LlmProfileServiceError) {
              throw new ChatServiceError(error.code, error.message, error);
            }
            throw error;
          }
        },
        onTurnModelUsed: async (model, accountId) => {
          if (model.profileId) {
            await llmProfileService.touchLastUsed(model.profileId, accountId);
          }
        },
        floorRunService: floorRunService!,
        sessionToolRegistryService,
        generationCoordinator: effectiveGenerationCoordinator,
        eventBus: orchestrationContext.eventBus,
        executionPolicy: {
          queueMode: options.generationQueueMode,
          queueTimeoutMs: options.generationQueueTimeoutMs,
          executionTimeoutMs: options.llmDefaultTimeoutMs,
          commitRetry: { maxRetries: options.turnCommitMaxRetries, baseDelayMs: options.turnCommitRetryBaseDelayMs },
        },
        accountMode,
        sessionStateService,
        firstPartyGameStateService,
        defaultAccountId: DEFAULT_ADMIN_ACCOUNT_ID,
      }
    );

    promptRuntimePreviewService = chatService;

    await registerChatRoutes(app, chatService, {
      enableSseChat: options.enableSseChat,
      enablePromptDryRun: options.enablePromptDryRun,
      cors: options.cors,
    });

    const shouldEnableWs = options.enableWebSocket ?? Boolean(options.orchestration);
    if (shouldEnableWs) {
      wsBridge = await registerWsPlugin(app, { eventBus: orchestrationContext.eventBus, db: database.db });
    }

  }

  await registerPromptRuntimeRoutes(app, promptRuntimeControlService, {
    previewService: promptRuntimePreviewService,
  });

  if (sessionStateObservationService) {
    await registerSessionStateObservationRoutes(app, {
      observationService: sessionStateObservationService,
    });
  }



  if (options.enableMemory === true && options.memoryMaintenance) {
    const maintenanceService = new MemoryMaintenanceService(database.db, {
      eventBus: orchestrationContext?.eventBus,
    });
    const intervalMs = Math.max(10_000, options.memoryMaintenance.intervalMs);
    const batchSize = options.memoryMaintenance.batchSize ?? 500;
    const dryRun = options.memoryMaintenance.dryRun ?? false;
    let maintenanceRunning = false;

    const runMaintenance = async () => {
        if (maintenanceRunning) {
          return;
        }
        maintenanceRunning = true;
        try {
          const scopes = await listMemoryMaintenanceScopes(database.db);
          if (scopes.length === 0) {
            return;
          }
          let totalDeprecated = 0;
          let totalPurged = 0;
          let touchedScopeCount = 0;
          for (const scope of scopes) {
            const summary = await maintenanceService.run({
              batchSize,
              dryRun,
              policy: options.memoryMaintenance?.policy,
              scope,
            });
            totalDeprecated += summary.deprecated.total;
            totalPurged += summary.purged;
            if (summary.deprecated.total > 0 || summary.purged > 0) {
              touchedScopeCount += 1;
            }
          }
          app.log.info({
            dry_run: dryRun,
            scope_count: scopes.length,
            deprecated: totalDeprecated,
            purged: totalPurged,
            touched_scope_count: touchedScopeCount,
          }, "memory maintenance completed");
        } catch (error) {
          app.log.error({ err: error }, "memory maintenance failed");
        } finally {
          maintenanceRunning = false;
        }
    };

    void runMaintenance();
    memoryMaintenanceTimer = setInterval(() => {
      void runMaintenance();
    }, intervalMs);
  }

  if (options.enableClientData === true && options.clientData) {
    const clientDataConfig = options.clientData;
    const expirationIntervalMs = Math.max(10_000, clientDataConfig.expirationIntervalMs);
    const domainPurgeGracePeriodMs = clientDataConfig.domainPurgeGracePeriodMs;
    let expirationRunning = false;
    let purgeRunning = false;

    const runExpirationCleanup = async () => {
      if (expirationRunning) {
        app.log.debug({ feature: "client-data", task: "expiration-cleanup" }, "client data expiration cleanup skipped because previous run is still active");
        return;
      }
      expirationRunning = true;
      try {
        const result = await cleanExpiredClientDataItems(database.db, clientDataConfig, { batchSize: 500 });
        app.log.info({
          feature: "client-data",
          task: "expiration-cleanup",
          scanned: result.scanned,
          deleted: result.deleted,
          skipped: result.skipped,
        }, "client data expiration cleanup completed");
      } catch (error) {
        app.log.error({ err: error, feature: "client-data", task: "expiration-cleanup" }, "client data expiration cleanup failed");
      } finally {
        expirationRunning = false;
      }
    };

    const runDeletedDomainPurge = async () => {
      if (purgeRunning) {
        app.log.debug({ feature: "client-data", task: "domain-purge" }, "client data domain purge skipped because previous run is still active");
        return;
      }
      purgeRunning = true;
      try {
        const result = await purgeDeletedClientDataDomains(database.db, { gracePeriodMs: domainPurgeGracePeriodMs });
        app.log.info({
          feature: "client-data",
          task: "domain-purge",
          scanned: result.scanned,
          deleted: result.deleted,
          skipped: result.skipped,
          grace_period_ms: domainPurgeGracePeriodMs,
        }, "client data deleted domain purge completed");
      } catch (error) {
        app.log.error({ err: error, feature: "client-data", task: "domain-purge" }, "client data deleted domain purge failed");
      } finally {
        purgeRunning = false;
      }
    };

    void runExpirationCleanup();
    void runDeletedDomainPurge();

    clientDataExpirationTimer = setInterval(() => {
      void runExpirationCleanup();
    }, expirationIntervalMs);

    clientDataDomainPurgeTimer = setInterval(() => {
      void runDeletedDomainPurge();
    }, expirationIntervalMs);
  }

  return {
    app,
    database: database.db,
    orchestrationContext,
    wsBridge,
    mcpManager,
  };
}
