/**
 * Configuration
 *
 * 从环境变量加载应用配置，构造 OrchestrationConfig。
 *
 * 支持的环境变量：
 * - LLM_PROVIDER: 提供商类型（默认 openai-compatible）
 * - LLM_API_KEY: API 密钥（必须）
 * - LLM_BASE_URL: 自定义 Base URL
 * - LLM_MODEL: 默认模型 ID（默认 gpt-4o-mini）
 * - LLM_DIRECTOR_MODEL: Director 模型（可选）
 * - LLM_VERIFIER_MODEL: Verifier 模型（可选）
 * - LLM_MEMORY_MODEL: Memory 模型（可选）
 * - LLM_DEFAULT_TIMEOUT_MS: 服务端默认生成超时（毫秒，默认 60000）
 * - TURN_COMMIT_MAX_RETRIES: commit 的 SQLITE_BUSY / SQLITE_LOCKED 有限重试次数（默认 2）
 * - TURN_COMMIT_RETRY_BASE_DELAY_MS: commit 重试基础退避时间（毫秒，默认 100）
 * - ENABLE_SSE_CHAT: 是否启用 SSE 流式聊天端点（默认 false）
 * - ENABLE_PROMPT_DRY_RUN: 是否启用 Prompt Dry-run 调试端点（默认 false）
 * - CHAT_HISTORY_MAX_FLOORS: 可选历史楼层上限（最近 N 层）
 * - ENABLE_MEMORY_CONSOLIDATION: 是否默认启用 MemoryConsolidator（默认 false）
 * - ENABLE_ASYNC_MEMORY_INGEST: 是否启用异步记忆入队主路径（默认 false）
 * - ENABLE_MACRO_COMPACTION: 是否启用 macro summary 压缩能力（默认 false）
 * - ENABLE_DUAL_SUMMARY_INJECTION: 是否启用 micro/macro 双层摘要注入预算（默认 false）
 * - MEMORY_INJECTION_DECAY_HALF_LIFE_DAYS: 可选，启用记忆注入衰减排序的半衰期（天）
 * - MEMORY_INJECTION_DECAY_MIN_FACTOR: 可选，衰减因子下限（0-1，默认 0.05）
 * - MEMORY_INJECTION_DECAY_BY: 可选，衰减使用的时间字段（updatedAt | createdAt，默认 updatedAt）
 * - ENABLE_MEMORY_MAINTENANCE: 可选，启用记忆维护任务（deprecate / purge）
 * - MEMORY_MAINTENANCE_INTERVAL_MINUTES: 可选，维护任务运行间隔（分钟，默认 60）
 * - MEMORY_MAINTENANCE_BATCH_SIZE: 可选，批处理大小（默认 500）
 * - MEMORY_MAINTENANCE_DEPRECATE_SUMMARY_DAYS: 可选，summary 超过 N 天自动 deprecated（默认 30，设为 0 禁用）
 * - MEMORY_MAINTENANCE_DEPRECATE_OPEN_LOOP_DAYS: 可选，open_loop 超过 N 天自动 deprecated（默认 7，设为 0 禁用）
 * - MEMORY_MAINTENANCE_PURGE_DEPRECATED_DAYS: 可选，deprecated 且自上次更新后超过 N 天自动删除（以 updatedAt 作为最后变更时间，默认 90，设为 0 禁用）
 * - MEMORY_MAINTENANCE_DRY_RUN: 可选，仅统计不执行写入/删除（默认 false）
 * - MEMORY_WORKER_POLL_INTERVAL_MS: 可选，MemoryWorker 轮询间隔（默认 2000）
 * - MEMORY_WORKER_LEASE_TTL_MS: 可选，MemoryWorker lease TTL（默认 120000）
 * - MEMORY_WORKER_MAX_CONCURRENT_JOBS: 可选，MemoryWorker 最大并发作业数（默认 4）
 * - MEMORY_WORKER_RETRY_BASE_DELAY_MS: 可选，MemoryWorker 重试基础退避（默认 1000）
 * - MEMORY_WORKER_MAX_RETRY_DELAY_MS: 可选，MemoryWorker 最大重试退避（默认 30000）
 * - MEMORY_WORKER_CANDIDATE_SCAN_LIMIT: 可选，MemoryWorker 单轮候选扫描上限（默认 32）
 * - ENABLE_MCP: 是否启用 MCP 工具集成（默认 false）
 * - AUTH_MODE: 认证模式（off | api_key | jwt，默认 off）
 * - AUTH_API_KEYS: API Key 模式下的 key 列表（逗号分隔）
 * - AUTH_API_KEY_ACCOUNTS: 多账号 + API Key 模式下的账号映射（key:account_id，逗号分隔）
 * - AUTH_JWT_SECRET: JWT 模式下的签名密钥
 * - AUTH_JWT_ACCOUNT_CLAIM: 多账号 + JWT 模式的账号 claim 字段名（默认 account_id）
 * - ACCOUNT_MODE: 账号模式（single | multi，默认 single）
 * - CORS_ORIGINS / CORS_ORIGIN: 允许的跨域来源（逗号分隔，默认本地 Vite 地址）
 * - CORS_CREDENTIALS: 是否允许携带凭据（true | false，默认 false）
 */

