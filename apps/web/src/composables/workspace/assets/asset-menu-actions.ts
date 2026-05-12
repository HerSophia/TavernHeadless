import type { CharacterManagerMode, PresetManagerMode, WorldbookManagerMode } from "./asset-manager-dialogs";
import { buildAssetExportFileName, exportAssetJsonFile } from "./asset-export";
import type { WorkspaceAsset, WorldbookAssetDetailResult } from "../../../stores/workspace";
import type { EventTone } from "../../../stores/workspace-ui";

export type AssetMenuAction = "bindWorldbook" | "delete" | "duplicate" | "edit" | "export" | "unbindWorldbook" | "update";

type AddEvent = (key: string, tone?: EventTone, vars?: Record<string, number | string>) => void;

type WorkspaceAssetMenuStore = {
  bindWorldbookToActiveSession: (assetId: string) => Promise<{
    apiSyncFailed: boolean;
    bindingChanged: boolean;
    ok: boolean;
    reason?: "missing" | "no_session" | "unsupported";
    session: unknown;
  }>;
  loadWorldbookAssetDetail: (assetId: string) => Promise<WorldbookAssetDetailResult>;
  previewLibraryAsset: (assetId: string) => WorkspaceAsset | null;
  unbindWorldbookFromActiveSession: (assetId: string) => Promise<{
    apiSyncFailed: boolean;
    guarded: boolean;
    session: unknown;
  }>;
};

type UseWorkspaceAssetMenuActionsOptions = {
  addEvent: AddEvent;
  closeAssetContextMenu: () => void;
  flashBindingCard: () => void;
  openCharacterManagerDialog: (mode: CharacterManagerMode, assetId: string) => Promise<void>;
  openPresetManagerDialog: (mode: PresetManagerMode, assetId: string) => Promise<void>;
  openWorldbookManagerDialog: (mode: WorldbookManagerMode, assetId: string) => Promise<void>;
  resolveTargetAssetId: () => string;
  workspace: WorkspaceAssetMenuStore;
};

export function useWorkspaceAssetMenuActions(options: UseWorkspaceAssetMenuActionsOptions) {
  async function handleAssetMenuAction(action: AssetMenuAction): Promise<void> {
    const targetId = options.resolveTargetAssetId();
    options.closeAssetContextMenu();

    if (!targetId) {
      options.addEvent("events.assetMissing", "warn");
      return;
    }

    const asset = options.workspace.previewLibraryAsset(targetId);
    if (!asset) {
      options.addEvent("events.assetMissing", "warn");
      return;
    }

    if (asset.kind === "preset") {
      if (action === "edit" || action === "update" || action === "duplicate" || action === "delete") {
        await options.openPresetManagerDialog(action, targetId);
        return;
      }

      if (action === "export") {
        options.addEvent("events.assetManagePresetCharacterOnly", "warn");
        return;
      }

      options.addEvent("events.assetManageFailed", "warn");
      return;
    }

    if (asset.kind === "worldbook") {
      if (action === "bindWorldbook") {
        const result = await options.workspace.bindWorldbookToActiveSession(asset.id);
        if (!result.ok || !result.session) {
          options.addEvent(result.reason === "no_session" ? "events.sessionNone" : "events.assetManageFailed", "warn");
          return;
        }

        if (result.bindingChanged) {
          options.flashBindingCard();
        }

        options.addEvent("events.worldbookBound", "success", { asset: asset.name });
        if (result.apiSyncFailed) {
          options.addEvent("events.apiSyncFailed", "warn");
        }
        return;
      }

      if (action === "unbindWorldbook") {
        const result = await options.workspace.unbindWorldbookFromActiveSession(asset.id);
        if (!result.session || result.guarded) {
          options.addEvent("events.worldbookUnbindGuarded", "warn", { asset: asset.name });
          return;
        }

        options.flashBindingCard();
        options.addEvent("events.worldbookUnbound", "warn", { asset: asset.name });
        if (result.apiSyncFailed) {
          options.addEvent("events.apiSyncFailed", "warn");
        }
        return;
      }

      if (action === "export") {
        try {
          const detailResult = await options.workspace.loadWorldbookAssetDetail(asset.id);
          if (!detailResult.ok || !detailResult.detail) {
            options.addEvent("events.worldbookExportFailed", "warn", { asset: asset.name });
            return;
          }

          exportAssetJsonFile(
            buildAssetExportFileName(detailResult.detail.name || asset.name),
            detailResult.detail.data
          );
          options.addEvent("events.worldbookExported", "success", { asset: asset.name });
        } catch {
          options.addEvent("events.worldbookExportFailed", "warn", { asset: asset.name });
        }
        return;
      }

      if (action !== "delete" && action !== "duplicate" && action !== "edit" && action !== "update") {
        options.addEvent("events.assetManageFailed", "warn");
        return;
      }

      await options.openWorldbookManagerDialog(action, targetId);
      return;
    }

    if (asset.kind === "character") {
      const isDeleted = asset.tags.includes("deleted");
      const mode: CharacterManagerMode =
        action === "delete"
          ? isDeleted
            ? "restore"
            : "delete"
          : action === "edit"
            ? "edit"
            : "update";

      if (action === "export") {
        options.addEvent("events.assetManagePresetCharacterOnly", "warn");
        return;
      }

      if (action === "bindWorldbook" || action === "unbindWorldbook") {
        options.addEvent("events.assetManageFailed", "warn");
        return;
      }

      await options.openCharacterManagerDialog(mode, targetId);
      return;
    }

    options.addEvent("events.assetManagePresetCharacterOnly", "warn");
  }

  return {
    handleAssetMenuAction
  };
}
