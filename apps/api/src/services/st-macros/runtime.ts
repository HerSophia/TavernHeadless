import type {
  StMacroEvalResult,
  StMacroMutationPreview,
  StMacroRuntimeContext,
  StMacroScopedBlock,
  StMacroStagedMutation,
  StMacroToken,
  StMacroTraceEntry,
  StMacroVariableOverlay,
  StMacroVariableSnapshot,
  StMacroWarning,
} from "./types.js";

interface StMacroTextNode {
  kind: "text";
  rawText: string;
}

interface StMacroNodeArgument {
  rawText: string;
  nodes: StMacroNode[];
}

interface StMacroRawNode {
  kind: "raw";
  rawText: string;
}

interface StMacroCallNode {
  kind: "macro";
  rawText: string;
  name: string;
  args: StMacroNodeArgument[];
}

interface StMacroIfNode {
  kind: "if";
  rawText: string;
  conditionRaw: string;
  conditionNodes: StMacroNode[];
  thenNodes: StMacroNode[];
  elseNodes: StMacroNode[];
}

type StMacroNode = StMacroTextNode | StMacroRawNode | StMacroCallNode | StMacroIfNode;

const LEGACY_ALIAS_MAP: Record<string, string> = {
  "<USER>": "{{user}}",
  "<BOT>": "{{char}}",
  "<CHAR>": "{{char}}",
  "<GROUP>": "",
  "<CHARIFNOTGROUP>": "{{char}}",
};

function normalizeLegacyAliases(input: string): string {
  let result = input;
  for (const [legacy, replacement] of Object.entries(LEGACY_ALIAS_MAP)) {
    result = result.replaceAll(legacy, replacement);
  }
  return result;
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function splitArgs(rawInner: string): { name: string; args: string[] } {
  const normalized = rawInner.trim();
  const doubleColonIndex = normalized.indexOf("::");
  if (doubleColonIndex >= 0) {
    return {
      name: normalized.slice(0, doubleColonIndex).trim(),
      args: normalized.slice(doubleColonIndex + 2).split("::").map((item) => item.trim()),
    };
  }

  const parts = normalized.split(/\s+/).filter((item) => item.length > 0);
  return {
    name: parts[0] ?? "",
    args: parts.slice(1),
  };
}

function tokenizeMacros(input: string): StMacroToken[] {
  const tokens: StMacroToken[] = [];
  const regex = /\{\{([\s\S]*?)\}\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", raw: input.slice(lastIndex, match.index) });
    }

    const raw = match[0];
    const rawInner = match[1] ?? "";
    const { name, args } = splitArgs(rawInner);
    tokens.push({ type: "macro", raw, name, args });
    lastIndex = match.index + raw.length;
  }

  if (lastIndex < input.length) {
    tokens.push({ type: "text", raw: input.slice(lastIndex) });
  }

  return tokens;
}