import type { MemoryInjectionOptions, ProviderType } from "@tavern/core";

import type { MemoryMaintenancePolicy } from "./services/memory-maintenance-service.js";

import type { OrchestrationConfig } from "./services/orchestration-factory.js";
import type { AuthConfig, AuthMode } from "./plugins/auth.js";
import type { AccountMode } from "./accounts/constants.js";
import { parseCorsOrigins, type CorsConfig } from "./plugins/cors.js";

// ── 类型 ──────────────────────────────────────────────

export interface AppConfig {
  /** 服务端口 */
  port: number;
  /** 数据库路径 */
  databasePath?: string;
  /** 编排配置（如果提供了 LLM_API_KEY） */
  orchestration?: OrchestrationConfig;
  /** 是否启用 WebSocket */
  enableWebSocket: boolean;
  /** 可选：限制进入 prompt 的历史楼层数（最近 N 层） */
  chatHistoryMaxFloors?: number;
  /** 是否启用记忆系统（摘要注入 + 持久化） */
  enableMemory: boolean;
  /** 可选：记忆注入衰减配置（不设置则不启用） */
  memoryInjectionDecay?: MemoryInjectionOptions["decay"];
  /** 可选：记忆维护任务配置（不设置则不启用） */
  memoryMaintenance?: {
    intervalMs: number;
    batchSize?: number;
    policy?: MemoryMaintenancePolicy;
    dryRun?: boolean;
  };
  /** 是否启用 SSE 流式聊天端点 */
  enableSseChat: boolean;
  /** 是否启用 Prompt Dry-run 端点 */
  enablePromptDryRun: boolean;
  /** 是否默认启用 MemoryConsolidator */
  enableMemoryConsolidation: boolean;
  /** 是否启用异步记忆入队主路径 */
  enableAsyncMemoryIngest: boolean;
  /** 是否启用 macro summary 压缩 */
  enableMacroCompaction: boolean;
  /** 是否启用 micro/macro 双层摘要注入 */
  enableDualSummaryInjection: boolean;
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
  llmDefaultTimeoutMs: number;
  /** commit 的 SQLITE_BUSY / SQLITE_LOCKED 有限重试次数 */
  turnCommitMaxRetries: number;
  /** commit 重试基础退避时间（毫秒） */
  turnCommitRetryBaseDelayMs: number;
  /** 认证配置 */
  auth: AuthConfig;
  /** 账号模式 */
  accountMode: AccountMode;
  /** CORS 配置 */
  cors: CorsConfig;
  /** 是否启用 MCP 工具集成 */
  enableMcp: boolean;
}

// ── 加载函数 ──────────────────────────────────────────

/**
 * 从环境变量加载应用配置。
 *
 * 如果未配置 LLM_API_KEY，orchestration 为 undefined，
 * 聊天路由不会启用（仅 CRUD 可用）。
 */
