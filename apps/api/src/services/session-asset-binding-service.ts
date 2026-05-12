import { and, eq } from "drizzle-orm";

import type { AppDb } from "../db/client.js";
import { presets, regexProfiles, worldbooks } from "../db/schema.js";
import { AssetVersionService } from "./asset-version-service.js";

export type SessionAssetBindingError = {
  statusCode: number;
  code: string;
  message: string;
};

export type SessionAssetBindingState = {
  presetId: string | null;
  regexProfileId: string | null;
  worldbookProfileId: string | null;
  deepBinding: boolean;
  presetVersionId: string | null;
  regexProfileVersionId: string | null;
  worldbookVersionId: string | null;
};

export type SessionAssetBindingWriteInput = {
  preset_id?: string | null;
  regex_profile_id?: string | null;
  worldbook_profile_id?: string | null;
  deep_binding?: boolean;
  preset_version_id?: string | null;
  regex_profile_version_id?: string | null;
  worldbook_version_id?: string | null;
};

/**
 * 解析会话的 prompt 资产绑定。
 *
 * 该服务只处理 preset、worldbook、regex profile。角色卡仍沿用现有角色版本和快照逻辑。
 */
export class SessionAssetBindingService {
  constructor(private readonly db: AppDb) {}

  resolveCreate(
    accountId: string,
    input: SessionAssetBindingWriteInput,
  ): SessionAssetBindingState | SessionAssetBindingError {
    return this.resolve(accountId, emptySessionAssetBindingState(), input);
  }

  resolveUpdate(
    accountId: string,
    current: SessionAssetBindingState,
    input: SessionAssetBindingWriteInput,
  ): SessionAssetBindingState | SessionAssetBindingError {
    return this.resolve(accountId, current, input);
  }

  private resolve(
    accountId: string,
    current: SessionAssetBindingState,
    input: SessionAssetBindingWriteInput,
  ): SessionAssetBindingState | SessionAssetBindingError {
    const versionStringProvided = typeof input.preset_version_id === "string"
      || typeof input.regex_profile_version_id === "string"
      || typeof input.worldbook_version_id === "string";
    const deepBinding = input.deep_binding ?? (versionStringProvided ? true : current.deepBinding);

    const preset = this.resolveOne({
      accountId,
      kind: "preset",
      currentAssetId: current.presetId,
      currentVersionId: current.presetVersionId,
      inputAssetId: input.preset_id,
      inputVersionId: input.preset_version_id,
      deepBinding,
    });
    if ("statusCode" in preset) return preset;

    const regexProfile = this.resolveOne({
      accountId,
      kind: "regex_profile",
      currentAssetId: current.regexProfileId,
      currentVersionId: current.regexProfileVersionId,
      inputAssetId: input.regex_profile_id,
      inputVersionId: input.regex_profile_version_id,
      deepBinding,
    });
    if ("statusCode" in regexProfile) return regexProfile;

    const worldbook = this.resolveOne({
      accountId,
      kind: "worldbook",
      currentAssetId: current.worldbookProfileId,
      currentVersionId: current.worldbookVersionId,
      inputAssetId: input.worldbook_profile_id,
      inputVersionId: input.worldbook_version_id,
      deepBinding,
    });
    if ("statusCode" in worldbook) return worldbook;

    return {
      presetId: preset.assetId,
      presetVersionId: preset.versionId,
      regexProfileId: regexProfile.assetId,
      regexProfileVersionId: regexProfile.versionId,
      worldbookProfileId: worldbook.assetId,
      worldbookVersionId: worldbook.versionId,
      deepBinding,
    };
  }

