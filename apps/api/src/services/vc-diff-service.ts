import { createHash } from "node:crypto";

export type VcDiffMode = "summary" | "full";
export type VcChangeType = "added" | "removed" | "changed" | "unchanged";

export type VcDiffChange = {
  path: string;
  change_type: VcChangeType;
  before_hash?: string;
  after_hash?: string;
  before_value?: unknown;
  after_value?: unknown;
  before_preview?: unknown;
  after_preview?: unknown;
  redacted?: boolean;
};

export type VcDiff = {
  mode: VcDiffMode;
  changes: VcDiffChange[];
  total_changes: number;
  truncated: boolean;
  max_bytes: number;
};

export type VcDiffServiceOptions = {
  mode?: VcDiffMode;
  includeUnchanged?: boolean;
  previewLength?: number;
  maxBytes?: number;
  redactPathPatterns?: RegExp[];
  forceRedactPaths?: string[];
  forceUnredactPaths?: string[];
};

const DEFAULT_PREVIEW_LENGTH = 120;
const DEFAULT_MAX_DIFF_BYTES = 16_000;

const DEFAULT_REDACT_PATH_PATTERNS = [
  /(^|[.[_-])prompt($|[.\]_-])/i,
  /(^|[.[_-])message($|[.\]_-])/i,
  /(^|[.[_-])content($|[.\]_-])/i,
  /(^|[.[_-])generated[_-]?text($|[.\]_-])/i,
  /(^|[.[_-])args($|[.\]_-])/i,
  /(^|[.[_-])args[_-]?json($|[.\]_-])/i,
  /(^|[.[_-])result($|[.\]_-])/i,
  /(^|[.[_-])result[_-]?json($|[.\]_-])/i,
  /(^|[.[_-])api[_-]?key($|[.\]_-])/i,
  /(^|[.[_-])secret($|[.\]_-])/i,
  /(^|[.[_-])token($|[.\]_-])/i,
  /(^|[.[_-])password($|[.\]_-])/i,
  /(^|[.[_-])authorization($|[.\]_-])/i,
  /(^|[.[_-])credential($|[.\]_-])/i,
  /(^|[.[_-])model[_-]?params($|[.\]_-])/i,
];

/**
 * Computes a structural diff between two JSON-like snapshots for the VC operation journal.
 *
 * The default output is summary mode. Summary mode records paths, hashes, short previews,
 * and redaction flags. It does not store sensitive full values by default.
 */
export class VcDiffService {
  diff(before: unknown, after: unknown, options: VcDiffServiceOptions = {}): VcDiff {
    const normalizedOptions = normalizeOptions(options);
    const changes = collectChanges({
      before,
      after,
      path: "",
      options: normalizedOptions,
    });
    const visibleChanges = normalizedOptions.includeUnchanged
      ? changes
      : changes.filter((change) => change.change_type !== "unchanged");

    return enforceSizeLimit({
      mode: normalizedOptions.mode,
      changes: visibleChanges,
      total_changes: visibleChanges.length,
      truncated: false,
      max_bytes: normalizedOptions.maxBytes,
    });
  }
}

type NormalizedDiffOptions = Required<Pick<VcDiffServiceOptions, "mode" | "includeUnchanged" | "previewLength" | "maxBytes">> & {
  redactPathPatterns: RegExp[];
  forceRedactPaths: Set<string>;
  forceUnredactPaths: Set<string>;
};

type CollectChangesInput = {
  before: unknown;
  after: unknown;
  path: string;
  options: NormalizedDiffOptions;
};

function normalizeOptions(options: VcDiffServiceOptions): NormalizedDiffOptions {
  return {
    mode: options.mode ?? "summary",
    includeUnchanged: options.includeUnchanged ?? false,
    previewLength: options.previewLength ?? DEFAULT_PREVIEW_LENGTH,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_DIFF_BYTES,
    redactPathPatterns: options.redactPathPatterns ?? DEFAULT_REDACT_PATH_PATTERNS,
    forceRedactPaths: new Set(options.forceRedactPaths ?? []),
    forceUnredactPaths: new Set(options.forceUnredactPaths ?? []),
  };
}

