import type { ComputedRef, Ref } from "vue";

import { mapApiErrorToUiState } from "@tavern/client-helpers";

import {
  createCharacterAssetVersion as createCharacterAssetVersionApi,
  deleteCharacterAsset as deleteCharacterAssetApi,
  deletePresetAsset as deletePresetAssetApi,
  deleteWorldbookAsset as deleteWorldbookAssetApi,
  fetchCharacterAssetDetail as fetchCharacterAssetDetailApi,
  fetchPresetAssetEditorDetail as fetchPresetAssetEditorDetailApi,
  fetchWorldbookAssetDetail as fetchWorldbookAssetDetailApi,
  importLibraryAsset as importLibraryAssetApi,
  restoreCharacterAsset as restoreCharacterAssetApi,
  updatePresetAsset as updatePresetAssetApi,
  updateWorldbookAsset as updateWorldbookAssetApi,
  updateSessionAssetBindings as updateSessionAssetBindingsApi,
  type WorkspaceSessionAssetBindingPatch,
  type WorkspaceAssetKind as ApiWorkspaceAssetKind,
  type WorkspaceCharacterAssetSnapshot,
  type WorkspacePresetEditorDocument
} from "../../../lib/workspace-api";
import { normalizeImportName, resolveImportAssetName } from "../import-utils";
import { toCharacterAssetDetail, toPresetAssetDetail, toWorldbookAssetDetail } from "../mappers";
import { serializePresetEditorDocument, toApiPresetEditorDocument } from "../preset-editor";
import type {
  AssetApplyResult,
  AssetFavoriteResult,
  CharacterAssetDetailResult,
  CharacterAssetMutationResult,
  LibraryHydrationResult,
  LibraryImportFailure,
  LibraryImportOptions,
  LibraryImportProgress,
  LibraryImportResult,
  PresetAssetDeleteResult,
  PresetAssetDetailResult,
  PresetAssetMutationResult,
  PresetAssetSaveMode,
  SessionState,
  WorldbookAssetDetailResult,
  WorldbookAssetMutationResult,
  WorldbookAssetSaveMode,
  WorkspaceAsset,
  WorkspaceAssetImportEntry,
  WorkspaceAssetKind
} from "../types";

type AssetsActionsContext = {
  activeSession: ComputedRef<SessionState | null>;
  currentAccount: ComputedRef<string>;
  findLibraryAsset: (assetId: string) => WorkspaceAsset | null;
  hydrateLibraryAssets: (accountId?: string) => Promise<LibraryHydrationResult>;
  libraryAssets: ComputedRef<WorkspaceAsset[]>;
  sessions: Ref<SessionState[]>;
  syncSessionWorldbookCount: (session: SessionState) => void;
  touchLibraryAsset: (asset: WorkspaceAsset) => void;
};

type PresetAssetMutationFailureReason = Exclude<PresetAssetMutationResult["reason"], "missing" | "unsupported" | undefined>;

type WorldbookAssetMutationFailureReason = Exclude<WorldbookAssetMutationResult["reason"], "missing" | "unsupported" | undefined>;

function resolvePresetAssetMutationFailureReason(error: unknown): PresetAssetMutationFailureReason {
  const uiError = mapApiErrorToUiState(error);
  if (uiError.code === "preset_conflict") {
    return "preset_conflict";
  }
  if (uiError.code === "resource_busy") {
    return "resource_busy";
  }
  return "failed";
}

function resolveWorldbookAssetMutationFailureReason(error: unknown): WorldbookAssetMutationFailureReason {
  const uiError = mapApiErrorToUiState(error);
  if (uiError.code === "worldbook_conflict") {
    return "worldbook_conflict";
  }
  if (uiError.code === "resource_busy") {
    return "resource_busy";
  }
  return "failed";
}

