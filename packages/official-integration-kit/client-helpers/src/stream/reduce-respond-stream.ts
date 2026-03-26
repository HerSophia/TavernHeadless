import type { RespondResult, TavernRespondStreamEvent } from "@tavern/sdk";

import { resolveUsage } from "../usage/resolve-usage.js";
import type { RespondStreamState } from "./types.js";

export function reduceRespondStream(
  state: RespondStreamState = createInitialRespondStreamState(),
  event: TavernRespondStreamEvent,
): RespondStreamState {
  if (event.type === "start") {
    return {
      ...state,
      branchId: event.payload.branchId,
      floorId: event.payload.floorId,
      floorNo: event.payload.floorNo,
      status: "streaming",
    };
  }

  if (event.type === "chunk") {
    return {
      ...state,
      content: `${state.content}${event.payload.chunk}`,
      status: state.status === "idle" ? "streaming" : state.status,
    };
  }

  if (event.type === "summary") {
    return {
      ...state,
      summaries: [...state.summaries, ...event.payload.summaries],
    };
  }

  if (event.type === "error") {
    return {
      ...state,
      error: {
        code: event.payload.code,
        message: event.payload.message ?? "Stream request failed",
      },
      status: "error",
    };
  }

  const usage = resolveUsage(event.payload.totalUsage);
  const branchId = event.payload.branchId ?? state.branchId;
  const summaries = event.payload.summaries.length > 0 ? event.payload.summaries : state.summaries;
  const result: RespondResult = {
    branchId,
    finalState: event.payload.finalState,
    floorId: event.payload.floorId,
    floorNo: event.payload.floorNo,
    generatedText: event.payload.generatedText ?? state.content,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    summaries,
    totalTokens: usage.totalTokens,
    totalUsage: usage.usage,
  };

  return {
    ...state,
    branchId: result.branchId,
    content: result.generatedText,
    floorId: result.floorId,
    floorNo: result.floorNo,
    result,
    status: "done",
    summaries,
  };
}

export function createInitialRespondStreamState(): RespondStreamState {
  return {
    content: "",
    result: null,
    status: "idle",
    summaries: [],
  };
}
