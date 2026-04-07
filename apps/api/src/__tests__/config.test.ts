import { describe, it, expect, vi, afterEach } from "vitest";

import { loadConfig } from "../config.js";

// 每个用例结束后清除所有 stubbed 环境变量
afterEach(() => {
  vi.unstubAllEnvs();
});

// ── loadConfig 基本场景 ─────────────────────────────────

describe("loadConfig", () => {
  it("returns config without orchestration when LLM_API_KEY is not set", () => {
    // 不设置 LLM_API_KEY
    const config = loadConfig();
    expect(config.orchestration).toBeUndefined();
    expect(config.port).toBe(3000);
    expect(config.enableWebSocket).toBe(true);
    expect(config.auth.mode).toBe("off");
    expect(config.accountMode).toBe("single");
    expect(config.llmDefaultTimeoutMs).toBe(60_000);
    expect(config.turnCommitMaxRetries).toBe(2);
    expect(config.turnCommitRetryBaseDelayMs).toBe(100);
    expect(config.generationQueueMode).toBe("reject");
    expect(config.generationQueueTimeoutMs).toBeUndefined();
  });

  it("returns config with orchestration when LLM_API_KEY is set", () => {
    vi.stubEnv("LLM_API_KEY", "sk-test-key");

    const config = loadConfig();
    expect(config.orchestration).toBeDefined();
    expect(config.orchestration!.providers).toHaveLength(1);
    expect(config.orchestration!.providers[0]!.apiKey).toBe("sk-test-key");
    expect(config.orchestration!.defaultModel.modelId).toBe("gpt-4o-mini");
  });

  it("reads PORT from environment", () => {
    vi.stubEnv("PORT", "4000");
    const config = loadConfig();
    expect(config.port).toBe(4000);
  });

  it("reads DATABASE_URL from environment", () => {
    vi.stubEnv("DATABASE_URL", "/tmp/test.db");
    const config = loadConfig();
    expect(config.databasePath).toBe("/tmp/test.db");
  });

  it("defaults databasePath to undefined when DATABASE_URL is empty", () => {
    vi.stubEnv("DATABASE_URL", "");
    const config = loadConfig();
    expect(config.databasePath).toBeUndefined();
  });

  it("reads ENABLE_WEBSOCKET=false", () => {
    vi.stubEnv("ENABLE_WEBSOCKET", "false");
    const config = loadConfig();
    expect(config.enableWebSocket).toBe(false);
  });

  it("reads ENABLE_SSE_CHAT=true", () => {
    vi.stubEnv("ENABLE_SSE_CHAT", "true");
    const config = loadConfig();
    expect(config.enableSseChat).toBe(true);
  });

  it("reads ENABLE_PROMPT_DRY_RUN=true", () => {
    vi.stubEnv("ENABLE_PROMPT_DRY_RUN", "true");
    const config = loadConfig();
    expect(config.enablePromptDryRun).toBe(true);
  });

  it("reads ENABLE_MEMORY=true", () => {
    vi.stubEnv("ENABLE_MEMORY", "true");
    const config = loadConfig();
    expect(config.enableMemory).toBe(true);
  });

  it("reads ENABLE_MEMORY_CONSOLIDATION=true", () => {
    vi.stubEnv("ENABLE_MEMORY_CONSOLIDATION", "true");
    const config = loadConfig();
    expect(config.enableMemoryConsolidation).toBe(true);
  });

  it("defaults Memory V2 feature flags to false", () => {
    const config = loadConfig();
    expect(config.enableAsyncMemoryIngest).toBe(false);
    expect(config.enableMacroCompaction).toBe(false);
    expect(config.enableDualSummaryInjection).toBe(false);
    expect(config.enableDeferredIrreversibleTools).toBe(false);
    expect(config.deferredIrreversibleMcpTools).toEqual([]);
    expect(config.enableUnsafeScriptHandler).toBe(false);
  });

  it("reads Memory V2 feature flags", () => {
    vi.stubEnv("ENABLE_ASYNC_MEMORY_INGEST", "true");
    vi.stubEnv("ENABLE_MACRO_COMPACTION", "true");
    vi.stubEnv("ENABLE_DUAL_SUMMARY_INJECTION", "true");
    vi.stubEnv("ENABLE_DEFERRED_IRREVERSIBLE_TOOLS", "true");
    vi.stubEnv("DEFERRED_IRREVERSIBLE_MCP_TOOLS", "mcp-1/github_create_issue,mcp-2/files_write");
    const config = loadConfig();
    expect(config.enableAsyncMemoryIngest).toBe(true);
    expect(config.enableMacroCompaction).toBe(true);
    expect(config.enableDualSummaryInjection).toBe(true);
    expect(config.enableDeferredIrreversibleTools).toBe(true);
    expect(config.deferredIrreversibleMcpTools).toEqual(["mcp-1/github_create_issue", "mcp-2/files_write"]);
  });

  it("reads ENABLE_UNSAFE_SCRIPT_HANDLER=true", () => {
    vi.stubEnv("ENABLE_UNSAFE_SCRIPT_HANDLER", "true");

    const config = loadConfig();
    expect(config.enableUnsafeScriptHandler).toBe(true);
  });

  it("reads MemoryWorker tuning envs", () => {
    vi.stubEnv("MEMORY_WORKER_POLL_INTERVAL_MS", "500");
    vi.stubEnv("MEMORY_WORKER_LEASE_TTL_MS", "60000");
    vi.stubEnv("MEMORY_WORKER_MAX_CONCURRENT_JOBS", "8");
    vi.stubEnv("MEMORY_WORKER_RETRY_BASE_DELAY_MS", "1500");
    vi.stubEnv("MEMORY_WORKER_MAX_RETRY_DELAY_MS", "45000");
    vi.stubEnv("MEMORY_WORKER_CANDIDATE_SCAN_LIMIT", "64");

    const config = loadConfig();
    expect(config.memoryWorker).toEqual({
      pollIntervalMs: 500,
      leaseTtlMs: 60_000,
      maxConcurrentJobs: 8,
      retryBaseDelayMs: 1_500,
      maxRetryDelayMs: 45_000,
      candidateScanLimit: 64,
    });
  });

  it("ignores invalid MemoryWorker tuning envs", () => {
    vi.stubEnv("MEMORY_WORKER_POLL_INTERVAL_MS", "0");
    vi.stubEnv("MEMORY_WORKER_LEASE_TTL_MS", "-1");
    vi.stubEnv("MEMORY_WORKER_MAX_CONCURRENT_JOBS", "abc");

    const config = loadConfig();
    expect(config.memoryWorker).toBeUndefined();
  });

  it("reads LLM_DEFAULT_TIMEOUT_MS as positive int", () => {
    vi.stubEnv("LLM_DEFAULT_TIMEOUT_MS", "90000");

    const config = loadConfig();
    expect(config.llmDefaultTimeoutMs).toBe(90_000);
  });

  it("reads TURN_COMMIT_MAX_RETRIES and TURN_COMMIT_RETRY_BASE_DELAY_MS", () => {
    vi.stubEnv("TURN_COMMIT_MAX_RETRIES", "4");
    vi.stubEnv("TURN_COMMIT_RETRY_BASE_DELAY_MS", "250");

    const config = loadConfig();
    expect(config.turnCommitMaxRetries).toBe(4);
    expect(config.turnCommitRetryBaseDelayMs).toBe(250);
  });

  it("falls back to defaults for invalid retry and timeout env values", () => {
    vi.stubEnv("LLM_DEFAULT_TIMEOUT_MS", "0");
    vi.stubEnv("TURN_COMMIT_MAX_RETRIES", "-1");
    vi.stubEnv("TURN_COMMIT_RETRY_BASE_DELAY_MS", "0");

    const config = loadConfig();
    expect(config.llmDefaultTimeoutMs).toBe(60_000);
    expect(config.turnCommitMaxRetries).toBe(2);
    expect(config.turnCommitRetryBaseDelayMs).toBe(100);
  });

  it("reads GENERATION_QUEUE_MODE and GENERATION_QUEUE_TIMEOUT_MS", () => {
    vi.stubEnv("GENERATION_QUEUE_MODE", "queue");
    vi.stubEnv("GENERATION_QUEUE_TIMEOUT_MS", "2500");

    const config = loadConfig();
    expect(config.generationQueueMode).toBe("queue");
    expect(config.generationQueueTimeoutMs).toBe(2_500);
  });

  it("throws for unsupported GENERATION_QUEUE_MODE", () => {
    vi.stubEnv("GENERATION_QUEUE_MODE", "later");

    expect(() => loadConfig()).toThrow("Unsupported GENERATION_QUEUE_MODE: later");
  });

  it("ignores invalid GENERATION_QUEUE_TIMEOUT_MS", () => {
    vi.stubEnv("GENERATION_QUEUE_TIMEOUT_MS", "0");
    expect(loadConfig().generationQueueTimeoutMs).toBeUndefined();
  });

  it("reads ENABLE_MCP=true", () => {
    vi.stubEnv("ENABLE_MCP", "true");
    const config = loadConfig();
    expect(config.enableMcp).toBe(true);
  });

  it("reads CHAT_HISTORY_MAX_FLOORS as positive int", () => {
    vi.stubEnv("CHAT_HISTORY_MAX_FLOORS", "50");
    const config = loadConfig();
    expect(config.chatHistoryMaxFloors).toBe(50);
  });

  it("ignores invalid CHAT_HISTORY_MAX_FLOORS", () => {
    vi.stubEnv("CHAT_HISTORY_MAX_FLOORS", "-5");
    const config = loadConfig();
    expect(config.chatHistoryMaxFloors).toBeUndefined();
  });
});

