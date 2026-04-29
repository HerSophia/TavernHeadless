import process from "node:process";

// ── Types ────────────────────────────────────────────

export type SmokeOptions = {
  baseUrl: string;
  keepData: boolean;
  skipImports: boolean;
  verbose: boolean;
  logMaxChars: number;
};

export type JsonObject = Record<string, unknown>;

const DEFAULT_LOG_MAX_CHARS = 12_000;
const MAX_LOG_MAX_CHARS = 1_000_000;

export type ApiResponse<T> = {
  status: number;
  body: T | null;
};

export type SmokeContext = {
  api: ReturnType<typeof createApiClient>;
  options: SmokeOptions;
  runId: string;
  runStep: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  track: (resource: string, id: string) => void;
  addCleanup: (task: () => Promise<void>) => void;
  shared: Record<string, string>;
  cleanupTasks: Array<() => Promise<void>>;
  keptResourceIds: Record<string, string[]>;
};

// ── Context Factory ──────────────────────────────────

export function createSmokeContext(options: SmokeOptions): SmokeContext {
  const runId = `smoke-${Date.now().toString(36)}`;
  const api = createApiClient(options.baseUrl, { verbose: options.verbose, logMaxChars: options.logMaxChars, smokeRunId: runId });
  const cleanupTasks: Array<() => Promise<void>> = [];
  const keptResourceIds: Record<string, string[]> = {};
  const shared: Record<string, string> = {};
  let step = 0;

  async function runStep<T>(name: string, fn: () => Promise<T>): Promise<T> {
    step += 1;
    const label = `[${String(step).padStart(2, "0")}] ${name}`;
    const startedAt = Date.now();

    if (options.verbose) {
      console.log(`${label} ...`);
    } else {
      process.stdout.write(`${label} ... `);
    }

    try {
      const result = await fn();
      console.log(options.verbose ? `  PASS (${Date.now() - startedAt}ms)` : "PASS");
      return result;
    } catch (error) {
      console.log(options.verbose ? `  FAIL (${Date.now() - startedAt}ms)` : "FAIL");
      throw error;
    }
  }

  function track(resource: string, id: string): void {
    if (!keptResourceIds[resource]) keptResourceIds[resource] = [];
    keptResourceIds[resource].push(id);
  }

  function addCleanup(task: () => Promise<void>): void {
    cleanupTasks.unshift(task);
  }

  return { api, options, runId, runStep, track, addCleanup, shared, cleanupTasks, keptResourceIds };
}

// ── API Client ───────────────────────────────────────

export function createApiClient(
  baseUrl: string,
  options: { verbose?: boolean; logMaxChars?: number; smokeRunId?: string } = {}
) {
  const normalizedBase = baseUrl.replace(/\/$/, "");
  const logMaxChars = normalizeLogMaxChars(options.logMaxChars);
  let requestSeq = 0;

  async function request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    expectedStatuses: number[] = [200]
  ): Promise<ApiResponse<T>> {
    const url = `${normalizedBase}${path}`;
    const startedAt = Date.now();
    const requestBody = body === undefined ? undefined : JSON.stringify(body);
    requestSeq += 1;
    const smokeRequestId = options.smokeRunId ? `${options.smokeRunId}:${requestSeq}` : `smoke:${requestSeq}`;
    const headers: Record<string, string> = {
      "X-Smoke-Request-Id": smokeRequestId,
      ...(options.smokeRunId ? { "X-Smoke-Run-Id": options.smokeRunId } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    };
    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers,
        body: requestBody,
      });
    } catch (error) {
      throw new Error(formatNetworkFailure({
        method,
        path,
        url,
        smokeRequestId,
        body,
        durationMs: Date.now() - startedAt,
        error,
        logMaxChars,
      }));
    }

    const text = await response.text();
    const parsedBody = text.length === 0 ? null : safeParseJson(text);
    const durationMs = Date.now() - startedAt;

    if (!expectedStatuses.includes(response.status)) {
      throw new Error(formatHttpFailure({
        method,
        path,
        url,
        smokeRequestId,
        body,
        expectedStatuses,
        actualStatus: response.status,
        durationMs,
        responseHeaders: Object.fromEntries(response.headers.entries()),
        responseText: text,
        parsedBody,
        logMaxChars,
      }));
    }

    if (options.verbose) {
      console.log(formatHttpSuccess({
        method,
        path,
        smokeRequestId,
        body,
        status: response.status,
        durationMs,
        parsedBody,
        logMaxChars,
      }));
    }

    return {
      status: response.status,
      body: parsedBody as T | null,
    };
  }

  return { request };
}

