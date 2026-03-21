import process from "node:process";
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, writeFile } from "node:fs/promises";

import type { ProviderType } from "@tavern/core";

import { buildApp } from "../src/app.js";
import type { OrchestrationConfig } from "../src/services/orchestration-factory.js";

type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type ReasoningEffort = "low" | "medium" | "high";

const REGRESSION_REASONING_EFFORT: ReasoningEffort = "low";

type CliOptions = {
  provider: ProviderType;
  modelId: string;
  apiKey: string;
  baseUrl?: string;
  masterKey: string;
  operator: string;
  databasePath: string;
  outputPath: string;
  keepDatabase: boolean;
  skipCleanup: boolean;
  port: number;
};

type ApiResponse<T> = {
  status: number;
  body: T | null;
  rawText: string;
};

type StepRecord = {
  name: string;
  method: ApiMethod;
  path: string;
  required: boolean;
  status: "passed" | "failed";
  http_status?: number;
  duration_ms?: number;
  details?: Record<string, unknown>;
  error?: {
    message: string;
    response_body?: unknown;
  };
};

type StepResult<T> = {
  value: T;
  httpStatus?: number;
  details?: Record<string, unknown>;
};

type RegressionReport = {
  executed_at: string;
  operator: string;
  provider: string;
  base_url: string | null;
  model_id: string;
  api_base_url: string | null;
  database_path: string;
  llm_profile_activation_exercised: boolean;
  output_path: string;
  notes: string[];
  steps: StepRecord[];
  summary: {
    passed: number;
    failed: number;
    first_failing_endpoint: string | null;
    cleanup_attempted: boolean;
    total_duration_ms: number;
    cleanup_succeeded: boolean | null;
  };
};

type RuntimeResponse = {
  data?: {
    session_id?: string | null;
    slots?: Array<{
      slot?: string;
      source?: string;
      profile_id?: string | null;
      provider?: string;
      model_id?: string;
      params?: {
        reasoning_effort?: ReasoningEffort;
      };
    }>;
  };
};

type JsonObject = Record<string, unknown>;

type RequestOptions = {
  expectedStatuses?: number[];
};

class ApiRequestError extends Error {
  readonly method: ApiMethod;
  readonly path: string;
  readonly status: number;
  readonly responseBody: unknown;

  constructor(method: ApiMethod, path: string, status: number, responseBody: unknown, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.method = method;
    this.path = path;
    this.status = status;
    this.responseBody = responseBody;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, "../../../.env"), quiet: true });

