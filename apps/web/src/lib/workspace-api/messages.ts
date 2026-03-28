import {
  isTavernApiError,
  type RegenerateResult,
  type RespondResult
} from "@tavern/sdk";

import { apiClient } from "../api";
import type {
  StreamRespondOptions,
  StreamStartPayload,
  WorkspaceGenerationParams,
  WorkspaceMessageUpdateResult,
  WorkspaceRegenerateResult,
  WorkspaceReplayBlockingExecution,
  WorkspaceRespondResult
} from "./types";

export async function updateMessageContent(
  messageId: string,
  content: string,
  accountId?: string
): Promise<WorkspaceMessageUpdateResult | null> {
  const result = await apiClient.messages.update({
    accountId,
    content,
    messageId
  });

  if (!result) {
    return null;
  }

  return {
    content: result.content,
    id: result.id,
    role: result.role as WorkspaceMessageUpdateResult["role"]
  };
}

export async function editAndRegenerateMessage(
  messageId: string,
  content: string,
  accountId?: string
): Promise<WorkspaceRegenerateResult> {
  const result = await apiClient.messages.editAndRegenerate({
    accountId,
    content,
    messageId
  });

  return toWorkspaceRegenerateResult(result);
}

export async function retryFloor(
  floorId: string,
  accountId?: string,
  confirmedExecutionIds?: string[]
): Promise<WorkspaceRegenerateResult> {
  const result = await apiClient.floors.retry({
    accountId,
    confirmedExecutionIds,
    floorId
  });

  return toWorkspaceRegenerateResult(result);
}

export async function respondInSession(
  sessionId: string,
  message: string,
  accountId?: string,
  generationParams?: WorkspaceGenerationParams
): Promise<WorkspaceRespondResult> {
  const result = await apiClient.sessions.respond({
    accountId,
    generationParams,
    message,
    sessionId
  });

  return toWorkspaceRespondResult(result);
}

export async function streamSessionResponse(
  sessionId: string,
  message: string,
  options: StreamRespondOptions = {}
): Promise<WorkspaceRespondResult> {
  const result = await apiClient.sessions.respondStream({
    accountId: options.accountId,
    generationParams: options.generationParams,
    message,
    onChunk: (payload) => options.onChunk?.(payload.chunk),
    onEvent: (event) => options.onEvent?.(event),
    onError: (payload) => options.onError?.(payload.message ?? "Stream request failed"),
    onStart: (payload) => options.onStart?.(toLegacyStartPayload(payload)),
    onSummary: (payload) => options.onSummary?.(payload.summaries),
    onTool: (payload) => options.onTool?.(payload),
    sessionId,
    signal: options.signal
  });

  const workspaceResult = toWorkspaceRespondResult(result);

  options.onDone?.(workspaceResult);
  return workspaceResult;
}

export async function deleteMessageById(messageId: string, accountId?: string): Promise<boolean> {
  return apiClient.messages.remove({
    accountId,
    messageId
  });
}

function toLegacyStartPayload(payload: {
  branchId?: string;
  floorId?: string;
  floorNo?: number;
}): StreamStartPayload {
  return {
    branch_id: payload.branchId,
    floor_id: payload.floorId,
    floor_no: payload.floorNo
  };
}

function toWorkspaceRespondResult(result: RespondResult): WorkspaceRespondResult {
  return {
    branchId: result.branchId,
    finalState: result.finalState,
    floorId: result.floorId,
    floorNo: result.floorNo,
    generatedText: result.generatedText,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    summaries: result.summaries,
    totalUsage: result.totalUsage,
    totalTokens: result.totalTokens
  };
}

function toWorkspaceRegenerateResult(result: RegenerateResult): WorkspaceRegenerateResult {
  return {
    branchId: result.branchId,
    finalState: result.finalState,
    floorId: result.floorId,
    floorNo: result.floorNo,
    generatedText: result.generatedText,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    summaries: result.summaries,
    sourceFloorId: result.sourceFloorId,
    sourceMessageId: result.sourceMessageId,
    totalUsage: result.totalUsage,
    totalTokens: result.totalTokens
  };
}

export function isToolReplayBlockedError(error: unknown): boolean {
  return isTavernApiError(error) && error.code === "tool_replay_blocked";
}

export function isToolReplayConfirmationRequiredError(error: unknown): boolean {
  return isTavernApiError(error) && error.code === "tool_replay_confirmation_required";
}

export function extractToolReplayBlockingExecutions(error: unknown): WorkspaceReplayBlockingExecution[] {
  if (!isTavernApiError(error)) {
    return [];
  }

  const details = asRecord(error.details);
  const rawExecutions = Array.isArray(details?.blocking_executions) ? details.blocking_executions : [];

  return rawExecutions
    .map(mapReplayBlockingExecution)
    .filter((execution): execution is WorkspaceReplayBlockingExecution => execution !== null);
}

function mapReplayBlockingExecution(value: unknown): WorkspaceReplayBlockingExecution | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const executionId = readRequiredString(record.execution_id);
  const toolName = readRequiredString(record.tool_name);
  const providerId = readRequiredString(record.provider_id);
  const status = readRequiredString(record.status);
  const replaySafety = readReplaySafety(record.replay_safety);
  const reason = readRequiredString(record.reason);

  if (!executionId || !toolName || !providerId || !status || !replaySafety || !reason) {
    return null;
  }

  return {
    ...(readOptionalString(record.error_message) ? { errorMessage: readOptionalString(record.error_message) } : {}),
    executionId,
    lifecycleState: readOptionalString(record.lifecycle_state) ?? null,
    providerId,
    providerType: readOptionalString(record.provider_type) ?? null,
    reason,
    replaySafety,
    sideEffectLevel: readOptionalString(record.side_effect_level) ?? null,
    status,
    toolName
  };
}

function readReplaySafety(value: unknown): WorkspaceReplayBlockingExecution["replaySafety"] | null {
  switch (value) {
    case "safe":
    case "confirm_on_replay":
    case "never_auto_replay":
    case "uncertain":
      return value;
    default:
      return null;
  }
}

function readRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}
