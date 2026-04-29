import type {
  StructuredToolExecutionOutcome,
  ToolCallResult,
  ToolExecutionStatus,
} from "@tavern/core";

export type FinalToolExecutionStatus = Exclude<ToolExecutionStatus, "running" | "queued">;

type FinalStructuredToolExecutionOutcome = StructuredToolExecutionOutcome & { executionStatus: FinalToolExecutionStatus };

const FINAL_TOOL_EXECUTION_STATUSES = new Set<FinalToolExecutionStatus>([
  "success",
  "error",
  "denied",
  "timeout",
  "uncertain",
  "blocked",
]);

export interface ResolveStructuredToolExecutionOutcomeOptions {
  fallbackStatus?: FinalToolExecutionStatus;
  fallbackReasonCode?: string;
  allowLegacyMessageInference?: boolean;
}

export interface ResolvedStructuredToolExecutionOutcome {
  outcome: FinalStructuredToolExecutionOutcome | null;
  usedLegacyMessageInference: boolean;
}

export function isFinalToolExecutionStatus(value: unknown): value is FinalToolExecutionStatus {
  return typeof value === "string"
    && FINAL_TOOL_EXECUTION_STATUSES.has(value as FinalToolExecutionStatus);
}

export function inferLegacyExecutionStatusFromErrorMessage(
  error: string,
  fallback: FinalToolExecutionStatus = "error",
): FinalToolExecutionStatus {
  const normalized = error.toLowerCase();

  if (normalized.includes("execution outcome is uncertain")) {
    return "uncertain";
  }

  if (normalized.includes("timeout")) {
    return "timeout";
  }

  return fallback;
}

export function resolveStructuredToolExecutionOutcome(
  input: Pick<
    ToolCallResult,
    | "error"
    | "executionStatus"
    | "executionReasonCode"
    | "reconnectRequired"
    | "retryable"
    | "providerMessage"
  >,
  options: ResolveStructuredToolExecutionOutcomeOptions = {},
): ResolvedStructuredToolExecutionOutcome {
  let usedLegacyMessageInference = false;
  let status = isFinalToolExecutionStatus(input.executionStatus)
    ? input.executionStatus
    : null;

  if (!status && input.error && options.allowLegacyMessageInference !== false) {
    status = inferLegacyExecutionStatusFromErrorMessage(
      input.error,
      options.fallbackStatus ?? "error",
    );
    usedLegacyMessageInference = true;
  }

  if (!status) {
    status = options.fallbackStatus ?? null;
  }

  if (!status) {
    return {
      outcome: null,
      usedLegacyMessageInference,
    };
  }

  const providerMessage = input.providerMessage ?? input.error;
  const reasonCode = input.executionReasonCode ?? options.fallbackReasonCode;

  return {
    outcome: {
      executionStatus: status,
      ...(reasonCode ? { executionReasonCode: reasonCode } : {}),
      ...(input.reconnectRequired !== undefined ? { reconnectRequired: input.reconnectRequired } : {}),
      ...(input.retryable !== undefined ? { retryable: input.retryable } : {}),
      ...(providerMessage ? { providerMessage } : {}),
    },
    usedLegacyMessageInference,
  };
}

export function buildStructuredToolCallErrorResult(
  error: string,
  outcome: StructuredToolExecutionOutcome,
): ToolCallResult {
  return {
    error,
    executionStatus: outcome.executionStatus,
    ...(outcome.executionReasonCode ? { executionReasonCode: outcome.executionReasonCode } : {}),
    ...(outcome.reconnectRequired !== undefined ? { reconnectRequired: outcome.reconnectRequired } : {}),
    ...(outcome.retryable !== undefined ? { retryable: outcome.retryable } : {}),
    ...(outcome.providerMessage && outcome.providerMessage !== error
      ? { providerMessage: outcome.providerMessage }
      : {}),
  };
}

export function toStructuredToolErrorPayload(
  error: string,
  outcome: StructuredToolExecutionOutcome | null,
): Record<string, unknown> {
  if (!outcome) {
    return { error };
  }

  return {
    error,
    executionStatus: outcome.executionStatus,
    ...(outcome.executionReasonCode ? { executionReasonCode: outcome.executionReasonCode } : {}),
    ...(outcome.reconnectRequired !== undefined ? { reconnectRequired: outcome.reconnectRequired } : {}),
    ...(outcome.retryable !== undefined ? { retryable: outcome.retryable } : {}),
    ...(outcome.providerMessage && outcome.providerMessage !== error
      ? { providerMessage: outcome.providerMessage }
      : {}),
  };
}