function toDurationMs(startedAt: bigint): number {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function formatDurationMs(durationMs: number): string {
  return `${durationMs.toFixed(2)}ms`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const steps: StepRecord[] = [];
  const notes = [
    "This script starts a local apps/api instance with AUTH_MODE=off, ACCOUNT_MODE=single, ENABLE_SSE_CHAT=true, and ENABLE_PROMPT_DRY_RUN=true.",
    "The generated report never stores api_key or APP_SECRETS_MASTER_KEY values.",
    "A real provider key is required. Placeholder-like LLM_API_KEY or APP_SECRETS_MASTER_KEY values are rejected before any network call is attempted.",
    `The regression explicitly uses reasoning_effort=${REGRESSION_REASONING_EFFORT} for the Hello probe and LLM Profile activation path when supported.`,
    "Each regression step records duration_ms to make slow segments easier to inspect.",
  ];

  let app: Awaited<ReturnType<typeof buildApp>>["app"] | undefined;
  let apiBaseUrl: string | null = null;
  let sessionId: string | undefined;
  let profileId: string | undefined;
  let cleanupAttempted = false;
  let cleanupSucceeded: boolean | null = null;
  let topLevelFailure: unknown;

  const originalEnv = snapshotEnv([
    "AUTH_MODE",
    "ACCOUNT_MODE",
    "ENABLE_SSE_CHAT",
    "ENABLE_PROMPT_DRY_RUN",
    "LLM_PROVIDER",
    "LLM_MODEL",
    "LLM_API_KEY",
    "LLM_BASE_URL",
    "APP_SECRETS_MASTER_KEY",
    "DATABASE_URL",
  ]);

  try {
    await mkdir(dirname(options.databasePath), { recursive: true });
    await mkdir(dirname(options.outputPath), { recursive: true });

    applyRuntimeEnv(options);

    const orchestration = buildOrchestrationConfig(options);
    const built = await buildApp({
      databasePath: options.databasePath,
      logger: false,
      orchestration,
      enableSseChat: true,
      enablePromptDryRun: true,
      auth: { mode: "off" },
      accountMode: "single",
      cors: { origins: true, credentials: false },
    });
    app = built.app;

    apiBaseUrl = normalizeBaseUrl(await app.listen({ host: "127.0.0.1", port: options.port }));
    const api = createApiClient(apiBaseUrl);

    let stepIndex = 0;
    const runStep = async <T>(
      name: string,
      method: ApiMethod,
      path: string,
      fn: () => Promise<StepResult<T>>,
    ): Promise<T> => {
      stepIndex += 1;
      process.stdout.write(`[${String(stepIndex).padStart(2, "0")}] ${name} ... `);
      const startedAt = process.hrtime.bigint();
      try {
        const result = await fn();
        const durationMs = toDurationMs(startedAt);
        steps.push({
          name,
          method,
          path,
          required: true,
          status: "passed",
          http_status: result.httpStatus,
          duration_ms: durationMs,
          details: result.details,
        });
        console.log(`PASS (${formatDurationMs(durationMs)})`);
        return result.value;
      } catch (error) {
        const durationMs = toDurationMs(startedAt);
        steps.push({
          name,
          method,
          path,
          required: true,
          status: "failed",
          ...(error instanceof ApiRequestError ? { http_status: error.status } : {}),
          duration_ms: durationMs,
          error: toRecordedError(error),
        });
        console.log(`FAIL (${formatDurationMs(durationMs)})`);
        throw error;
      }
    };

    const recordCleanupStep = async (
      name: string,
      method: ApiMethod,
      path: string,
      fn: () => Promise<StepResult<unknown>>,
    ): Promise<boolean> => {
      stepIndex += 1;
      process.stdout.write(`[${String(stepIndex).padStart(2, "0")}] ${name} ... `);
      const startedAt = process.hrtime.bigint();
      try {
        const result = await fn();
        const durationMs = toDurationMs(startedAt);
        steps.push({
          name,
          method,
          path,
          required: false,
          status: "passed",
          http_status: result.httpStatus,
          duration_ms: durationMs,
          details: result.details,
        });
        console.log(`PASS (${formatDurationMs(durationMs)})`);
        return true;
      } catch (error) {
        const durationMs = toDurationMs(startedAt);
        steps.push({
          name,
          method,
          path,
          required: false,
          status: "failed",
          ...(error instanceof ApiRequestError ? { http_status: error.status } : {}),
          duration_ms: durationMs,
          error: toRecordedError(error),
        });
        console.log(`FAIL (${formatDurationMs(durationMs)})`);
        return false;
      }
    };

    await runStep("GET /health", "GET", "/health", async () => {
      const response = await api.request<JsonObject>("GET", "/health", undefined, { expectedStatuses: [200] });
      const body = response.body as { ok?: boolean; service?: string; database?: string } | null;
      assert(body?.ok === true, `Unexpected health payload: ${JSON.stringify(body)}`);
      assert(body?.service === "@tavern/api", `Unexpected service name: ${JSON.stringify(body)}`);
      assert(body?.database === "ready", `Unexpected database state: ${JSON.stringify(body)}`);
      return {
        value: body,
        httpStatus: response.status,
        details: {
          service: body?.service ?? null,
          database: body?.database ?? null,
        },
      };
    });

    await runStep("POST /llm-profiles/models/discover", "POST", "/llm-profiles/models/discover", async () => {
      const response = await api.request<{ data?: Array<{ id?: string; label?: string }> }>(
        "POST",
        "/llm-profiles/models/discover",
        buildProviderRequestBody(options),
        { expectedStatuses: [200] },
      );
      const models = response.body?.data ?? [];
      const modelIds = models.map((item) => item.id).filter((value): value is string => typeof value === "string");
      assert(modelIds.includes(options.modelId), `Model '${options.modelId}' not found in discovery response`);
      return {
        value: models,
        httpStatus: response.status,
        details: {
          matched_model: options.modelId,
          model_count: modelIds.length,
          first_models: modelIds.slice(0, 5),
        },
      };
    });

    await runStep("POST /llm-profiles/models/test", "POST", "/llm-profiles/models/test", async () => {
      const response = await api.request<{ data?: { request_text?: string; response_text?: string } }>(
        "POST",
        "/llm-profiles/models/test",
        {
          ...buildProviderRequestBody(options),
          model_id: options.modelId,
          reasoning_effort: REGRESSION_REASONING_EFFORT,
        },
        { expectedStatuses: [200] },
      );
      const data = response.body?.data;
      assert(data?.request_text === "Hello", `Unexpected request_text: ${JSON.stringify(data)}`);
      assert(Boolean(data?.response_text?.trim()), `Empty response_text: ${JSON.stringify(data)}`);
      return {
        value: data,
        httpStatus: response.status,
        details: {
          request_text: data?.request_text ?? null,
          response_text_excerpt: truncate(data?.response_text ?? "", 160),
        },
      };
    });

    profileId = await runStep("POST /llm-profiles", "POST", "/llm-profiles", async () => {
      const response = await api.request<{ data?: { id?: string; provider?: string; model_id?: string } }>(
        "POST",
        "/llm-profiles",
        {
          preset_name: "Real Provider Smoke",
          provider: options.provider,
          model_id: options.modelId,
          api_key_name: "REAL_PROVIDER_KEY",
          api_key: options.apiKey,
          ...(options.baseUrl ? { base_url: options.baseUrl } : {}),
        },
        { expectedStatuses: [201] },
      );
      const createdProfileId = must(response.body?.data?.id, "Missing profile id from create profile response");
      return {
        value: createdProfileId,
        httpStatus: response.status,
        details: {
          profile_id: createdProfileId,
          provider: response.body?.data?.provider ?? null,
          model_id: response.body?.data?.model_id ?? null,
        },
      };
    });

    sessionId = await runStep("POST /sessions", "POST", "/sessions", async () => {
      const response = await api.request<{ data?: { id?: string } }>(
        "POST",
        "/sessions",
        {
          title: "real-provider-regression",
          prompt_mode: "native",
        },
        { expectedStatuses: [201] },
      );
      const createdSessionId = must(response.body?.data?.id, "Missing session id from create session response");
      return {
        value: createdSessionId,
        httpStatus: response.status,
        details: {
          session_id: createdSessionId,
        },
      };
    });

    await runStep("POST /llm-profiles/:id/activate", "POST", `/llm-profiles/${profileId}/activate`, async () => {
      const response = await api.request<{ data?: { activated?: boolean; scope?: string; instance_slot?: string } }>(
        "POST",
        `/llm-profiles/${profileId}/activate`,
        {
          scope: "session",
          session_id: sessionId,
          params: {
            reasoning_effort: REGRESSION_REASONING_EFFORT,
          },
          instance_slot: "*",
        },
        { expectedStatuses: [200] },
      );
      assert(response.body?.data?.activated === true, `Activation did not succeed: ${JSON.stringify(response.body)}`);
      return {
        value: response.body,
        httpStatus: response.status,
        details: {
          activated: response.body?.data?.activated ?? false,
          scope: response.body?.data?.scope ?? null,
          instance_slot: response.body?.data?.instance_slot ?? null,
        },
      };
    });

    const runtimeSessionId = must(sessionId, "Missing session id before runtime inspection");
    await runStep("GET /llm-profiles/runtime", "GET", `/llm-profiles/runtime?session_id=${encodeURIComponent(runtimeSessionId)}`, async () => {
      const response = await api.request<RuntimeResponse>(
        "GET",
        `/llm-profiles/runtime?session_id=${encodeURIComponent(runtimeSessionId)}`,
        undefined,
        { expectedStatuses: [200] },
      );
      const slots = response.body?.data?.slots ?? [];
      const matchedSlots = slots
        .filter((slot) => slot.profile_id === profileId)
        .map((slot) => slot.slot)
        .filter((value): value is string => typeof value === "string");
      const matchedReasoningEfforts = slots
        .filter((slot) => slot.profile_id === profileId)
        .map((slot) => slot.params?.reasoning_effort)
        .filter((value): value is ReasoningEffort => typeof value === "string");
      assert(matchedSlots.length > 0, `Activated profile '${profileId}' not found in runtime slots`);
      assert(matchedReasoningEfforts.includes(REGRESSION_REASONING_EFFORT), `Activated profile reasoning_effort '${REGRESSION_REASONING_EFFORT}' not found in runtime slots`);
      return {
        value: response.body,
        httpStatus: response.status,
        details: {
          matched_slots: matchedSlots,
          reasoning_effort: matchedReasoningEfforts[0] ?? null,
          slot_count: slots.length,
        },
      };
    });

    await runStep("POST /sessions/:id/respond/dry-run", "POST", `/sessions/${sessionId}/respond/dry-run`, async () => {
      const response = await api.request<{
        data?: {
          messages?: unknown[];
          token_estimate?: number;
          available_for_reply?: number;
          assembly?: Record<string, unknown>;
        };
      }>(
        "POST",
        `/sessions/${sessionId}/respond/dry-run`,
        { message: "Please introduce yourself in one short paragraph." },
        { expectedStatuses: [200] },
      );
      const data = response.body?.data;
      assert(Array.isArray(data?.messages), `Dry-run messages[] missing: ${JSON.stringify(data)}`);
      assert(typeof data?.token_estimate === "number", `Dry-run token_estimate missing: ${JSON.stringify(data)}`);
      assert(
        typeof data?.available_for_reply === "number",
        `Dry-run available_for_reply missing: ${JSON.stringify(data)}`,
      );
      return {
        value: data,
        httpStatus: response.status,
        details: {
          message_count: Array.isArray(data?.messages) ? data.messages.length : 0,
          token_estimate: data?.token_estimate ?? null,
          available_for_reply: data?.available_for_reply ?? null,
          assembly_mode: typeof data?.assembly?.mode === "string" ? data.assembly.mode : null,
        },
      };
    });

    await runStep("POST /sessions/:id/respond", "POST", `/sessions/${sessionId}/respond`, async () => {
      const response = await api.request<{
        data?: {
          floor_id?: string;
          floor_no?: number;
          generated_text?: string;
          final_state?: string;
        };
      }>(
        "POST",
        `/sessions/${sessionId}/respond`,
        { message: "Please introduce yourself in one short paragraph." },
        { expectedStatuses: [200] },
      );
      const data = response.body?.data;
      assert(Boolean(data?.generated_text?.trim()), `Respond generated_text is empty: ${JSON.stringify(data)}`);
      assert(Boolean(data?.floor_id), `Respond floor_id is missing: ${JSON.stringify(data)}`);
      assert(data?.final_state === "committed", `Respond final_state is not committed: ${JSON.stringify(data)}`);
      return {
        value: data,
        httpStatus: response.status,
        details: {
          floor_id: data?.floor_id ?? null,
          floor_no: data?.floor_no ?? null,
          final_state: data?.final_state ?? null,
          generated_text_excerpt: truncate(data?.generated_text ?? "", 160),
        },
      };
    });

    await runStep("POST /sessions/:id/respond/stream", "POST", `/sessions/${sessionId}/respond/stream`, async () => {
      const response = await api.request<JsonObject>(
        "POST",
        `/sessions/${sessionId}/respond/stream`,
        { message: "Please introduce yourself in one short paragraph." },
        { expectedStatuses: [200] },
      );
      const streamBody = response.rawText;
      assert(streamBody.includes("event: start"), "SSE stream does not contain event: start");
      assert(streamBody.includes("event: done"), "SSE stream does not contain event: done");
      return {
        value: streamBody,
        httpStatus: response.status,
        details: {
          has_start: true,
          has_done: true,
          body_excerpt: truncate(streamBody.replace(/\s+/g, " ").trim(), 220),
        },
      };
    });

    await runStep("POST /sessions/:id/regenerate", "POST", `/sessions/${sessionId}/regenerate`, async () => {
      const response = await api.request<{
        data?: {
          floor_id?: string;
          previous_floor_id?: string;
          generated_text?: string;
          final_state?: string;
        };
      }>(
        "POST",
        `/sessions/${sessionId}/regenerate`,
        {},
        { expectedStatuses: [200] },
      );
      const data = response.body?.data;
      assert(Boolean(data?.floor_id), `Regenerate floor_id is missing: ${JSON.stringify(data)}`);
      assert(Boolean(data?.previous_floor_id), `Regenerate previous_floor_id is missing: ${JSON.stringify(data)}`);
      assert(Boolean(data?.generated_text?.trim()), `Regenerate generated_text is empty: ${JSON.stringify(data)}`);
      return {
        value: data,
        httpStatus: response.status,
        details: {
          floor_id: data?.floor_id ?? null,
          previous_floor_id: data?.previous_floor_id ?? null,
          final_state: data?.final_state ?? null,
          generated_text_excerpt: truncate(data?.generated_text ?? "", 160),
        },
      };
    });

    if (!options.skipCleanup) {
      cleanupAttempted = true;
      cleanupSucceeded = true;

      if (sessionId) {
        const deletedSession = await recordCleanupStep(
          "DELETE /sessions/:id",
          "DELETE",
          `/sessions/${sessionId}`,
          async () => {
            const response = await api.request<{ data?: { deleted?: boolean; id?: string } }>(
              "DELETE",
              `/sessions/${sessionId}`,
              undefined,
              { expectedStatuses: [200] },
            );
            return {
              value: response.body,
              httpStatus: response.status,
              details: {
                id: response.body?.data?.id ?? sessionId,
                deleted: response.body?.data?.deleted ?? true,
              },
            };
          },
        );
        cleanupSucceeded = cleanupSucceeded && deletedSession;
      }

      if (profileId) {
        const deletedProfile = await recordCleanupStep(
          "DELETE /llm-profiles/:id",
          "DELETE",
          `/llm-profiles/${profileId}`,
          async () => {
            const response = await api.request<{ data?: { deleted?: boolean; id?: string } }>(
              "DELETE",
              `/llm-profiles/${profileId}`,
              undefined,
              { expectedStatuses: [200] },
            );
            return {
              value: response.body,
              httpStatus: response.status,
              details: {
                id: response.body?.data?.id ?? profileId,
                deleted: response.body?.data?.deleted ?? true,
              },
            };
          },
        );
        cleanupSucceeded = cleanupSucceeded && deletedProfile;
      }
    }
  } catch (error) {
    topLevelFailure = error;
  } finally {
    if (app) {
      try {
        await app.close();
      } catch {
        // Ignore close errors in cleanup path.
      }
    }

    restoreEnv(originalEnv);

    if (!options.keepDatabase) {
      try {
        await rm(options.databasePath, { force: true });
      } catch {
        // Ignore database cleanup errors.
      }
    }

    const report = buildReport({
      options,
      apiBaseUrl,
      steps,
      notes,
      cleanupAttempted,
      cleanupSucceeded,
    });
    await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`\nReport written to ${options.outputPath}`);
  }

  if (topLevelFailure) {
    console.error("\nReal-provider regression failed.");
    console.error(toErrorMessage(topLevelFailure));
    process.exit(1);
  }

  console.log("\nReal-provider regression completed successfully.");
}

