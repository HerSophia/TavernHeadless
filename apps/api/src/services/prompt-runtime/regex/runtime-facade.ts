import { createHash } from "node:crypto";

import type {
  PromptRuntimeRegexPhaseId,
  PromptRuntimeRegexPhaseTrace,
  PromptRuntimeRegexSubstitutionMode,
} from "../../prompt-assembler.js";
import {
  applyRegexScripts,
  type RegexContext,
  type STRegexScript,
} from "@tavern/adapters-sillytavern";

import { getPromptRuntimeRegexPhaseContract } from "./phase-contract.js";
import { collectRegexRuleNames, listReservedRegexPlacements, resolveRegexRuleName } from "./support-matrix.js";

export const PROMPT_RUNTIME_REGEX_SUBSTITUTION_MODE: PromptRuntimeRegexSubstitutionMode = "bare_variable_only";

export interface PromptRuntimeRegexSubstitutionContext {
  substituteFindParams?: RegexContext["substituteFindParams"];
  substituteReplaceParams?: RegexContext["substituteReplaceParams"];
}

export interface PromptRuntimeRegexPhaseRuntimeResult extends PromptRuntimeRegexPhaseTrace {
  text: string;
}

/**
 * Regex substitute 在本轮只承诺最小能力：`{{key}}` 形式的裸变量插值。
 *
 * 它不会执行 `evaluateStMacros(...)`，也不会解释 `getvar`、`if` 或路径读取语义。
 */
export function createRegexMacroSubstituter(variables: Record<string, unknown>) {
  return (text: string): string => text.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_match, key: string) => {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return "";
    }

    if (!Object.prototype.hasOwnProperty.call(variables, normalizedKey)) {
      return `{{${normalizedKey}}}`;
    }

    const value = variables[normalizedKey];
    if (value === null || value === undefined) {
      return "";
    }

    return String(value);
  });
}

export function buildRegexSubstitutionContext(
  variables: Record<string, unknown>,
): PromptRuntimeRegexSubstitutionContext {
  const substituter = createRegexMacroSubstituter(variables);

  return {
    substituteFindParams: substituter,
    substituteReplaceParams: substituter,
  };
}

export function executePromptRuntimeRegexPhase(args: {
  phaseId: PromptRuntimeRegexPhaseId;
  text?: string;
  scripts: STRegexScript[];
  depth?: number | null;
  substitutionContext?: PromptRuntimeRegexSubstitutionContext;
}): PromptRuntimeRegexPhaseRuntimeResult {
  const contract = getPromptRuntimeRegexPhaseContract(args.phaseId);
  const candidateRuleNames = collectRegexRuleNames(args.scripts, contract.placement);

  if (contract.reserved) {
    return {
      phaseId: contract.phaseId,
      placement: contract.placement,
      channel: contract.channel,
      status: "reserved",
      changed: false,
      depth: null,
      inputTextHash: null,
      outputTextHash: null,
      candidateRuleNames,
      matchedRuleNames: [],
      skippedRules: candidateRuleNames.map((ruleName) => ({
        ruleName,
        reason: "reserved_non_executable",
      })),
      text: args.text ?? "",
    };
  }

  const sourceText = args.text ?? "";
  const execution = executeRegexScriptsWithTrace(
    sourceText,
    args.scripts,
    contract.placement,
    {
      channel: contract.channel ?? undefined,
      ...(typeof args.depth === "number" ? { depth: args.depth } : {}),
      ...(args.substitutionContext?.substituteFindParams
        ? { substituteFindParams: args.substitutionContext.substituteFindParams }
        : {}),
      ...(args.substitutionContext?.substituteReplaceParams
        ? { substituteReplaceParams: args.substitutionContext.substituteReplaceParams }
        : {}),
    },
  );

  return {
    phaseId: contract.phaseId,
    placement: contract.placement,
    channel: contract.channel,
    status: "executed",
    changed: execution.text !== sourceText,
    depth: typeof args.depth === "number" ? args.depth : null,
    inputTextHash: hashRegexText(sourceText),
    outputTextHash: hashRegexText(execution.text),
    candidateRuleNames: execution.candidateRuleNames,
    matchedRuleNames: execution.matchedRuleNames,
    skippedRules: execution.skippedRules,
    text: execution.text,
  };
}

