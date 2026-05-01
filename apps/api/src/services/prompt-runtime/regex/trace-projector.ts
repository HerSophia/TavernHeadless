import type {
  PromptRuntimeRegexPhaseId,
  PromptRuntimeRegexPhaseTrace,
  PromptRuntimeRegexSubstitutionMode,
  PromptRuntimeRegexTrace,
} from "../../prompt-assembler.js";

import { PROMPT_RUNTIME_REGEX_PHASE_ORDER } from "./phase-contract.js";

export function buildPromptRuntimeRegexTrace(args: {
  userInputRules?: string[];
  aiOutputRules?: string[];
  preprocessedUserMessage?: string;
  phases?: PromptRuntimeRegexPhaseTrace[];
  reservedPlacements?: number[];
  substitutionMode?: PromptRuntimeRegexSubstitutionMode | null;
}): PromptRuntimeRegexTrace | undefined {
  const userInputRules = args.userInputRules ?? [];
  const aiOutputRules = args.aiOutputRules ?? [];
  const phases = sortRegexPhases(args.phases ?? []);
  const reservedPlacements = sortNumericArray(args.reservedPlacements ?? []);

  if (
    userInputRules.length === 0
    && aiOutputRules.length === 0
    && phases.length === 0
    && reservedPlacements.length === 0
    && args.preprocessedUserMessage === undefined
    && !args.substitutionMode
  ) {
    return undefined;
  }

  return {
    userInputRules,
    aiOutputRules,
    ...(args.preprocessedUserMessage !== undefined
      ? { preprocessedUserMessage: args.preprocessedUserMessage }
      : {}),
    ...(phases.length > 0 ? { phases } : {}),
    ...(reservedPlacements.length > 0 ? { reservedPlacements } : {}),
    ...(args.substitutionMode ? { substitutionMode: args.substitutionMode } : {}),
  };
}

export function mergePromptRuntimeRegexTrace(
  ...traces: Array<PromptRuntimeRegexTrace | undefined>
): PromptRuntimeRegexTrace | undefined {
  const definedTraces = traces.filter((trace): trace is PromptRuntimeRegexTrace => trace !== undefined);
  if (definedTraces.length === 0) {
    return undefined;
  }

  const mergedPhases = sortRegexPhases(
    mergePhases(definedTraces.flatMap((trace) => trace.phases ?? [])),
  );
  const mergedReservedPlacements = sortNumericArray(
    definedTraces.flatMap((trace) => trace.reservedPlacements ?? []),
  );
  const substitutionMode = [...definedTraces]
    .reverse()
    .find((trace) => trace.substitutionMode !== undefined)?.substitutionMode;
  const preprocessedUserMessage = [...definedTraces]
    .reverse()
    .find((trace) => trace.preprocessedUserMessage !== undefined)?.preprocessedUserMessage;

  return buildPromptRuntimeRegexTrace({
    userInputRules: mergeStringArrays(definedTraces.flatMap((trace) => trace.userInputRules ?? [])),
    aiOutputRules: mergeStringArrays(definedTraces.flatMap((trace) => trace.aiOutputRules ?? [])),
    ...(preprocessedUserMessage !== undefined ? { preprocessedUserMessage } : {}),
    ...(mergedPhases.length > 0 ? { phases: mergedPhases } : {}),
    ...(mergedReservedPlacements.length > 0 ? { reservedPlacements: mergedReservedPlacements } : {}),
    ...(substitutionMode ? { substitutionMode } : {}),
  });
}

function mergePhases(
  phases: PromptRuntimeRegexPhaseTrace[],
): PromptRuntimeRegexPhaseTrace[] {
  const phaseMap = new Map<PromptRuntimeRegexPhaseId, PromptRuntimeRegexPhaseTrace>();
  for (const phase of phases) {
    phaseMap.set(phase.phaseId, phase);
  }

  return [...phaseMap.values()];
}

function sortRegexPhases(phases: PromptRuntimeRegexPhaseTrace[]): PromptRuntimeRegexPhaseTrace[] {
  const phaseOrder = new Map(
    PROMPT_RUNTIME_REGEX_PHASE_ORDER.map((phaseId, index) => [phaseId, index] satisfies [PromptRuntimeRegexPhaseId, number]),
  );

  return [...phases].sort((left, right) => {
    const leftOrder = phaseOrder.get(left.phaseId) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = phaseOrder.get(right.phaseId) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return left.phaseId.localeCompare(right.phaseId);
  });
}

function sortNumericArray(values: number[]): number[] {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

function mergeStringArrays(values: string[]): string[] {
  return Array.from(new Set(values));
}
