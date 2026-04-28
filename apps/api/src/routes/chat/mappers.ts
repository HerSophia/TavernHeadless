import type { FastifyReply } from "fastify";

import type { DryRunRequest, RespondRequest } from "../../services/chat/contracts.js";

import type {
  DryRunDebugOptionsBody,
  DryRunVisibilityBody,
  GenerationParamsBody,
  LiveDebugOptionsBody,
  PromptBudgetBody,
  PromptDeliveryBody,
  PromptSourceSelectionBody,
  PromptStructureBody,
  TurnSessionStateWriteDeleteBody,
  TurnSessionStateWriteValueBody,
} from "./schemas.js";
import { sendError } from "../../lib/http.js";

export function mapGenerationParams(
  params: GenerationParamsBody,
): RespondRequest["generationParams"] {
  return {
    temperature: params.temperature,
    maxOutputTokens: params.max_output_tokens,
    topP: params.top_p,
    topK: params.top_k,
    frequencyPenalty: params.frequency_penalty,
    presencePenalty: params.presence_penalty,
    stopSequences: params.stop_sequences,
    stream: params.stream,
    reasoningEffort: params.reasoning_effort,
  };
}

export function mapTurnSessionStateWritesRequest(
  writes: Array<TurnSessionStateWriteValueBody | TurnSessionStateWriteDeleteBody> | undefined,
): RespondRequest["sessionStateWrites"] {
  return writes?.map((write) => {
    if ("delete" in write && write.delete === true) {
      return {
        namespace: write.namespace as never,
        slot: write.slot,
        delete: true,
      };
    }
    return {
      namespace: write.namespace as never,
      slot: write.slot,
      value: "value" in write ? write.value : undefined,
    };
  });
}

export function ensureTurnSessionStateWritesEnabled(
  reply: FastifyReply,
  writes: Array<TurnSessionStateWriteValueBody | TurnSessionStateWriteDeleteBody> | undefined,
  enableClientData: boolean,
): boolean {
  if (writes === undefined || enableClientData) {
    return true;
  }
  sendError(reply, 503, "feature_unavailable", "Session state is unavailable because client-data is disabled");
  return false;
}

export function mapPromptStructureRequest(
  structure: PromptStructureBody | undefined,
): RespondRequest["structure"] {
  if (!structure) {
    return undefined;
  }

  return {
    mode: structure.mode,
    mergeAdjacentSameRole: structure.merge_adjacent_same_role,
    assistantRewriteStrategy: structure.assistant_rewrite_strategy,
    preserveSystemMessages: structure.preserve_system_messages,
  };
}

export function mapPromptDeliveryRequest(
  delivery: PromptDeliveryBody | undefined,
): RespondRequest["delivery"] {
  if (!delivery) {
    return undefined;
  }

  return {
    allowAssistantPrefill: delivery.allow_assistant_prefill,
    requireLastUser: delivery.require_last_user,
    noAssistant: delivery.no_assistant,
  };
}

export function mapPromptBudgetRequest(
  budget: PromptBudgetBody | undefined,
): DryRunRequest["budget"] {
  if (!budget) {
    return undefined;
  }

  return {
    ...(budget.max_input_tokens !== undefined ? { maxInputTokens: budget.max_input_tokens } : {}),
    ...(budget.reserved_completion_tokens !== undefined ? { reservedCompletionTokens: budget.reserved_completion_tokens } : {}),
  };
}

export function mapPromptSourceSelectionRequest(
  sourceSelection: PromptSourceSelectionBody | undefined,
): DryRunRequest["sourceSelection"] {
  if (!sourceSelection) {
    return undefined;
  }

  return {
    ...(sourceSelection.history ? { history: { ...(sourceSelection.history.mode !== undefined ? { mode: sourceSelection.history.mode } : {}), ...(sourceSelection.history.max_messages !== undefined ? { maxMessages: sourceSelection.history.max_messages } : {}) } } : {}),
    ...(sourceSelection.memory ? { memory: { ...(sourceSelection.memory.enabled !== undefined ? { enabled: sourceSelection.memory.enabled } : {}) } } : {}),
    ...(sourceSelection.worldbook ? { worldbook: { ...(sourceSelection.worldbook.enabled !== undefined ? { enabled: sourceSelection.worldbook.enabled } : {}) } } : {}),
    ...(sourceSelection.examples ? { examples: { ...(sourceSelection.examples.enabled !== undefined ? { enabled: sourceSelection.examples.enabled } : {}) } } : {}),
  };
}

export function mapLiveDebugOptionsRequest(
  debugOptions: LiveDebugOptionsBody | undefined,
): RespondRequest["debugOptions"] {
  if (!debugOptions) {
    return undefined;
  }

  const mapped = {
    ...(debugOptions.include_prompt_snapshot !== undefined
      ? { includePromptSnapshot: debugOptions.include_prompt_snapshot }
      : {}),
    ...(debugOptions.include_runtime_trace !== undefined
      ? { includeRuntimeTrace: debugOptions.include_runtime_trace }
      : {}),
    ...(debugOptions.include_worldbook_matches !== undefined
      ? { includeWorldbookMatches: debugOptions.include_worldbook_matches }
      : {}),
  };

  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

export function mapDryRunDebugOptionsRequest(
  debugOptions: DryRunDebugOptionsBody | undefined,
): DryRunRequest["debugOptions"] {
  if (!debugOptions) {
    return undefined;
  }

  return {
    includeWorldbookMatches: debugOptions.include_worldbook_matches,
  };
}

export function mapDryRunVisibilityRequest(
  visibility: DryRunVisibilityBody | undefined,
): DryRunRequest["visibility"] {
  if (!visibility) {
    return undefined;
  }

  return {
    hiddenFloorRanges: visibility.hidden_floor_ranges?.map((range) => ({
      startFloorNo: range.start_floor_no,
      endFloorNo: range.end_floor_no,
    })),
    visibleFloorRanges: visibility.visible_floor_ranges?.map((range) => ({
      startFloorNo: range.start_floor_no,
      endFloorNo: range.end_floor_no,
    })),
    hiddenFloorIds: visibility.hidden_floor_ids,
    mode: visibility.mode,
  };
}
