import { TavernApiError } from "../errors/tavern-api-error.js";
import { createResponseError } from "../errors/normalize-error.js";
import { toApiUsage } from "../types/usage.js";
import type {
  RespondStreamCallbacks,
  TavernRespondChunkPayload,
  TavernRespondDonePayload,
  TavernRespondErrorPayload,
  TavernRespondStartPayload,
  TavernRespondRunPayload,
  TavernRespondStreamEvent,
  TavernRespondSummaryPayload,
  TavernRespondToolPayload,
  TavernRespondToolPhase,
  TavernRespondToolProviderType,
  TavernRespondToolReplaySafety,
  TavernRespondToolSideEffectLevel,
} from "./event-types.js";

export async function readSseStream(
  response: Response,
  callbacks: RespondStreamCallbacks = {},
): Promise<TavernRespondDonePayload> {
  if (!response.ok) {
    throw await createResponseError(response);
  }

  if (!response.body) {
    throw new TavernApiError({
      message: "SSE stream is not available in this runtime",
      status: response.status,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];
  let donePayload: TavernRespondDonePayload | null = null;
  let startPayload: TavernRespondStartPayload | null = null;
  let collectedSummaries: string[] = [];

  const flushEvent = (): void => {
    if (dataLines.length === 0) {
      eventName = "message";
      return;
    }

    const rawEvent = dataLines.join("\n");
    dataLines = [];
    const event = parseEvent(eventName, rawEvent);
    eventName = "message";

    if (!event) {
      return;
    }

    callbacks.onEvent?.(event);

    if (event.type === "start") {
      startPayload = event.payload;
      callbacks.onStart?.(event.payload);
      return;
    }

    if (event.type === "run") {
      callbacks.onRun?.(event.payload);
      return;
    }

    if (event.type === "chunk") {
      callbacks.onChunk?.(event.payload);
      return;
    }

    if (event.type === "summary") {
      collectedSummaries = [...collectedSummaries, ...event.payload.summaries];
      callbacks.onSummary?.(event.payload);
      return;
    }

    if (event.type === "tool") {
      callbacks.onTool?.(event.payload);
      return;
    }

    if (event.type === "error") {
      callbacks.onError?.(event.payload);
      throw new TavernApiError({
        code: event.payload.code,
        message: event.payload.message ?? "Stream request failed",
        status: response.status,
      });
    }

    donePayload = {
      ...event.payload,
      branchId: event.payload.branchId ?? startPayload?.branchId,
      summaries: event.payload.summaries.length > 0 ? event.payload.summaries : collectedSummaries,
    };
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const lineBreakIndex = buffer.indexOf("\n");
      if (lineBreakIndex < 0) {
        break;
      }

      const rawLine = buffer.slice(0, lineBreakIndex);
      buffer = buffer.slice(lineBreakIndex + 1);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

      if (line.length === 0) {
        flushEvent();
        continue;
      }

      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
        continue;
      }

      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }
  }

  if (buffer.trim().length > 0) {
    dataLines.push(buffer.trim());
  }
  flushEvent();

  if (!donePayload) {
    throw new TavernApiError({
      message: "Stream ended without final done payload",
      status: response.status,
    });
  }

  return donePayload;
}