// ── LLM 模型配置 ──────────────────────────────────────

describe("LLM model configuration", () => {
  it("uses custom LLM_PROVIDER and LLM_BASE_URL", () => {
    vi.stubEnv("LLM_API_KEY", "sk-test");
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    vi.stubEnv("LLM_BASE_URL", "https://custom.api.com");
    vi.stubEnv("LLM_MODEL", "claude-3");

    const config = loadConfig();
    const provider = config.orchestration!.providers[0]!;
    expect(provider.type).toBe("anthropic");
    expect(provider.baseURL).toBe("https://custom.api.com");
    expect(config.orchestration!.defaultModel.modelId).toBe("claude-3");
  });

  it("sets optional director / verifier / memory models", () => {
    vi.stubEnv("LLM_API_KEY", "sk-test");
    vi.stubEnv("LLM_DIRECTOR_MODEL", "director-model");
    vi.stubEnv("LLM_VERIFIER_MODEL", "verifier-model");
    vi.stubEnv("LLM_MEMORY_MODEL", "memory-model");

    const config = loadConfig();
    expect(config.orchestration!.directorModel!.modelId).toBe("director-model");
    expect(config.orchestration!.verifierModel!.modelId).toBe("verifier-model");
    expect(config.orchestration!.memoryModel!.modelId).toBe("memory-model");
  });

  it("does not set optional models when env vars are absent", () => {
    vi.stubEnv("LLM_API_KEY", "sk-test");

    const config = loadConfig();
    expect(config.orchestration!.directorModel).toBeUndefined();
    expect(config.orchestration!.verifierModel).toBeUndefined();
    expect(config.orchestration!.memoryModel).toBeUndefined();
  });
});

