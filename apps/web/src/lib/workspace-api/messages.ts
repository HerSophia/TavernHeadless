import { apiClient } from "../api";
import {
  normalizeContentFormat,
  resolveInputTokens,
  resolveOutputTokens,
  resolveTotalTokens
} from "./mappers";
import {
  buildAccountHeaders,
  extractErrorMessage,
  resolvePath
} from "./transport";
import type {
  MessageMutationResponse,
  RespondResponse,
  StreamDonePayload,
  StreamErrorPayload,
  StreamRespondOptions,
  StreamStartPayload,
  StreamSummaryPayload,
  StreamChunkPayload,
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
  const response = await apiClient.patch("/messages/{id}", {
    body: {
      content
    },
    headers: buildAccountHeaders(accountId),
    path: {
      id: messageId
    }
  });

  if (response.status !== 200 || !response.body || typeof response.body !== "object") {
    return null;
  }

  const payload = response.body as MessageMutationResponse;
  if (!payload.data) {
    return null;
  }

  return {
    content: payload.data.content,
    id: payload.data.id,
    role: payload.data.role
  };
}

export async function editAndRegenerateMessage(
  messageId: string,
  content: string,
  accountId?: string
): Promise<WorkspaceRegenerateResult> {
  const response = await fetch(resolvePath(`/messages/${encodeURIComponent(messageId)}/edit-and-regenerate`), {
    body: JSON.stringify({
      content
    }),
    headers: {
      "content-type": "application/json",
      ...buildAccountHeaders(accountId)
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  const payload = (await response.json()) as RespondResponse;
  const data = payload.data;
  if (!data?.floor_id || typeof data.floor_no !== "number") {
    throw new Error("Edit-and-regenerate API returned an invalid payload");
  }

  return {
    branchId: data.branch_id,
    floorId: data.floor_id,
    floorNo: data.floor_no,
    totalTokens: resolveTotalTokens(data.total_usage)
  };
}

export async function retryFloor(floorId: string, accountId?: string): Promise<WorkspaceRegenerateResult> {
  const response = await fetch(resolvePath(`/floors/${encodeURIComponent(floorId)}/retry`), {
    body: JSON.stringify({}),
    headers: {
      "content-type": "application/json",
      ...buildAccountHeaders(accountId)
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  const payload = (await response.json()) as RespondResponse;
  const data = payload.data;
  if (!data?.floor_id || typeof data.floor_no !== "number") {
    throw new Error("Retry-floor API returned an invalid payload");
  }

  return {
    branchId: data.branch_id,
    floorId: data.floor_id,
    floorNo: data.floor_no,
    totalTokens: resolveTotalTokens(data.total_usage)
  };
}

export async function respondInSession(
  sessionId: string,
  message: string,
  accountId?: string,
  generationParams?: WorkspaceGenerationParams
): Promise<WorkspaceRespondResult> {
  const response = await fetch(resolvePath(`/sessions/${encodeURIComponent(sessionId)}/respond`), {
    body: JSON.stringify({
      generation_params: toApiGenerationParams(generationParams),
      message
    }),
    headers: {
      "content-type": "application/json",
      ...buildAccountHeaders(accountId)
    },
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  const payload = (await response.json()) as RespondResponse;
  const data = payload.data;
  if (!data?.floor_id || typeof data.floor_no !== "number") {
    throw new Error("Respond API returned an invalid payload");
  }

  return {
    floorId: data.floor_id,
    floorNo: data.floor_no,
    generatedText: data.generated_text ?? "",
    inputTokens: resolveInputTokens(data.total_usage),
    outputTokens: resolveOutputTokens(data.total_usage),
    totalTokens: resolveTotalTokens(data.total_usage)
  };
}

function toApiGenerationParams(generationParams?: WorkspaceGenerationParams): {
  frequency_penalty?: number;
  max_output_tokens?: number;
  presence_penalty?: number;
  stop_sequences?: string[];
  stream?: boolean;
  temperature?: number;
  top_k?: number;
  top_p?: number;
} | undefined {
  if (!generationParams) {
    return undefined;
  }

  const mapped = {
    frequency_penalty: generationParams.frequencyPenalty,
    max_output_tokens: generationParams.maxOutputTokens,
    presence_penalty: generationParams.presencePenalty,
    stop_sequences: generationParams.stopSequences,
    stream: generationParams.stream,
    temperature: generationParams.temperature,
    top_k: generationParams.topK,
    top_p: generationParams.topP
  };

  const compacted = Object.fromEntries(
    Object.entries(mapped).filter(([, value]) => value !== undefined)
  ) as {
    frequency_penalty?: number;
    max_output_tokens?: number;
    presence_penalty?: number;
    stop_sequences?: string[];
    stream?: boolean;
    temperature?: number;
    top_k?: number;
    top_p?: number;
  };

  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

export async function streamSessionResponse(
  sessionId: string,
  message: string,
  options: StreamRespondOptions = {}
): Promise<WorkspaceRespondResult> {
  const generationParams = toApiGenerationParams(options.generationParams);
  const response = await fetch(resolvePath(`/sessions/${encodeURIComponent(sessionId)}/respond/stream`), {
    body: JSON.stringify({
      generation_params: generationParams,
      message
    }),
    headers: {
      Accept: "text/event-stream",
      "content-type": "application/json",
      ...buildAccountHeaders(options.accountId)
    },
    method: "POST",
    signal: options.signal
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  if (!response.body) {
    throw new Error("SSE stream is not available in this runtime");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "message";
  let dataLines: string[] = [];
  let donePayload: StreamDonePayload | null = null;

  const flushEvent = (): void => {
    if (dataLines.length === 0) {
      eventName = "message";
      return;
    }

    const joined = dataLines.join("\n");
    dataLines = [];

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(joined);
    } catch {
      parsed = null;
    }

    if (eventName === "start") {
      options.onStart?.((parsed as StreamStartPayload | null) ?? {});
    } else if (eventName === "chunk") {
      options.onChunk?.((parsed as StreamChunkPayload | null)?.chunk ?? "");
    } else if (eventName === "summary") {
      options.onSummary?.((parsed as StreamSummaryPayload | null)?.summaries ?? []);
    } else if (eventName === "error") {
      const payload = (parsed as StreamErrorPayload | null) ?? {};
      const messageText = payload.message ?? "Stream request failed";
      options.onError?.(messageText);
      throw new Error(messageText);
    } else if (eventName === "done") {
      donePayload = (parsed as StreamDonePayload | null) ?? {};
    }

    eventName = "message";
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const index = buffer.indexOf("\n");
      if (index < 0) {
        break;
      }

      const rawLine = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

      if (line.length === 0) {
        flushEvent();
        continue;
      }

      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }
  }

  if (buffer.trim().length > 0) {
    dataLines.push(buffer.trim());
  }
  flushEvent();

  const finalPayload = donePayload as StreamDonePayload | null;
  if (!finalPayload || typeof finalPayload.floor_id !== "string" || typeof finalPayload.floor_no !== "number") {
    throw new Error("Stream ended without final done payload");
  }

  const result: WorkspaceRespondResult = {
    floorId: finalPayload.floor_id,
    floorNo: finalPayload.floor_no,
    generatedText: finalPayload.generated_text ?? "",
    inputTokens: resolveInputTokens(finalPayload.total_usage),
    outputTokens: resolveOutputTokens(finalPayload.total_usage),
    totalTokens: resolveTotalTokens(finalPayload.total_usage)
  };

  options.onDone?.(result);
  return result;
}

export async function deleteMessageById(messageId: string, accountId?: string): Promise<boolean> {
  const response = await apiClient.delete("/messages/{id}", {
    headers: buildAccountHeaders(accountId),
    path: {
      id: messageId
    }
  });

  return response.status === 200;
}