function parseArgs(args: string[]): CliOptions {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const parsed: Partial<CliOptions> = {
    provider: process.env.LLM_PROVIDER as ProviderType | undefined,
    modelId: process.env.LLM_MODEL,
    apiKey: process.env.LLM_API_KEY,
    baseUrl: process.env.LLM_BASE_URL || undefined,
    masterKey: process.env.APP_SECRETS_MASTER_KEY,
    operator: process.env.REAL_PROVIDER_OPERATOR ?? process.env.USERNAME ?? process.env.USER ?? "unknown",
    databasePath: resolve(__dirname, `../../../.tmp/real-provider-regression-${runId}.sqlite`),
    outputPath: resolve(__dirname, `../../../.tmp/real-provider-regression-${runId}.json`),
    keepDatabase: false,
    skipCleanup: false,
    port: 0,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=");
    const nextValue = inlineValue ?? args[i + 1];
    const consumeNext = inlineValue === undefined;

    switch (key) {
      case "provider": {
        if (!nextValue) {
          throw new Error("Missing value for --provider");
        }
        parsed.provider = nextValue as ProviderType;
        break;
      }
      case "model": {
        if (!nextValue) {
          throw new Error("Missing value for --model");
        }
        parsed.modelId = nextValue;
        break;
      }
      case "api-key": {
        if (!nextValue) {
          throw new Error("Missing value for --api-key");
        }
        parsed.apiKey = nextValue;
        break;
      }
      case "base-url": {
        if (!nextValue) {
          throw new Error("Missing value for --base-url");
        }
        parsed.baseUrl = nextValue;
        break;
      }
      case "master-key": {
        if (!nextValue) {
          throw new Error("Missing value for --master-key");
        }
        parsed.masterKey = nextValue;
        break;
      }
      case "operator": {
        if (!nextValue) {
          throw new Error("Missing value for --operator");
        }
        parsed.operator = nextValue;
        break;
      }
      case "database":
      case "db": {
        if (!nextValue) {
          throw new Error(`Missing value for --${key}`);
        }
        parsed.databasePath = resolve(process.cwd(), nextValue);
        break;
      }
      case "output": {
        if (!nextValue) {
          throw new Error("Missing value for --output");
        }
        parsed.outputPath = resolve(process.cwd(), nextValue);
        break;
      }
      case "port": {
        if (!nextValue) {
          throw new Error("Missing value for --port");
        }
        const port = Number(nextValue);
        if (!Number.isInteger(port) || port < 0) {
          throw new Error(`Invalid --port value: ${nextValue}`);
        }
        parsed.port = port;
        break;
      }
      case "keep-db": {
        parsed.keepDatabase = true;
        break;
      }
      case "skip-cleanup": {
        parsed.skipCleanup = true;
        break;
      }
      case "help": {
        printUsage();
        process.exit(0);
        break;
      }
      default:
        throw new Error(`Unknown option: --${key}`);
    }

    if (consumeNext && key !== "keep-db" && key !== "skip-cleanup") {
      i += 1;
    }
  }

  const provider = requireNonEmpty(parsed.provider, "provider", "Use --provider or set LLM_PROVIDER.") as ProviderType;
  const modelId = requireNonEmpty(parsed.modelId, "model", "Use --model or set LLM_MODEL.");
  const apiKey = requireNonEmpty(parsed.apiKey, "api-key", "Use --api-key or set LLM_API_KEY.");
  const masterKey = requireNonEmpty(
    parsed.masterKey,
    "master-key",
    "Use --master-key or set APP_SECRETS_MASTER_KEY.",
  );
  const operator = requireNonEmpty(parsed.operator, "operator", "Use --operator to record who ran the regression.");

  if (looksPlaceholderValue(apiKey)) {
    throw new Error(
      "LLM_API_KEY still looks like a placeholder. Provide a real provider key before running the regression.",
    );
  }

  if (looksPlaceholderValue(masterKey)) {
    throw new Error(
      "APP_SECRETS_MASTER_KEY looks like a placeholder. Provide a real master key before running the regression.",
    );
  }

  return {
    provider,
    modelId,
    apiKey,
    baseUrl: parsed.baseUrl,
    masterKey,
    operator,
    databasePath: requireNonEmpty(parsed.databasePath, "database", "Missing database path."),
    outputPath: requireNonEmpty(parsed.outputPath, "output", "Missing output path."),
    keepDatabase: parsed.keepDatabase === true,
    skipCleanup: parsed.skipCleanup === true,
    port: parsed.port ?? 0,
  };
}

