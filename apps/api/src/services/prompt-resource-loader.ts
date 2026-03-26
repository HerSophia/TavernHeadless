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

export interface LoadedPromptPreset {
  id: string;
  updatedAt: number;
  preset: STPreset;
}

export interface LoadedPromptWorldbook {
  id: string;
  updatedAt: number;
  worldbook: STWorldBook;
}

export interface LoadedPromptRegexProfile {
  id: string;
  updatedAt: number;
  scripts: STRegexScript[];
}

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
        dataJson: presets.dataJson,
      })
      .from(presets)
      .where(and(eq(presets.id, presetId), eq(presets.accountId, accountId)))
      .limit(1);

    if (!row) {
      return null;
    }

    try {
      return {
        id: row.id,
        updatedAt: row.updatedAt,
        preset: parsePreset(JSON.parse(row.dataJson)),
      };
    } catch {
      return null;
    }
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

    let globalSettings: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.dataJson);
      if (parsed && typeof parsed === "object") {
        globalSettings = parsed as Record<string, unknown>;
      }
    } catch {
      // ignore malformed JSON and fall back to defaults
    }

    return {
      id: row.id,
      updatedAt: row.updatedAt,
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
        dataJson: regexProfiles.dataJson,
      })
      .from(regexProfiles)
      .where(and(eq(regexProfiles.id, regexProfileId), eq(regexProfiles.accountId, accountId)))
      .limit(1);

    if (!row) {
      return null;
    }

    try {
      return {
        id: row.id,
        updatedAt: row.updatedAt,
        scripts: parseRegexScripts(JSON.parse(row.dataJson)),
      };
    } catch {
      return null;
    }
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
