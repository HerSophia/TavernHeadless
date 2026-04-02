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
import { ToolWorker } from "./services/tool-worker.js";


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

export type BuildAppOptions = {
  databasePath?: string;
  logger?: boolean;
  /** 提供 LLM 配置后自动启用聊天路由 */
  orchestration?: OrchestrationConfig;
  /**
   * 是否启用 WebSocket 推送。
   * - undefined（默认）：当 orchestration 启用时自动启用
   * - true：强制启用（需要 orchestration）
   * - false：强制禁用
   */
  enableWebSocket?: boolean;
  /** 可选：限制进入 prompt 的历史楼层数（最近 N 层） */
  chatHistoryMaxFloors?: number;
  /** 是否启用记忆系统（摘要注入 + 持久化），默认 false */
  enableMemory?: boolean;
  /**
   * 可选：记忆注入衰减配置。
   * 仅在 enableMemory=true 且 chat routes 启用时生效。
   */
  memoryInjectionDecay?: MemoryInjectionOptions["decay"];
  /**
   * 可选：记忆后台维护任务（deprecate / purge）。
   * 仅在 enableMemory=true 时生效。
   */
  memoryMaintenance?: {
    /** 运行间隔（ms） */
    intervalMs: number;
    /** 批处理大小（默认 500） */
    batchSize?: number;
    /** 清理策略（不设置则全部跳过） */
    policy?: MemoryMaintenancePolicy;
    /** 可选：仅统计，不执行写入/删除 */
    dryRun?: boolean;
  };
  /** 是否启用 SSE 流式聊天端点（/sessions/:id/respond/stream），默认 false */
  enableSseChat?: boolean;
  /** 是否启用 Prompt Dry-run 端点（/sessions/:id/respond/dry-run），默认 false */
  enablePromptDryRun?: boolean;
  /** 是否默认启用 MemoryConsolidator（可被请求级 turn config 覆盖） */
  enableMemoryConsolidation?: boolean;
  /** 是否启用异步记忆入队主路径（Phase 2 切换开关） */
  enableAsyncMemoryIngest?: boolean;
  /** 是否启用 macro summary 压缩（Phase 4 切换开关） */
  enableMacroCompaction?: boolean;
  /** 是否启用 micro/macro 双层摘要注入（Phase 4 切换开关） */
  enableDualSummaryInjection?: boolean;
  /** 是否启用 deferred irreversible tool runtime 入口（Phase 1 切换开关） */
  enableDeferredIrreversibleTools?: boolean;
  /** 允许 deferred 执行的 MCP 工具白名单，格式为 serverId/toolName */
  deferredIrreversibleMcpTools?: string[];
  /** 可选：MemoryWorker 运行参数 */
  memoryWorker?: {
    pollIntervalMs?: number;
    leaseTtlMs?: number;
    maxConcurrentJobs?: number;
    retryBaseDelayMs?: number;
    maxRetryDelayMs?: number;
    candidateScanLimit?: number;
  };
  /** 服务端默认生成超时（毫秒） */
  llmDefaultTimeoutMs?: number;
  /** 聊天 transfer 产物目录 */
  chatTransferArtifactDir?: string;
  /** 聊天导入最大字节数 */
  chatImportMaxBytes?: number;
  /** 同步聊天导出消息阈值 */
  chatExportSyncMaxMessages?: number;
  /** 聊天导出产物 TTL（毫秒） */
  chatExportArtifactTtlMs?: number;
  /**
   * 生成协调器实现。
   * 默认使用单实例内存协调器。
   * 若后续需要共享锁或共享队列，可从这里注入自定义实现。
   */
  generationCoordinator?: GenerationCoordinator;
  /**
   * 同一 session + branch 的生成并发策略。
   * 默认保持 reject。
   */
  generationQueueMode?: GenerationExecutionMode;
  /**
   * queue 模式下的排队等待超时（毫秒）。
   * 默认沿用 ChatService 的 5000。
   */
  generationQueueTimeoutMs?: number;
  /** commit 的 SQLITE_BUSY / SQLITE_LOCKED 有限重试次数 */
  turnCommitMaxRetries?: number;
  /** commit 重试基础退避时间（毫秒） */
  turnCommitRetryBaseDelayMs?: number;
  /** 认证配置（默认 off） */
  auth?: AuthConfig;
  /** 账号模式（默认 single） */
  accountMode?: AccountMode;
  /** CORS 配置 */
  cors?: CorsConfig;
  /** 是否启用 MCP 工具集成（默认 false） */
  enableMcp?: boolean;
};

export type BuildAppResult = {
  app: FastifyInstance;
  /** 如果启用了 orchestration，返回上下文（EventBus 等） */
  orchestrationContext?: OrchestrationContext;
  /** 如果启用了 WebSocket，返回 WsBridge 实例 */
  wsBridge?: WsBridge;
  /** 如果启用了 MCP，返回连接管理器 */
  mcpManager?: McpConnectionManager;
};

