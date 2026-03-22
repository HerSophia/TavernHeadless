import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { readFileSync } from "node:fs";

import type { MemoryInjectionOptions } from "@tavern/core";

import { createDatabase } from "./db/client";
import { sendError, zodIssues } from "./lib/http";
import { registerCrudRoutes } from "./routes";
import { registerChatRoutes } from "./routes/chat";
import { registerWsPlugin, type WsBridge } from "./ws";
import { DrizzleFloorRepository, DrizzleMemoryRepository } from "./adapters";
import { ChatService, ChatServiceError, type ResolvedTurnModels } from "./services/chat-service";
import {
  MemoryMaintenanceService,
  type MemoryMaintenancePolicy,
} from "./services/memory-maintenance-service";
import {
  createOrchestrationContext,
  type OrchestrationConfig,
  type OrchestrationContext,
} from "./services/orchestration-factory";
import { LlmProfileService, LlmProfileServiceError } from "./services/llm-profile-service";
import { registerOpenApi } from "./plugins/openapi";
import { registerRequestLogging } from "./plugins/request-logging";
import { registerAuth, type AuthConfig } from "./plugins/auth";
import { findNativePipelineError } from "./lib/native-pipeline-error";
import { ensureDefaultAdminAccount } from "./accounts/service";
import { DEFAULT_ADMIN_ACCOUNT_ID, type AccountMode } from "./accounts/constants";
import { registerCors, type CorsConfig } from "./plugins/cors";

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
  /** 认证配置（默认 off） */
  auth?: AuthConfig;
  /** 账号模式（默认 single） */
  accountMode?: AccountMode;
  /** CORS 配置 */
  cors?: CorsConfig;
};

export type BuildAppResult = {
  app: FastifyInstance;
  /** 如果启用了 orchestration，返回上下文（EventBus 等） */
  orchestrationContext?: OrchestrationContext;
  /** 如果启用了 WebSocket，返回 WsBridge 实例 */
  wsBridge?: WsBridge;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<BuildAppResult> {
  const app = Fastify({ logger: options.logger ?? true });
  const database = createDatabase(options.databasePath);
  const accountMode = options.accountMode ?? "single";

  let memoryMaintenanceTimer: NodeJS.Timeout | undefined;

  app.addHook("onClose", async () => {
    if (memoryMaintenanceTimer) {
      clearInterval(memoryMaintenanceTimer);
      memoryMaintenanceTimer = undefined;
    }
    database.close();
  });

  await ensureDefaultAdminAccount(database.db);

  const auth = options.auth ?? { mode: "off" };

  await registerCors(app, options.cors ?? { origins: true, credentials: false });

  await registerOpenApi(app, { authMode: auth.mode });
  await registerRequestLogging(app);
  await registerAuth(app, auth, {
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

  await registerCrudRoutes(app, database);

  // ── 可选：记忆维护任务（deprecate / purge） ──
  // 注意：当前实现为进程内定时器，不带分布式锁。
  // 多实例部署时，只允许一个实例启用记忆维护；
  // 其余 API 实例应关闭该开关，或改由独立 maintenance job / worker 负责。
  // 当前 beta 仅记录该部署约束，不在这里实现多实例协调。
  if (options.enableMemory === true && options.memoryMaintenance) {
    const maintenance = options.memoryMaintenance;
    const service = new MemoryMaintenanceService(database.db);
    const intervalMs = Math.max(10_000, maintenance.intervalMs);
    const batchSize = maintenance.batchSize;
    const policy = maintenance.policy;
    const dryRun = maintenance.dryRun === true;

    let running = false;

    const runOnce = async () => {
      if (running) return;
      running = true;
      try {
        const result = await service.run({
          batchSize,
          policy,
          dryRun,
        });
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
  }

  // ── 可选：聊天业务路由 ──
  let orchestrationContext: OrchestrationContext | undefined;
  let wsBridge: WsBridge | undefined;

  if (options.orchestration) {
    const floorRepo = new DrizzleFloorRepository(database.db);
    const memoryRepo = new DrizzleMemoryRepository(database.db);

    const activeOrchestrationContext = createOrchestrationContext(
      options.orchestration,
      floorRepo,
      memoryRepo
    );
    orchestrationContext = activeOrchestrationContext;

    const llmProfileService = new LlmProfileService(database.db);

    const chatService = new ChatService(
      database.db,
      activeOrchestrationContext.orchestrator,
      activeOrchestrationContext.tokenCounter,
      {
        historyMaxFloors: options.chatHistoryMaxFloors,
        memoryStore: options.enableMemory ? activeOrchestrationContext.memoryStore : undefined,
        memoryInjectionDecay: options.memoryInjectionDecay,
        enableMemoryConsolidationByDefault: options.enableMemoryConsolidation,
        resolveTurnModels: async (sessionId, accountId = DEFAULT_ADMIN_ACCOUNT_ID) => {
          try {
            const profileMap = await llmProfileService.resolveActiveProfiles(sessionId, accountId);
            const result: ResolvedTurnModels = {};

            for (const [slot, resolved] of Object.entries(profileMap)) {
              if (!resolved) continue;

              const providerId = `llm-profile-${resolved.profileId}`;
              activeOrchestrationContext.providerRegistry.register({
                id: providerId,
                type: resolved.provider,
                apiKey: resolved.apiKey,
                baseURL: resolved.baseUrl ?? undefined,
              });

              // resolveActiveProfiles 已经对每个具体槽位完成 fallback 解析，忽略通配位
              if (slot === "*") continue;
              const concreteSlot = slot as keyof ResolvedTurnModels;

              result[concreteSlot] = {
                model: { providerId, modelId: resolved.modelId },
                source: resolved.source === "session" ? "session_profile" : "global_profile",
                profileId: resolved.profileId,
                generationParams: resolved.params,
              };
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
      });
    }
  }

  return { app, orchestrationContext, wsBridge };
}
