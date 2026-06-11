export const PROMPT_RUNTIME_INJECTION_PLACEMENTS = [
  "before_system_prompt",
  "after_system_prompt",
  "before_character",
  "after_character",
  "before_persona",
  "after_persona",
  "before_worldbook",
  "after_worldbook",
  "before_memory",
  "after_memory",
  "before_examples",
  "after_examples",
  "before_history",
  "after_history",
  "before_current_user_input",
  "after_current_user_input",
  "before_output_instruction",
  "before_assistant_prefill",
] as const;

export type PromptRuntimeInjectionPlacement =
  typeof PROMPT_RUNTIME_INJECTION_PLACEMENTS[number];

export type PromptRuntimeInjectionPromptMode =
  | "compat_strict"
  | "compat_plus"
  | "native";

export type PromptRuntimeInjectionScope = "request" | "session" | "branch";

export type PromptRuntimeInjectionNotAppliedReason =
  | "placement_not_available_in_mode"
  | "unknown_placement"
  | "empty_title_or_content"
  | "prompt_section_absent"
  | "disabled"
  | "expired"
  | "mode_scope_mismatch";

export interface PromptRuntimeClientInjectionInput {
  sourceKind: "client_injection";
  title: string;
  content: string;
  placement: string;
  order?: number;
  scope?: Extract<PromptRuntimeInjectionScope, "request">;
}

export interface PromptRuntimeInjectionBuilderInput {
  sourceKind: string;
  title: string;
  content: string;
  placement: string;
  order?: number;
  scope?: PromptRuntimeInjectionScope;
  injectionId?: string;
  enabled?: boolean;
  modeScope?: PromptRuntimeInjectionPromptMode | null;
  ttlMs?: number | null;
  createdAt?: number;
}

export interface PromptRuntimeInjectionPlacementResolverInput {
  placement: string;
  promptMode: PromptRuntimeInjectionPromptMode;
}

export interface PromptRuntimeInjectionPlacementResolverOutput {
  resolved: boolean;
  reason?: Extract<
    PromptRuntimeInjectionNotAppliedReason,
    "placement_not_available_in_mode" | "unknown_placement"
  >;
  internalKey?: string;
}

export interface PromptRuntimeInjectionTraceItem {
  requestIndex: number;
  sourceKind: string;
  injectionId?: string;
  enabled?: boolean;
  scope: PromptRuntimeInjectionScope;
  placementRequested: string;
  orderRequested: number;
  title: string;
  contentLength: number;
  applied: boolean;
  notAppliedReason?: PromptRuntimeInjectionNotAppliedReason;
  placementResolved?: string;
}

export interface PromptRuntimeInjectionTrace {
  items: PromptRuntimeInjectionTraceItem[];
}

export interface PromptRuntimeAssemblyContributor {
  sourceKind: string;
  title: string;
  content: string;
  internalPlacementKey?: string;
  requestIndex?: number;
  requestedPlacement?: string;
  requestedOrder?: number;
  scope?: PromptRuntimeInjectionScope;
}

export interface PromptRuntimeInjectionBuildResult {
  renderables: PromptRuntimeAssemblyContributor[];
  items: PromptRuntimeInjectionTraceItem[];
}
