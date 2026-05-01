import type {
  StMacroMutationPreview,
  StMacroStagedMutation,
  StMacroTraceEntry,
  StMacroWarning,
} from "../../st-macros/index.js";
import { stringifyStMacroValue } from "../../st-macros/variable-path.js";
import type { PromptRuntimeMacroTrace } from "../../prompt-assembler.js";

export function buildPromptRuntimeMacroTrace(args: {
  warnings?: StMacroWarning[];
  usedNames?: string[];
  mutationPreview?: StMacroMutationPreview[];
  stagedMutations?: StMacroStagedMutation[];
  traces?: StMacroTraceEntry[];
}): PromptRuntimeMacroTrace | undefined {
  const warnings = args.warnings ?? [];
  const usedNames = args.usedNames ?? [];
  const mutationPreview = args.mutationPreview ?? [];
  const stagedMutations = args.stagedMutations ?? [];
  const traces = args.traces ?? [];

  if (
    warnings.length === 0
    && usedNames.length === 0
    && mutationPreview.length === 0
    && stagedMutations.length === 0
    && traces.length === 0
  ) {
    return undefined;
  }

  return {
    warnings: warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
      ...(warning.macroName ? { macroName: warning.macroName } : {}),
      ...(warning.rawText ? { rawText: warning.rawText } : {}),
    })),
    usedNames,
    mutationPreview: mutationPreview.map((item) => ({
      kind: item.kind,
      scope: item.scope,
      key: item.key,
      ...(item.value !== undefined ? { value: stringifyPromptVariableValue(item.value) } : {}),
    })),
    stagedMutations: stagedMutations.map((item) => ({
      kind: item.kind,
      scope: item.scope,
      key: item.key,
      ...(item.value !== undefined ? { value: stringifyPromptVariableValue(item.value) } : {}),
      sourceMacro: item.sourceMacro,
    })),
    traces: traces.map((trace) => ({
      macroName: trace.macroName,
      rawText: trace.rawText,
      resolvedText: trace.resolvedText,
      ...(trace.phase ? { phase: trace.phase } : {}),
      ...(trace.sourceKind ? { sourceKind: trace.sourceKind } : {}),
      ...(trace.selectedBranch ? { selectedBranch: trace.selectedBranch } : {}),
    })),
  };
}

function stringifyPromptVariableValue(value: unknown): string {
  return stringifyStMacroValue(value as import("../../st-macros/index.js").StMacroJsonValue);
}