function findScopedIfStart(input: string): number {
  return input.search(/\{\{\s*if\b/i);
}

function tryParseIfBlock(input: string): StMacroScopedBlock | null {
  const startIndex = findScopedIfStart(input);
  if (startIndex < 0) {
    return null;
  }

  const sliced = input.slice(startIndex);
  if (!sliced.startsWith("{{")) {
    return null;
  }

  let startLength = -1;
  let conditionRaw = "";
  let nestedMacroDepth = 0;
  for (let index = 0; index < sliced.length - 1; index += 1) {
    const pair = sliced.slice(index, index + 2);
    if (pair === "{{") {
      nestedMacroDepth += 1;
      index += 1;
      continue;
    }
    if (pair === "}}") {
      nestedMacroDepth -= 1;
      index += 1;
      if (nestedMacroDepth === 0) {
        const header = sliced.slice(0, index + 1);
        const inner = header.slice(2, -2).trim();
        if (!/^if\b/i.test(inner)) {
          return null;
        }
        conditionRaw = inner.replace(/^if\b/i, "").trim();
        startLength = index + 1;
        break;
      }
    }
  }

  if (startLength < 0) {
    return null;
  }
  let depth = 1;
  let index = startLength;
  let elseIndex = -1;
  let elseCloseIndex = -1;

  while (index < sliced.length) {
    const openIndex = sliced.indexOf("{{", index);
    if (openIndex < 0) {
      return null;
    }
    const closeIndex = sliced.indexOf("}}", openIndex + 2);
    if (closeIndex < 0) {
      return null;
    }

    const inner = sliced.slice(openIndex + 2, closeIndex).trim();
    if (/^if\b/i.test(inner)) {
      depth += 1;
    } else if (/^\/if\b/i.test(inner)) {
      depth -= 1;
      if (depth === 0) {
        const thenContent = elseIndex >= 0
          ? sliced.slice(startLength, elseIndex)
          : sliced.slice(startLength, openIndex);
        const elseContent = elseIndex >= 0 && elseCloseIndex >= 0
          ? sliced.slice(elseCloseIndex + 2, openIndex)
          : undefined;
        return {
          kind: "if",
          conditionRaw,
          thenContent,
          elseContent,
          rawText: sliced.slice(0, closeIndex + 2),
        };
      }
    } else if (/^else\b/i.test(inner) && depth === 1 && elseIndex < 0) {
      elseIndex = openIndex;
      elseCloseIndex = closeIndex;
    }

    index = closeIndex + 2;
  }

  return null;
}

function hasUnclosedIfBlock(source: string): boolean {
  return source.includes("{{if") && !source.includes("{{/if}}");
}

function hasUnmatchedClosingIfBlock(source: string): boolean {
  return source.includes("{{/if}}") && !source.includes("{{if");
}

function parseMacroNodes(source: string): StMacroNode[] {
  const scopedIf = tryParseIfBlock(source);
  if (scopedIf) {
    const blockStartIndex = source.indexOf(scopedIf.rawText);
    const prefix = source.slice(0, blockStartIndex);
    const suffix = source.slice(blockStartIndex + scopedIf.rawText.length);
    const nodes: StMacroNode[] = [];

    if (prefix.length > 0) {
      nodes.push(...parseMacroNodes(prefix));
    }

    nodes.push({
      kind: "if",
      rawText: scopedIf.rawText,
      conditionRaw: scopedIf.conditionRaw,
      conditionNodes: parseMacroNodes(scopedIf.conditionRaw),
      thenNodes: parseMacroNodes(scopedIf.thenContent),
      elseNodes: parseMacroNodes(scopedIf.elseContent ?? ""),
    });

    if (suffix.length > 0) {
      nodes.push(...parseMacroNodes(suffix));
    }

    return nodes;
  }

  if (hasUnclosedIfBlock(source) || hasUnmatchedClosingIfBlock(source)) {
    return [{ kind: "raw", rawText: source }];
  }

  return tokenizeMacros(source).map((token) => {
    if (token.type === "text") {
      return {
        kind: "text",
        rawText: token.raw,
      } satisfies StMacroTextNode;
    }

    const name = token.name?.trim() ?? "";
    if (!name) {
      return {
        kind: "raw",
        rawText: token.raw,
      } satisfies StMacroRawNode;
    }

    return {
      kind: "macro",
      rawText: token.raw,
      name,
      args: (token.args ?? []).map((arg) => ({
        rawText: arg,
        nodes: parseMacroNodes(arg),
      })),
    } satisfies StMacroCallNode;
  });
}

function isTruthy(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return normalized !== "false" && normalized !== "0" && normalized !== "off";
}

function normalizeComparisonOperand(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function detectUnsupportedIfCondition(conditionValue: string): string | null {
  const trimmed = conditionValue.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const unsupportedOperator = trimmed.match(/(>=|<=|>|<|\band\b|\bor\b|\bnot\b|\bcontains\b|\bstartsWith\b)/i);
  return unsupportedOperator?.[0] ?? null;
}

function evaluateIfCondition(conditionValue: string): { supported: boolean; result: boolean } {
  const unsupported = detectUnsupportedIfCondition(conditionValue);
  if (unsupported) {
    return { supported: false, result: false };
  }

  const operatorMatch = conditionValue.match(/^(.*?)(==|!=)(.*)$/s);
  if (!operatorMatch) {
    return { supported: true, result: isTruthy(conditionValue) };
  }

  const [, leftRaw = "", operator = "", rightRaw = ""] = operatorMatch;
  const left = normalizeComparisonOperand(leftRaw);
  const right = normalizeComparisonOperand(rightRaw);
  return {
    supported: true,
    result: operator === "==" ? left === right : left !== right,
  };
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stringifyNumber(value: number): string {
  return String(value);
}

function createVariableSnapshot(values: Record<string, string>, variableSnapshot?: StMacroVariableSnapshot): StMacroVariableSnapshot {
  return variableSnapshot ?? {
    local: { ...values },
    global: { ...values },
    plain: { ...values },
  };
}

function createVariableOverlay(): StMacroVariableOverlay {
  return {
    local: {},
    global: {},
  };
}

function hasOwnValue(target: Record<string, string | undefined>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function readScopedVariable(
  snapshot: Record<string, string>,
  overlay: Record<string, string | undefined>,
  key: string,
): string {
  if (hasOwnValue(overlay, key)) {
    return overlay[key] ?? "";
  }
  return snapshot[key] ?? "";
}

function hasScopedVariable(
  snapshot: Record<string, string>,
  overlay: Record<string, string | undefined>,
  key: string,
): boolean {
  if (hasOwnValue(overlay, key)) {
    return overlay[key] !== undefined;
  }
  return Object.prototype.hasOwnProperty.call(snapshot, key);
}

function writeScopedVariable(
  overlay: Record<string, string | undefined>,
  key: string,
  value: string,
): void {
  overlay[key] = value;
}

function deleteScopedVariable(
  overlay: Record<string, string | undefined>,
  key: string,
): void {
  overlay[key] = undefined;
}

function resolveNamedMacro(
  macroName: string,
  args: string[],
  values: Record<string, string>,
  variableSnapshot: StMacroVariableSnapshot,
  variableOverlay: StMacroVariableOverlay,
): string | undefined {
  if (args.length === 0) {
    const directValue = values[macroName];
    if (directValue === `{{${macroName}}}`) {
      return undefined;
    }
    return directValue;
  }

  if (macroName === "getvar" && args.length === 1) {
    return readScopedVariable(variableSnapshot.local, variableOverlay.local, args[0] ?? "");
  }

  if (macroName === "getglobalvar" && args.length === 1) {
    return readScopedVariable(variableSnapshot.global, variableOverlay.global, args[0] ?? "");
  }

  if (macroName === "hasvar" && args.length === 1) {
    return hasScopedVariable(variableSnapshot.local, variableOverlay.local, args[0] ?? "") ? "true" : "false";
  }

  if (macroName === "hasglobalvar" && args.length === 1) {
    return hasScopedVariable(variableSnapshot.global, variableOverlay.global, args[0] ?? "") ? "true" : "false";
  }

  return undefined;
}

function resolveShorthandVariable(
  macroName: string,
  variableSnapshot: StMacroVariableSnapshot,
  variableOverlay: StMacroVariableOverlay,
): string | undefined {
  if (macroName.startsWith(".")) {
    return readScopedVariable(variableSnapshot.local, variableOverlay.local, macroName.slice(1));
  }

  if (macroName.startsWith("$")) {
    return readScopedVariable(variableSnapshot.global, variableOverlay.global, macroName.slice(1));
  }

  return undefined;
}

function createPreviewWarning(name: string): StMacroWarning {
  return {
    code: "macro_preview_side_effect_suppressed",
    message: `Macro ${name} side effect was previewed but not committed.`,
    macroName: name,
  };
}

function createDisallowedWarning(name: string, phase: StMacroRuntimeContext["phase"]): StMacroWarning {
  return {
    code: "macro_eval_phase_disallowed",
    message: `Macro ${name} is not allowed in phase ${phase}.`,
    macroName: name,
  };
}

function resolveWriteMacro(
  macroName: string,
  args: string[],
  variableSnapshot: StMacroVariableSnapshot,
  variableOverlay: StMacroVariableOverlay,
  phase: StMacroRuntimeContext["phase"],
): {
  text: string;
  preview: StMacroMutationPreview | null;
  staged: StMacroStagedMutation | null;
  warning?: StMacroWarning;
} | null {
  const previewPhase = phase === "preview" || phase === "dry_run" || phase === "assemble";

  const ensureWritable = (name: string): StMacroWarning | undefined => {
    if (previewPhase) {
      return undefined;
    }
    return createDisallowedWarning(name, phase);
  };

  const buildMutation = (
    kind: "set" | "delete",
    scope: "branch" | "global",
    key: string,
    value?: string,
  ): { preview: StMacroMutationPreview; staged: StMacroStagedMutation } => ({
    preview: kind === "set"
      ? { kind, scope, key, value }
      : { kind, scope, key },
    staged: kind === "set"
      ? { kind, scope, key, value, sourceMacro: macroName }
      : { kind, scope, key, sourceMacro: macroName },
  });

  const scopeTarget = (isGlobal: boolean) => isGlobal
    ? { scope: "global" as const, snapshot: variableSnapshot.global, overlay: variableOverlay.global }
    : { scope: "branch" as const, snapshot: variableSnapshot.local, overlay: variableOverlay.local };

  if ((macroName === "setvar" || macroName === "setglobalvar") && args.length === 2) {
    const blocked = ensureWritable(macroName);
    const target = scopeTarget(macroName === "setglobalvar");
    const key = args[0] ?? "";
    const value = args[1] ?? "";
    if (blocked) return { text: "", preview: null, staged: null, warning: blocked };
    writeScopedVariable(target.overlay, key, value);
    const mutation = buildMutation("set", target.scope, key, value);
    return {
      text: "",
      preview: mutation.preview,
      staged: mutation.staged,
      warning: previewPhase ? createPreviewWarning(macroName) : undefined,
    };
  }

  if ((macroName === "addvar" || macroName === "addglobalvar") && args.length === 2) {
    const blocked = ensureWritable(macroName);
    const target = scopeTarget(macroName === "addglobalvar");
    const key = args[0] ?? "";
    const addValue = args[1] ?? "";
    if (blocked) return { text: "", preview: null, staged: null, warning: blocked };
    const current = readScopedVariable(target.snapshot, target.overlay, key) || "0";
    const next = Number.isFinite(Number(current)) && Number.isFinite(Number(addValue))
      ? stringifyNumber(parseNumber(current) + parseNumber(addValue))
      : `${current}${addValue}`;
    writeScopedVariable(target.overlay, key, next);
    const mutation = buildMutation("set", target.scope, key, next);
    return {
      text: "",
      preview: mutation.preview,
      staged: mutation.staged,
      warning: previewPhase ? createPreviewWarning(macroName) : undefined,
    };
  }

  if ((macroName === "incvar" || macroName === "incglobalvar") && args.length === 1) {
    const blocked = ensureWritable(macroName);
    const target = scopeTarget(macroName === "incglobalvar");
    const key = args[0] ?? "";
    if (blocked) return { text: "", preview: null, staged: null, warning: blocked };
    const next = stringifyNumber(parseNumber(readScopedVariable(target.snapshot, target.overlay, key) || "0") + 1);
    writeScopedVariable(target.overlay, key, next);
    const mutation = buildMutation("set", target.scope, key, next);
    return {
      text: next,
      preview: mutation.preview,
      staged: mutation.staged,
      warning: previewPhase ? createPreviewWarning(macroName) : undefined,
    };
  }

  if ((macroName === "decvar" || macroName === "decglobalvar") && args.length === 1) {
    const blocked = ensureWritable(macroName);
    const target = scopeTarget(macroName === "decglobalvar");
    const key = args[0] ?? "";
    if (blocked) return { text: "", preview: null, staged: null, warning: blocked };
    const next = stringifyNumber(parseNumber(readScopedVariable(target.snapshot, target.overlay, key) || "0") - 1);
    writeScopedVariable(target.overlay, key, next);
    const mutation = buildMutation("set", target.scope, key, next);
    return {
      text: next,
      preview: mutation.preview,
      staged: mutation.staged,
      warning: previewPhase ? createPreviewWarning(macroName) : undefined,
    };
  }

  if ((macroName === "deletevar" || macroName === "deleteglobalvar") && args.length === 1) {
    const blocked = ensureWritable(macroName);
    const target = scopeTarget(macroName === "deleteglobalvar");
    const key = args[0] ?? "";
    if (blocked) return { text: "", preview: null, staged: null, warning: blocked };
    deleteScopedVariable(target.overlay, key);
    const mutation = buildMutation("delete", target.scope, key);
    return {
      text: "",
      preview: mutation.preview,
      staged: mutation.staged,
      warning: previewPhase ? createPreviewWarning(macroName) : undefined,
    };
  }

  return null;
}

export function evaluateStMacros(input: string, context: StMacroRuntimeContext): StMacroEvalResult {
  const warnings: StMacroWarning[] = [];
  const usedMacros: string[] = [];
  const traces: StMacroTraceEntry[] = [];
  const mutationPreview: StMacroMutationPreview[] = [];
  const stagedMutations: StMacroStagedMutation[] = [];
  const normalizedInput = normalizeLegacyAliases(input);
  const maxDepth = context.maxDepth ?? 16;
  const maxSteps = context.maxSteps ?? 256;
  const maxExpandedLength = context.maxExpandedLength ?? 32_768;
  const maxMutationCount = context.maxMutationCount ?? 128;
  const variableSnapshot = createVariableSnapshot(context.values, context.variableSnapshot);
  const variableOverlay = createVariableOverlay();
  const mutableValues = { ...context.values };
  let stepCount = 0;
  let lengthLimitReached = false;
  let mutationLimitReached = false;
  let writeMutationCount = 0;
  const evaluationStack: string[] = [];

  const createLimitedText = (text: string): string => {
    if (text.length <= maxExpandedLength) {
      return text;
    }

    if (!lengthLimitReached) {
      warnings.push({
        code: "macro_expanded_length_limit_exceeded",
        message: `Macro expanded text length exceeded limit ${maxExpandedLength}.`,
      });
      lengthLimitReached = true;
    }

    return text.slice(0, maxExpandedLength);
  };

  const recordStep = (): boolean => {
    stepCount += 1;
    if (stepCount > maxSteps) {
      warnings.push({
        code: "macro_step_limit_exceeded",
        message: `Macro evaluation steps exceeded limit ${maxSteps}.`,
      });
      return false;
    }

    return true;
  };

  const canRecordMutation = (): boolean => {
    if (writeMutationCount < maxMutationCount) {
      return true;
    }

    if (!mutationLimitReached) {
      warnings.push({
        code: "macro_mutation_limit_exceeded",
        message: `Macro write mutation budget exceeded limit ${maxMutationCount}.`,
      });
      mutationLimitReached = true;
    }

    return false;
  };

  const pushTrace = (entry: StMacroTraceEntry): void => {
    traces.push({
      phase: context.phase,
      ...entry,
    });
  };

  const enterEvaluation = (rawText: string, macroName: string): boolean => {
    if (evaluationStack.includes(rawText)) {
      warnings.push({
        code: "macro_cycle_detected",
        message: `Macro ${macroName} expansion entered a repeated evaluation path.`,
        macroName,
        rawText,
      });
      pushTrace({
        macroName,
        rawText,
        resolvedText: rawText,
        sourceKind: macroName === "if" ? "if" : "macro",
        selectedBranch: "raw",
      });
      return false;
    }

    evaluationStack.push(rawText);
    return true;
  };

  const leaveEvaluation = (rawText: string): void => {
    const stackIndex = evaluationStack.lastIndexOf(rawText);
    if (stackIndex >= 0) {
      evaluationStack.splice(stackIndex, 1);
    }
  };

  if (context.phase === "import") {
    return {
      text: normalizedInput,
      warnings: [
        {
          code: "macro_eval_phase_disallowed",
          message: "Macro evaluation is disabled during import phase.",
        },
      ],
      usedMacros,
      mutationPreview,
      stagedMutations,
      traces,
    };
  }

  const warnRawNode = (rawText: string): void => {
    if (hasUnclosedIfBlock(rawText)) {
      warnings.push({
        code: "macro_scoped_block_unclosed",
        message: "Found scoped block without closing macro.",
        rawText: "{{if}}",
      });
    }

    if (hasUnmatchedClosingIfBlock(rawText)) {
      warnings.push({
        code: "macro_unmatched_closing_block",
        message: "Found unmatched closing block macro.",
        rawText: "{{/if}}",
      });
    }
  };

  const evaluateNodes = (nodes: StMacroNode[], depth: number): string => {
    if (depth > maxDepth) {
      warnings.push({
        code: "macro_depth_limit_exceeded",
        message: `Macro evaluation depth exceeded limit ${maxDepth}.`,
      });
      return nodes.map((node) => node.rawText).join("");
    }

    if (!recordStep()) {
      return nodes.map((node) => node.rawText).join("");
    }

    const result = nodes.map((node) => {
      if (node.kind === "text") {
        return node.rawText;
      }

      if (node.kind === "raw") {
        warnRawNode(node.rawText);
        pushTrace({
          macroName: "raw",
          rawText: node.rawText,
          resolvedText: node.rawText,
          sourceKind: "raw",
          selectedBranch: "raw",
        });
        return node.rawText;
      }

      if (node.kind === "if") {
        pushUnique(usedMacros, "if");
        if (!enterEvaluation(node.rawText, "if")) {
          return node.rawText;
        }
        try {
          for (const conditionNode of node.conditionNodes) {
            if (conditionNode.kind === "macro") {
              pushUnique(usedMacros, conditionNode.name);
            }
          }
          const conditionValue = evaluateNodes(node.conditionNodes, depth + 1);
          const conditionResult = evaluateIfCondition(conditionValue);
          if (!conditionResult.supported) {
            warnings.push({
              code: "macro_condition_unsupported",
              message: "If condition expression is outside the current Beta3 supported subset.",
              macroName: "if",
              rawText: node.rawText,
            });
            pushTrace({
              macroName: "if",
              rawText: node.rawText,
              resolvedText: node.rawText,
              sourceKind: "if",
              selectedBranch: "raw",
            });
            return node.rawText;
          }
          const selectedBranch = conditionResult.result ? "then" : "else";
          const selectedNodes = conditionResult.result ? node.thenNodes : node.elseNodes;
          const resolvedBranch = evaluateNodes(selectedNodes, depth + 1);
          const limitedBranch = createLimitedText(resolvedBranch);
          pushTrace({
            macroName: "if",
            rawText: node.rawText,
            resolvedText: limitedBranch,
            sourceKind: "if",
            selectedBranch,
          });
          return limitedBranch;
        } finally {
          leaveEvaluation(node.rawText);
        }
      }

      if (!recordStep()) {
        return node.rawText;
      }

      pushUnique(usedMacros, node.name);
      if (!enterEvaluation(node.rawText, node.name)) {
        return node.rawText;
      }
      try {
        const normalizedArgs = node.args.map((arg) => evaluateNodes(arg.nodes, depth + 1));

        const writeResult = resolveWriteMacro(node.name, normalizedArgs, variableSnapshot, variableOverlay, context.phase);
        if (writeResult) {
          if ((writeResult.preview || writeResult.staged) && canRecordMutation()) {
            writeMutationCount += 1;
            if (writeResult.preview) {
              mutationPreview.push(writeResult.preview);
            }
            if (writeResult.staged) {
              stagedMutations.push(writeResult.staged);
            }
          }
          if (writeResult.warning) {
            warnings.push(writeResult.warning);
          }
          const resolvedText = createLimitedText(writeResult.text);
          pushTrace({
            macroName: node.name,
            rawText: node.rawText,
            resolvedText,
            sourceKind: "macro",
          });
          return resolvedText;
        }

        const resolved = resolveNamedMacro(node.name, normalizedArgs, mutableValues, variableSnapshot, variableOverlay);
        if (resolved !== undefined) {
          const limitedResolved = createLimitedText(resolved);
          pushTrace({
            macroName: node.name,
            rawText: node.rawText,
            resolvedText: limitedResolved,
            sourceKind: "macro",
          });
          return limitedResolved;
        }

        if (normalizedArgs.length === 0) {
          const shorthandResolved = resolveShorthandVariable(node.name, variableSnapshot, variableOverlay);
          if (shorthandResolved !== undefined) {
            const limitedResolved = createLimitedText(shorthandResolved);
            pushTrace({
              macroName: node.name,
              rawText: node.rawText,
              resolvedText: limitedResolved,
              sourceKind: "macro",
            });
            return limitedResolved;
          }
        }

        if (normalizedArgs.length > 0) {
          warnings.push({
            code: "macro_arg_arity_invalid",
            message: `Macro ${node.name} argument shape is outside the current Beta3 macro subset.`,
            macroName: node.name,
            rawText: node.rawText,
          });
          pushTrace({
            macroName: node.name,
            rawText: node.rawText,
            resolvedText: node.rawText,
            sourceKind: "macro",
            selectedBranch: "raw",
          });
          return node.rawText;
        }

        const plainValue = mutableValues[node.name];
        if (plainValue === undefined) {
          warnings.push({
            code: "macro_unknown",
            message: `Unknown macro: ${node.name}`,
            macroName: node.name,
            rawText: node.rawText,
          });
          pushTrace({
            macroName: node.name,
            rawText: node.rawText,
            resolvedText: node.rawText,
            sourceKind: "macro",
            selectedBranch: "raw",
          });
          return node.rawText;
        }

        const nestedNodes = parseMacroNodes(plainValue);
        if (nestedNodes.some((child) => child.kind !== "text" || child.rawText !== plainValue)) {
          const nestedRawTexts = nestedNodes
            .filter((child) => child.kind === "macro" || child.kind === "if")
            .map((child) => child.rawText);
          if (evaluationStack.includes(node.rawText) && nestedRawTexts.includes(node.rawText)) {
            warnings.push({
              code: "macro_cycle_detected",
              message: `Macro ${node.name} expansion entered a repeated evaluation path.`,
              macroName: node.name,
              rawText: node.rawText,
            });
            pushTrace({ macroName: node.name, rawText: node.rawText, resolvedText: node.rawText, sourceKind: "macro", selectedBranch: "raw" });
            return node.rawText;
          }
          const expandedValue = evaluateNodes(nestedNodes, depth + 1);
          const limitedExpanded = createLimitedText(expandedValue);
          pushTrace({ macroName: node.name, rawText: node.rawText, resolvedText: limitedExpanded, sourceKind: "macro" });
          return limitedExpanded;
        }

        const limitedResolved = createLimitedText(plainValue);
        pushTrace({
          macroName: node.name,
          rawText: node.rawText,
          resolvedText: limitedResolved,
          sourceKind: "macro",
        });
        return limitedResolved;
      } finally {
        leaveEvaluation(node.rawText);
      }
    }).join("");

    return createLimitedText(result);
  };

  const nodes = parseMacroNodes(normalizedInput);
  const text = createLimitedText(evaluateNodes(nodes, 0));

  return {
    text,
    warnings,
    usedMacros,
    mutationPreview,
    stagedMutations,
    traces,
  };
}
