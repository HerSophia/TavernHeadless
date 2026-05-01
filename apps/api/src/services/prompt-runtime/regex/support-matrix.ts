import { REGEX_PLACEMENT, type STRegexScript } from "@tavern/adapters-sillytavern";

export interface PromptRuntimeRegexPlacementSupport {
  retained: boolean;
  executable: boolean;
  inspectable: boolean;
  snapshotWorthy: boolean;
  reserved: boolean;
}

export interface RegexCompatReport {
  stored_count: number;
  prompt_executable_count: number;
  persist_executable_count: number;
  display_only_count: number;
  retained_non_executable_count: number;
  reserved_world_info_count: number;
  unsupported_runtime_count: number;
  contains_prompt_only: number;
  contains_run_on_edit: number;
  contains_reasoning: number;
  contains_slash_command: number;
}

const PLACEMENT_SUPPORT: Record<number, PromptRuntimeRegexPlacementSupport> = {
  [REGEX_PLACEMENT.MD_DISPLAY]: {
    retained: true,
    executable: true,
    inspectable: false,
    snapshotWorthy: false,
    reserved: false,
  },
  [REGEX_PLACEMENT.USER_INPUT]: {
    retained: true,
    executable: true,
    inspectable: true,
    snapshotWorthy: true,
    reserved: false,
  },
  [REGEX_PLACEMENT.AI_OUTPUT]: {
    retained: true,
    executable: true,
    inspectable: true,
    snapshotWorthy: true,
    reserved: false,
  },
  [REGEX_PLACEMENT.SLASH_COMMAND]: {
    retained: true,
    executable: false,
    inspectable: false,
    snapshotWorthy: false,
    reserved: false,
  },
  [REGEX_PLACEMENT.WORLD_INFO]: {
    retained: true,
    executable: false,
    inspectable: true,
    snapshotWorthy: true,
    reserved: true,
  },
  [REGEX_PLACEMENT.REASONING]: {
    retained: true,
    executable: false,
    inspectable: false,
    snapshotWorthy: false,
    reserved: false,
  },
};

const PROMPT_PIPELINE_EXECUTABLE_PLACEMENTS = new Set<number>([
  REGEX_PLACEMENT.USER_INPUT,
  REGEX_PLACEMENT.AI_OUTPUT,
]);

const DISPLAY_EXECUTABLE_PLACEMENTS = new Set<number>([
  REGEX_PLACEMENT.MD_DISPLAY,
]);

const RESERVED_PLACEMENTS = new Set<number>([
  REGEX_PLACEMENT.WORLD_INFO,
]);

export function getRegexPlacementSupport(
  placement: number,
): PromptRuntimeRegexPlacementSupport | undefined {
  return PLACEMENT_SUPPORT[placement];
}

export function isRegexPlacementRetained(placement: number): boolean {
  return PLACEMENT_SUPPORT[placement]?.retained === true;
}

export function isRegexPlacementExecutable(placement: number): boolean {
  return PLACEMENT_SUPPORT[placement]?.executable === true;
}

export function isRegexPlacementInspectable(placement: number): boolean {
  return PLACEMENT_SUPPORT[placement]?.inspectable === true;
}

export function isRegexPlacementSnapshotWorthy(placement: number): boolean {
  return PLACEMENT_SUPPORT[placement]?.snapshotWorthy === true;
}

export function isRegexPlacementReserved(placement: number): boolean {
  return PLACEMENT_SUPPORT[placement]?.reserved === true;
}

export function resolveRegexRuleName(script: STRegexScript): string {
  const trimmedScriptName = script.scriptName.trim();
  if (trimmedScriptName.length > 0) {
    return trimmedScriptName;
  }

  const trimmedId = script.id.trim();
  return trimmedId.length > 0 ? trimmedId : "unnamed_regex_rule";
}

export function collectRegexRuleNames(
  scripts: STRegexScript[],
  placement: number,
): string[] {
  return scripts
    .filter((script) => !script.disabled && script.placement.includes(placement))
    .map((script) => resolveRegexRuleName(script));
}