export function buildReservedWorldInfoRegexPhase(
  scripts: STRegexScript[],
): PromptRuntimeRegexPhaseRuntimeResult | undefined {
  const reservedPlacements = listReservedRegexPlacements(scripts);
  if (!reservedPlacements.includes(getPromptRuntimeRegexPhaseContract("prompt.world_info.reserved").placement)) {
    return undefined;
  }

  const reservedPhase = executePromptRuntimeRegexPhase({
    phaseId: "prompt.world_info.reserved",
    scripts,
  });

  return reservedPhase.candidateRuleNames.length > 0
    ? reservedPhase
    : undefined;
}

export function listRuntimeRegexReservedPlacements(scripts: STRegexScript[]): number[] {
  return listReservedRegexPlacements(scripts);
}

function hashRegexText(text: string | null | undefined): string | null {
  if (typeof text !== "string") {
    return null;
  }

  return createHash("sha256").update(text).digest("hex");
}

function executeRegexScriptsWithTrace(
  text: string,
  scripts: STRegexScript[],
  placement: number,
  context?: RegexContext,
): {
  text: string;
  candidateRuleNames: string[];
  matchedRuleNames: string[];
  skippedRules: Array<{ ruleName: string; reason: PromptRuntimeRegexPhaseTrace["skippedRules"][number]["reason"] }>;
} {
  let result = text;
  const candidateScripts = scripts.filter((script) => !script.disabled && script.placement.includes(placement));
  const candidateRuleNames = candidateScripts.map((script) => resolveRegexRuleName(script));
  const matchedRuleNames: string[] = [];
  const skippedRules: Array<{ ruleName: string; reason: PromptRuntimeRegexPhaseTrace["skippedRules"][number]["reason"] }> = [];

  for (const script of candidateScripts) {
    const ruleName = resolveRegexRuleName(script);

    if (isChannelFiltered(script, context?.channel)) {
      skippedRules.push({ ruleName, reason: "channel_filtered" });
      continue;
    }
    if (isDepthFiltered(script, context?.depth)) {
      skippedRules.push({ ruleName, reason: "depth_filtered" });
      continue;
    }
    if (!canParseRegexPattern(script.findRegex, script.substituteRegex, context?.substituteFindParams)) {
      skippedRules.push({ ruleName, reason: "invalid_regex" });
      continue;
    }

    const nextResult = applyRegexScripts(result, [script], placement, context);
    if (nextResult !== result) {
      matchedRuleNames.push(ruleName);
      result = nextResult;
      continue;
    }

    skippedRules.push({ ruleName, reason: "no_match" });
  }

  return { text: result, candidateRuleNames, matchedRuleNames, skippedRules };
}

function isChannelFiltered(
  script: STRegexScript,
  channel: RegexContext["channel"],
): boolean {
  if (channel === "display") {
    return !script.markdownOnly;
  }

  if (channel === "prompt") {
    return !script.promptOnly;
  }

  if (channel === "edit") {
    return script.markdownOnly || script.promptOnly || !script.runOnEdit;
  }

  return script.markdownOnly || script.promptOnly;
}

function isDepthFiltered(
  script: STRegexScript,
  depth: number | undefined,
): boolean {
  if (typeof depth !== "number" || Number.isNaN(depth)) {
    return false;
  }

  if (typeof script.minDepth === "number" && !Number.isNaN(script.minDepth) && script.minDepth >= -1 && depth < script.minDepth) {
    return true;
  }

  return typeof script.maxDepth === "number"
    && !Number.isNaN(script.maxDepth)
    && script.maxDepth >= 0
    && depth > script.maxDepth;
}

function canParseRegexPattern(
  findRegex: string,
  mode: number,
  substituteParams?: (text: string) => string,
): boolean {
  const processed = substituteRegexPattern(findRegex, mode, substituteParams);
  return parseRegexString(processed) !== null;
}

function substituteRegexPattern(findRegex: string, mode: number, substituteParams?: (text: string) => string): string {
  if (mode === 0 || !substituteParams) {
    return findRegex;
  }

  if (mode === 2) {
    return findRegex.replace(/\{\{[^}]+\}\}/g, (match) => {
      const replaced = substituteParams(match);
      return replaced.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    });
  }

  return substituteParams(findRegex);
}

function parseRegexString(regexStr: string): RegExp | null {
  if (!regexStr) {
    return null;
  }

  const match = regexStr.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
  if (match) {
    try {
      return new RegExp(match[1]!, match[2]);
    } catch {
      return null;
    }
  }

  try {
    return new RegExp(regexStr, "g");
  } catch {
    return null;
  }
}