function collectChanges(input: CollectChangesInput): VcDiffChange[] {
  const beforeHash = hashValue(input.before);
  const afterHash = hashValue(input.after);
  if (beforeHash === afterHash) {
    if (!input.options.includeUnchanged) return [];
    return [buildChange(input.path || "$", "unchanged", input.before, input.after, input.options)];
  }

  if (isPlainObject(input.before) && isPlainObject(input.after)) {
    const beforeObject = input.before as Record<string, unknown>;
    const afterObject = input.after as Record<string, unknown>;
    const keys = new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)]);
    return [...keys]
      .sort((left, right) => left.localeCompare(right))
      .flatMap((key) => {
        const childPath = appendObjectPath(input.path, key);
        if (!Object.prototype.hasOwnProperty.call(beforeObject, key)) {
          return [buildChange(childPath, "added", undefined, afterObject[key], input.options)];
        }
        if (!Object.prototype.hasOwnProperty.call(afterObject, key)) {
          return [buildChange(childPath, "removed", beforeObject[key], undefined, input.options)];
        }
        return collectChanges({
          before: beforeObject[key],
          after: afterObject[key],
          path: childPath,
          options: input.options,
        });
      });
  }

  if (Array.isArray(input.before) && Array.isArray(input.after)) {
    const maxLength = Math.max(input.before.length, input.after.length);
    const changes: VcDiffChange[] = [];
    for (let index = 0; index < maxLength; index += 1) {
      const childPath = `${input.path || "$"}[${index}]`;
      if (index >= input.before.length) {
        changes.push(buildChange(childPath, "added", undefined, input.after[index], input.options));
        continue;
      }
      if (index >= input.after.length) {
        changes.push(buildChange(childPath, "removed", input.before[index], undefined, input.options));
        continue;
      }
      changes.push(...collectChanges({
        before: input.before[index],
        after: input.after[index],
        path: childPath,
        options: input.options,
      }));
    }
    return changes;
  }

  return [buildChange(input.path || "$", changeTypeForValues(input.before, input.after), input.before, input.after, input.options)];
}

function buildChange(
  path: string,
  changeType: VcChangeType,
  before: unknown,
  after: unknown,
  options: NormalizedDiffOptions,
): VcDiffChange {
  const redacted = shouldRedact(path, options);
  const change: VcDiffChange = {
    path,
    change_type: changeType,
    before_hash: before === undefined ? undefined : hashValue(before),
    after_hash: after === undefined ? undefined : hashValue(after),
    redacted,
  };

  if (redacted) {
    return change;
  }

  if (options.mode === "full") {
    if (before !== undefined) change.before_value = before;
    if (after !== undefined) change.after_value = after;
    return change;
  }

  if (before !== undefined) change.before_preview = previewValue(before, options.previewLength);
  if (after !== undefined) change.after_preview = previewValue(after, options.previewLength);
  return change;
}

function changeTypeForValues(before: unknown, after: unknown): VcChangeType {
  if (before === undefined) return "added";
  if (after === undefined) return "removed";
  return "changed";
}

function shouldRedact(path: string, options: NormalizedDiffOptions): boolean {
  if (options.forceUnredactPaths.has(path)) return false;
  if (options.forceRedactPaths.has(path)) return true;
  return options.redactPathPatterns.some((pattern) => pattern.test(path));
}

function appendObjectPath(parent: string, key: string): string {
  const encodedKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
  if (!parent) return encodedKey;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${parent}.${encodedKey}`
    : `${parent}[${encodedKey}]`;
}

function previewValue(value: unknown, limit: number): unknown {
  if (typeof value === "string") {
    return truncateString(value, limit);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  return truncateString(stableStringify(value), limit);
}

function truncateString(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function enforceSizeLimit(diff: VcDiff): VcDiff {
  if (byteLength(diff) <= diff.max_bytes) return diff;

  let reduced: VcDiff = {
    ...diff,
    truncated: true,
    changes: diff.changes.map(stripValueFields),
  };
  if (byteLength(reduced) <= reduced.max_bytes) return reduced;

  while (reduced.changes.length > 0 && byteLength(reduced) > reduced.max_bytes) {
    reduced = {
      ...reduced,
      changes: reduced.changes.slice(0, -1),
    };
  }
  return reduced;
}

function stripValueFields(change: VcDiffChange): VcDiffChange {
  return {
    path: change.path,
    change_type: change.change_type,
    before_hash: change.before_hash,
    after_hash: change.after_hash,
    redacted: change.redacted,
  };
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function hashValue(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableStringify(value));
}

function normalizeForStableStringify(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableStringify(item));
  }
  if (isPlainObject(value)) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, normalizeForStableStringify(record[key])]),
    );
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
