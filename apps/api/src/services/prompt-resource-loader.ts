import { and, asc, eq } from "drizzle-orm";
import {
  parsePreset,
  parseRegexScripts,
  parseWorldBook,
  type STPreset,
  type STRegexScript,
  type STWorldBook,
} from "@tavern/adapters-sillytavern";

import type { AppDb, DbExecutor } from "../db/client.js";
import {
  presetVersions,
  presets,
  regexProfileVersions,
  regexProfiles,
  worldbookEntries,
  worldbookVersions,
  worldbooks,
} from "../db/schema.js";
import { parseWorldbookEntryExtraJson } from "../lib/worldbook-utils.js";
import { createAssetContentHash, normalizeAssetVersionDataJson } from "./asset-version-service.js";

export interface LoadedPromptPreset {
  id: string;
  updatedAt: number;
  version: number;
  versionId?: string | null;
  contentHash?: string | null;
  preset: STPreset;
}

export interface LoadedPromptWorldbook {
  id: string;
  updatedAt: number;
  version: number;
  versionId?: string | null;
  contentHash?: string | null;
  worldbook: STWorldBook;
}

export interface LoadedPromptRegexProfile {
  id: string;
  updatedAt: number;
  version: number;
  versionId?: string | null;
  contentHash?: string | null;
  scripts: STRegexScript[];
}

export interface LoadPromptResourceBundleParams {
  presetId: string | null;
  presetVersionId?: string | null;
  worldbookProfileId: string | null;
  worldbookVersionId?: string | null;
  regexProfileId: string | null;
  regexProfileVersionId?: string | null;
  deepBinding?: boolean;
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

type PromptVersionInfo = {
  id: string;
  versionNo: number;
  dataJson: string;
  contentHash: string;
};

type PromptWorldbookEntryRow = typeof worldbookEntries.$inferSelect;

type DeepBindingFallbackAssetType = "preset" | "worldbook" | "regex_profile";

type DeepBindingVersionFallbackReason =
  | "version_row_missing"
  | "asset_row_missing"
  | "version_parse_failed";

type VersionLoadResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: DeepBindingVersionFallbackReason };

/**
 * Prompt 资源读取器。
 *
 * 统一承接 prompt 组装阶段对 preset / worldbook / regex 的读取，
 * 并显式附带 account ownership 约束，避免仅按资源 id 取数。
 */
export class PromptResourceLoader {
  constructor(private readonly db: AppDb) {}

  private warnDeepBindingFallback(args: {
    assetType: DeepBindingFallbackAssetType;
    assetId: string;
    requestedVersionId: string;
    reason: DeepBindingVersionFallbackReason;
  }): void {
    console.warn("[PromptResourceLoader] deep binding fallback", {
      assetType: args.assetType,
      assetId: args.assetId,
      requestedVersionId: args.requestedVersionId,
      reason: args.reason,
      fallback: "live_asset",
    });
  }

  async loadPreset(
    accountId: string,
    presetId: string | null,
    options: { deepBinding?: boolean; presetVersionId?: string | null } = {},
  ): Promise<LoadedPromptPreset | null> {
    return this.db.transaction((tx) => this.loadPresetInTransaction(tx, accountId, {
      presetId,
      presetVersionId: options.presetVersionId,
      deepBinding: options.deepBinding,
    }));
  }

  async loadWorldbookData(
    accountId: string,
    worldbookProfileId: string | null,
    options: { deepBinding?: boolean; worldbookVersionId?: string | null } = {},
  ): Promise<LoadedPromptWorldbook | null> {
    return this.db.transaction((tx) => this.loadWorldbookInTransaction(tx, accountId, {
      worldbookProfileId,
      worldbookVersionId: options.worldbookVersionId,
      deepBinding: options.deepBinding,
    }));
  }

  async loadRegexScripts(
    accountId: string,
    regexProfileId: string | null,
    options: { deepBinding?: boolean; regexProfileVersionId?: string | null } = {},
  ): Promise<LoadedPromptRegexProfile | null> {
    return this.db.transaction((tx) => this.loadRegexProfileInTransaction(tx, accountId, {
      regexProfileId,
      regexProfileVersionId: options.regexProfileVersionId,
      deepBinding: options.deepBinding,
    }));
  }

  async loadPromptResourceBundle(
    accountId: string,
    params: LoadPromptResourceBundleParams
  ): Promise<LoadedPromptResourceBundle> {
    return this.db.transaction((tx) => ({
      preset: this.loadPresetInTransaction(tx, accountId, params),
      worldbook: this.loadWorldbookInTransaction(tx, accountId, params),
      regexProfile: this.loadRegexProfileInTransaction(tx, accountId, params),
    }));
  }

