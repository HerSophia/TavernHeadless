import { and, asc, eq } from "drizzle-orm";
import {
  parsePreset,
  parseRegexScripts,
  type STPreset,
  type STRegexScript,
  type STWorldBook,
} from "@tavern/adapters-sillytavern";

import type { AppDb } from "../db/client.js";
import { presets, regexProfiles, worldbooks, worldbookEntries } from "../db/schema.js";
import { parseWorldbookEntryExtraJson } from "../lib/worldbook-utils.js";

export interface LoadedPromptPreset {
  id: string;
  updatedAt: number;
  version: number;
  preset: STPreset;
}

export interface LoadedPromptWorldbook {
  id: string;
  updatedAt: number;
  version: number;
  worldbook: STWorldBook;
}

export interface LoadedPromptRegexProfile {
  id: string;
  updatedAt: number;
  version: number;
  scripts: STRegexScript[];
}

export interface LoadPromptResourceBundleParams {
  presetId: string | null;
  worldbookProfileId: string | null;
  regexProfileId: string | null;
}

export interface LoadedPromptResourceBundle {
  preset: LoadedPromptPreset | null;
  worldbook: LoadedPromptWorldbook | null;
  regexProfile: LoadedPromptRegexProfile | null;
}

type PromptPresetRow = {
  id: string;
  updatedAt: number;
  version: number;
  dataJson: string;
};

type PromptWorldbookRow = {
  id: string;
  name: string;
  updatedAt: number;
  version: number;
  dataJson: string;
};

type PromptRegexProfileRow = {
  id: string;
  updatedAt: number;
  version: number;
  dataJson: string;
};

type PromptWorldbookEntryRow = typeof worldbookEntries.$inferSelect;

/**
 * Prompt 资源读取器。
 *
 * 统一承接 prompt 组装阶段对 preset / worldbook / regex 的读取，
 * 并显式附带 account ownership 约束，避免仅按资源 id 取数。
 */
export class PromptResourceLoader {
  constructor(private readonly db: AppDb) {}

  async loadPreset(
    accountId: string,
    presetId: string | null
  ): Promise<LoadedPromptPreset | null> {
    if (!presetId) {
      return null;
    }

    const [row] = await this.db
      .select({
        id: presets.id,
        updatedAt: presets.updatedAt,
        version: presets.version,
        dataJson: presets.dataJson,
      })
      .from(presets)
      .where(and(eq(presets.id, presetId), eq(presets.accountId, accountId)))
      .limit(1);

    return parseLoadedPresetRow(row ?? null);
  }

  async loadWorldbookData(
    accountId: string,
    worldbookProfileId: string | null
  ): Promise<LoadedPromptWorldbook | null> {
    if (!worldbookProfileId) {
      return null;
    }

    const [row] = await this.db
      .select({
        id: worldbooks.id,
        name: worldbooks.name,
        updatedAt: worldbooks.updatedAt,
        version: worldbooks.version,
        dataJson: worldbooks.dataJson,
      })
      .from(worldbooks)
      .where(and(eq(worldbooks.id, worldbookProfileId), eq(worldbooks.accountId, accountId)))
      .limit(1);

    if (!row) {
      return null;
    }

    const entryRows = await this.db
      .select()
      .from(worldbookEntries)
      .where(eq(worldbookEntries.worldbookId, row.id))
      .orderBy(asc(worldbookEntries.order), asc(worldbookEntries.uid));

    return parseLoadedWorldbookRow(row, entryRows);
  }

  async loadRegexScripts(
    accountId: string,
    regexProfileId: string | null
  ): Promise<LoadedPromptRegexProfile | null> {
    if (!regexProfileId) {
      return null;
    }

    const [row] = await this.db
      .select({
        id: regexProfiles.id,
        updatedAt: regexProfiles.updatedAt,
        version: regexProfiles.version,
        dataJson: regexProfiles.dataJson,
      })
      .from(regexProfiles)
      .where(and(eq(regexProfiles.id, regexProfileId), eq(regexProfiles.accountId, accountId)))
      .limit(1);

    return parseLoadedRegexProfileRow(row ?? null);
  }