  private resolveOne(args: {
    accountId: string;
    kind: "preset" | "worldbook" | "regex_profile";
    currentAssetId: string | null;
    currentVersionId: string | null;
    inputAssetId?: string | null;
    inputVersionId?: string | null;
    deepBinding: boolean;
  }): { assetId: string | null; versionId: string | null } | SessionAssetBindingError {
    const versionService = new AssetVersionService(this.db);
    let assetId = args.inputAssetId !== undefined ? args.inputAssetId : args.currentAssetId;

    if (args.deepBinding && args.inputVersionId && args.inputAssetId !== null) {
      const loaded = this.loadVersionById(args.kind, versionService, args.accountId, args.inputVersionId);
      if (!loaded) return assetVersionNotFoundError();
      if (assetId && loaded.assetId !== assetId) return assetVersionNotFoundError();
      assetId = loaded.assetId;
    }

    if (assetId === null) {
      return { assetId: null, versionId: null };
    }

    if (!assetId || !this.assetOwnedByAccount(args.kind, args.accountId, assetId)) {
      return assetNotFoundError(args.kind);
    }

    if (!args.deepBinding) {
      return { assetId, versionId: null };
    }

    if (args.inputVersionId === null) {
      return { assetId, versionId: null };
    }

    const requestedVersionId = args.inputVersionId !== undefined
      ? args.inputVersionId
      : args.inputAssetId === undefined && args.currentAssetId === assetId
        ? args.currentVersionId
        : undefined;

    if (requestedVersionId) {
      const loaded = this.loadVersionById(args.kind, versionService, args.accountId, requestedVersionId);
      if (!loaded || loaded.assetId !== assetId) return assetVersionNotFoundError();
      return { assetId, versionId: loaded.id };
    }

    const latest = this.ensureCurrentVersion(args.kind, versionService, args.accountId, assetId);
    if (!latest) return assetVersionNotFoundError();
    return { assetId, versionId: latest.id };
  }

  private assetOwnedByAccount(kind: "preset" | "worldbook" | "regex_profile", accountId: string, assetId: string): boolean {
    if (kind === "preset") {
      const row = this.db
        .select({ id: presets.id })
        .from(presets)
        .where(and(eq(presets.id, assetId), eq(presets.accountId, accountId)))
        .limit(1)
        .get();
      return Boolean(row);
    }

    if (kind === "worldbook") {
      const row = this.db
        .select({ id: worldbooks.id })
        .from(worldbooks)
        .where(and(eq(worldbooks.id, assetId), eq(worldbooks.accountId, accountId)))
        .limit(1)
        .get();
      return Boolean(row);
    }

    const row = this.db
      .select({ id: regexProfiles.id })
      .from(regexProfiles)
      .where(and(eq(regexProfiles.id, assetId), eq(regexProfiles.accountId, accountId)))
      .limit(1)
      .get();
    return Boolean(row);
  }

  private loadVersionById(
    kind: "preset" | "worldbook" | "regex_profile",
    versionService: AssetVersionService,
    accountId: string,
    versionId: string,
  ): { id: string; assetId: string } | null {
    if (kind === "preset") {
      const version = versionService.loadPresetVersionById(accountId, versionId);
      return version ? { id: version.id, assetId: version.presetId } : null;
    }

    if (kind === "worldbook") {
      const version = versionService.loadWorldbookVersionById(accountId, versionId);
      return version ? { id: version.id, assetId: version.worldbookId } : null;
    }

    const version = versionService.loadRegexProfileVersionById(accountId, versionId);
    return version ? { id: version.id, assetId: version.regexProfileId } : null;
  }

  private ensureCurrentVersion(
    kind: "preset" | "worldbook" | "regex_profile",
    versionService: AssetVersionService,
    accountId: string,
    assetId: string,
  ): { id: string } | null {
    if (kind === "preset") return versionService.ensureCurrentPresetVersion(accountId, assetId);
    if (kind === "worldbook") return versionService.ensureCurrentWorldbookVersion(accountId, assetId);
    return versionService.ensureCurrentRegexProfileVersion(accountId, assetId);
  }
}

export function emptySessionAssetBindingState(): SessionAssetBindingState {
  return {
    presetId: null,
    regexProfileId: null,
    worldbookProfileId: null,
    deepBinding: false,
    presetVersionId: null,
    regexProfileVersionId: null,
    worldbookVersionId: null,
  };
}

function assetNotFoundError(kind: "preset" | "worldbook" | "regex_profile"): SessionAssetBindingError {
  if (kind === "preset") {
    return { statusCode: 404, code: "preset_not_found", message: "Preset not found" };
  }
  if (kind === "worldbook") {
    return { statusCode: 404, code: "worldbook_not_found", message: "Worldbook not found" };
  }
  return { statusCode: 404, code: "regex_profile_not_found", message: "Regex profile not found" };
}

function assetVersionNotFoundError(): SessionAssetBindingError {
  return { statusCode: 404, code: "asset_version_not_found", message: "Asset version not found" };
}
