import type { StMacroJsonValue } from "./types.js";

export type VariablePathFailureReason = "parse_failed" | "type_invalid";

interface ParsedVariablePath {
  rawText: string;
  segments: string[];
}

type ParseVariablePathResult =
  | { ok: true; path: ParsedVariablePath }
  | { ok: false; reason: "parse_failed"; message: string };

export type VariableAccessTarget =
  | { kind: "exact"; key: string }
  | { kind: "path"; rootKey: string; segments: string[] };

type ResolveVariableAccessTargetResult =
  | { ok: true; access: VariableAccessTarget }
  | { ok: false; reason: "parse_failed"; message: string };

export type ReadScopedVariableValueResult =
  | { ok: true; exists: boolean; value: StMacroJsonValue | undefined; access: VariableAccessTarget }
  | { ok: false; reason: VariablePathFailureReason; message: string };

export type WriteScopedVariableValueResult =
  | { ok: true; mutationKind: "set" | "delete"; key: string; value?: StMacroJsonValue }
  | { ok: true; mutationKind: "none" }
  | { ok: false; reason: VariablePathFailureReason; message: string };

function parseFailure(message: string): Extract<ParseVariablePathResult, { ok: false }> {
  return {
    ok: false,
    reason: "parse_failed",
    message,
  };
}

function hasOwnKey(target: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function skipWhitespace(input: string, index: number): number {
  let nextIndex = index;
  while (nextIndex < input.length && /\s/.test(input[nextIndex] ?? "")) {
    nextIndex += 1;
  }
  return nextIndex;
}

function isPlainRecord(value: StMacroJsonValue | undefined): value is Record<string, StMacroJsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonValue<T extends StMacroJsonValue>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function readQuotedKey(
  input: string,
  startIndex: number,
):
  | { ok: true; key: string; nextIndex: number }
  | { ok: false; reason: "parse_failed"; message: string } {
  let index = skipWhitespace(input, startIndex);
  const quote = input[index];
  if (quote !== '"' && quote !== "'") {
    return parseFailure("Variable path bracket segment must use a quoted key.");
  }

  index += 1;
  let key = "";
  while (index < input.length) {
    const character = input[index] ?? "";
    if (character === "\\") {
      const escaped = input[index + 1];
      if (escaped === undefined) {
        return parseFailure("Variable path quoted key has an invalid escape sequence.");
      }
      key += escaped;
      index += 2;
      continue;
    }

    if (character === quote) {
      index += 1;
      index = skipWhitespace(input, index);
      if (input[index] !== "]") {
        return parseFailure("Variable path bracket segment is missing a closing bracket.");
      }
      return {
        ok: true,
        key,
        nextIndex: index + 1,
      };
    }

    key += character;
    index += 1;
  }

  return parseFailure("Variable path quoted key is not closed.");
}

function readIdentifier(
  input: string,
  startIndex: number,
):
  | { ok: true; key: string; nextIndex: number }
  | { ok: false; reason: "parse_failed"; message: string } {
  let index = startIndex;
  while (index < input.length) {
    const character = input[index] ?? "";
    if (character === "." || character === "[" || character === "]" || /\s/.test(character)) {
      break;
    }
    index += 1;
  }

  if (index === startIndex) {
    return parseFailure("Variable path contains an empty path segment.");
  }

  return {
    ok: true,
    key: input.slice(startIndex, index),
    nextIndex: index,
  };
}

export function parseVariablePath(rawText: string): ParseVariablePathResult {
  const input = rawText.trim();
  if (input.length === 0) {
    return parseFailure("Variable path is empty.");
  }

  const segments: string[] = [];
  let index = 0;

  const readNextSegment = (): ParseVariablePathResult => {
    index = skipWhitespace(input, index);
    if (index >= input.length) {
      return parseFailure("Variable path ended unexpectedly.");
    }

    if (input[index] === "[") {
      const quoted = readQuotedKey(input, index + 1);
      if (!quoted.ok) {
        return quoted;
      }
      segments.push(quoted.key);
      index = quoted.nextIndex;
      return { ok: true, path: { rawText: input, segments } };
    }

    const identifier = readIdentifier(input, index);
    if (!identifier.ok) {
      return identifier;
    }
    segments.push(identifier.key);
    index = identifier.nextIndex;
    return { ok: true, path: { rawText: input, segments } };
  };

  const firstSegment = readNextSegment();
  if (!firstSegment.ok) {
    return firstSegment;
  }

  while (index < input.length) {
    index = skipWhitespace(input, index);
    if (index >= input.length) {
      break;
    }

    const character = input[index] ?? "";
    if (character === ".") {
      index += 1;
      const nextSegment = readNextSegment();
      if (!nextSegment.ok) {
        return nextSegment;
      }
      continue;
    }

    if (character === "[") {
      const nextSegment = readNextSegment();
      if (!nextSegment.ok) {
        return nextSegment;
      }
      continue;
    }

    return parseFailure(`Variable path contains unsupported token: ${character}`);
  }

  return {
    ok: true,
    path: {
      rawText: input,
      segments,
    },
  };
}

function readExactValue(
  snapshot: Record<string, StMacroJsonValue>,
  overlay: Record<string, StMacroJsonValue | undefined>,
  key: string,
): { exists: boolean; value: StMacroJsonValue | undefined } {
  if (hasOwnKey(overlay, key)) {
    return {
      exists: overlay[key] !== undefined,
      value: overlay[key],
    };
  }

  if (hasOwnKey(snapshot, key)) {
    return {
      exists: true,
      value: snapshot[key],
    };
  }

  return {
    exists: false,
    value: undefined,
  };
}

export function resolveVariableAccessTarget(
  rawKey: string,
  snapshot: Record<string, StMacroJsonValue>,
  overlay: Record<string, StMacroJsonValue | undefined>,
): ResolveVariableAccessTargetResult {
  const key = rawKey.trim();
  if (
    hasOwnKey(overlay, key)
    || hasOwnKey(snapshot, key)
    || (!key.includes(".") && !key.includes("["))
  ) {
    return {
      ok: true,
      access: {
        kind: "exact",
        key,
      },
    };
  }

  const parsed = parseVariablePath(key);
  if (!parsed.ok) {
    return parsed;
  }

  const [rootKey, ...segments] = parsed.path.segments;
  if (rootKey === undefined) {
    return parseFailure("Variable path is empty.");
  }

  return {
    ok: true,
    access: {
      kind: "path",
      rootKey,
      segments,
    },
  };
}

export function stringifyStMacroValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? serialized : String(value);
  } catch {
    return String(value);
  }
}