// ── CORS 配置 ────────────────────────────────────────

describe("CORS configuration", () => {
  it("defaults to dev origins when CORS_ORIGINS is not set", () => {
    const config = loadConfig();
    expect(config.cors.origins).toEqual([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4173",
      "http://127.0.0.1:4173",
    ]);
    expect(config.cors.credentials).toBe(false);
  });

  it("parses CORS_ORIGINS as comma-separated list", () => {
    vi.stubEnv("CORS_ORIGINS", "https://a.com,https://b.com");
    vi.stubEnv("CORS_CREDENTIALS", "true");

    const config = loadConfig();
    expect(config.cors.origins).toEqual(["https://a.com", "https://b.com"]);
    expect(config.cors.credentials).toBe(true);
  });

  it("returns true for wildcard CORS_ORIGINS=*", () => {
    vi.stubEnv("CORS_ORIGINS", "*");
    const config = loadConfig();
    expect(config.cors.origins).toBe(true);
  });
});

// ── Auth 配置 ────────────────────────────────────────

describe("auth configuration", () => {
  it("defaults to auth mode off", () => {
    const config = loadConfig();
    expect(config.auth).toEqual({ mode: "off" });
  });

  it("parses api_key auth mode", () => {
    vi.stubEnv("AUTH_MODE", "api_key");
    vi.stubEnv("AUTH_API_KEYS", "key1,key2,key1"); // key1 重复，应去重

    const config = loadConfig();
    expect(config.auth.mode).toBe("api_key");
    if (config.auth.mode === "api_key") {
      expect(config.auth.apiKeys).toEqual(["key1", "key2"]);
    }
  });

  it("throws when api_key mode has no keys", () => {
    vi.stubEnv("AUTH_MODE", "api_key");
    vi.stubEnv("AUTH_API_KEYS", "");

    expect(() => loadConfig()).toThrow("AUTH_MODE=api_key requires AUTH_API_KEYS");
  });

  it("parses jwt auth mode", () => {
    vi.stubEnv("AUTH_MODE", "jwt");
    vi.stubEnv("AUTH_JWT_SECRET", "my-secret");
    vi.stubEnv("AUTH_JWT_ACCOUNT_CLAIM", "sub");

    const config = loadConfig();
    expect(config.auth.mode).toBe("jwt");
    if (config.auth.mode === "jwt") {
      expect(config.auth.jwtSecret).toBe("my-secret");
      expect(config.auth.jwtAccountClaim).toBe("sub");
    }
  });

  it("throws when jwt mode has no secret", () => {
    vi.stubEnv("AUTH_MODE", "jwt");

    expect(() => loadConfig()).toThrow("AUTH_MODE=jwt requires AUTH_JWT_SECRET");
  });

  it("throws for unsupported AUTH_MODE", () => {
    vi.stubEnv("AUTH_MODE", "oauth2");

    expect(() => loadConfig()).toThrow("Unsupported AUTH_MODE: oauth2");
  });

  it("throws when NODE_ENV=production and auth mode is off", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_MODE", "off");

    expect(() => loadConfig()).toThrow("AUTH_MODE=off is not allowed when NODE_ENV=production");
  });
});