export function loadConfig(): AppConfig {
  const port = Number(process.env.PORT ?? 3000);
  const databasePath = process.env.DATABASE_URL || undefined;
  const enableWebSocket = process.env.ENABLE_WEBSOCKET !== "false";
  const chatHistoryMaxFloors = parsePositiveInt(process.env.CHAT_HISTORY_MAX_FLOORS);
  const enableMemory = process.env.ENABLE_MEMORY === "true";
  const enableSseChat = process.env.ENABLE_SSE_CHAT === "true";
  const enablePromptDryRun = process.env.ENABLE_PROMPT_DRY_RUN === "true";
  const accountMode = parseAccountMode(process.env.ACCOUNT_MODE);
  const enableMemoryConsolidation = process.env.ENABLE_MEMORY_CONSOLIDATION === "true";
  const enableAsyncMemoryIngest = process.env.ENABLE_ASYNC_MEMORY_INGEST === "true";
  const enableMacroCompaction = process.env.ENABLE_MACRO_COMPACTION === "true";
  const enableDualSummaryInjection = process.env.ENABLE_DUAL_SUMMARY_INJECTION === "true";
  const llmDefaultTimeoutMs = parsePositiveInt(process.env.LLM_DEFAULT_TIMEOUT_MS) ?? 60_000;
  const turnCommitMaxRetries = parseNonNegativeInt(process.env.TURN_COMMIT_MAX_RETRIES) ?? 2;
  const turnCommitRetryBaseDelayMs = parsePositiveInt(process.env.TURN_COMMIT_RETRY_BASE_DELAY_MS) ?? 100;
  const cors = parseCorsConfig(process.env.CORS_ORIGINS ?? process.env.CORS_ORIGIN, process.env.CORS_CREDENTIALS);
  const enableMcp = process.env.ENABLE_MCP === "true";
  const memoryInjectionDecay = parseMemoryInjectionDecay(
    process.env.MEMORY_INJECTION_DECAY_HALF_LIFE_DAYS,
    process.env.MEMORY_INJECTION_DECAY_MIN_FACTOR,
    process.env.MEMORY_INJECTION_DECAY_BY
  );
  const memoryWorker = parseMemoryWorkerConfig(
    process.env.MEMORY_WORKER_POLL_INTERVAL_MS,
    process.env.MEMORY_WORKER_LEASE_TTL_MS,
    process.env.MEMORY_WORKER_MAX_CONCURRENT_JOBS,
    process.env.MEMORY_WORKER_RETRY_BASE_DELAY_MS,
    process.env.MEMORY_WORKER_MAX_RETRY_DELAY_MS,
    process.env.MEMORY_WORKER_CANDIDATE_SCAN_LIMIT,
  );

  const memoryMaintenance = parseMemoryMaintenanceConfig(
    process.env.ENABLE_MEMORY_MAINTENANCE,
    process.env.MEMORY_MAINTENANCE_INTERVAL_MINUTES,
    process.env.MEMORY_MAINTENANCE_BATCH_SIZE,
    process.env.MEMORY_MAINTENANCE_DEPRECATE_SUMMARY_DAYS,
    process.env.MEMORY_MAINTENANCE_DEPRECATE_OPEN_LOOP_DAYS,
    process.env.MEMORY_MAINTENANCE_PURGE_DEPRECATED_DAYS,
    process.env.MEMORY_MAINTENANCE_DRY_RUN
  );

  const auth = parseAuthConfig(
    process.env.AUTH_MODE,
    process.env.AUTH_API_KEYS,
    process.env.AUTH_JWT_SECRET,
    process.env.AUTH_API_KEY_ACCOUNTS,
    process.env.AUTH_JWT_ACCOUNT_CLAIM
  );

  if (accountMode === "multi" && auth.mode === "off") {
    throw new Error("ACCOUNT_MODE=multi requires AUTH_MODE to be api_key or jwt");
  }

  if (accountMode === "multi" && auth.mode === "api_key" && !auth.apiKeyAccountMap) {
    throw new Error("ACCOUNT_MODE=multi with AUTH_MODE=api_key requires AUTH_API_KEY_ACCOUNTS mapping");
  }

  // ── LLM 配置 ──
  const apiKey = process.env.LLM_API_KEY;

  if (!apiKey) {
    return {
      port,
      databasePath,
      enableWebSocket,
      chatHistoryMaxFloors,
      enableMemory,
      memoryInjectionDecay,
      memoryMaintenance,
      enableSseChat,
      enablePromptDryRun,
      enableMemoryConsolidation,
      enableAsyncMemoryIngest,
      enableMacroCompaction,
      enableDualSummaryInjection,
      memoryWorker,
      llmDefaultTimeoutMs,
      turnCommitMaxRetries,
      turnCommitRetryBaseDelayMs,
      auth,
      accountMode,
      cors,
      enableMcp,
    };
  }

  const providerType = (process.env.LLM_PROVIDER ?? "openai-compatible") as ProviderType;
  const baseURL = process.env.LLM_BASE_URL || undefined;
  const modelId = process.env.LLM_MODEL ?? "gpt-4o-mini";

  // Provider ID 从类型派生，加上 "default-" 前缀区分
  const providerId = `default-${providerType}`;

  const orchestration: OrchestrationConfig = {
    providers: [
      {
        id: providerId,
        type: providerType,
        apiKey,
        baseURL,
      },
    ],
    defaultModel: {
      providerId,
      modelId,
    },
  };

  // 可选：Director / Verifier / Memory 使用不同模型
  const directorModel = process.env.LLM_DIRECTOR_MODEL;
  if (directorModel) {
    orchestration.directorModel = { providerId, modelId: directorModel };
  }

  const verifierModel = process.env.LLM_VERIFIER_MODEL;
  if (verifierModel) {
    orchestration.verifierModel = { providerId, modelId: verifierModel };
  }

  const memoryModel = process.env.LLM_MEMORY_MODEL;
  if (memoryModel) {
    orchestration.memoryModel = { providerId, modelId: memoryModel };
  }

  return {
    port,
    databasePath,
    orchestration,
    enableWebSocket,
    chatHistoryMaxFloors,
    enableMemory,
    memoryInjectionDecay,
    memoryMaintenance,
    enableSseChat,
    enablePromptDryRun,
    enableMemoryConsolidation,
    enableAsyncMemoryIngest,
    enableMacroCompaction,
    enableDualSummaryInjection,
    memoryWorker,
    llmDefaultTimeoutMs,
    turnCommitMaxRetries,
    turnCommitRetryBaseDelayMs,
    auth,
    accountMode,
    cors,
    enableMcp,
  };
}

