import { z } from "zod";

import { buildZodObjectSchema } from "../schemas/json-schema-zod.js";
import { errorResponseJsonSchema, idParamsJsonSchema } from "../schemas/common.js";
import { SESSION_STATE_NAMESPACE_PATTERN } from "../../session-state/session-state-types.js";
import {
  generationParamsJsonSchema,
  sessionIdParamsJsonSchema,
  respondBodyJsonSchema,
  regenerateBodyJsonSchema,
  promptIntentValues,
  editAndRegenerateBodyJsonSchema,
  respondSuccessResponseJsonSchema,
  regenerateSuccessResponseJsonSchema,
  retryFloorBodyJsonSchema,
  editAndRegenerateSuccessResponseJsonSchema,
  dryRunSuccessResponseJsonSchema,
  dryRunBodyJsonSchema,
  streamResponseExample,
  liveDebugOptionsJsonSchema,
  promptDeliveryJsonSchema,
  promptStructureJsonSchema,
  promptBudgetJsonSchema,
  promptSourceSelectionJsonSchema,
  dryRunVisibilityJsonSchema,
  turnConfigJsonSchema,
} from "../schemas/chat-schemas.js";

export type TurnConfigBody = {
  enableTools?: boolean;
  enableDirector?: boolean;
  enableVerifier?: boolean;
  enableMemoryConsolidation?: boolean;
  verifierFailStrategy?: "warn" | "block" | "retry";
  toolMode?: "inline" | "standalone" | "both";
  maxRetries?: number;
};

export type GenerationParamsBody = {
  temperature?: number;
  max_output_tokens?: number;
  top_p?: number;
  top_k?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop_sequences?: string[];
  stream?: boolean;
  reasoning_effort?: "low" | "medium" | "high";
};

export type PromptDeliveryBody = {
  allow_assistant_prefill?: boolean;
  require_last_user?: boolean;
  no_assistant?: boolean;
};

export type PromptStructureBody = {
  mode: "default" | "strict_alternating" | "no_assistant" | "flattened";
  merge_adjacent_same_role?: boolean;
  assistant_rewrite_strategy?: "to_system" | "to_user_transcript";
  preserve_system_messages?: boolean;
};

export type PromptBudgetBody = {
  max_input_tokens?: number;
  reserved_completion_tokens?: number;
};

export type PromptSourceSelectionBody = {
  history?: {
    mode?: "full" | "windowed";
    max_messages?: number;
  };
  memory?: { enabled?: boolean };
  worldbook?: { enabled?: boolean };
  examples?: { enabled?: boolean };
};

export type LiveDebugOptionsBody = {
  include_prompt_snapshot?: boolean;
  include_runtime_trace?: boolean;
  include_worldbook_matches?: boolean;
};

export type DryRunDebugOptionsBody = {
  include_worldbook_matches?: boolean;
};

export type FloorVisibilityRangeBody = {
  start_floor_no: number;
  end_floor_no: number;
};

export type DryRunVisibilityBody = {
  hidden_floor_ranges?: FloorVisibilityRangeBody[];
  visible_floor_ranges?: FloorVisibilityRangeBody[];
  hidden_floor_ids?: string[];
  mode?: "allow_all_except_hidden" | "deny_all_except_visible";
};

export type TurnSessionStateWriteValueBody = {
  namespace: string;
  slot: string;
  value?: unknown;
};

export type TurnSessionStateWriteDeleteBody = {
  namespace: string;
  slot: string;
  delete: true;
};

export type RespondBody = {
  message: string;
  prompt_intent?: (typeof promptIntentValues)[number];
  delivery?: PromptDeliveryBody;
  structure?: PromptStructureBody;
  debug_options?: LiveDebugOptionsBody;
  config?: TurnConfigBody;
  generation_params?: GenerationParamsBody;
  branch_id?: string;
  source_floor_id?: string;
  session_state_writes?: Array<TurnSessionStateWriteValueBody | TurnSessionStateWriteDeleteBody>;
};

export type DryRunBody = {
  message: string;
  prompt_intent?: (typeof promptIntentValues)[number];
  debug_options?: DryRunDebugOptionsBody;
  visibility?: DryRunVisibilityBody;
  structure?: PromptStructureBody;
  delivery?: PromptDeliveryBody;
  budget?: PromptBudgetBody;
  source_selection?: PromptSourceSelectionBody;
};

export type RegenerateBody = {
  delivery?: PromptDeliveryBody;
  structure?: PromptStructureBody;
  debug_options?: LiveDebugOptionsBody;
  config?: TurnConfigBody;
  generation_params?: GenerationParamsBody;
  confirmed_execution_ids?: string[];
  confirmed_session_state_mutation_ids?: string[];
  session_state_writes?: Array<TurnSessionStateWriteValueBody | TurnSessionStateWriteDeleteBody>;
};

export type EditAndRegenerateBody = RegenerateBody & {
  content: string;
  branch_id?: string;
};

