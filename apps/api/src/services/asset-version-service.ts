import { createHash } from "node:crypto";

import { and, asc, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { STWorldBook } from "@tavern/adapters-sillytavern";

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

type AssetVersionDb = AppDb | DbExecutor;

type PresetVersionRow = typeof presetVersions.$inferSelect;
type WorldbookVersionRow = typeof worldbookVersions.$inferSelect;
type RegexProfileVersionRow = typeof regexProfileVersions.$inferSelect;

type CreateAssetVersionInput = {
  versionNo: number;
  data: unknown;
  parentVersionId?: string | null;
  createdByOperationId?: string | null;
  createdAt?: number;
};

export type PromptAssetVersionKind = "preset" | "worldbook" | "regex_profile";

export type PromptAssetVersionRef = {
  id: string;
  assetId: string;
  kind: PromptAssetVersionKind;
  versionNo: number;
  dataJson: string;
  contentHash: string;
  parentVersionId: string | null;
  createdByOperationId: string | null;
  createdAt: number;
};

/**
 * 用于 preset、worldbook、regex profile 的不可变版本服务。
 *
 * 资产主表仍然保存当前内容。版本表保存每次写入后的快照，供深度绑定、审计和回放读取。
 */
export class AssetVersionService {
  constructor(private readonly db: AssetVersionDb) {}

  listPresetVersions(accountId: string, presetId: string): PresetVersionRow[] | null {
    if (!this.getOwnedPreset(accountId, presetId)) return null;
    return this.db
      .select()
      .from(presetVersions)
      .where(eq(presetVersions.presetId, presetId))
      .orderBy(asc(presetVersions.versionNo), asc(presetVersions.createdAt))
      .all();
  }

  listWorldbookVersions(accountId: string, worldbookId: string): WorldbookVersionRow[] | null {
    if (!this.getOwnedWorldbook(accountId, worldbookId)) return null;
    return this.db
      .select()
      .from(worldbookVersions)
      .where(eq(worldbookVersions.worldbookId, worldbookId))
      .orderBy(asc(worldbookVersions.versionNo), asc(worldbookVersions.createdAt))
      .all();
  }

  listRegexProfileVersions(accountId: string, regexProfileId: string): RegexProfileVersionRow[] | null {
    if (!this.getOwnedRegexProfile(accountId, regexProfileId)) return null;
    return this.db
      .select()
      .from(regexProfileVersions)
      .where(eq(regexProfileVersions.regexProfileId, regexProfileId))
      .orderBy(asc(regexProfileVersions.versionNo), asc(regexProfileVersions.createdAt))
      .all();
  }

  getLatestPresetVersion(accountId: string, presetId: string): PresetVersionRow | null {
    if (!this.getOwnedPreset(accountId, presetId)) return null;
    return this.db
      .select()
      .from(presetVersions)
      .where(eq(presetVersions.presetId, presetId))
      .orderBy(desc(presetVersions.versionNo), desc(presetVersions.createdAt))
      .limit(1)
      .get() ?? null;
  }

  getLatestWorldbookVersion(accountId: string, worldbookId: string): WorldbookVersionRow | null {
    if (!this.getOwnedWorldbook(accountId, worldbookId)) return null;
    return this.db
      .select()
      .from(worldbookVersions)
      .where(eq(worldbookVersions.worldbookId, worldbookId))
      .orderBy(desc(worldbookVersions.versionNo), desc(worldbookVersions.createdAt))
      .limit(1)
      .get() ?? null;
  }

  getLatestRegexProfileVersion(accountId: string, regexProfileId: string): RegexProfileVersionRow | null {
    if (!this.getOwnedRegexProfile(accountId, regexProfileId)) return null;
    return this.db
      .select()
      .from(regexProfileVersions)
      .where(eq(regexProfileVersions.regexProfileId, regexProfileId))
      .orderBy(desc(regexProfileVersions.versionNo), desc(regexProfileVersions.createdAt))
      .limit(1)
      .get() ?? null;
  }

  loadPresetVersion(accountId: string, presetId: string, versionId: string): PresetVersionRow | null {
    if (!this.getOwnedPreset(accountId, presetId)) return null;
    return this.db
      .select()
      .from(presetVersions)
      .where(and(eq(presetVersions.id, versionId), eq(presetVersions.presetId, presetId)))
      .limit(1)
      .get() ?? null;
  }

  loadWorldbookVersion(accountId: string, worldbookId: string, versionId: string): WorldbookVersionRow | null {
    if (!this.getOwnedWorldbook(accountId, worldbookId)) return null;
    return this.db
      .select()
      .from(worldbookVersions)
      .where(and(eq(worldbookVersions.id, versionId), eq(worldbookVersions.worldbookId, worldbookId)))
      .limit(1)
      .get() ?? null;
  }

  loadRegexProfileVersion(accountId: string, regexProfileId: string, versionId: string): RegexProfileVersionRow | null {
    if (!this.getOwnedRegexProfile(accountId, regexProfileId)) return null;
    return this.db
      .select()
      .from(regexProfileVersions)
      .where(and(eq(regexProfileVersions.id, versionId), eq(regexProfileVersions.regexProfileId, regexProfileId)))
      .limit(1)
      .get() ?? null;
  }

  loadPresetVersionById(accountId: string, versionId: string): PresetVersionRow | null {
    const version = this.db
      .select()
      .from(presetVersions)
      .where(eq(presetVersions.id, versionId))
      .limit(1)
      .get();
    if (!version || !this.getOwnedPreset(accountId, version.presetId)) return null;
    return version;
  }

  loadWorldbookVersionById(accountId: string, versionId: string): WorldbookVersionRow | null {
    const version = this.db
      .select()
      .from(worldbookVersions)
      .where(eq(worldbookVersions.id, versionId))
      .limit(1)
      .get();
    if (!version || !this.getOwnedWorldbook(accountId, version.worldbookId)) return null;
    return version;
  }

  loadRegexProfileVersionById(accountId: string, versionId: string): RegexProfileVersionRow | null {
    const version = this.db
      .select()
      .from(regexProfileVersions)
      .where(eq(regexProfileVersions.id, versionId))
      .limit(1)
      .get();
    if (!version || !this.getOwnedRegexProfile(accountId, version.regexProfileId)) return null;
    return version;
  }

  createPresetVersion(presetId: string, input: CreateAssetVersionInput): PresetVersionRow {
    const existing = this.getPresetVersionByNo(presetId, input.versionNo);
    if (existing) return existing;

    const dataJson = normalizeAssetVersionDataJson(input.data);
    const now = input.createdAt ?? Date.now();
    const parentVersionId = input.parentVersionId !== undefined
      ? input.parentVersionId
      : this.getLatestPresetVersionForAsset(presetId)?.id ?? null;

    const [created] = this.db
      .insert(presetVersions)
      .values({
        id: nanoid(),
        presetId,
        parentVersionId,
        versionNo: input.versionNo,
        dataJson,
        contentHash: createAssetContentHash(dataJson),
        createdByOperationId: input.createdByOperationId ?? null,
        createdAt: now,
      })
      .returning()
      .all();

    return created ?? this.getPresetVersionByNo(presetId, input.versionNo)!;
  }

  createWorldbookVersion(worldbookId: string, input: Omit<CreateAssetVersionInput, "data"> & { data?: unknown }): WorldbookVersionRow {
    const existing = this.getWorldbookVersionByNo(worldbookId, input.versionNo);
    if (existing) return existing;

    const data = input.data ?? this.buildWorldbookVersionSnapshot(worldbookId);
    const dataJson = normalizeAssetVersionDataJson(data);
    const now = input.createdAt ?? Date.now();
    const parentVersionId = input.parentVersionId !== undefined
      ? input.parentVersionId
      : this.getLatestWorldbookVersionForAsset(worldbookId)?.id ?? null;

    const [created] = this.db
      .insert(worldbookVersions)
      .values({
        id: nanoid(),
        worldbookId,
        parentVersionId,
        versionNo: input.versionNo,
        dataJson,
        contentHash: createAssetContentHash(dataJson),
        createdByOperationId: input.createdByOperationId ?? null,
        createdAt: now,
      })
      .returning()
      .all();

    return created ?? this.getWorldbookVersionByNo(worldbookId, input.versionNo)!;
  }

  createRegexProfileVersion(regexProfileId: string, input: CreateAssetVersionInput): RegexProfileVersionRow {
    const existing = this.getRegexProfileVersionByNo(regexProfileId, input.versionNo);
    if (existing) return existing;

    const dataJson = normalizeAssetVersionDataJson(input.data);
    const now = input.createdAt ?? Date.now();
    const parentVersionId = input.parentVersionId !== undefined
      ? input.parentVersionId
      : this.getLatestRegexProfileVersionForAsset(regexProfileId)?.id ?? null;

    const [created] = this.db
      .insert(regexProfileVersions)
      .values({
        id: nanoid(),
        regexProfileId,
        parentVersionId,
        versionNo: input.versionNo,
        dataJson,
        contentHash: createAssetContentHash(dataJson),
        createdByOperationId: input.createdByOperationId ?? null,
        createdAt: now,
      })
      .returning()
      .all();

    return created ?? this.getRegexProfileVersionByNo(regexProfileId, input.versionNo)!;
  }

  ensureCurrentPresetVersion(accountId: string, presetId: string, createdAt = Date.now()): PresetVersionRow | null {
    const preset = this.getOwnedPreset(accountId, presetId);
    if (!preset) return null;
    return this.getPresetVersionByNo(preset.id, Math.max(1, preset.version))
      ?? this.createPresetVersion(preset.id, { versionNo: Math.max(1, preset.version), data: preset.dataJson, createdAt });
  }

  ensureCurrentWorldbookVersion(accountId: string, worldbookId: string, createdAt = Date.now()): WorldbookVersionRow | null {
    const worldbook = this.getOwnedWorldbook(accountId, worldbookId);
    if (!worldbook) return null;
    return this.getWorldbookVersionByNo(worldbook.id, Math.max(1, worldbook.version))
      ?? this.createWorldbookVersion(worldbook.id, { versionNo: Math.max(1, worldbook.version), createdAt });
  }

  ensureCurrentRegexProfileVersion(accountId: string, regexProfileId: string, createdAt = Date.now()): RegexProfileVersionRow | null {
    const profile = this.getOwnedRegexProfile(accountId, regexProfileId);
    if (!profile) return null;
    return this.getRegexProfileVersionByNo(profile.id, Math.max(1, profile.version))
      ?? this.createRegexProfileVersion(profile.id, { versionNo: Math.max(1, profile.version), data: profile.dataJson, createdAt });
  }

  ensureInitialVersionsForAccount(accountId: string): void {
    const now = Date.now();
    for (const row of this.db.select().from(presets).where(eq(presets.accountId, accountId)).all()) {
      this.ensureCurrentPresetVersion(accountId, row.id, row.createdAt || now);
    }
    for (const row of this.db.select().from(worldbooks).where(eq(worldbooks.accountId, accountId)).all()) {
      this.ensureCurrentWorldbookVersion(accountId, row.id, row.createdAt || now);
    }
    for (const row of this.db.select().from(regexProfiles).where(eq(regexProfiles.accountId, accountId)).all()) {
      this.ensureCurrentRegexProfileVersion(accountId, row.id, row.createdAt || now);
    }
  }

  ensureInitialVersionsForAllAccounts(): void {
    const now = Date.now();
    for (const row of this.db.select().from(presets).all()) {
      if (!this.getPresetVersionByNo(row.id, Math.max(1, row.version))) {
        this.createPresetVersion(row.id, { versionNo: Math.max(1, row.version), data: row.dataJson, createdAt: row.createdAt || now });
      }
    }
    for (const row of this.db.select().from(worldbooks).all()) {
      if (!this.getWorldbookVersionByNo(row.id, Math.max(1, row.version))) {
        this.createWorldbookVersion(row.id, { versionNo: Math.max(1, row.version), createdAt: row.createdAt || now });
      }
    }
    for (const row of this.db.select().from(regexProfiles).all()) {
      if (!this.getRegexProfileVersionByNo(row.id, Math.max(1, row.version))) {
        this.createRegexProfileVersion(row.id, { versionNo: Math.max(1, row.version), data: row.dataJson, createdAt: row.createdAt || now });
      }
    }
  }

  buildWorldbookVersionSnapshot(worldbookId: string): STWorldBook {
    const worldbook = this.db
      .select()
      .from(worldbooks)
      .where(eq(worldbooks.id, worldbookId))
      .limit(1)
      .get();
    if (!worldbook) {
      throw new Error(`Worldbook not found: ${worldbookId}`);
    }

    const globalSettings = parseJsonObject(worldbook.dataJson);
    const entries = this.db
      .select()
      .from(worldbookEntries)
      .where(eq(worldbookEntries.worldbookId, worldbook.id))
      .orderBy(asc(worldbookEntries.order), asc(worldbookEntries.uid), asc(worldbookEntries.id))
      .all();

    return {
      name: worldbook.name,
      entries: entries.map((entry) => ({
        uid: entry.uid,
        key: parseStringArray(entry.keysJson),
        keysecondary: parseStringArray(entry.keysSecondaryJson),
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
  }

  private getOwnedPreset(accountId: string, presetId: string): typeof presets.$inferSelect | null {
    return this.db
      .select()
      .from(presets)
      .where(and(eq(presets.id, presetId), eq(presets.accountId, accountId)))
      .limit(1)
      .get() ?? null;
  }

  private getOwnedWorldbook(accountId: string, worldbookId: string): typeof worldbooks.$inferSelect | null {
    return this.db
      .select()
      .from(worldbooks)
      .where(and(eq(worldbooks.id, worldbookId), eq(worldbooks.accountId, accountId)))
      .limit(1)
      .get() ?? null;
  }

  private getOwnedRegexProfile(accountId: string, regexProfileId: string): typeof regexProfiles.$inferSelect | null {
    return this.db
      .select()
      .from(regexProfiles)
      .where(and(eq(regexProfiles.id, regexProfileId), eq(regexProfiles.accountId, accountId)))
      .limit(1)
      .get() ?? null;
  }

  private getPresetVersionByNo(presetId: string, versionNo: number): PresetVersionRow | null {
    return this.db
      .select()
      .from(presetVersions)
      .where(and(eq(presetVersions.presetId, presetId), eq(presetVersions.versionNo, versionNo)))
      .limit(1)
      .get() ?? null;
  }

  private getWorldbookVersionByNo(worldbookId: string, versionNo: number): WorldbookVersionRow | null {
    return this.db
      .select()
      .from(worldbookVersions)
      .where(and(eq(worldbookVersions.worldbookId, worldbookId), eq(worldbookVersions.versionNo, versionNo)))
      .limit(1)
      .get() ?? null;
  }

  private getRegexProfileVersionByNo(regexProfileId: string, versionNo: number): RegexProfileVersionRow | null {
    return this.db
      .select()
      .from(regexProfileVersions)
      .where(and(eq(regexProfileVersions.regexProfileId, regexProfileId), eq(regexProfileVersions.versionNo, versionNo)))
      .limit(1)
      .get() ?? null;
  }

  private getLatestPresetVersionForAsset(presetId: string): PresetVersionRow | null {
    return this.db
      .select()
      .from(presetVersions)
      .where(eq(presetVersions.presetId, presetId))
      .orderBy(desc(presetVersions.versionNo), desc(presetVersions.createdAt))
      .limit(1)
      .get() ?? null;
  }

  private getLatestWorldbookVersionForAsset(worldbookId: string): WorldbookVersionRow | null {
    return this.db
      .select()
      .from(worldbookVersions)
      .where(eq(worldbookVersions.worldbookId, worldbookId))
      .orderBy(desc(worldbookVersions.versionNo), desc(worldbookVersions.createdAt))
      .limit(1)
      .get() ?? null;
  }

  private getLatestRegexProfileVersionForAsset(regexProfileId: string): RegexProfileVersionRow | null {
    return this.db
      .select()
      .from(regexProfileVersions)
      .where(eq(regexProfileVersions.regexProfileId, regexProfileId))
      .orderBy(desc(regexProfileVersions.versionNo), desc(regexProfileVersions.createdAt))
      .limit(1)
      .get() ?? null;
  }
}

export function toPresetVersionRef(row: PresetVersionRow): PromptAssetVersionRef {
  return {
    id: row.id,
    assetId: row.presetId,
    kind: "preset",
    versionNo: row.versionNo,
    dataJson: row.dataJson,
    contentHash: row.contentHash,
    parentVersionId: row.parentVersionId,
    createdByOperationId: row.createdByOperationId,
    createdAt: row.createdAt,
  };
}

export function toWorldbookVersionRef(row: WorldbookVersionRow): PromptAssetVersionRef {
  return {
    id: row.id,
    assetId: row.worldbookId,
    kind: "worldbook",
    versionNo: row.versionNo,
    dataJson: row.dataJson,
    contentHash: row.contentHash,
    parentVersionId: row.parentVersionId,
    createdByOperationId: row.createdByOperationId,
    createdAt: row.createdAt,
  };
}

export function toRegexProfileVersionRef(row: RegexProfileVersionRow): PromptAssetVersionRef {
  return {
    id: row.id,
    assetId: row.regexProfileId,
    kind: "regex_profile",
    versionNo: row.versionNo,
    dataJson: row.dataJson,
    contentHash: row.contentHash,
    parentVersionId: row.parentVersionId,
    createdByOperationId: row.createdByOperationId,
    createdAt: row.createdAt,
  };
}

export function normalizeAssetVersionDataJson(value: unknown): string {
  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    return stableStringify(parsed.parsed ? parsed.value : value);
  }

  return stableStringify(value ?? null);
}

export function createAssetContentHash(dataJson: string): string {
  return `sha256:${createHash("sha256").update(dataJson).digest("hex")}`;
}

export function parseAssetVersionDataJson(dataJson: string): unknown {
  const parsed = tryParseJson(dataJson);
  return parsed.parsed ? parsed.value : dataJson;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableStringify(value));
}

function normalizeForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableStringify(item));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, normalizeForStableStringify(record[key])]),
    );
  }

  return value;
}

function tryParseJson(raw: string): { parsed: true; value: unknown } | { parsed: false } {
  try {
    return { parsed: true, value: JSON.parse(raw) };
  } catch {
    return { parsed: false };
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const parsed = tryParseJson(raw);
  return parsed.parsed && parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
    ? parsed.value as Record<string, unknown>
    : {};
}

function parseStringArray(raw: string): string[] {
  const parsed = tryParseJson(raw);
  return parsed.parsed && Array.isArray(parsed.value)
    ? parsed.value.filter((item): item is string => typeof item === "string")
    : [];
}