function printUsage(): void {
  console.log("Usage: pnpm --filter @tavern/api real-provider:regression -- [options]");
  console.log("");
  console.log("Options:");
  console.log("  --provider <name>     Provider name (default: LLM_PROVIDER from .env)");
  console.log("  --model <id>          Model id (default: LLM_MODEL from .env)");
  console.log("  --api-key <value>     Real provider API key (default: LLM_API_KEY from .env)");
  console.log("  --base-url <url>      Optional provider base URL (default: LLM_BASE_URL from .env)");
  console.log("  --master-key <value>  APP_SECRETS_MASTER_KEY override");
  console.log("  --operator <name>     Operator name written into the report");
  console.log("  --db, --database      SQLite database path for the temporary local run");
  console.log("  --output <path>       JSON report output path");
  console.log("  --port <n>            Local API port (default: 0 for random free port)");
  console.log("  --keep-db             Keep the temporary database file after the run");
  console.log("  --skip-cleanup        Skip DELETE /sessions/:id and DELETE /llm-profiles/:id");
  console.log("  --help                Show this help message");
}

function buildProviderRequestBody(options: CliOptions) {
  return {
    provider: options.provider,
    api_key: options.apiKey,
    ...(options.baseUrl ? { base_url: options.baseUrl } : {}),
  };
}