export function readScopedVariableValue(
  snapshot: Record<string, StMacroJsonValue>,
  overlay: Record<string, StMacroJsonValue | undefined>,
  rawKey: string,
): ReadScopedVariableValueResult {
  const resolvedAccess = resolveVariableAccessTarget(rawKey, snapshot, overlay);
  if (!resolvedAccess.ok) {
    return resolvedAccess;
  }

  if (resolvedAccess.access.kind === "exact") {
    const exact = readExactValue(snapshot, overlay, resolvedAccess.access.key);
    return {
      ok: true,
      exists: exact.exists,
      value: exact.value,
      access: resolvedAccess.access,
    };
  }

  const root = readExactValue(snapshot, overlay, resolvedAccess.access.rootKey);
  if (!root.exists) {
    return {
      ok: true,
      exists: false,
      value: undefined,
      access: resolvedAccess.access,
    };
  }

  let currentValue = root.value;
  for (const segment of resolvedAccess.access.segments) {
    if (!isPlainRecord(currentValue)) {
      return {
        ok: false,
        reason: "type_invalid",
        message: `Variable path '${rawKey}' cannot descend through non-object value.`,
      };
    }

    if (!hasOwnKey(currentValue, segment)) {
      return {
        ok: true,
        exists: false,
        value: undefined,
        access: resolvedAccess.access,
      };
    }

    currentValue = currentValue[segment];
  }

  return {
    ok: true,
    exists: true,
    value: currentValue,
    access: resolvedAccess.access,
  };
}