function parseEvent(eventName: string, rawEvent: string): TavernRespondStreamEvent | null {
  const parsed = parseJson(rawEvent);

  if (eventName === "start") {
    const payload = parsed as Record<string, unknown> | null;
    const startPayload: TavernRespondStartPayload = {
      branchId: readOptionalString(payload?.branch_id),
      floorId: readOptionalString(payload?.floor_id),
      floorNo: readOptionalNumber(payload?.floor_no),
    };

    return { payload: startPayload, type: "start" };
  }

  if (eventName === "run") {
    const payload = parsed as Record<string, unknown> | null;
    const floorId = readOptionalString(payload?.floor_id);
    const runId = readOptionalString(payload?.run_id);
    const runType = readRunType(payload?.run_type);
    const status = readRunStatus(payload?.status);
    const phase = readRunPhase(payload?.phase);
    const publicPhase = readRunPublicPhase(payload?.public_phase);
    const phaseSeq = readOptionalNumber(payload?.phase_seq);
    const attemptNo = readOptionalNumber(payload?.attempt_no);
    const startedAt = readOptionalNumber(payload?.started_at);
    const updatedAt = readOptionalNumber(payload?.updated_at);

    if (!floorId || !runId || !runType || !status || !phase || !publicPhase || phaseSeq === undefined || attemptNo === undefined || startedAt === undefined || updatedAt === undefined) {
      return null;
    }

    const runPayload: TavernRespondRunPayload = {
      attemptNo,
      completedAt: readOptionalNumber(payload?.completed_at) ?? null,
      error: readRunErrorPayload(payload?.error),
      floorId,
      pendingOutput: readRunPendingOutputPayload(payload?.pending_output),
      phase,
      phaseSeq,
      publicPhase,
      runId,
      runType,
      startedAt,
      status,
      updatedAt,
      verifier: readRunVerifierPayload(payload?.verifier),
    };

    return { payload: runPayload, type: "run" };
  }

  if (eventName === "chunk") {
    const payload = parsed as Record<string, unknown> | null;
    const chunkPayload: TavernRespondChunkPayload = {
      chunk: readString(payload?.chunk),
    };

    return { payload: chunkPayload, type: "chunk" };
  }

  if (eventName === "summary") {
    const payload = parsed as Record<string, unknown> | null;
    const summaryPayload: TavernRespondSummaryPayload = {
      summaries: readStringArray(payload?.summaries),
    };

    return { payload: summaryPayload, type: "summary" };
  }

  if (eventName === "tool") {
    const payload = parsed as Record<string, unknown> | null;
    const executionId = readOptionalString(payload?.execution_id);
    const toolName = readOptionalString(payload?.tool_name);
    const providerId = readOptionalString(payload?.provider_id);
    const phase = readToolPhase(payload?.phase);
    const replaySafety = readToolReplaySafety(payload?.replay_safety);

    if (!executionId || !toolName || !providerId || !phase || !replaySafety) {
      return null;
    }

    const toolPayload: TavernRespondToolPayload = {
      executionId,
      toolName,
      providerId,
      phase,
      replaySafety,
      ...(readToolProviderType(payload?.provider_type) ? { providerType: readToolProviderType(payload?.provider_type) } : {}),
      ...(readToolSideEffectLevel(payload?.side_effect_level) ? { sideEffectLevel: readToolSideEffectLevel(payload?.side_effect_level) } : {}),
      ...(readOptionalString(payload?.message) ? { message: readOptionalString(payload?.message) } : {}),
      ...(typeof readOptionalNumber(payload?.duration_ms) === "number"
        ? { durationMs: readOptionalNumber(payload?.duration_ms) }
        : {}),
    };

    return { payload: toolPayload, type: "tool" };
  }

  if (eventName === "error") {
    const payload = parsed as Record<string, unknown> | null;
    const errorPayload: TavernRespondErrorPayload = {
      code: readOptionalString(payload?.code),
      message: readOptionalString(payload?.message),
    };

    return { payload: errorPayload, type: "error" };
  }

  if (eventName === "done") {
    const payload = parsed as Record<string, unknown> | null;
    const floorId = readOptionalString(payload?.floor_id);
    const floorNo = readOptionalNumber(payload?.floor_no);

    if (!floorId || floorNo === undefined) {
      return null;
    }

    const donePayload: TavernRespondDonePayload = {
      branchId: readOptionalString(payload?.branch_id),
      finalState: readOptionalFinalState(payload?.final_state),
      floorId,
      floorNo,
      generatedText: readOptionalString(payload?.generated_text),
      memory: readRespondMemoryReceipt(payload?.memory),
      summaries: readStringArray(payload?.summaries),
      totalUsage: toApiUsage(payload?.total_usage),
    };

    return { payload: donePayload, type: "done" };
  }

  return null;
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readOptionalFinalState(value: unknown): TavernRespondDonePayload["finalState"] | undefined {
  return value === "draft" || value === "generating" || value === "committed" || value === "failed"
    ? value
    : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readRespondMemoryReceipt(value: unknown): TavernRespondDonePayload["memory"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const mode = readOptionalString(record.mode);
  const status = readOptionalString(record.status);

  if ((mode !== "sync" && mode !== "async") || (status !== "applied" && status !== "queued")) {
    return undefined;
  }

  return {
    jobId: readNullableString(record.job_id),
    mode,
    status,
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readToolPhase(value: unknown): TavernRespondToolPhase | undefined {
  return value === "start"
    || value === "success"
    || value === "error"
    || value === "denied"
    || value === "timeout"
    || value === "uncertain"
    || value === "blocked"
    ? value
    : undefined;
}

function readToolReplaySafety(value: unknown): TavernRespondToolReplaySafety | undefined {
  return value === "safe"
    || value === "confirm_on_replay"
    || value === "never_auto_replay"
    || value === "uncertain"
    ? value
    : undefined;
}

function readToolProviderType(value: unknown): TavernRespondToolProviderType | undefined {
  return value === "builtin"
    || value === "preset"
    || value === "mcp"
    || value === "unknown"
    ? value
    : undefined;
}

function readToolSideEffectLevel(value: unknown): TavernRespondToolSideEffectLevel | undefined {
  return value === "none" || value === "sandbox" || value === "irreversible" ? value : undefined;
}

function readRunType(value: unknown): TavernRespondRunPayload["runType"] | undefined {
  return value === "respond" || value === "regenerate_page" || value === "retry_turn" || value === "edit_and_regenerate"
    ? value
    : undefined;
}

function readRunStatus(value: unknown): TavernRespondRunPayload["status"] | undefined {
  return value === "running" || value === "completed" || value === "failed" || value === "cancelled"
    ? value
    : undefined;
}

function readRunPhase(value: unknown): TavernRespondRunPayload["phase"] | undefined {
  switch (value) {
    case "input_recorded":
    case "semantic_resolved":
    case "prechecked":
    case "prompt_assembled":
    case "page_generating":
    case "candidate_generated":
    case "verifier_checked":
    case "transaction_prepared":
    case "transaction_committed":
    case "post_commit_scheduled":
      return value;
    default:
      return undefined;
  }
}

function readRunPublicPhase(value: unknown): TavernRespondRunPayload["publicPhase"] | undefined {
  return value === "preparing" || value === "generating" || value === "verifying" || value === "committing" || value === "post_processing"
    ? value
    : undefined;
}

function readRunPendingOutputPayload(value: unknown): TavernRespondRunPayload["pendingOutput"] {
  const payload = value as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const attemptNo = readOptionalNumber(payload.attempt_no);
  const startedAt = readOptionalNumber(payload.started_at);
  const updatedAt = readOptionalNumber(payload.updated_at);
  const tempId = readOptionalString(payload.temp_id);
  const text = readString(payload.text);
  const state = payload.state === "draft" || payload.state === "streaming" || payload.state === "generated" || payload.state === "failed" ? payload.state : undefined;
  if (attemptNo === undefined || startedAt === undefined || updatedAt === undefined || !tempId || !state) {
    return null;
  }
  return { attemptNo, error: readOptionalString(payload.error) ?? null, startedAt, state, tempId, text, updatedAt };
}

function readRunVerifierPayload(value: unknown): TavernRespondRunPayload["verifier"] {
  const payload = value as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const status = payload.status === "pending" || payload.status === "passed" || payload.status === "warned" || payload.status === "blocked" || payload.status === "skipped" ? payload.status : undefined;
  if (!status) {
    return null;
  }

  const issues = Array.isArray(payload.issues)
    ? payload.issues.map((item) => item as Record<string, unknown>).filter((item) => typeof item?.description === "string" && (item?.severity === "warning" || item?.severity === "error")).map((item) => ({ description: readString(item.description), severity: item.severity as "warning" | "error" }))
    : [];
  return {
    issues,
    status,
    suggestion: readOptionalString(payload.suggestion) ?? null,
  };
}

function readRunErrorPayload(value: unknown): TavernRespondRunPayload["error"] {
  const payload = value as Record<string, unknown> | null;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const code = readOptionalString(payload.code);
  const message = readOptionalString(payload.message);
  return code && message ? { code, message } : null;
}