// ── Account mode ─────────────────────────────────────

describe("account mode", () => {
  it("defaults to single", () => {
    const config = loadConfig();
    expect(config.accountMode).toBe("single");
  });

  it("parses multi", () => {
    vi.stubEnv("ACCOUNT_MODE", "multi");
    vi.stubEnv("AUTH_MODE", "jwt");
    vi.stubEnv("AUTH_JWT_SECRET", "secret");

    const config = loadConfig();
    expect(config.accountMode).toBe("multi");
  });

  it("throws for unsupported ACCOUNT_MODE", () => {
    vi.stubEnv("ACCOUNT_MODE", "team");
    expect(() => loadConfig()).toThrow("Unsupported ACCOUNT_MODE: team");
  });

  it("throws when multi + auth off", () => {
    vi.stubEnv("ACCOUNT_MODE", "multi");
    // AUTH_MODE 默认 off
    expect(() => loadConfig()).toThrow("ACCOUNT_MODE=multi requires AUTH_MODE");
  });

  it("throws when multi + api_key without account map", () => {
    vi.stubEnv("ACCOUNT_MODE", "multi");
    vi.stubEnv("AUTH_MODE", "api_key");
    vi.stubEnv("AUTH_API_KEYS", "key1");
    // 没设置 AUTH_API_KEY_ACCOUNTS

    expect(() => loadConfig()).toThrow("AUTH_API_KEY_ACCOUNTS mapping");
  });
});

// ── API Key Account Map ───────────────────────────────

