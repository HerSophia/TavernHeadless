import { and, eq } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../db/client.js";
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

type PromptAssetKind = "preset" | "worldbook" | "regex_profile";

/**
 * 解析会话的 prompt 资产绑定。
 *
 * 该服务只处理 preset、worldbook、regex profile。角色卡仍沿用现有角色版本和快照逻辑。
 */
export class SessionAssetBindingService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  resolveCreate(
    accountId: string,
    workspaceId: string,
    input: SessionAssetBindingWriteInput,
  ): SessionAssetBindingState | SessionAssetBindingError {
    return this.resolve(accountId, workspaceId, emptySessionAssetBindingState(), input);
  }

  resolveUpdate(
    accountId: string,
    workspaceId: string,
    current: SessionAssetBindingState,
    input: SessionAssetBindingWriteInput,
  ): SessionAssetBindingState | SessionAssetBindingError {
    return this.resolve(accountId, workspaceId, current, input);
  }

  private resolve(
    accountId: string,
    workspaceId: string,
    current: SessionAssetBindingState,
    input: SessionAssetBindingWriteInput,
  ): SessionAssetBindingState | SessionAssetBindingError {
    const versionStringProvided = typeof input.preset_version_id === "string"
      || typeof input.regex_profile_version_id === "string"
      || typeof input.worldbook_version_id === "string";
    const deepBinding = input.deep_binding ?? (versionStringProvided ? true : current.deepBinding);

    const preset = this.resolveOne({
      accountId,
      workspaceId,
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
      workspaceId,
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
      workspaceId,
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
    workspaceId: string;
    kind: PromptAssetKind;
    currentAssetId: string | null;
    currentVersionId: string | null;
    inputAssetId?: string | null;
    inputVersionId?: string | null;
    deepBinding: boolean;
  }): { assetId: string | null; versionId: string | null } | SessionAssetBindingError {
    const versionService = new AssetVersionService(this.db);
    let assetId = args.inputAssetId !== undefined ? args.inputAssetId : args.currentAssetId;

    if (args.deepBinding && args.inputVersionId && args.inputAssetId !== null) {
      const loaded = this.loadVersionById(args.kind, versionService, args.accountId, args.workspaceId, args.inputVersionId);
      if (!loaded) return assetVersionNotFoundError();
      if (assetId && loaded.assetId !== assetId) return assetVersionNotFoundError();
      assetId = loaded.assetId;
    }

    if (assetId === null) {
      return { assetId: null, versionId: null };
    }

    if (!assetId || !this.assetOwnedByWorkspace(args.kind, args.accountId, args.workspaceId, assetId)) {
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
      const loaded = this.loadVersionById(args.kind, versionService, args.accountId, args.workspaceId, requestedVersionId);
      if (!loaded || loaded.assetId !== assetId) return assetVersionNotFoundError();
      return { assetId, versionId: loaded.id };
    }

    const latest = this.ensureCurrentVersion(args.kind, versionService, args.accountId, assetId);
    if (!latest) return assetVersionNotFoundError();
    return { assetId, versionId: latest.id };
  }

  private assetOwnedByWorkspace(kind: PromptAssetKind, accountId: string, workspaceId: string, assetId: string): boolean {
    const row = this.loadAssetRecord(kind, accountId, assetId);
    return Boolean(row && isWorkspaceCompatible(row.workspaceId, workspaceId));
  }

  private loadAssetRecord(kind: PromptAssetKind, accountId: string, assetId: string): { id: string; workspaceId: string | null } | null {
    if (kind === "preset") {
      return this.db
        .select({ id: presets.id, workspaceId: presets.workspaceId })
        .from(presets)
        .where(and(eq(presets.id, assetId), eq(presets.accountId, accountId)))
        .limit(1)
        .get() ?? null;
    }

    if (kind === "worldbook") {
      return this.db
        .select({ id: worldbooks.id, workspaceId: worldbooks.workspaceId })
        .from(worldbooks)
        .where(and(eq(worldbooks.id, assetId), eq(worldbooks.accountId, accountId)))
        .limit(1)
        .get() ?? null;
    }

    return this.db
      .select({ id: regexProfiles.id, workspaceId: regexProfiles.workspaceId })
      .from(regexProfiles)
      .where(and(eq(regexProfiles.id, assetId), eq(regexProfiles.accountId, accountId)))
      .limit(1)
      .get() ?? null;
  }

  private loadVersionById(
    kind: PromptAssetKind,
    versionService: AssetVersionService,
    accountId: string,
    workspaceId: string,
    versionId: string,
  ): { id: string; assetId: string } | null {
    if (kind === "preset") {
      const version = versionService.loadPresetVersionById(accountId, versionId);
      if (!version || !this.assetOwnedByWorkspace(kind, accountId, workspaceId, version.presetId)) return null;
      return { id: version.id, assetId: version.presetId };
    }

    if (kind === "worldbook") {
      const version = versionService.loadWorldbookVersionById(accountId, versionId);
      if (!version || !this.assetOwnedByWorkspace(kind, accountId, workspaceId, version.worldbookId)) return null;
      return { id: version.id, assetId: version.worldbookId };
    }

    const version = versionService.loadRegexProfileVersionById(accountId, versionId);
    if (!version || !this.assetOwnedByWorkspace(kind, accountId, workspaceId, version.regexProfileId)) return null;
    return { id: version.id, assetId: version.regexProfileId };
  }

  private ensureCurrentVersion(
    kind: PromptAssetKind,
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

function isWorkspaceCompatible(rowWorkspaceId: string | null, workspaceId: string): boolean {
  // 兼容历史数据：nullable workspace_id 在 Phase 1 期间视为旧账号默认 Workspace 资源。
  return rowWorkspaceId === null || rowWorkspaceId === workspaceId;
}

function assetNotFoundError(kind: PromptAssetKind): SessionAssetBindingError {
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