export function setScopedVariableValue(
  snapshot: Record<string, StMacroJsonValue>,
  overlay: Record<string, StMacroJsonValue | undefined>,
  rawKey: string,
  nextValue: StMacroJsonValue,
): WriteScopedVariableValueResult {
  const resolvedAccess = resolveVariableAccessTarget(rawKey, snapshot, overlay);
  if (!resolvedAccess.ok) {
    return resolvedAccess;
  }

  if (resolvedAccess.access.kind === "exact") {
    overlay[resolvedAccess.access.key] = nextValue;
    return {
      ok: true,
      mutationKind: "set",
      key: resolvedAccess.access.key,
      value: nextValue,
    };
  }

  if (resolvedAccess.access.segments.length === 0) {
    overlay[resolvedAccess.access.rootKey] = nextValue;
    return {
      ok: true,
      mutationKind: "set",
      key: resolvedAccess.access.rootKey,
      value: nextValue,
    };
  }

  const root = readExactValue(snapshot, overlay, resolvedAccess.access.rootKey);
  let nextRoot: Record<string, StMacroJsonValue>;
  if (!root.exists) {
    nextRoot = {};
  } else if (!isPlainRecord(root.value)) {
    return {
      ok: false,
      reason: "type_invalid",
      message: `Variable path '${rawKey}' cannot descend through non-object value.`,
    };
  } else {
    nextRoot = cloneJsonValue(root.value);
  }

  let current = nextRoot;
  const parentSegments = resolvedAccess.access.segments.slice(0, -1);
  const leafSegment = resolvedAccess.access.segments.at(-1);
  if (leafSegment === undefined) {
    return {
      ok: false,
      reason: "parse_failed",
      message: `Variable path '${rawKey}' is missing a leaf segment.`,
    };
  }

  for (const segment of parentSegments) {
    const child = current[segment];
    if (child === undefined) {
      current[segment] = {};
      current = current[segment] as Record<string, StMacroJsonValue>;
      continue;
    }

    if (!isPlainRecord(child)) {
      return {
        ok: false,
        reason: "type_invalid",
        message: `Variable path '${rawKey}' cannot descend through non-object value.`,
      };
    }

    current = child;
  }

  current[leafSegment] = nextValue;
  overlay[resolvedAccess.access.rootKey] = nextRoot;
  return {
    ok: true,
    mutationKind: "set",
    key: resolvedAccess.access.rootKey,
    value: nextRoot,
  };
}

export function deleteScopedVariableValue(
  snapshot: Record<string, StMacroJsonValue>,
  overlay: Record<string, StMacroJsonValue | undefined>,
  rawKey: string,
): WriteScopedVariableValueResult {
  const resolvedAccess = resolveVariableAccessTarget(rawKey, snapshot, overlay);
  if (!resolvedAccess.ok) {
    return resolvedAccess;
  }

  if (resolvedAccess.access.kind === "exact") {
    overlay[resolvedAccess.access.key] = undefined;
    return {
      ok: true,
      mutationKind: "delete",
      key: resolvedAccess.access.key,
    };
  }

  const root = readExactValue(snapshot, overlay, resolvedAccess.access.rootKey);
  if (!root.exists) {
    return {
      ok: true,
      mutationKind: "none",
    };
  }

  if (!isPlainRecord(root.value)) {
    return {
      ok: false,
      reason: "type_invalid",
      message: `Variable path '${rawKey}' cannot descend through non-object value.`,
    };
  }

  const nextRoot = cloneJsonValue(root.value);
  let current = nextRoot;
  const parentSegments = resolvedAccess.access.segments.slice(0, -1);
  const leafSegment = resolvedAccess.access.segments.at(-1);
  if (leafSegment === undefined) {
    overlay[resolvedAccess.access.rootKey] = undefined;
    return {
      ok: true,
      mutationKind: "delete",
      key: resolvedAccess.access.rootKey,
    };
  }

  for (const segment of parentSegments) {
    const child = current[segment];
    if (child === undefined) {
      return {
        ok: true,
        mutationKind: "none",
      };
    }

    if (!isPlainRecord(child)) {
      return {
        ok: false,
        reason: "type_invalid",
        message: `Variable path '${rawKey}' cannot descend through non-object value.`,
      };
    }

    current = child;
  }

  if (!hasOwnKey(current, leafSegment)) {
    return {
      ok: true,
      mutationKind: "none",
    };
  }

  delete current[leafSegment];
  overlay[resolvedAccess.access.rootKey] = nextRoot;
  return {
    ok: true,
    mutationKind: "set",
    key: resolvedAccess.access.rootKey,
    value: nextRoot,
  };
}
