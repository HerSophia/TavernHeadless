import type {
  RuntimeToolEnvelope,
  ToolCallResult,
  ToolExecutionStatus,
} from "@tavern/core";
import {
  resolveStructuredToolExecutionOutcome,
  toStructuredToolErrorPayload,
} from "../shared/execution-status.js";

export const TOOL_RUNTIME_SCOPE_TYPE = "tool_execution" as const;

export function buildToolRuntimeScopeKey(sessionId: string): string {
  return `session:${sessionId}`;
}

export interface ToolExecuteJobPayload {
  envelope: RuntimeToolEnvelope;
}

export interface FinalizedToolAsyncExecution {
  resultJson: string;
  status: Exclude<ToolExecutionStatus, "running" | "queued">;
  errorMessage?: string;
  finishedAt: number;
  durationMs: number;
  /**
   * 可选：供执行日志与审计链使用的稳定原因码。
   *
   * 仅当 provider 或 runtime 明确给出时才返回。
   */
  reasonCode?: string;
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    const serialized = JSON.stringify(value, (_key, currentValue) => {
      if (typeof currentValue === "bigint") {
        return currentValue.toString();
      }

      if (typeof currentValue === "function") {
        return `[Function ${currentValue.name || "anonymous"}]`;
      }

      if (typeof currentValue === "symbol") {
        return currentValue.toString();
      }

      if (currentValue && typeof currentValue === "object") {
        if (seen.has(currentValue)) {
          return "[Circular]";
        }

        seen.add(currentValue);
      }

      return currentValue;
    });

    return serialized ?? "null";
  } catch {
    return JSON.stringify(String(value));
  }
}

export function finalizeToolCallResult(
  envelope: RuntimeToolEnvelope,
  result: ToolCallResult,
  finishedAt: number,
): FinalizedToolAsyncExecution {
  const resolvedOutcome = result.error
    ? resolveStructuredToolExecutionOutcome(result, {
        fallbackStatus: "error",
        allowLegacyMessageInference: true,
      }).outcome
    : resolveStructuredToolExecutionOutcome(result).outcome;
  const status = resolvedOutcome?.executionStatus ?? "success";
  const reasonCode = resolvedOutcome?.executionReasonCode;

  if (result.error) {
    return {
      resultJson: safeJsonStringify(
        toStructuredToolErrorPayload(result.error, resolvedOutcome),
      ),
      status,
      errorMessage: result.error,
      finishedAt,
      durationMs: Math.max(0, finishedAt - envelope.acceptedAt),
      ...(reasonCode ? { reasonCode } : {}),
    };
  }

  return {
    resultJson: safeJsonStringify(result.data ?? null),
    status,
    finishedAt,
    durationMs: Math.max(0, finishedAt - envelope.acceptedAt),
    ...(reasonCode ? { reasonCode } : {}),
  };
}