  private loadPresetInTransaction(
    tx: DbExecutor,
    accountId: string,
    params: Pick<LoadPromptResourceBundleParams, "presetId" | "presetVersionId" | "deepBinding">,
  ): LoadedPromptPreset | null {
    if (!params.presetId) return null;

    if (params.deepBinding === true && params.presetVersionId) {
      const versionLoaded = this.loadPresetVersionInTransaction(tx, accountId, params.presetId, params.presetVersionId);
      if (versionLoaded.ok) return versionLoaded.value;
      this.warnDeepBindingFallback({
        assetType: "preset",
        assetId: params.presetId,
        requestedVersionId: params.presetVersionId,
        reason: versionLoaded.reason,
      });
    }

    const row = tx
      .select({ id: presets.id, updatedAt: presets.updatedAt, version: presets.version, dataJson: presets.dataJson })
      .from(presets)
      .where(and(eq(presets.id, params.presetId), eq(presets.accountId, accountId)))
      .get();

    if (!row) return null;
    const versionInfo = loadPresetVersionInfoByNo(tx, row.id, row.version);
    return parseLoadedPresetRow(row, versionInfo);
  }

  private loadWorldbookInTransaction(
    tx: DbExecutor,
    accountId: string,
    params: Pick<LoadPromptResourceBundleParams, "worldbookProfileId" | "worldbookVersionId" | "deepBinding">,
  ): LoadedPromptWorldbook | null {
    if (!params.worldbookProfileId) return null;

    if (params.deepBinding === true && params.worldbookVersionId) {
      const versionLoaded = this.loadWorldbookVersionInTransaction(tx, accountId, params.worldbookProfileId, params.worldbookVersionId);
      if (versionLoaded.ok) return versionLoaded.value;
      this.warnDeepBindingFallback({
        assetType: "worldbook",
        assetId: params.worldbookProfileId,
        requestedVersionId: params.worldbookVersionId,
        reason: versionLoaded.reason,
      });
    }

    const row = tx
      .select({ id: worldbooks.id, name: worldbooks.name, updatedAt: worldbooks.updatedAt, version: worldbooks.version, dataJson: worldbooks.dataJson })
      .from(worldbooks)
      .where(and(eq(worldbooks.id, params.worldbookProfileId), eq(worldbooks.accountId, accountId)))
      .get();

    if (!row) return null;

    const entryRows = tx
      .select()
      .from(worldbookEntries)
      .where(eq(worldbookEntries.worldbookId, row.id))
      .orderBy(asc(worldbookEntries.order), asc(worldbookEntries.uid), asc(worldbookEntries.id))
      .all();

    const versionInfo = loadWorldbookVersionInfoByNo(tx, row.id, row.version);
    return parseLoadedWorldbookRow(row, entryRows, versionInfo);
  }

  private loadRegexProfileInTransaction(
    tx: DbExecutor,
    accountId: string,
    params: Pick<LoadPromptResourceBundleParams, "regexProfileId" | "regexProfileVersionId" | "deepBinding">,
  ): LoadedPromptRegexProfile | null {
    if (!params.regexProfileId) return null;

    if (params.deepBinding === true && params.regexProfileVersionId) {
      const versionLoaded = this.loadRegexProfileVersionInTransaction(tx, accountId, params.regexProfileId, params.regexProfileVersionId);
      if (versionLoaded.ok) return versionLoaded.value;
      this.warnDeepBindingFallback({
        assetType: "regex_profile",
        assetId: params.regexProfileId,
        requestedVersionId: params.regexProfileVersionId,
        reason: versionLoaded.reason,
      });
    }

    const row = tx
      .select({ id: regexProfiles.id, updatedAt: regexProfiles.updatedAt, version: regexProfiles.version, dataJson: regexProfiles.dataJson })
      .from(regexProfiles)
      .where(and(eq(regexProfiles.id, params.regexProfileId), eq(regexProfiles.accountId, accountId)))
      .get();

    if (!row) return null;
    const versionInfo = loadRegexProfileVersionInfoByNo(tx, row.id, row.version);
    return parseLoadedRegexProfileRow(row, versionInfo);
  }