function buildOrchestrationConfig(options: CliOptions): OrchestrationConfig {
  const providerId = `default-${options.provider}`;
  return {
    providers: [
      {
        id: providerId,
        type: options.provider,
        apiKey: options.apiKey,
        ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
      },
    ],
    defaultModel: {
      providerId,
      modelId: options.modelId,
    },
  };
}

function applyRuntimeEnv(options: CliOptions): void {
  process.env.AUTH_MODE = "off";
  process.env.ACCOUNT_MODE = "single";
  process.env.ENABLE_SSE_CHAT = "true";
  process.env.ENABLE_PROMPT_DRY_RUN = "true";
  process.env.LLM_PROVIDER = options.provider;
  process.env.LLM_MODEL = options.modelId;
  process.env.LLM_API_KEY = options.apiKey;
  process.env.APP_SECRETS_MASTER_KEY = options.masterKey;
  process.env.DATABASE_URL = options.databasePath;

  if (options.baseUrl) {
    process.env.LLM_BASE_URL = options.baseUrl;
  } else {
    delete process.env.LLM_BASE_URL;
  }
}

function createApiClient(baseUrl: string) {
  const normalizedBase = baseUrl.replace(/\/$/, "");

  async function request<T>(
    method: ApiMethod,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const expectedStatuses = options.expectedStatuses ?? [200];
    const response = await fetch(`${normalizedBase}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const rawText = await response.text();
    const parsedBody = rawText.length === 0 ? null : safeParseJson(rawText);

    if (!expectedStatuses.includes(response.status)) {
      throw new ApiRequestError(
        method,
        path,
        response.status,
        parsedBody,
        `${method} ${path} expected [${expectedStatuses.join(", ")}], got ${response.status}. Response: ${truncate(rawText, 400)}`,
      );
    }

    return {
      status: response.status,
      body: parsedBody as T | null,
      rawText,
    };
  }

  return { request };
}

function buildReport(input: {
  options: CliOptions;
  apiBaseUrl: string | null;
  steps: StepRecord[];
  notes: string[];
  cleanupAttempted: boolean;
  cleanupSucceeded: boolean | null;
}): RegressionReport {
  const requiredSteps = input.steps.filter((step) => step.required);
  const failedStep = requiredSteps.find((step) => step.status === "failed");

  return {
    executed_at: new Date().toISOString(),
    operator: input.options.operator,
    provider: input.options.provider,
    base_url: input.options.baseUrl ?? null,
    model_id: input.options.modelId,
    api_base_url: input.apiBaseUrl,
    database_path: input.options.databasePath,
    llm_profile_activation_exercised: input.steps.some((step) => step.path.includes("/llm-profiles/") && step.path.endsWith("/activate")),
    output_path: input.options.outputPath,
    notes: input.notes,
    steps: input.steps,
    summary: {
      passed: requiredSteps.filter((step) => step.status === "passed").length,
      failed: requiredSteps.filter((step) => step.status === "failed").length,
      first_failing_endpoint: failedStep ? `${failedStep.method} ${failedStep.path}` : null,
      cleanup_attempted: input.cleanupAttempted,
      total_duration_ms: Number(input.steps.reduce((total, step) => total + (step.duration_ms ?? 0), 0).toFixed(2)),
      cleanup_succeeded: input.cleanupSucceeded,
    },
  };
}

function normalizeBaseUrl(listenAddress: string): string {
  if (listenAddress.startsWith("http://") || listenAddress.startsWith("https://")) {
    return listenAddress.replace(/\/$/, "");
  }
  if (listenAddress.startsWith("127.0.0.1") || listenAddress.startsWith("localhost")) {
    return `http://${listenAddress.replace(/\/$/, "")}`;
  }
  return `http://${listenAddress.replace(/\/$/, "")}`;
}

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function requireNonEmpty(value: string | undefined, field: string, hint: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing ${field}. ${hint}`);
  }
  return value.trim();
}

function looksPlaceholderValue(value: string): boolean {
  const lower = value.trim().toLowerCase();
  const patterns = [
    /^sk-xxx$/,
    /^sk-test(?:-|$)/,
    /^replace-with-strong-secret$/,
    /^replace-me$/,
    /^changeme$/,
    /^dummy(?:-|$)/,
    /^example(?:-|$)/,
    /^test-key(?:-|$)/,
    /^your-/,
  ];
  return patterns.some((pattern) => pattern.test(lower));
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function must<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

function toRecordedError(error: unknown): { message: string; response_body?: unknown } {
  if (error instanceof ApiRequestError) {
    return {
      message: error.message,
      response_body: error.responseBody,
    };
  }

  return {
    message: toErrorMessage(error),
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

main().catch((error) => {
  console.error("\nReal-provider regression failed.");
  console.error(toErrorMessage(error));
  process.exit(1);
});
