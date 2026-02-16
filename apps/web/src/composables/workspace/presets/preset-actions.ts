import type { ComputedRef, Ref } from "vue";

import { fetchPresetAssetDetail } from "../../../lib/workspace-api";
import type { WorkspaceAsset } from "../../../stores/workspace";
import type { EventTone } from "../../../stores/workspace-ui";
import type { PresetManagerMode } from "../assets/asset-manager-dialogs";
import { buildAssetExportFileName, exportAssetJsonFile } from "../assets/asset-export";

type AddEvent = (key: string, tone?: EventTone, vars?: Record<string, number | string>) => void;

type UseWorkspacePresetActionsOptions = {
  activePresetAssetId: Ref<string>;
  addEvent: AddEvent;
  applyLibraryAsset: (assetId: string) => void;
  currentAccount: ComputedRef<string>;
  currentPresetAsset: ComputedRef<WorkspaceAsset | null>;
  openPresetManagerDialog: (mode: PresetManagerMode, assetId: string) => Promise<void>;
  presetAssets: ComputedRef<WorkspaceAsset[]>;
};

export function useWorkspacePresetActions(options: UseWorkspacePresetActionsOptions) {
  function getCurrentPresetAsset(): WorkspaceAsset | null {
    const preset = options.currentPresetAsset.value;
    if (!preset) {
      options.addEvent("events.presetMissing", "warn");
      return null;
    }

    return preset;
  }

  async function editCurrentPreset(): Promise<void> {
    const preset = getCurrentPresetAsset();
    if (!preset) {
      return;
    }

    await options.openPresetManagerDialog("edit", preset.id);
  }

  function switchCurrentPreset(): void {
    const preset = getCurrentPresetAsset();
    if (!preset) {
      return;
    }

    const assets = options.presetAssets.value;
    if (assets.length < 2) {
      options.addEvent("events.presetSwitchUnavailable", "warn");
      return;
    }

    const currentIndex = assets.findIndex((asset) => asset.id === preset.id);
    const next = assets[(currentIndex + 1 + assets.length) % assets.length] ?? null;
    if (!next) {
      return;
    }

    options.activePresetAssetId.value = next.id;
    options.applyLibraryAsset(next.id);
  }

  async function exportCurrentPreset(): Promise<void> {
    const preset = getCurrentPresetAsset();
    if (!preset) {
      return;
    }

    try {
      const detail = await fetchPresetAssetDetail(preset.id, options.currentAccount.value);
      exportAssetJsonFile(
        buildAssetExportFileName(detail.name || preset.name),
        detail.data
      );
      options.addEvent("events.presetExported", "success", { asset: preset.name });
    } catch {
      options.addEvent("events.presetExportFailed", "warn", { asset: preset.name });
    }
  }

  return {
    editCurrentPreset,
    exportCurrentPreset,
    switchCurrentPreset
  };
}