  private loadPresetVersionInTransaction(
    tx: DbExecutor,
    accountId: string,
    presetId: string,
    versionId: string,
  ): VersionLoadResult<LoadedPromptPreset> {
    const version = tx
      .select({ id: presetVersions.id, presetId: presetVersions.presetId, versionNo: presetVersions.versionNo, dataJson: presetVersions.dataJson, contentHash: presetVersions.contentHash })
      .from(presetVersions)
      .where(and(eq(presetVersions.id, versionId), eq(presetVersions.presetId, presetId)))
      .get();
    if (!version) return { ok: false, reason: "version_row_missing" };

    const asset = tx
      .select({ id: presets.id, updatedAt: presets.updatedAt })
      .from(presets)
      .where(and(eq(presets.id, version.presetId), eq(presets.accountId, accountId)))
      .get();
    if (!asset) return { ok: false, reason: "asset_row_missing" };

    const loaded = parseLoadedPresetVersionRow({
      id: asset.id,
      updatedAt: asset.updatedAt,
      version: version.versionNo,
      dataJson: version.dataJson,
    }, version);
    return loaded ? { ok: true, value: loaded } : { ok: false, reason: "version_parse_failed" };
  }

  private loadWorldbookVersionInTransaction(
    tx: DbExecutor,
    accountId: string,
    worldbookId: string,
    versionId: string,
  ): VersionLoadResult<LoadedPromptWorldbook> {
    const version = tx
      .select({ id: worldbookVersions.id, worldbookId: worldbookVersions.worldbookId, versionNo: worldbookVersions.versionNo, dataJson: worldbookVersions.dataJson, contentHash: worldbookVersions.contentHash })
      .from(worldbookVersions)
      .where(and(eq(worldbookVersions.id, versionId), eq(worldbookVersions.worldbookId, worldbookId)))
      .get();
    if (!version) return { ok: false, reason: "version_row_missing" };

    const asset = tx
      .select({ id: worldbooks.id, updatedAt: worldbooks.updatedAt })
      .from(worldbooks)
      .where(and(eq(worldbooks.id, version.worldbookId), eq(worldbooks.accountId, accountId)))
      .get();
    if (!asset) return { ok: false, reason: "asset_row_missing" };

    const loaded = parseLoadedWorldbookVersionRow({
      id: asset.id,
      updatedAt: asset.updatedAt,
      version: version.versionNo,
      dataJson: version.dataJson,
    }, version);
    return loaded ? { ok: true, value: loaded } : { ok: false, reason: "version_parse_failed" };
  }

  private loadRegexProfileVersionInTransaction(
    tx: DbExecutor,
    accountId: string,
    regexProfileId: string,
    versionId: string,
  ): VersionLoadResult<LoadedPromptRegexProfile> {
    const version = tx
      .select({ id: regexProfileVersions.id, regexProfileId: regexProfileVersions.regexProfileId, versionNo: regexProfileVersions.versionNo, dataJson: regexProfileVersions.dataJson, contentHash: regexProfileVersions.contentHash })
      .from(regexProfileVersions)
      .where(and(eq(regexProfileVersions.id, versionId), eq(regexProfileVersions.regexProfileId, regexProfileId)))
      .get();
    if (!version) return { ok: false, reason: "version_row_missing" };

    const asset = tx
      .select({ id: regexProfiles.id, updatedAt: regexProfiles.updatedAt })
      .from(regexProfiles)
      .where(and(eq(regexProfiles.id, version.regexProfileId), eq(regexProfiles.accountId, accountId)))
      .get();
    if (!asset) return { ok: false, reason: "asset_row_missing" };

    const loaded = parseLoadedRegexProfileVersionRow({
      id: asset.id,
      updatedAt: asset.updatedAt,
      version: version.versionNo,
      dataJson: version.dataJson,
    }, version);
    return loaded ? { ok: true, value: loaded } : { ok: false, reason: "version_parse_failed" };
  }
}

function parseLoadedPresetRow(row: PromptPresetRow | null | undefined, versionInfo?: PromptVersionInfo | null): LoadedPromptPreset | null {
  if (!row) return null;

  try {
    return {
      id: row.id,
      updatedAt: row.updatedAt,
      version: row.version,
      versionId: versionInfo?.id ?? null,
      contentHash: versionInfo?.contentHash ?? createAssetContentHash(normalizeAssetVersionDataJson(row.dataJson)),
      preset: parsePreset(JSON.parse(row.dataJson)),
    };
  } catch {
    return null;
  }
}

function parseLoadedPresetVersionRow(row: PromptPresetRow, versionInfo: PromptVersionInfo): LoadedPromptPreset | null {
  try {
    return {
      id: row.id,
      updatedAt: row.updatedAt,
      version: versionInfo.versionNo,
      versionId: versionInfo.id,
      contentHash: versionInfo.contentHash,
      preset: parsePreset(JSON.parse(versionInfo.dataJson)),
    };
  } catch {
    return null;
  }
}