// ── CLI ──────────────────────────────────────────────

export function parseArgs(args: string[]): SmokeOptions {
  const defaultPort = process.env.PORT ?? "3000";
  const parsed: SmokeOptions = {
    baseUrl: process.env.API_BASE_URL ?? `http://127.0.0.1:${defaultPort}`,
    keepData: false,
    skipImports: false,
    verbose: parseBooleanEnv(process.env.SMOKE_VERBOSE),
    logMaxChars: normalizeLogMaxChars(process.env.SMOKE_LOG_MAX_CHARS),
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
      case "base-url": {
        if (!nextValue) {
          throw new Error("Missing value for --base-url");
        }
        parsed.baseUrl = nextValue;
        break;
      }
      case "keep-data": {
        parsed.keepData = true;
        break;
      }
      case "skip-imports": {
        parsed.skipImports = true;
        break;
      }
      case "verbose":
      case "debug": {
        parsed.verbose = true;
        break;
      }
      case "log-max-chars": {
        if (!nextValue) {
          throw new Error("Missing value for --log-max-chars");
        }
        parsed.logMaxChars = normalizeLogMaxChars(nextValue);
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

    if (consumeNext && (key === "base-url" || key === "log-max-chars")) {
      i += 1;
    }
  }

  return parsed;
}

function printUsage(): void {
  console.log("Usage: pnpm --filter @tavern/api smoke -- [options]");
  console.log("Options:");
  console.log("  --base-url <url>  API base URL (default: API_BASE_URL or http://127.0.0.1:3000)");
  console.log("  --keep-data       Keep created resources (default: cleanup enabled)");
  console.log("  --skip-imports    Skip import routes smoke tests");
  console.log("  --verbose         Print request/response details for every successful request");
  console.log("  --debug           Alias for --verbose");
  console.log("  --log-max-chars <n>");
  console.log("                    Maximum characters per logged body/value (default: 12000)");
  console.log("  --help            Show this help message");
  console.log("Environment: SMOKE_VERBOSE=1 and SMOKE_LOG_MAX_CHARS=<n> provide the same logging controls.");
}

// ── Assertions ───────────────────────────────────────

export function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function must<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
}

