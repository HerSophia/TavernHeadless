import type { STWorldBook, STWorldBookEntry } from "@tavern/adapters-sillytavern";

import { worldbookEntries } from "../db/schema.js";
import { parseJsonField } from "./http.js";

function toPlainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

export function buildPersistedWorldbookGlobalSettings(worldbook: STWorldBook): Record<string, unknown> {
  return {
    ...toPlainRecord(worldbook.extra),
    scanDepth: worldbook.scanDepth,
    caseSensitive: worldbook.caseSensitive,
    matchWholeWords: worldbook.matchWholeWords,
    recursive: worldbook.recursive,
    maxRecursionSteps: worldbook.maxRecursionSteps,
  };
}

export function buildWorldbookEntryInsertValues(
  entry: STWorldBookEntry,
  args: {
    id: string;
    worldbookId: string;
    uid: number;
    createdAt: number;
    updatedAt: number;
  }
): typeof worldbookEntries.$inferInsert {
  return {
    id: args.id,
    worldbookId: args.worldbookId,
    uid: args.uid,
    comment: entry.comment ?? "",
    content: entry.content ?? "",
    keysJson: JSON.stringify(entry.key ?? []),
    keysSecondaryJson: JSON.stringify(entry.keysecondary ?? []),
    selective: entry.selective ?? true,
    selectiveLogic: entry.selectiveLogic ?? 0,
    constant: entry.constant ?? false,
    position: entry.position ?? 0,
    order: entry.order ?? 100,
    depth: entry.depth ?? 4,
    role: entry.role ?? 0,
    disable: entry.disable ?? false,
    scanDepth: entry.scanDepth ?? null,
    caseSensitive: entry.caseSensitive ?? null,
    matchWholeWords: entry.matchWholeWords ?? null,
    excludeRecursion: entry.excludeRecursion ?? false,
    preventRecursion: entry.preventRecursion ?? false,
    delayUntilRecursion: entry.delayUntilRecursion ?? null,
    outletName: entry.outletName ?? "",
    extraJson: JSON.stringify(entry.extra ?? {}),
    createdAt: args.createdAt,
    updatedAt: args.updatedAt,
  };
}

export function parseWorldbookEntryExtraJson(raw: string | null | undefined): Record<string, unknown> {
  const parsed = parseJsonField(raw ?? "{}");
  return toPlainRecord(parsed);
}

export function splitWorldbookEntryExtra(raw: string | null | undefined): {
  root: Record<string, unknown>;
  extensions: Record<string, unknown>;
} {
  const extra = parseWorldbookEntryExtraJson(raw);
  const { extensions, ...root } = extra;

  return {
    root,
    extensions: toPlainRecord(extensions),
  };
}

export function buildRawWorldbookEntryPayload(
  entry: typeof worldbookEntries.$inferSelect
): Record<string, unknown> {
  const { root, extensions: extraExtensions } = splitWorldbookEntryExtra(entry.extraJson);

  return {
    ...root,
    uid: entry.uid,
    key: parseJsonField(entry.keysJson),
    keysecondary: parseJsonField(entry.keysSecondaryJson),
    secondary_keys: parseJsonField(entry.keysSecondaryJson),
    selective: entry.selective,
    selectiveLogic: entry.selectiveLogic,
    constant: entry.constant,
    content: entry.content,
    comment: entry.comment,
    position: entry.position,
    order: entry.order,
    insertion_order: entry.order,
    depth: entry.depth,
    role: entry.role,
    disable: entry.disable,
    enabled: !entry.disable,
    scanDepth: entry.scanDepth ?? null,
    caseSensitive: entry.caseSensitive ?? null,
    matchWholeWords: entry.matchWholeWords ?? null,
    excludeRecursion: entry.excludeRecursion,
    preventRecursion: entry.preventRecursion,
    delayUntilRecursion: entry.delayUntilRecursion ?? null,
    outletName: entry.outletName,
    extensions: {
      ...extraExtensions,
      position: entry.position,
      selectiveLogic: entry.selectiveLogic,
      role: entry.role,
      depth: entry.depth,
      scan_depth: entry.scanDepth ?? null,
      case_sensitive: entry.caseSensitive ?? null,
      match_whole_words: entry.matchWholeWords ?? null,
      exclude_recursion: entry.excludeRecursion,
      prevent_recursion: entry.preventRecursion,
      delay_until_recursion: entry.delayUntilRecursion ?? null,
      ...(entry.outletName ? { outlet_name: entry.outletName } : {}),
    },
  };
}
