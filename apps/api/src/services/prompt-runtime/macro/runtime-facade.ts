import { evaluateStMacros, type StMacroEvalResult, type StMacroVariableSnapshot } from "../../st-macros/index.js";

const DEFAULT_MACRO_MAX_DEPTH = 24;
const DEFAULT_MACRO_MAX_STEPS = 256;
const DEFAULT_MACRO_MAX_EXPANDED_LENGTH = 32_768;
const DEFAULT_MACRO_MAX_MUTATION_COUNT = 64;

export function evaluatePromptMacroValues(args: {
  phase: "preview" | "dry_run" | "assemble" | "commit_consume";
  values: Record<string, string>;
  variableSnapshot?: StMacroVariableSnapshot;
  sampleText: string;
}): StMacroEvalResult {
  return evaluateStMacros(args.sampleText, {
    phase: args.phase,
    values: args.values,
    variableSnapshot: args.variableSnapshot,
    maxDepth: DEFAULT_MACRO_MAX_DEPTH,
    maxSteps: DEFAULT_MACRO_MAX_STEPS,
    maxExpandedLength: DEFAULT_MACRO_MAX_EXPANDED_LENGTH,
    maxMutationCount: DEFAULT_MACRO_MAX_MUTATION_COUNT,
  });
}