export function listReservedRegexPlacements(scripts: STRegexScript[]): number[] {
  return Array.from(new Set(
    scripts.flatMap((script) => script.placement.filter((placement) => RESERVED_PLACEMENTS.has(placement))),
  )).sort((left, right) => left - right);
}

export function buildRegexCompatReport(scripts: STRegexScript[]): RegexCompatReport {
  const storedCount = scripts.length;
  const promptExecutableCount = scripts.filter((script) => hasPromptPipelineExecutablePlacement(script)).length;
  const persistExecutableCount = scripts.filter((script) => hasPersistExecutablePlacement(script)).length;
  const displayOnlyCount = scripts.filter((script) => isDisplayOnlyExecutableScript(script)).length;
  const retainedNonExecutableCount = scripts.filter((script) => hasRetainedNonExecutableOnlyPlacement(script)).length;
  const reservedWorldInfoCount = scripts.filter((script) => script.placement.includes(REGEX_PLACEMENT.WORLD_INFO)).length;
  const unsupportedRuntimeCount = scripts.filter((script) => hasUnsupportedRuntimeOnlyPlacement(script)).length;

  return {
    stored_count: storedCount,
    prompt_executable_count: promptExecutableCount,
    persist_executable_count: persistExecutableCount,
    display_only_count: displayOnlyCount,
    retained_non_executable_count: retainedNonExecutableCount,
    reserved_world_info_count: reservedWorldInfoCount,
    unsupported_runtime_count: unsupportedRuntimeCount,
    contains_prompt_only: scripts.filter((script) => script.promptOnly).length,
    contains_run_on_edit: scripts.filter((script) => script.runOnEdit).length,
    contains_reasoning: scripts.filter((script) => script.placement.includes(REGEX_PLACEMENT.REASONING)).length,
    contains_slash_command: scripts.filter((script) => script.placement.includes(REGEX_PLACEMENT.SLASH_COMMAND)).length,
  };
}

function hasPromptPipelineExecutablePlacement(script: STRegexScript): boolean {
  return !script.disabled
    && !script.markdownOnly
    && script.placement.some((placement) => PROMPT_PIPELINE_EXECUTABLE_PLACEMENTS.has(placement));
}

function hasPersistExecutablePlacement(script: STRegexScript): boolean {
  return hasPromptPipelineExecutablePlacement(script) && !script.promptOnly;
}

function isDisplayOnlyExecutableScript(script: STRegexScript): boolean {
  return !script.disabled
    && script.markdownOnly
    && !script.promptOnly
    && script.placement.some((placement) => DISPLAY_EXECUTABLE_PLACEMENTS.has(placement));
}

function hasRetainedNonExecutablePlacement(script: STRegexScript): boolean {
  return script.placement.some((placement) => isRegexPlacementRetained(placement) && !isRegexPlacementExecutable(placement));
}

function hasReservedPlacement(script: STRegexScript): boolean {
  return script.placement.some((placement) => RESERVED_PLACEMENTS.has(placement));
}

function hasUnknownPlacement(script: STRegexScript): boolean {
  return script.placement.some((placement) => PLACEMENT_SUPPORT[placement] === undefined);
}

function hasRetainedNonExecutableOnlyPlacement(script: STRegexScript): boolean {
  if (hasPromptPipelineExecutablePlacement(script) || isDisplayOnlyExecutableScript(script)) {
    return false;
  }

  return hasRetainedNonExecutablePlacement(script);
}

function hasUnsupportedRuntimeOnlyPlacement(script: STRegexScript): boolean {
  if (hasPromptPipelineExecutablePlacement(script) || isDisplayOnlyExecutableScript(script)) {
    return false;
  }

  if (hasUnknownPlacement(script)) {
    return true;
  }

  return hasRetainedNonExecutablePlacement(script) && !hasReservedPlacement(script);
}