function parseLoadedWorldbookRow(
  row: PromptWorldbookRow | null | undefined,
  entryRows: PromptWorldbookEntryRow[],
  versionInfo?: PromptVersionInfo | null,
): LoadedPromptWorldbook | null {
  if (!row) return null;

  const globalSettings = safeParseJsonObject(row.dataJson);
  const worldbook: STWorldBook = {
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
    caseSensitive: typeof globalSettings.caseSensitive === "boolean" ? globalSettings.caseSensitive : false,
    matchWholeWords: typeof globalSettings.matchWholeWords === "boolean" ? globalSettings.matchWholeWords : false,
    recursive: typeof globalSettings.recursive === "boolean" ? globalSettings.recursive : false,
    maxRecursionSteps: typeof globalSettings.maxRecursionSteps === "number" ? globalSettings.maxRecursionSteps : 0,
  };

  return {
    id: row.id,
    updatedAt: row.updatedAt,
    version: row.version,
    versionId: versionInfo?.id ?? null,
    contentHash: versionInfo?.contentHash ?? createAssetContentHash(normalizeAssetVersionDataJson(worldbook)),
    worldbook,
  };
}

function parseLoadedWorldbookVersionRow(row: PromptPresetRow, versionInfo: PromptVersionInfo): LoadedPromptWorldbook | null {
  try {
    return {
      id: row.id,
      updatedAt: row.updatedAt,
      version: versionInfo.versionNo,
      versionId: versionInfo.id,
      contentHash: versionInfo.contentHash,
      worldbook: parseWorldBook(JSON.parse(versionInfo.dataJson)),
    };
  } catch {
    return null;
  }
}

function parseLoadedRegexProfileRow(
  row: PromptRegexProfileRow | null | undefined,
  versionInfo?: PromptVersionInfo | null,
): LoadedPromptRegexProfile | null {
  if (!row) return null;

  try {
    return {
      id: row.id,
      updatedAt: row.updatedAt,
      version: row.version,
      versionId: versionInfo?.id ?? null,
      contentHash: versionInfo?.contentHash ?? createAssetContentHash(normalizeAssetVersionDataJson(row.dataJson)),
      scripts: parseRegexScripts(JSON.parse(row.dataJson)),
    };
  } catch {
    return null;
  }
}

function parseLoadedRegexProfileVersionRow(row: PromptRegexProfileRow, versionInfo: PromptVersionInfo): LoadedPromptRegexProfile | null {
  try {
    return {
      id: row.id,
      updatedAt: row.updatedAt,
      version: versionInfo.versionNo,
      versionId: versionInfo.id,
      contentHash: versionInfo.contentHash,
      scripts: parseRegexScripts(JSON.parse(versionInfo.dataJson)),
    };
  } catch {
    return null;
  }
}

function loadPresetVersionInfoByNo(tx: DbExecutor, presetId: string, versionNo: number): PromptVersionInfo | null {
  return tx
    .select({ id: presetVersions.id, versionNo: presetVersions.versionNo, dataJson: presetVersions.dataJson, contentHash: presetVersions.contentHash })
    .from(presetVersions)
    .where(and(eq(presetVersions.presetId, presetId), eq(presetVersions.versionNo, versionNo)))
    .limit(1)
    .get() ?? null;
}

function loadWorldbookVersionInfoByNo(tx: DbExecutor, worldbookId: string, versionNo: number): PromptVersionInfo | null {
  return tx
    .select({ id: worldbookVersions.id, versionNo: worldbookVersions.versionNo, dataJson: worldbookVersions.dataJson, contentHash: worldbookVersions.contentHash })
    .from(worldbookVersions)
    .where(and(eq(worldbookVersions.worldbookId, worldbookId), eq(worldbookVersions.versionNo, versionNo)))
    .limit(1)
    .get() ?? null;
}

function loadRegexProfileVersionInfoByNo(tx: DbExecutor, regexProfileId: string, versionNo: number): PromptVersionInfo | null {
  return tx
    .select({ id: regexProfileVersions.id, versionNo: regexProfileVersions.versionNo, dataJson: regexProfileVersions.dataJson, contentHash: regexProfileVersions.contentHash })
    .from(regexProfileVersions)
    .where(and(eq(regexProfileVersions.regexProfileId, regexProfileId), eq(regexProfileVersions.versionNo, versionNo)))
    .limit(1)
    .get() ?? null;
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
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
