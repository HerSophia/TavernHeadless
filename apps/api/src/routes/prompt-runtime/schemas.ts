import { z } from "zod";

import type { PromptMode } from "../../services/prompt-assembler.js";
import { PROMPT_MODE_VALUES } from "../../services/prompt-assembler.js";
import type {
  DryRunVisibilityBody,
  GenerationParamsBody,
  LiveDebugOptionsBody,
  PromptBudgetBody,
  PromptDeliveryBody,
  PromptSourceSelectionBody,
  PromptStructureBody,
  TurnConfigBody,
  TurnSessionStateWriteDeleteBody,
  TurnSessionStateWriteValueBody,
} from "../chat/schemas.js";
import {
  dryRunVisibilityBodySchema,
  generationParamsBodySchema,
  liveDebugOptionsBodySchema,
  promptBudgetBodySchema,
  promptDeliveryBodySchema,
  promptSourceSelectionBodySchema,
  promptStructureBodySchema,
  turnConfigBodySchema,
  turnSessionStateWriteBodySchema,
} from "../chat/schemas.js";
import { promptIntentValues } from "../schemas/chat-schemas.js";

export type PromptRuntimeInspectBody = {
  message: string;
  branch_id?: string;
  source_floor_id?: string;
  prompt_intent?: (typeof promptIntentValues)[number];
  config?: TurnConfigBody;
  generation_params?: GenerationParamsBody;
  session_state_writes?: Array<TurnSessionStateWriteValueBody | TurnSessionStateWriteDeleteBody>;
  debug_options?: LiveDebugOptionsBody;
  visibility?: DryRunVisibilityBody;
  structure?: PromptStructureBody;
  delivery?: PromptDeliveryBody;
  budget?: PromptBudgetBody;
  source_selection?: PromptSourceSelectionBody;
};

export const promptRuntimeInspectBodySchema: z.ZodType<PromptRuntimeInspectBody> = z.object({
  message: z.string().min(1),
  branch_id: z.string().min(1).optional(),
  source_floor_id: z.string().min(1).optional(),
  prompt_intent: z.enum(promptIntentValues).optional(),
  config: turnConfigBodySchema.optional(),
  generation_params: generationParamsBodySchema.optional(),
  session_state_writes: z.array(turnSessionStateWriteBodySchema).optional(),
  debug_options: liveDebugOptionsBodySchema.optional(),
  visibility: dryRunVisibilityBodySchema.optional(),
  structure: promptStructureBodySchema.optional(),
  delivery: promptDeliveryBodySchema.optional(),
  budget: promptBudgetBodySchema.optional(),
  source_selection: promptSourceSelectionBodySchema.optional(),
}).strict();

export type PromptRuntimeModePatchBody = {
  prompt_mode: PromptMode | null;
};

export const promptRuntimeModePatchBodySchema: z.ZodType<PromptRuntimeModePatchBody> = z.object({
  prompt_mode: z.enum(PROMPT_MODE_VALUES).nullable(),
}).strict();