export type MemoryMaintenanceScopeRef = {
  accountId: string;
  scope: "global" | "chat" | "floor";
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
      return sendError(reply, 409, "constraint_error", "Database constraint violation", {
        sqlite_code: code,
        message: errorMessage
      });
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

  // ── 开发用：内嵌 API 测试页面 ──
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

  if (options.orchestration) {
    const floorRepo = new DrizzleFloorRepository(database.db);
    const memoryRepo = new DrizzleMemoryRepository(database.db);
    const variableRepo = new DrizzleVariableRepository(database.db);
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

  // ── 可选：MCP 工具集成 ──
  const mcpService = new McpService(database.db);
  const mcpBackfill = await mcpService.backfillLegacySecretStorage();
  if (mcpBackfill.migrated > 0 || mcpBackfill.skipped > 0) {
    app.log.info(mcpBackfill, 'MCP secret storage backfill completed');
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

    // 注册 MCP 运行时路由
    await registerMcpRuntimeRoutes(app, mcpManager, database);

    // 应用关闭时断开所有 MCP 连接
    app.addHook('onClose', async () => {
      await mcpManager!.shutdown();
    });

    app.log.info({
      serverCount: resolvedMcpConfigs.configs.length,
      failedServerCount: resolvedMcpConfigs.failures.length,
    }, 'MCP integration enabled');
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
      toolRuntimePolicy: toolRuntimeComponents.policy,
    });
  }

  await registerCrudRoutes(app, database, {
    variableEventBus: orchestrationContext?.eventBus,
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
  });

  // ── 可选：聊天业务路由 ──
  if (options.orchestration && orchestrationContext) {
    const activeOrchestrationContext = orchestrationContext;

    const llmProfileService = new LlmProfileService(database.db);
    const llmInstanceService = new LlmInstanceService(database.db);

    const toolRegistry = baseToolRegistry ?? new ToolRegistry();

    // 默认协调器仍为单实例内存实现。
    // queueMode 只影响当前进程内的互斥 / 排队行为，
    // 不提供跨实例共享锁或共享队列。
    const generationCoordinator = options.generationCoordinator ?? new InMemoryGenerationCoordinator();

    const turnCommitService = new TurnCommitService(
      database.db,
      new ChatMessagePersistence(database.db, activeOrchestrationContext.tokenCounter),
      activeOrchestrationContext.eventBus,
      {
        enableAsyncMemoryIngest: options.enableMemory === true && options.enableAsyncMemoryIngest === true,
        floorRunService,
        mutationRuntime: mutationRuntimeComponents?.runtime,
        toolRuntimeJobBridge: toolRuntimeComponents?.bridge,
      },
    );

    const shouldStartMemoryWorker = options.enableMemory === true && (
      options.enableAsyncMemoryIngest === true
      || options.enableMacroCompaction === true
      || options.memoryMaintenance !== undefined
    );

    if (shouldStartMemoryWorker) {
      memoryWorker = new MemoryWorker(
        database.db,
        activeOrchestrationContext.memoryStore,
        activeOrchestrationContext.memoryIngestProcessor,
        activeOrchestrationContext.memoryCompactionProcessor,
        activeOrchestrationContext.eventBus,
        {
          ...options.memoryWorker,
          logger: app.log,
          enableMacroCompaction: options.enableMacroCompaction === true,
        },
      );
      memoryWorker.start();
    }

    if (options.enableMemory === true && options.memoryMaintenance && memoryWorker) {
      const maintenance = options.memoryMaintenance;
      const intervalMs = Math.max(10_000, maintenance.intervalMs);
      const batchSize = maintenance.batchSize;
      const policy = maintenance.policy;
      const dryRun = maintenance.dryRun === true;
      const memoryJobScheduler = new MemoryJobScheduler({
        eventBus: activeOrchestrationContext.eventBus,
      });

      const enqueueMaintenanceJobs = async () => {
        try {
          const scheduledAt = Date.now();
          const scheduleBucket = Math.floor(scheduledAt / intervalMs);
          const scopes = await listMemoryMaintenanceScopes(database.db);

          const result = database.db.transaction((tx) => scopes.map((scopeRef) => memoryJobScheduler.enqueueMaintenance(tx, {
            accountId: scopeRef.accountId,
            scope: scopeRef.scope,
            scopeId: scopeRef.scopeId,
            scheduleBucket,
            scheduledAt,
            batchSize,
            dryRun,
            policy,
          })));

          app.log.info({
            scopeCount: scopes.length,
            enqueued: result.filter((entry) => entry.created).length,
            scheduleBucket,
          }, "Memory maintenance jobs enqueued");
        } catch (error) {
          app.log.error({ error }, "Memory maintenance enqueue failed");
        }
      };

      memoryMaintenanceTimer = setInterval(() => {
        void enqueueMaintenanceJobs();
      }, intervalMs);
      void enqueueMaintenanceJobs();
    }

    const chatService = new ChatService(
      database.db,
      activeOrchestrationContext.orchestrator,
      activeOrchestrationContext.tokenCounter,
      {
        historyMaxFloors: options.chatHistoryMaxFloors,
        memoryStore: options.enableMemory ? activeOrchestrationContext.memoryStore : undefined,
        memoryInjectionDecay: options.memoryInjectionDecay,
        enableMemoryConsolidationByDefault: options.enableMemoryConsolidation,
        enableAsyncMemoryIngest: options.enableAsyncMemoryIngest,
        enableDualSummaryInjection: options.enableDualSummaryInjection,
        floorRunService,
        turnCommitService,
        resolveTurnModels: async (sessionId, accountId = DEFAULT_ADMIN_ACCOUNT_ID) => {
          try {
            const [profileMap, instanceSlots] = await Promise.all([
              llmProfileService.resolveActiveProfiles(sessionId, accountId),
              llmInstanceService.resolveConfigs(accountId, sessionId),
            ]);
            const result: ResolvedTurnModels = {};
            const instanceMap = new Map(instanceSlots.map((item) => [item.slot, item] as const));

            for (const slot of ["narrator", "director", "verifier", "memory"] as const) {
              const resolvedProfile = profileMap[slot];
              const resolvedInstance = instanceMap.get(slot);
              const generationParams = mergeTurnGenerationParams(
                resolvedProfile?.params,
                resolvedInstance?.params,
              );
              const presetId = resolvedInstance?.presetId ?? undefined;
              const enabled = resolvedInstance?.enabled ?? true;

              if (resolvedProfile) {
                if (enabled) {
                  const providerId = `llm-profile-${resolvedProfile.profileId}-turn-${nanoid(8)}`;
                  const languageModel = activeOrchestrationContext.providerRegistry.createModel(
                    {
                      id: providerId,
                      type: resolvedProfile.provider,
                      apiKey: resolvedProfile.apiKey,
                      baseURL: resolvedProfile.baseUrl ?? undefined,
                    },
                    resolvedProfile.modelId,
                  );

                  result[slot] = {
                    model: { providerId, modelId: resolvedProfile.modelId, languageModel },
                    source: resolvedProfile.source === "session" ? "session_profile" : "global_profile",
                    profileId: resolvedProfile.profileId,
                    generationParams,
                    enabled,
                    presetId,
                  };
                  continue;
                }

                result[slot] = {
                  source: resolvedProfile.source === "session" ? "session_profile" : "global_profile",
                  profileId: resolvedProfile.profileId,
                  generationParams,
                  enabled,
                  presetId,
                };
                continue;
              }

              if (
                resolvedInstance
                && (
                  resolvedInstance.enabled === false
                  || presetId !== undefined
                  || generationParams !== undefined
                  || resolvedInstance.source !== "default"
                )
              ) {
                result[slot] = {
                  source: "env",
                  generationParams,
                  enabled,
                  presetId,
                };
              }
            }

            return result;
          } catch (error) {
            if (error instanceof LlmProfileServiceError) {
              throw new ChatServiceError(error.code, error.message, error);
            }
            throw error;
          }
        },
        onTurnModelUsed: async (resolvedModel, accountId = DEFAULT_ADMIN_ACCOUNT_ID) => {
          if (!resolvedModel.profileId) {
            return;
          }
          await llmProfileService.touchLastUsed(resolvedModel.profileId, accountId);
        },
        generationCoordinator,
        executionPolicy: {
          queueMode: options.generationQueueMode,
          queueTimeoutMs: options.generationQueueTimeoutMs,
          executionTimeoutMs: options.llmDefaultTimeoutMs,
          commitRetry: {
            maxRetries: options.turnCommitMaxRetries,
            baseDelayMs: options.turnCommitRetryBaseDelayMs,
          },
        },
        toolRegistry,
        sessionToolRegistryService,
        eventBus: activeOrchestrationContext.eventBus,
      }
    );

    await registerChatRoutes(app, chatService, {
      enableSseChat: options.enableSseChat,
      enablePromptDryRun: options.enablePromptDryRun,
    });

    // ── 可选：WebSocket 实时推送 ──
    if (options.enableWebSocket !== false) {
      wsBridge = await registerWsPlugin(app, {
        eventBus: activeOrchestrationContext.eventBus,
        db: database.db,
      });
    }
  }

  if (options.enableMemory === true && options.memoryMaintenance && !memoryMaintenanceTimer) {
    const maintenance = options.memoryMaintenance;
    const service = new MemoryMaintenanceService(database.db);
    const intervalMs = Math.max(10_000, maintenance.intervalMs);
    const batchSize = maintenance.batchSize;
    const policy = maintenance.policy;
    const dryRun = maintenance.dryRun === true;

    let running = false;

    const runOnce = async () => {
      if (running) {
        return;
      }
      running = true;
      try {
        const result = await service.run({ batchSize, policy, dryRun });
        app.log.info({ result }, "Memory maintenance completed");
      } catch (error) {
        app.log.error({ error }, "Memory maintenance failed");
      } finally {
        running = false;
      }
    };

    memoryMaintenanceTimer = setInterval(() => {
      void runOnce();
    }, intervalMs);
    void runOnce();
  }


  return { app, orchestrationContext, wsBridge, mcpManager };
}
