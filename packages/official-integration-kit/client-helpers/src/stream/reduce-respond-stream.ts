import type { RespondResult, TavernRespondStreamEvent, TavernRespondToolPayload } from "@tavern/sdk";

import { resolveUsage } from "../usage/resolve-usage.js";
import { isTerminalToolPhase } from "./group-tool-events-by-execution.js";
import type { RespondStreamState, RespondStreamWarning } from "./types.js";

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

  if (event.type === "run") {
    return {
      ...state,
      content: event.payload.pendingOutput?.text ?? state.content,
      floorId: event.payload.floorId,
      run: event.payload,
      status:
        state.status === "idle" && event.payload.status === "running"
          ? "streaming"
          : state.status,
    };
  }

  if (event.type === "summary") {
    return {
      ...state,
      summaries: [...state.summaries, ...event.payload.summaries],
    };
  }

  if (event.type === "tool") {
    const activeTools = { ...state.activeTools };
    if (isTerminalToolPhase(event.payload.phase)) {
      delete activeTools[event.payload.executionId];
    } else {
      activeTools[event.payload.executionId] = event.payload;
    }

    return {
      ...state,
      activeTools,
      status: state.status === "idle" ? "streaming" : state.status,
      toolEvents: [...state.toolEvents, event.payload],
      warnings: appendToolWarning(state.warnings, event.payload),
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
    activeTools: {},
    content: "",
    run: null,
    result: null,
    status: "idle",
    summaries: [],
    toolEvents: [],
    warnings: [],
  };
}

function appendToolWarning(
  warnings: RespondStreamWarning[],
  toolEvent: TavernRespondToolPayload,
): RespondStreamWarning[] {
  if (!isTerminalToolPhase(toolEvent.phase) || toolEvent.replaySafety === "safe") {
    return warnings;
  }

  const warning = {
    code: resolveToolWarningCode(toolEvent),
    executionId: toolEvent.executionId,
    message: buildToolWarningMessage(toolEvent),
    toolName: toolEvent.toolName,
  } satisfies RespondStreamWarning;

  if (warnings.some((item) => item.code === warning.code && item.executionId === warning.executionId)) {
    return warnings;
  }

  return [...warnings, warning];
}

function resolveToolWarningCode(toolEvent: TavernRespondToolPayload): string {
  switch (toolEvent.replaySafety) {
    case "confirm_on_replay":
      return "tool_replay_confirmation_required";
    case "never_auto_replay":
      return "tool_replay_blocked";
    default:
      return "tool_execution_uncertain";
  }
}

function buildToolWarningMessage(toolEvent: TavernRespondToolPayload): string {
  switch (toolEvent.replaySafety) {
    case "confirm_on_replay":
      return `Tool '${toolEvent.toolName}' requires confirmation before replay.`;
    case "never_auto_replay":
      return `Tool '${toolEvent.toolName}' cannot be replayed automatically.`;
    default:
      return toolEvent.message ?? `Tool '${toolEvent.toolName}' finished with an uncertain replay outcome.`;
  }
}
