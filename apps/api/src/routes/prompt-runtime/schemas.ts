import { z } from "zod";

import type { PromptMode } from "../../services/prompt-assembler.js";
import { PROMPT_MODE_VALUES } from "../../services/prompt-assembler.js";
import type {
  DryRunVisibilityBody,
  GenerationParamsBody,
  LiveDebugOptionsBody,
  PromptBudgetBody,
  PromptDeliveryBody,
  PromptRuntimeInjectionPlacementParamsBody,
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
  promptRuntimeInjectionPlacementParamsBodySchema,
  promptSourceSelectionBodySchema,
  promptStructureBodySchema,
  turnConfigBodySchema,
  turnSessionStateWriteBodySchema,
} from "../chat/schemas.js";
import { promptIntentValues } from "../schemas/chat-schemas.js";

import type {
  PromptRuntimeClientInjectionInput,
} from "../../services/prompt-runtime-injection-types.js";
import type {
  PromptRuntimeInjectionPatchInput,
  PromptRuntimeInjectionWriteInput,
} from "../../services/prompt-runtime/injection-service.js";

export type PromptRuntimeInjectionBody = {
   source_kind: PromptRuntimeClientInjectionInput["sourceKind"];
  title: string;
  content: string;
  placement: string;
  placement_params?: PromptRuntimeInjectionPlacementParamsBody;
  order?: number;
  scope?: PromptRuntimeClientInjectionInput["scope"];
};

export type PromptRuntimePersistedInjectionCreateBody = {
  source_kind: PromptRuntimeInjectionWriteInput["sourceKind"];
  title: string;
  content: string;
  placement: string;
  placement_params?: PromptRuntimeInjectionPlacementParamsBody;
  order?: number;
  enabled?: boolean;
  mode_scope?: PromptMode | null;
  ttl_ms?: number | null;
};

export type PromptRuntimePersistedInjectionPatchBody = {
  source_kind?: PromptRuntimeInjectionPatchInput["sourceKind"];
  title?: string;
  content?: string;
  placement?: string;
  placement_params?: PromptRuntimeInjectionPlacementParamsBody | null;
  order?: number;
  enabled?: boolean;
  mode_scope?: PromptMode | null;
  ttl_ms?: number | null;
};

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
  prompt_runtime_injections?: PromptRuntimeInjectionBody[];
};

function validateTrimmedString(field: string) {
  return z.string().refine((value) => value.trim().length > 0, `${field} must not be empty after trimming`);
}

export const promptRuntimeInjectionBodySchema: z.ZodType<PromptRuntimeInjectionBody> = z.object({
  source_kind: z.literal("client_injection"),
  title: z.string(),
  content: z.string(),
  placement: z.string().min(1),
  placement_params: promptRuntimeInjectionPlacementParamsBodySchema.optional(),
  order: z.number().int().optional(),
  scope: z.literal("request").optional(),
}).strict();

export const promptRuntimePersistedInjectionCreateBodySchema: z.ZodType<PromptRuntimePersistedInjectionCreateBody> = z.object({
  source_kind: z.literal("client_injection"),
  title: validateTrimmedString("title"),
  content: validateTrimmedString("content"),
  placement: validateTrimmedString("placement"),
  placement_params: promptRuntimeInjectionPlacementParamsBodySchema.optional(),
  order: z.number().int().optional(),
  enabled: z.boolean().optional(),
  mode_scope: z.enum(PROMPT_MODE_VALUES).nullable().optional(),
  ttl_ms: z.number().int().nonnegative().nullable().optional(),
}).strict();

export const promptRuntimePersistedInjectionPatchBodySchema: z.ZodType<PromptRuntimePersistedInjectionPatchBody> = z.object({
  source_kind: z.literal("client_injection").optional(),
  title: validateTrimmedString("title").optional(),
  content:validateTrimmedString("content").optional(),
  placement: validateTrimmedString("placement").optional(),
  placement_params: promptRuntimeInjectionPlacementParamsBodySchema.nullable().optional(),
  order: z.number().int().optional(),
  enabled: z.boolean().optional(),
  mode_scope: z.enum(PROMPT_MODE_VALUES).nullable().optional(),
  ttl_ms: z.number().int().nonnegative().nullable().optional(),
}).strict().refine(
  (value) => Object.values(value).some((item) => item !== undefined),
  "At least one mutable field is required",
);

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
  prompt_runtime_injections: z.array(promptRuntimeInjectionBodySchema).optional(),
}).strict();

export type PromptRuntimeModePatchBody = {
  prompt_mode: PromptMode | null;
};

export const promptRuntimeModePatchBodySchema: z.ZodType<PromptRuntimeModePatchBody> = z.object({
  prompt_mode: z.enum(PROMPT_MODE_VALUES).nullable(),
}).strict();