export type RetryFloorBody = RegenerateBody;

export const sessionIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const floorIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const messageIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const turnConfigBodySchema = buildZodObjectSchema<TurnConfigBody>(turnConfigJsonSchema);
export const generationParamsBodySchema = buildZodObjectSchema<GenerationParamsBody>(generationParamsJsonSchema);
export const promptDeliveryBodySchema = buildZodObjectSchema<PromptDeliveryBody>(promptDeliveryJsonSchema);
export const promptStructureBodySchema = buildZodObjectSchema<PromptStructureBody>(promptStructureJsonSchema);
export const promptBudgetBodySchema = buildZodObjectSchema<PromptBudgetBody>(promptBudgetJsonSchema);
export const promptSourceSelectionBodySchema = buildZodObjectSchema<PromptSourceSelectionBody>(promptSourceSelectionJsonSchema);
export const dryRunVisibilityBodySchema = buildZodObjectSchema<DryRunVisibilityBody>(dryRunVisibilityJsonSchema);
export const liveDebugOptionsBodySchema = buildZodObjectSchema<LiveDebugOptionsBody>(liveDebugOptionsJsonSchema);

const turnSessionStateWriteBaseSchema = {
  namespace: z.string().min(1).max(128).regex(SESSION_STATE_NAMESPACE_PATTERN),
  slot: z.string().min(1).max(256),
} as const;

const turnSessionStateWriteValueBodySchema = z.object({
  ...turnSessionStateWriteBaseSchema,
  value: z.unknown(),
}).strict();

const turnSessionStateWriteDeleteBodySchema = z.object({
  ...turnSessionStateWriteBaseSchema,
  delete: z.literal(true),
}).strict();

export const turnSessionStateWriteBodySchema: z.ZodType<TurnSessionStateWriteValueBody | TurnSessionStateWriteDeleteBody> = z.union([
  turnSessionStateWriteValueBodySchema,
  turnSessionStateWriteDeleteBodySchema,
]);

export const respondBodySchema: z.ZodType<RespondBody> = z.object({
  message: z.string().min(1),
  prompt_intent: z.enum(promptIntentValues).optional(),
  delivery: promptDeliveryBodySchema.optional(),
  structure: promptStructureBodySchema.optional(),
  debug_options: liveDebugOptionsBodySchema.optional(),
  config: turnConfigBodySchema.optional(),
  generation_params: generationParamsBodySchema.optional(),
  branch_id: z.string().min(1).optional(),
  source_floor_id: z.string().min(1).optional(),
  session_state_writes: z.array(turnSessionStateWriteBodySchema).optional(),
}).strict();

export const dryRunBodySchema = buildZodObjectSchema<DryRunBody>(dryRunBodyJsonSchema);

export const regenerateBodySchema: z.ZodType<RegenerateBody> = z.object({
  delivery: promptDeliveryBodySchema.optional(),
  structure: promptStructureBodySchema.optional(),
  debug_options: liveDebugOptionsBodySchema.optional(),
  config: turnConfigBodySchema.optional(),
  generation_params: generationParamsBodySchema.optional(),
  confirmed_execution_ids: z.array(z.string().min(1)).optional(),
  confirmed_session_state_mutation_ids: z.array(z.string().min(1)).optional(),
  session_state_writes: z.array(turnSessionStateWriteBodySchema).optional(),
}).strict();

export const editAndRegenerateBodySchema: z.ZodType<EditAndRegenerateBody> = (regenerateBodySchema as z.AnyZodObject).extend({
  content: z.string().min(1),
  branch_id: z.string().min(1).optional(),
}) as z.ZodType<EditAndRegenerateBody>;

export const retryFloorBodySchema: z.ZodType<RetryFloorBody> = regenerateBodySchema;

export const chatMutationErrorResponses = {
  400: errorResponseJsonSchema,
  404: errorResponseJsonSchema,
  499: errorResponseJsonSchema,
  409: errorResponseJsonSchema,
  500: errorResponseJsonSchema,
  503: errorResponseJsonSchema,
  504: errorResponseJsonSchema,
} as const;

export interface RegisterChatRoutesOptions {
  enableSseChat?: boolean;
  enablePromptDryRun?: boolean;
  enableClientData?: boolean;
  cors?: import("../../plugins/cors.js").CorsConfig;
  projectAccessService?: import("../../services/project-access-service.js").ProjectAccessService;
}

export {
  dryRunBodyJsonSchema,
  dryRunSuccessResponseJsonSchema,
  editAndRegenerateBodyJsonSchema,
  editAndRegenerateSuccessResponseJsonSchema,
  errorResponseJsonSchema,
  idParamsJsonSchema,
  regenerateBodyJsonSchema,
  regenerateSuccessResponseJsonSchema,
  respondBodyJsonSchema,
  respondSuccessResponseJsonSchema,
  retryFloorBodyJsonSchema,
  sessionIdParamsJsonSchema,
  streamResponseExample,
};