  async loadPromptResourceBundle(
    accountId: string,
    params: LoadPromptResourceBundleParams
  ): Promise<LoadedPromptResourceBundle> {
    return this.db.transaction((tx) => {
      const presetRow = params.presetId
        ? tx
            .select({
              id: presets.id,
              updatedAt: presets.updatedAt,
              version: presets.version,
              dataJson: presets.dataJson,
            })
            .from(presets)
            .where(and(eq(presets.id, params.presetId), eq(presets.accountId, accountId)))
            .get()
        : undefined;

      const worldbookRow = params.worldbookProfileId
        ? tx
            .select({
              id: worldbooks.id,
              name: worldbooks.name,
              updatedAt: worldbooks.updatedAt,
              version: worldbooks.version,
              dataJson: worldbooks.dataJson,
            })
            .from(worldbooks)
            .where(and(eq(worldbooks.id, params.worldbookProfileId), eq(worldbooks.accountId, accountId)))
            .get()
        : undefined;

      const worldbookEntryRows = worldbookRow
        ? tx
            .select()
            .from(worldbookEntries)
            .where(eq(worldbookEntries.worldbookId, worldbookRow.id))
            .orderBy(asc(worldbookEntries.order), asc(worldbookEntries.uid))
            .all()
        : [];

      const regexProfileRow = params.regexProfileId
        ? tx
            .select({
              id: regexProfiles.id,
              updatedAt: regexProfiles.updatedAt,
              version: regexProfiles.version,
              dataJson: regexProfiles.dataJson,
            })
            .from(regexProfiles)
            .where(and(eq(regexProfiles.id, params.regexProfileId), eq(regexProfiles.accountId, accountId)))
            .get()
        : undefined;

      return {
        preset: parseLoadedPresetRow(presetRow ?? null),
        worldbook: parseLoadedWorldbookRow(worldbookRow ?? null, worldbookEntryRows),
        regexProfile: parseLoadedRegexProfileRow(regexProfileRow ?? null),
      };
    });
  }
}

function parseLoadedPresetRow(row: PromptPresetRow | null | undefined): LoadedPromptPreset | null {
  if (!row) {
    return null;
  }

  try {
    return {
      id: row.id,
      updatedAt: row.updatedAt,
      version: row.version,
      preset: parsePreset(JSON.parse(row.dataJson)),
    };
  } catch {
    return null;
  }
}

function parseLoadedWorldbookRow(
  row: PromptWorldbookRow | null | undefined,
  entryRows: PromptWorldbookEntryRow[]
): LoadedPromptWorldbook | null {
  if (!row) {
    return null;
  }

  const globalSettings = safeParseJsonObject(row.dataJson);

  return {
    id: row.id,
    updatedAt: row.updatedAt,
    version: row.version,
    worldbook: {
      name: row.name,
      entries: entryRows.map((entry) => ({
        uid: entry.uid,
        key: safeParseJsonArray(entry.keysJson),
        keysecondary: safeParseJsonArray(entry.keysSecondaryJson),
        selective: entry.selective,
        selectiveLogic: entry.selectiveLogic as STWorldBook["entries"][number]["selectiveLogic"],
        constant: entry.constant,
        content: entry.content,
        comment: entry.comment,
        position: entry.position as STWorldBook["entries"][number]["position"],
        order: entry.order,
        depth: entry.depth,
        role: entry.role as STWorldBook["entries"][number]["role"],
        disable: entry.disable,
        scanDepth: entry.scanDepth ?? null,
        caseSensitive: entry.caseSensitive ?? null,
        matchWholeWords: entry.matchWholeWords ?? null,
        excludeRecursion: entry.excludeRecursion,
        preventRecursion: entry.preventRecursion,
        delayUntilRecursion: entry.delayUntilRecursion ?? null,
        outletName: entry.outletName,
        extra: parseWorldbookEntryExtraJson(entry.extraJson),
      })),
      scanDepth: typeof globalSettings.scanDepth === "number" ? globalSettings.scanDepth : 2,
      caseSensitive:
        typeof globalSettings.caseSensitive === "boolean" ? globalSettings.caseSensitive : false,
      matchWholeWords:
        typeof globalSettings.matchWholeWords === "boolean"
          ? globalSettings.matchWholeWords
          : false,
      recursive: typeof globalSettings.recursive === "boolean" ? globalSettings.recursive : false,
      maxRecursionSteps:
        typeof globalSettings.maxRecursionSteps === "number"
          ? globalSettings.maxRecursionSteps
          : 0,
    },
  };
}

function parseLoadedRegexProfileRow(
  row: PromptRegexProfileRow | null | undefined
): LoadedPromptRegexProfile | null {
  if (!row) {
    return null;
  }

  try {
    return {
      id: row.id,
      updatedAt: row.updatedAt,
      version: row.version,
      scripts: parseRegexScripts(JSON.parse(row.dataJson)),
    };
  } catch {
    return null;
  }
}

function safeParseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function safeParseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
