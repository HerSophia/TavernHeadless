export interface StMacroToken {
  type: "text" | "macro";
  raw: string;
  name?: string;
  args?: string[];
}

export interface StMacroScopedBlock {
  kind: "if";
  conditionRaw: string;
  thenContent: string;
  elseContent?: string;
  rawText: string;
}

export type StMacroPhase = "import" | "preview" | "dry_run" | "assemble" | "commit_consume";

export type StMacroWarningCode =
  | "macro_unknown"
  | "macro_value_missing"
  | "macro_parse_failed"
  | "macro_arg_arity_invalid"
  | "macro_arg_type_invalid"
  | "macro_condition_unsupported"
  | "macro_cycle_detected"
  | "macro_depth_limit_exceeded"
  | "macro_step_limit_exceeded"
  | "macro_expanded_length_limit_exceeded"
  | "macro_mutation_limit_exceeded"
  | "macro_unmatched_closing_block"
  | "macro_scoped_block_unclosed"
  | "macro_preview_side_effect_suppressed"
  | "macro_eval_phase_disallowed"
  | "macro_readonly_name_conflict"
  | "macro_internal_error";

export interface StMacroWarning {
  code: StMacroWarningCode;
  message: string;
  macroName?: string;
  rawText?: string;
}

export type StMacroJsonValue =
  | null
  | boolean
  | number
  | string
  | StMacroJsonValue[]
  | { [key: string]: StMacroJsonValue };

export interface StMacroMutationPreview {
  kind: "set" | "delete";
  scope: "branch" | "global";
  key: string;
  value?: unknown;
}

export interface StMacroStagedMutation extends StMacroMutationPreview {
  sourceMacro: string;
}

export interface StMacroTraceEntry {
  macroName: string;
  rawText: string;
  resolvedText: string;
  phase?: StMacroPhase;
  sourceKind?: "text" | "raw" | "macro" | "if";
  selectedBranch?: "then" | "else" | "raw";
}

export interface StMacroVariableSnapshot {
  local: Record<string, StMacroJsonValue>;
  global: Record<string, StMacroJsonValue>;
  plain: Record<string, string>;
}

export interface StMacroVariableOverlay {
  local: Record<string, StMacroJsonValue | undefined>;
  global: Record<string, StMacroJsonValue | undefined>;
}

export interface StMacroEvalResult {
  text: string;
  warnings: StMacroWarning[];
  usedMacros: string[];
  mutationPreview: StMacroMutationPreview[];
  stagedMutations: StMacroStagedMutation[];
  traces: StMacroTraceEntry[];
}

export interface StMacroRuntimeContext {
  phase: StMacroPhase;
  values: Record<string, string>;
  variableSnapshot?: StMacroVariableSnapshot;
  maxDepth?: number;
  maxSteps?: number;
  maxExpandedLength?: number;
  maxMutationCount?: number;
}
