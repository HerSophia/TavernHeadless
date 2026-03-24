import process from "node:process";

// ── Types ────────────────────────────────────────────

export type SmokeOptions = {
  baseUrl: string;
  keepData: boolean;
  skipImports: boolean;
};

export type JsonObject = Record<string, unknown>;

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
  const api = createApiClient(options.baseUrl);
  const runId = `smoke-${Date.now().toString(36)}`;
  const cleanupTasks: Array<() => Promise<void>> = [];
  const keptResourceIds: Record<string, string[]> = {};
  const shared: Record<string, string> = {};
  let step = 0;

  async function runStep<T>(name: string, fn: () => Promise<T>): Promise<T> {
    step += 1;
    process.stdout.write(`[${String(step).padStart(2, "0")}] ${name} ... `);
    try {
      const result = await fn();
      console.log("PASS");
      return result;
    } catch (error) {
      console.log("FAIL");
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

export function createApiClient(baseUrl: string) {
  const normalizedBase = baseUrl.replace(/\/$/, "");

  async function request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
    expectedStatuses: number[] = [200]
  ): Promise<ApiResponse<T>> {
    const url = `${normalizedBase}${path}`;
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const parsedBody = text.length === 0 ? null : safeParseJson(text);

    if (!expectedStatuses.includes(response.status)) {
      throw new Error(
        `${method} ${path} expected [${expectedStatuses.join(", ")}], got ${response.status}. Response: ${truncate(
          text,
          400
        )}`
      );
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
      case "help": {
        printUsage();
        process.exit(0);
        break;
      }
      default:
        throw new Error(`Unknown option: --${key}`);
    }

    if (consumeNext && key === "base-url") {
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
  console.log("  --help            Show this help message");
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
  return `${value.slice(0, max)}...`;
}