describe("API key account map", () => {
  it("parses key:account pairs", () => {
    vi.stubEnv("AUTH_MODE", "api_key");
    vi.stubEnv("AUTH_API_KEYS", "key1,key2");
    vi.stubEnv("AUTH_API_KEY_ACCOUNTS", "key1:account-a,key2:account-b");

    const config = loadConfig();
    if (config.auth.mode === "api_key") {
      expect(config.auth.apiKeyAccountMap).toEqual({
        key1: "account-a",
        key2: "account-b",
      });
    }
  });

  it("throws for invalid pair format", () => {
    vi.stubEnv("AUTH_MODE", "api_key");
    vi.stubEnv("AUTH_API_KEYS", "key1");
    vi.stubEnv("AUTH_API_KEY_ACCOUNTS", "invalid-pair");

    expect(() => loadConfig()).toThrow("Invalid AUTH_API_KEY_ACCOUNTS pair");
  });
});

// ── Memory injection decay ────────────────────────────

describe("memory injection decay", () => {
  it("returns undefined when half life is not set", () => {
    const config = loadConfig();
    expect(config.memoryInjectionDecay).toBeUndefined();
  });

  it("parses decay config with all parameters", () => {
    vi.stubEnv("MEMORY_INJECTION_DECAY_HALF_LIFE_DAYS", "7");
    vi.stubEnv("MEMORY_INJECTION_DECAY_MIN_FACTOR", "0.1");
    vi.stubEnv("MEMORY_INJECTION_DECAY_BY", "createdAt");

    const config = loadConfig();
    expect(config.memoryInjectionDecay).toBeDefined();
    expect(config.memoryInjectionDecay!.halfLifeMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(config.memoryInjectionDecay!.minFactor).toBe(0.1);
    expect(config.memoryInjectionDecay!.by).toBe("createdAt");
  });

  it("ignores invalid decay by value", () => {
    vi.stubEnv("MEMORY_INJECTION_DECAY_HALF_LIFE_DAYS", "7");
    vi.stubEnv("MEMORY_INJECTION_DECAY_BY", "invalid");

    const config = loadConfig();
    expect(config.memoryInjectionDecay).toBeDefined();
    expect(config.memoryInjectionDecay!.by).toBeUndefined();
  });
});

// ── Memory maintenance ────────────────────────────────

describe("memory maintenance", () => {
  it("returns undefined when not enabled", () => {
    const config = loadConfig();
    expect(config.memoryMaintenance).toBeUndefined();
  });

  it("parses maintenance config with defaults", () => {
    vi.stubEnv("ENABLE_MEMORY_MAINTENANCE", "true");

    const config = loadConfig();
    expect(config.memoryMaintenance).toBeDefined();
    expect(config.memoryMaintenance!.intervalMs).toBe(60 * 60 * 1000); // 60 min
    expect(config.memoryMaintenance!.batchSize).toBe(500);
    expect(config.memoryMaintenance!.dryRun).toBe(false);
  });

  it("parses custom maintenance config", () => {
    vi.stubEnv("ENABLE_MEMORY_MAINTENANCE", "true");
    vi.stubEnv("MEMORY_MAINTENANCE_INTERVAL_MINUTES", "30");
    vi.stubEnv("MEMORY_MAINTENANCE_BATCH_SIZE", "100");
    vi.stubEnv("MEMORY_MAINTENANCE_DEPRECATE_SUMMARY_DAYS", "0"); // 禁用
    vi.stubEnv("MEMORY_MAINTENANCE_DEPRECATE_OPEN_LOOP_DAYS", "14");
    vi.stubEnv("MEMORY_MAINTENANCE_PURGE_DEPRECATED_DAYS", "180");
    vi.stubEnv("MEMORY_MAINTENANCE_DRY_RUN", "true");

    const config = loadConfig();
    const m = config.memoryMaintenance!;
    expect(m.intervalMs).toBe(30 * 60 * 1000);
    expect(m.batchSize).toBe(100);
    expect(m.dryRun).toBe(true);
    // summaryMaxAgeMs 应不存在（因为 days=0）
    expect(m.policy).not.toHaveProperty("summaryMaxAgeMs");
    // openLoopMaxAgeMs = 14 * dayMs
    const dayMs = 24 * 60 * 60 * 1000;
    expect(m.policy!.openLoopMaxAgeMs).toBe(14 * dayMs);
    expect(m.policy!.deprecatedPurgeAgeMs).toBe(180 * dayMs);
  });
});