// ── Internal Helpers ─────────────────────────────────

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}... [truncated ${value.length - max} chars]`;
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1"
    || normalized === "true"
    || normalized === "yes"
    || normalized === "on"
    || normalized === "verbose"
    || normalized === "debug";
}

function normalizeLogMaxChars(value: string | number | undefined): number {
  if (value === undefined) {
    return DEFAULT_LOG_MAX_CHARS;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LOG_MAX_CHARS;
  }

  return Math.min(Math.trunc(parsed), MAX_LOG_MAX_CHARS);
}

function formatHttpSuccess(input: {
  method: string;
  path: string;
  smokeRequestId: string;
  body: unknown;
  status: number;
  durationMs: number;
  parsedBody: unknown;
  logMaxChars: number;
}): string {
  const lines = [
    `    ${input.method} ${input.path} -> ${input.status} (${input.durationMs}ms)`,
    `      smoke_request_id: ${input.smokeRequestId}`,
  ];

  if (input.body !== undefined) {
    lines.push("      request_body:");
    lines.push(indent(formatLogValue(input.body, input.logMaxChars), 8));
  }

  if (input.parsedBody !== null) {
    lines.push("      response_body:");
    lines.push(indent(formatLogValue(input.parsedBody, input.logMaxChars), 8));
  }

  return lines.join("\n");
}

function formatHttpFailure(input: {
  method: string;
  path: string;
  url: string;
  smokeRequestId: string;
  body: unknown;
  expectedStatuses: number[];
  actualStatus: number;
  durationMs: number;
  responseHeaders: Record<string, string>;
  responseText: string;
  parsedBody: unknown;
  logMaxChars: number;
}): string {
  const lines = [
    "HTTP request failed.",
    `  method: ${input.method}`,
    `  path: ${input.path}`,
    `  url: ${input.url}`,
    `  smoke_request_id: ${input.smokeRequestId}`,
    `  expected_statuses: [${input.expectedStatuses.join(", ")}]`,
    `  actual_status: ${input.actualStatus}`,
    `  duration_ms: ${input.durationMs}`,
  ];

  if (input.body !== undefined) {
    lines.push("  request_body:");
    lines.push(indent(formatLogValue(input.body, input.logMaxChars), 4));
  }

  lines.push("  response_headers:");
  lines.push(indent(formatLogValue(input.responseHeaders, input.logMaxChars), 4));

  lines.push("  response_body:");
  lines.push(indent(formatResponseBody(input.responseText, input.parsedBody, input.logMaxChars), 4));

  lines.push("  replay_curl:");
  lines.push(indent(buildCurlCommand(input.method, input.url, input.body, input.logMaxChars), 4));

  return lines.join("\n");
}

function formatNetworkFailure(input: {
  method: string;
  path: string;
  url: string;
  smokeRequestId: string;
  body: unknown;
  durationMs: number;
  error: unknown;
  logMaxChars: number;
}): string {
  const lines = [
    "HTTP request failed before receiving a response.",
    `  method: ${input.method}`,
    `  path: ${input.path}`,
    `  url: ${input.url}`,
    `  smoke_request_id: ${input.smokeRequestId}`,
    `  duration_ms: ${input.durationMs}`,
    `  error: ${input.error instanceof Error ? input.error.message : String(input.error)}`,
  ];

  if (input.body !== undefined) {
    lines.push("  request_body:");
    lines.push(indent(formatLogValue(input.body, input.logMaxChars), 4));
  }

  lines.push("  replay_curl:");
  lines.push(indent(buildCurlCommand(input.method, input.url, input.body, input.logMaxChars), 4));

  return lines.join("\n");
}

function formatResponseBody(responseText: string, parsedBody: unknown, maxChars: number): string {
  if (responseText.length === 0) {
    return "<empty>";
  }

  if (parsedBody !== null && typeof parsedBody !== "undefined") {
    return formatLogValue(parsedBody, maxChars);
  }

  return truncate(responseText, maxChars);
}

function formatLogValue(value: unknown, maxChars: number): string {
  const sanitized = sanitizeLogValue(value);
  if (typeof sanitized === "string") {
    return truncate(sanitized, maxChars);
  }

  try {
    return truncate(JSON.stringify(sanitized, null, 2), maxChars);
  } catch {
    return truncate(String(sanitized), maxChars);
  }
}

function sanitizeLogValue(value: unknown, key = ""): unknown {
  if (isSensitiveLogKey(key)) {
    return "[redacted]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeLogValue(entryValue, entryKey),
      ])
    );
  }

  return value;
}

function isSensitiveLogKey(key: string): boolean {
  return /api[_-]?key|authorization|bearer|token|secret|password|credential/i.test(key);
}

function indent(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

function buildCurlCommand(method: string, url: string, body: unknown, maxChars: number): string {
  const parts = ["curl", "-X", shellQuote(method), shellQuote(url)];
  if (body !== undefined) {
    parts.push("-H", shellQuote("Content-Type: application/json"));
    parts.push("--data-binary", shellQuote(formatLogValue(body, maxChars)));
  }
  return parts.join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
