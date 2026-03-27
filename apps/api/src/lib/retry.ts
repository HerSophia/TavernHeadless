import { normalizePositiveInt } from "./utils.js";

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs?: number;
}

export interface RetryAttemptContext {
  attempt: number;
  error: unknown;
  delayMs: number;
}

export async function executeWithRetry<T>(
  task: (attempt: number) => Promise<T>,
  policy: RetryPolicy,
  options: {
    shouldRetry?: (error: unknown, attempt: number) => boolean;
    onRetry?: (context: RetryAttemptContext) => Promise<void> | void;
  } = {},
): Promise<T> {
  const normalized = normalizeRetryPolicy(policy);
  let attempt = 0;

  while (true) {
    attempt += 1;

    try {
      return await task(attempt);
    } catch (error) {
      const shouldRetry = options.shouldRetry?.(error, attempt) ?? true;
      if (!shouldRetry || attempt > normalized.maxRetries) {
        throw error;
      }

      const delayMs = calculateRetryDelay(normalized, attempt);
      await options.onRetry?.({ attempt, error, delayMs });
      await sleep(delayMs);
    }
  }
}

export function isSqliteBusyError(error: unknown): boolean {
  for (const candidate of walkErrorChain(error)) {
    const code = typeof candidate.code === "string" ? candidate.code : undefined;
    if (code?.startsWith("SQLITE_BUSY") || code?.startsWith("SQLITE_LOCKED")) {
      return true;
    }

    const message = candidate.error.message;
    if (/database is locked/i.test(message) || /database is busy/i.test(message)) {
      return true;
    }
  }

  return false;
}

function normalizeRetryPolicy(policy: RetryPolicy): Required<RetryPolicy> {
  const maxRetries = normalizeNonNegativeInt(policy.maxRetries) ?? 0;
  const baseDelayMs = normalizePositiveInt(policy.baseDelayMs) ?? 100;
  const maxDelayMs = normalizePositiveInt(policy.maxDelayMs) ?? Math.max(baseDelayMs, 1_000);

  return {
    maxRetries,
    baseDelayMs,
    maxDelayMs,
  };
}

function calculateRetryDelay(policy: Required<RetryPolicy>, attempt: number): number {
  const exponentialDelay = policy.baseDelayMs * Math.max(1, 2 ** (attempt - 1));
  return Math.min(exponentialDelay, policy.maxDelayMs);
}

function normalizeNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.trunc(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type ErrorChainNode = {
  error: Error;
  code?: unknown;
  cause?: unknown;
};

function walkErrorChain(error: unknown): ErrorChainNode[] {
  const nodes: ErrorChainNode[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);

    const currentError = current instanceof Error
      ? current
      : new Error(String((current as { message?: unknown }).message ?? current));

    nodes.push({
      error: currentError,
      code: (current as { code?: unknown }).code,
      cause: (current as { cause?: unknown }).cause,
    });

    current = (current as { cause?: unknown }).cause;
  }

  return nodes;
}