function parseCorsConfig(originsRaw: string | undefined, credentialsRaw: string | undefined): CorsConfig {
  return {
    origins: parseCorsOrigins(originsRaw),
    credentials: credentialsRaw === "true",
  };
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function parseNonNegativeInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function parseMemoryInjectionDecay(
  halfLifeDaysRaw: string | undefined,
  minFactorRaw: string | undefined,
  byRaw: string | undefined
): MemoryInjectionOptions["decay"] | undefined {
  const halfLifeDays = parsePositiveNumber(halfLifeDaysRaw);
  if (!halfLifeDays) {
    return undefined;
  }

  const halfLifeMs = Math.round(halfLifeDays * 24 * 60 * 60 * 1000);

  let minFactor: number | undefined;
  if (minFactorRaw !== undefined && minFactorRaw.trim().length > 0) {
    const parsed = Number(minFactorRaw);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      minFactor = parsed;
    }
  }

  const byNormalized = byRaw?.trim();
  const by = byNormalized === "createdAt" || byNormalized === "updatedAt"
    ? byNormalized
    : undefined;

  return {
    halfLifeMs,
    ...(minFactor !== undefined ? { minFactor } : {}),
    ...(by ? { by } : {}),
  };
}

function parseMemoryMaintenanceConfig(
  enabledRaw: string | undefined,
  intervalMinutesRaw: string | undefined,
  batchSizeRaw: string | undefined,
  deprecateSummaryDaysRaw: string | undefined,
  deprecateOpenLoopDaysRaw: string | undefined,
  purgeDeprecatedDaysRaw: string | undefined,
  dryRunRaw: string | undefined
): AppConfig["memoryMaintenance"] | undefined {
  const enabled = enabledRaw === "true";
  if (!enabled) {
    return undefined;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const intervalMinutes = parsePositiveInt(intervalMinutesRaw) ?? 60;
  const batchSize = parsePositiveInt(batchSizeRaw) ?? 500;
  const deprecateSummaryDays = parseNonNegativeInt(deprecateSummaryDaysRaw) ?? 30;
  const deprecateOpenLoopDays = parseNonNegativeInt(deprecateOpenLoopDaysRaw) ?? 7;
  const purgeDeprecatedDays = parseNonNegativeInt(purgeDeprecatedDaysRaw) ?? 90;

  const policy: MemoryMaintenancePolicy = {
    ...(deprecateSummaryDays > 0
      ? { summaryMaxAgeMs: deprecateSummaryDays * dayMs }
      : {}),
    ...(deprecateOpenLoopDays > 0
      ? { openLoopMaxAgeMs: deprecateOpenLoopDays * dayMs }
      : {}),
    ...(purgeDeprecatedDays > 0
      ? { deprecatedPurgeAgeMs: purgeDeprecatedDays * dayMs }
      : {}),
  };

  return {
    intervalMs: intervalMinutes * 60 * 1000,
    batchSize,
    policy,
    dryRun: dryRunRaw === "true",
  };
}

function parseMemoryWorkerConfig(
  pollIntervalMsRaw: string | undefined,
  leaseTtlMsRaw: string | undefined,
  maxConcurrentJobsRaw: string | undefined,
  retryBaseDelayMsRaw: string | undefined,
  maxRetryDelayMsRaw: string | undefined,
  candidateScanLimitRaw: string | undefined,
): AppConfig["memoryWorker"] | undefined {
  const pollIntervalMs = parsePositiveInt(pollIntervalMsRaw);
  const leaseTtlMs = parsePositiveInt(leaseTtlMsRaw);
  const maxConcurrentJobs = parsePositiveInt(maxConcurrentJobsRaw);
  const retryBaseDelayMs = parsePositiveInt(retryBaseDelayMsRaw);
  const maxRetryDelayMs = parsePositiveInt(maxRetryDelayMsRaw);
  const candidateScanLimit = parsePositiveInt(candidateScanLimitRaw);

  if (
    pollIntervalMs === undefined
    && leaseTtlMs === undefined
    && maxConcurrentJobs === undefined
    && retryBaseDelayMs === undefined
    && maxRetryDelayMs === undefined
    && candidateScanLimit === undefined
  ) {
    return undefined;
  }

  return {
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
    ...(leaseTtlMs !== undefined ? { leaseTtlMs } : {}),
    ...(maxConcurrentJobs !== undefined ? { maxConcurrentJobs } : {}),
    ...(retryBaseDelayMs !== undefined ? { retryBaseDelayMs } : {}),
    ...(maxRetryDelayMs !== undefined ? { maxRetryDelayMs } : {}),
    ...(candidateScanLimit !== undefined ? { candidateScanLimit } : {}),
  };
}

function parseAuthConfig(
  modeRaw: string | undefined,
  apiKeysRaw: string | undefined,
  jwtSecret: string | undefined,
  apiKeyAccountsRaw: string | undefined,
  jwtAccountClaimRaw: string | undefined
): AuthConfig {
  const mode = parseAuthMode(modeRaw);

  if (mode === "off") {
    return { mode: "off" };
  }

  if (mode === "api_key") {
    const apiKeys = (apiKeysRaw ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    if (apiKeys.length === 0) {
      throw new Error("AUTH_MODE=api_key requires AUTH_API_KEYS to be set");
    }

    return {
      mode: "api_key",
      apiKeys: Array.from(new Set(apiKeys)),
      apiKeyAccountMap: parseApiKeyAccountMap(apiKeyAccountsRaw),
    };
  }

  if (!jwtSecret || jwtSecret.trim().length === 0) {
    throw new Error("AUTH_MODE=jwt requires AUTH_JWT_SECRET to be set");
  }

  return {
    mode: "jwt",
    jwtSecret,
    jwtAccountClaim: parseOptionalNonEmpty(jwtAccountClaimRaw),
  };
}

function parseApiKeyAccountMap(raw: string | undefined): Record<string, string> | undefined {
  if (!raw || raw.trim().length === 0) {
    return undefined;
  }

  const map: Record<string, string> = {};
  const pairs = raw.split(",").map((item) => item.trim()).filter((item) => item.length > 0);

  for (const pair of pairs) {
    const separatorIndex = pair.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === pair.length - 1) {
      throw new Error(`Invalid AUTH_API_KEY_ACCOUNTS pair: ${pair}`);
    }

    const key = pair.slice(0, separatorIndex).trim();
    const accountId = pair.slice(separatorIndex + 1).trim();
    if (!key || !accountId) {
      throw new Error(`Invalid AUTH_API_KEY_ACCOUNTS pair: ${pair}`);
    }

    map[key] = accountId;
  }

  return Object.keys(map).length > 0 ? map : undefined;
}

function parseOptionalNonEmpty(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function parseAuthMode(raw: string | undefined): AuthMode {
  if (!raw || raw.trim().length === 0) {
    return "off";
  }

  const normalized = raw.trim();

  if (normalized === "api_key" || normalized === "jwt") {
    return normalized;
  }

  if (normalized === "off") {
    return "off";
  }

  throw new Error(`Unsupported AUTH_MODE: ${raw}`);
}

function parseAccountMode(raw: string | undefined): AccountMode {
  if (!raw || raw.trim().length === 0) {
    return "single";
  }

  const normalized = raw.trim();

  if (normalized === "single" || normalized === "multi") {
    return normalized;
  }

  throw new Error(`Unsupported ACCOUNT_MODE: ${raw}`);
}
