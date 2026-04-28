import type { PromptRuntimeInspectRequest } from "../../services/prompt-runtime/types.js";

import type { PromptRuntimePreviewRequest } from "../../services/chat/contracts.js";
import type { RespondRequest } from "../../services/chat/contracts.js";
import type { PromptRuntimeInspectBody } from "./schemas.js";
import {
  mapGenerationParams,
  mapLiveDebugOptionsRequest,
  mapPromptBudgetRequest,
  mapPromptDeliveryRequest,
  mapPromptSourceSelectionRequest,
  mapPromptStructureRequest,
  mapTurnSessionStateWritesRequest,
  mapDryRunVisibilityRequest,
} from "../chat/mappers.js";

interface PromptRuntimePreviewBody {
  text: string;
  branch_id?: string;
  source_floor_id?: string;
  visibility?: PromptRuntimeInspectBody["visibility"];
  structure?: PromptRuntimeInspectBody["structure"];
  delivery?: PromptRuntimeInspectBody["delivery"];
  budget?: PromptRuntimeInspectBody["budget"];
  source_selection?: PromptRuntimeInspectBody["source_selection"];
}

export function mapPromptRuntimeInspectBodyToCamelCase(
  body: PromptRuntimeInspectBody,
): PromptRuntimeInspectRequest {
  return {
    message: body.message,
    branchId: body.branch_id,
    sourceFloorId: body.source_floor_id,
    promptIntent: body.prompt_intent,
    config: body.config,
    generationParams: body.generation_params
      ? mapGenerationParams(body.generation_params)
      : undefined,
    sessionStateWrites: mapTurnSessionStateWritesRequest(body.session_state_writes),
    debugOptions: mapLiveDebugOptionsRequest(body.debug_options),
    visibility: mapDryRunVisibilityRequest(body.visibility),
    structure: mapPromptStructureRequest(body.structure),
    delivery: mapPromptDeliveryRequest(body.delivery),
    budget: mapPromptBudgetRequest(body.budget),
    sourceSelection: mapPromptSourceSelectionRequest(body.source_selection),
  };
}

export function mapPromptRuntimePreviewBodyToCamelCase(
  body: PromptRuntimePreviewBody,
): PromptRuntimePreviewRequest {
  return {
    text: body.text,
    branchId: body.branch_id,
    sourceFloorId: body.source_floor_id,
    visibility: mapDryRunVisibilityRequest(body.visibility),
    structure: mapPromptStructureRequest(body.structure),
    delivery: mapPromptDeliveryRequest(body.delivery),
    budget: mapPromptBudgetRequest(body.budget),
    sourceSelection: mapPromptSourceSelectionRequest(body.source_selection),
  };
}

export function mapPromptRuntimeLiveRequestBodyToCamelCase(
  body: PromptRuntimeInspectBody,
): RespondRequest {
  return {
    message: body.message,
    promptIntent: body.prompt_intent,
    config: body.config,
    generationParams: body.generation_params
      ? mapGenerationParams(body.generation_params)
      : undefined,
    branchId: body.branch_id,
    sourceFloorId: body.source_floor_id,
    structure: mapPromptStructureRequest(body.structure),
    delivery: mapPromptDeliveryRequest(body.delivery),
    sessionStateWrites: mapTurnSessionStateWritesRequest(body.session_state_writes),
    debugOptions: mapLiveDebugOptionsRequest(body.debug_options),
  };
}