export function createAssetsActions(context: AssetsActionsContext) {
  async function persistSessionAssetBindings(
    session: SessionState,
    bindings: WorkspaceSessionAssetBindingPatch
  ): Promise<boolean> {
    try {
      const updated = await updateSessionAssetBindingsApi(session.id, bindings, session.account || context.currentAccount.value);
      session.deepBinding = updated.deepBinding;
      session.presetId = updated.presetId;
      session.presetVersionId = updated.presetVersionId;
      session.regexProfileId = updated.regexProfileId;
      session.regexProfileVersionId = updated.regexProfileVersionId;
      session.worldbookProfileId = updated.worldbookProfileId;
      session.worldbookVersionId = updated.worldbookVersionId;
      context.syncSessionWorldbookCount(session);
      return false;
    } catch {
      return true;
    }
  }

  function toggleLibraryFavorite(assetId: string): AssetFavoriteResult {
    const asset = context.findLibraryAsset(assetId);
    if (!asset) {
      return {
        asset: null,
        ok: false
      };
    }

    asset.favorite = !asset.favorite;

    return {
      asset,
      ok: true
    };
  }

  async function applyAssetFromLibrary(assetId: string): Promise<AssetApplyResult> {
    const session = context.activeSession.value;
    if (!session) {
      return {
        apiSyncFailed: false,
        asset: null,
        bindingChanged: false,
        ok: false,
        reason: "no_session"
      };
    }

    const asset = context.findLibraryAsset(assetId);
    if (!asset) {
      return {
        apiSyncFailed: false,
        asset: null,
        bindingChanged: false,
        ok: false,
        reason: "missing"
      };
    }

    let bindingChanged = false;
    let apiSyncFailed = false;

    if (asset.kind === "character") {
      session.characterName = asset.name;
      bindingChanged = true;
    } else if (asset.kind === "user") {
      session.userName = asset.name;
      bindingChanged = true;
    } else if (asset.kind === "preset") {
      const previous = session.presetId;
      session.presetId = asset.id;
      bindingChanged = previous !== asset.id;
      if (bindingChanged) {
        apiSyncFailed = await persistSessionAssetBindings(session, { presetId: asset.id });
      }
    } else if (asset.kind === "worldbook") {
      const previous = session.worldbookProfileId;
      session.worldbookProfileId = asset.id;
      bindingChanged = previous !== asset.id;
      if (bindingChanged) {
        apiSyncFailed = await persistSessionAssetBindings(session, { worldbookProfileId: asset.id });
      }
    }

    context.syncSessionWorldbookCount(session);
    context.touchLibraryAsset(asset);

    return {
      apiSyncFailed,
      asset,
      bindingChanged,
      ok: true
    };
  }

  async function importAssetsIntoLibrary(
    kind: WorkspaceAssetKind,
    entries: WorkspaceAssetImportEntry[],
    options: LibraryImportOptions = {}
  ): Promise<LibraryImportResult> {
    if (entries.length === 0) {
      return {
        apiSyncFailed: false,
        failed: 0,
        imported: 0,
        ok: false,
        reason: "empty",
        skipped: 0,
        failures: []
      };
    }

    const failures: LibraryImportFailure[] = [];
    const duplicatePolicy = options.duplicatePolicy ?? "skip";

    const total = entries.length;
    let processed = 0;
    let imported = 0;
    let failed = 0;
    let skipped = 0;

    const reportProgress = (phase: LibraryImportProgress["phase"], currentFile = ""): void => {
      options.onProgress?.({
        currentFile,
        failed,
        imported,
        phase,
        processed,
        skipped,
        total
      });
    };

    reportProgress("preparing");

    const candidates: WorkspaceAssetImportEntry[] = [];
    const existingNames = new Set(
      context.libraryAssets.value
        .filter((asset) => asset.kind === kind)
        .map((asset) => normalizeImportName(asset.name))
        .filter((name) => name.length > 0)
    );
    const batchNames = new Set<string>();

    for (const entry of entries) {
      const assetName = resolveImportAssetName(kind, entry);
      const nameKey = normalizeImportName(assetName);

      if (duplicatePolicy === "skip" && nameKey) {
        if (existingNames.has(nameKey)) {
          skipped += 1;
          processed += 1;
          failures.push({
            assetName,
            fileName: entry.fileName,
            reason: "duplicate_existing"
          });
          reportProgress("preparing", entry.fileName);
          continue;
        }

        if (batchNames.has(nameKey)) {
          skipped += 1;
          processed += 1;
          failures.push({
            assetName,
            fileName: entry.fileName,
            reason: "duplicate_batch"
          });
          reportProgress("preparing", entry.fileName);
          continue;
        }

        batchNames.add(nameKey);
      }

      candidates.push(entry);
    }

    reportProgress("importing");

    for (const entry of candidates) {
      try {
        await importLibraryAssetApi(
          {
            fileName: entry.fileName,
            kind: kind as ApiWorkspaceAssetKind,
            payload: entry.payload
          },
          context.currentAccount.value
        );
        imported += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "Unknown import failure";
        failures.push({
          fileName: entry.fileName,
          message,
          reason: "api"
        });
      } finally {
        processed += 1;
        reportProgress("importing", entry.fileName);
      }
    }

    reportProgress("hydrating");
    const hydration = await context.hydrateLibraryAssets(context.currentAccount.value);
    reportProgress("done");

    return {
      apiSyncFailed: hydration.apiSyncFailed,
      failed,
      imported,
      skipped,
      ok: imported > 0,
      failures
    };
  }

  async function loadPresetAssetDetail(assetId: string): Promise<PresetAssetDetailResult> {
    const asset = context.findLibraryAsset(assetId);
    if (!asset) {
      return {
        detail: null,
        ok: false,
        reason: "missing"
      };
    }

    if (asset.kind !== "preset") {
      return {
        detail: null,
        ok: false,
        reason: "unsupported"
      };
    }

    try {
      const detail = await fetchPresetAssetEditorDetailApi(asset.id, context.currentAccount.value);
      return {
        detail: toPresetAssetDetail(detail),
        ok: true
      };
    } catch {
      return {
        detail: null,
        ok: false,
        reason: "failed"
      };
    }
  }

  async function loadWorldbookAssetDetail(assetId: string): Promise<WorldbookAssetDetailResult> {
    const asset = context.findLibraryAsset(assetId);
    if (!asset) {
      return {
        detail: null,
        ok: false,
        reason: "missing"
      };
    }

    if (asset.kind !== "worldbook") {
      return {
        detail: null,
        ok: false,
        reason: "unsupported"
      };
    }

    try {
      const detail = await fetchWorldbookAssetDetailApi(asset.id, context.currentAccount.value);
      return {
        detail: toWorldbookAssetDetail(detail),
        ok: true
      };
    } catch {
      return {
        detail: null,
        ok: false,
        reason: "failed"
      };
    }
  }

  async function savePresetAsset(
    assetId: string,
    name: string,
    editor: WorkspacePresetEditorDocument,
    expectedVersion: number | undefined,
    mode: PresetAssetSaveMode
  ): Promise<PresetAssetMutationResult> {
    const asset = context.findLibraryAsset(assetId);
    if (!asset) {
      return {
        apiSyncFailed: false,
        asset: null,
        deleteSyncFailed: false,
        ok: false,
        reason: "missing"
      };
    }

    if (asset.kind !== "preset") {
      return {
        apiSyncFailed: false,
        asset: null,
        deleteSyncFailed: false,
        ok: false,
        reason: "unsupported"
      };
    }

    try {
      const payload = serializePresetEditorDocument(editor);
      let targetAssetId = assetId;

      if (mode === "duplicate") {
        const imported = await importLibraryAssetApi(
          {
            fileName: `${name}.json`,
            kind: "preset",
            payload
          },
          context.currentAccount.value
        );
        targetAssetId = imported.id;
      } else {
        const updated = await updatePresetAssetApi(
          assetId,
          name,
          toApiPresetEditorDocument(editor),
          expectedVersion,
          context.currentAccount.value
        );
        targetAssetId = updated.id;
      }

      const hydration = await context.hydrateLibraryAssets(context.currentAccount.value);
      const nextAsset = context.libraryAssets.value.find((item) => item.id === targetAssetId) ?? null;
      return {
        apiSyncFailed: hydration.apiSyncFailed,
        asset: nextAsset,
        deleteSyncFailed: false,
        ok: true
      };
    } catch (error) {
      return {
        apiSyncFailed: false,
        asset: null,
        deleteSyncFailed: false,
        ok: false,
        reason: resolvePresetAssetMutationFailureReason(error)
      };
    }
  }

  async function saveWorldbookAsset(
    assetId: string,
    name: string,
    data: Record<string, unknown>,
    expectedVersion: number | undefined,
    mode: WorldbookAssetSaveMode
  ): Promise<WorldbookAssetMutationResult> {
    const asset = context.findLibraryAsset(assetId);
    if (!asset) {
      return {
        apiSyncFailed: false,
        asset: null,
        ok: false,
        reason: "missing"
      };
    }

    if (asset.kind !== "worldbook") {
      return {
        apiSyncFailed: false,
        asset: null,
        ok: false,
        reason: "unsupported"
      };
    }

    try {
      let targetAssetId = assetId;
      if (mode === "duplicate") {
        const imported = await importLibraryAssetApi(
          {
            fileName: `${name}.json`,
            kind: "worldbook",
            payload: data
          },
          context.currentAccount.value
        );
        targetAssetId = imported.id;
      } else {
        const updated = await updateWorldbookAssetApi(assetId, name, data, expectedVersion, context.currentAccount.value);
        targetAssetId = updated.id;
      }

      const hydration = await context.hydrateLibraryAssets(context.currentAccount.value);
      const nextAsset = context.libraryAssets.value.find((item) => item.id === targetAssetId) ?? null;
      return {
        apiSyncFailed: hydration.apiSyncFailed,
        asset: nextAsset,
        ok: true
      };
    } catch (error) {
      return {
        apiSyncFailed: false,
        asset: null,
        ok: false,
        reason: resolveWorldbookAssetMutationFailureReason(error)
      };
    }
  }

  async function deletePresetLibraryAsset(
    assetId: string,
    expectedVersion: number | undefined
  ): Promise<PresetAssetDeleteResult> {
    const asset = context.findLibraryAsset(assetId);
    if (!asset) {
      return {
        apiSyncFailed: false,
        deleteSyncFailed: false,
        ok: false,
        reason: "missing"
      };
    }

    if (asset.kind !== "preset") {
      return {
        apiSyncFailed: false,
        deleteSyncFailed: false,
        ok: false,
        reason: "unsupported"
      };
    }

    try {
      await deletePresetAssetApi(asset.id, expectedVersion, context.currentAccount.value);
      const hydration = await context.hydrateLibraryAssets(context.currentAccount.value);
      return {
        apiSyncFailed: hydration.apiSyncFailed,
        deleteSyncFailed: false,
        ok: true
      };
    } catch (error) {
      return {
        apiSyncFailed: false,
        deleteSyncFailed: false,
        ok: false,
        reason: resolvePresetAssetMutationFailureReason(error)
      };
    }
  }

  async function deleteWorldbookLibraryAsset(
    assetId: string,
    expectedVersion: number | undefined
  ): Promise<WorldbookAssetMutationResult> {
    const asset = context.findLibraryAsset(assetId);
    if (!asset) {
      return {
        apiSyncFailed: false,
        asset: null,
        ok: false,
        reason: "missing"
      };
    }

    if (asset.kind !== "worldbook") {
      return {
        apiSyncFailed: false,
        asset: null,
        ok: false,
        reason: "unsupported"
      };
    }

    try {
      await deleteWorldbookAssetApi(asset.id, expectedVersion, context.currentAccount.value);
      const hydration = await context.hydrateLibraryAssets(context.currentAccount.value);
      context.sessions.value
        .filter((session) => session.account === context.currentAccount.value && session.worldbookProfileId === asset.id)
        .forEach((session) => {
          session.worldbookProfileId = null;
          context.syncSessionWorldbookCount(session);
        });
      return {
        apiSyncFailed: hydration.apiSyncFailed,
        asset: null,
        ok: true
      };
    } catch (error) {
      return {
        apiSyncFailed: false,
        asset: null,
        ok: false,
        reason: resolveWorldbookAssetMutationFailureReason(error)
      };
    }
  }

  async function loadCharacterAssetDetail(assetId: string): Promise<CharacterAssetDetailResult> {
    const asset = context.findLibraryAsset(assetId);
    if (!asset) {
      return {
        detail: null,
        ok: false,
        reason: "missing"
      };
    }

    if (asset.kind !== "character") {
      return {
        detail: null,
        ok: false,
        reason: "unsupported"
      };
    }

    try {
      const detail = await fetchCharacterAssetDetailApi(asset.id, context.currentAccount.value);
      return {
        detail: toCharacterAssetDetail(detail),
        ok: true
      };
    } catch {
      return {
        detail: null,
        ok: false,
        reason: "failed"
      };
    }
  }

  async function saveCharacterAsset(
    assetId: string,
    snapshot: WorkspaceCharacterAssetSnapshot
  ): Promise<CharacterAssetMutationResult> {
    const asset = context.findLibraryAsset(assetId);
    if (!asset) {
      return {
        apiSyncFailed: false,
        asset: null,
        ok: false,
        reason: "missing"
      };
    }

    if (asset.kind !== "character") {
      return {
        apiSyncFailed: false,
        asset: null,
        ok: false,
        reason: "unsupported"
      };
    }

    try {
      await createCharacterAssetVersionApi(asset.id, snapshot, context.currentAccount.value);
      const hydration = await context.hydrateLibraryAssets(context.currentAccount.value);
      const nextAsset = context.libraryAssets.value.find((item) => item.id === asset.id) ?? asset;
      return {
        apiSyncFailed: hydration.apiSyncFailed,
        asset: nextAsset,
        ok: true
      };
    } catch {
      return {
        apiSyncFailed: false,
        asset: null,
        ok: false,
        reason: "failed"
      };
    }
  }

  async function deleteCharacterLibraryAsset(assetId: string): Promise<CharacterAssetMutationResult> {
    const asset = context.findLibraryAsset(assetId);
    if (!asset) {
      return {
        apiSyncFailed: false,
        asset: null,
        ok: false,
        reason: "missing"
      };
    }

    if (asset.kind !== "character") {
      return {
        apiSyncFailed: false,
        asset: null,
        ok: false,
        reason: "unsupported"
      };
    }

    try {
      await deleteCharacterAssetApi(asset.id, context.currentAccount.value);
      const hydration = await context.hydrateLibraryAssets(context.currentAccount.value);
      const nextAsset = context.libraryAssets.value.find((item) => item.id === asset.id) ?? null;
      return {
        apiSyncFailed: hydration.apiSyncFailed,
        asset: nextAsset,
        ok: true
      };
    } catch {
      return {
        apiSyncFailed: false,
        asset: null,
        ok: false,
        reason: "failed"
      };
    }
  }

  async function restoreCharacterLibraryAsset(assetId: string): Promise<CharacterAssetMutationResult> {
    const asset = context.findLibraryAsset(assetId);

    if (asset && asset.kind !== "character") {
      return {
        apiSyncFailed: false,
        asset: null,
        ok: false,
        reason: "unsupported"
      };
    }

    try {
      await restoreCharacterAssetApi(assetId, context.currentAccount.value);
      const hydration = await context.hydrateLibraryAssets(context.currentAccount.value);
      const nextAsset = context.libraryAssets.value.find((item) => item.id === assetId) ?? null;
      return {
        apiSyncFailed: hydration.apiSyncFailed,
        asset: nextAsset,
        ok: true
      };
    } catch {
      return {
        apiSyncFailed: false,
        asset: null,
        ok: false,
        reason: "failed"
      };
    }
  }

  return {
    applyAssetFromLibrary,
    deleteCharacterLibraryAsset,
    deletePresetLibraryAsset,
    deleteWorldbookLibraryAsset,
    importAssetsIntoLibrary,
    loadCharacterAssetDetail,
    loadPresetAssetDetail,
    loadWorldbookAssetDetail,
    restoreCharacterLibraryAsset,
    saveCharacterAsset,
    savePresetAsset,
    saveWorldbookAsset,
    toggleLibraryFavorite
  };
}
