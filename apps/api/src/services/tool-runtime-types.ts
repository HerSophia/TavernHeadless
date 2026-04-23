import type {
  RuntimeToolEnvelope,
  ToolCallResult,
  ToolExecutionStatus,
} from "@tavern/core";

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

function inferFinalStatus(result: ToolCallResult): Exclude<ToolExecutionStatus, "running" | "queued"> {
  if (!result.error) {
    return "success";
  }

  // 优先使用 provider / connection 层给出的显式结构化状态。
  if (
    result.executionStatus
    && result.executionStatus !== "running"
    && result.executionStatus !== "queued"
  ) {
    return result.executionStatus;
  }

  // legacy fallback：仅当显式状态缺失时，才从错误字符串里兜底推断。
  const normalized = result.error.toLowerCase();
  if (normalized.includes("execution outcome is uncertain")) {
    return "uncertain";
  }

  if (normalized.includes("timeout")) {
    return "timeout";
  }

  return "error";
}

export function finalizeToolCallResult(
  envelope: RuntimeToolEnvelope,
  result: ToolCallResult,
  finishedAt: number,
): FinalizedToolAsyncExecution {
  const status = inferFinalStatus(result);
  const reasonCode = result.executionReasonCode;

  if (result.error) {
    return {
      resultJson: safeJsonStringify({ error: result.error }),
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
