import { apiClient } from "../api";
import type {
  StreamRespondOptions,
  StreamStartPayload,
  WorkspaceMessageUpdateResult,
  WorkspaceGenerationParams,
  WorkspaceRegenerateResult,
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

  return {
    branchId: result.branchId,
    floorId: result.floorId,
    floorNo: result.floorNo,
    totalTokens: result.totalTokens
  };
}

export async function retryFloor(floorId: string, accountId?: string): Promise<WorkspaceRegenerateResult> {
  const result = await apiClient.floors.retry({
    accountId,
    floorId
  });

  return {
    branchId: result.branchId,
    floorId: result.floorId,
    floorNo: result.floorNo,
    totalTokens: result.totalTokens
  };
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

  return {
    floorId: result.floorId,
    floorNo: result.floorNo,
    generatedText: result.generatedText,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: result.totalTokens
  };
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
    onError: (payload) => options.onError?.(payload.message ?? "Stream request failed"),
    onStart: (payload) => options.onStart?.(toLegacyStartPayload(payload)),
    onSummary: (payload) => options.onSummary?.(payload.summaries),
    sessionId,
    signal: options.signal
  });

  const workspaceResult: WorkspaceRespondResult = {
    floorId: result.floorId,
    floorNo: result.floorNo,
    generatedText: result.generatedText,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    totalTokens: result.totalTokens
  };

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
