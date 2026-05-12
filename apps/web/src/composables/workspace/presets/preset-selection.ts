import { computed } from "vue";

import type { SessionState, WorkspaceAsset } from "../../../stores/workspace";

type UseWorkspacePresetSelectionOptions = {
  activeSession: {
    value: SessionState | null;
  };
  libraryAssets: {
    value: WorkspaceAsset[];
  };
};

export function useWorkspacePresetSelection(options: UseWorkspacePresetSelectionOptions) {
  const activePresetAssetId = computed(() => options.activeSession.value?.presetId ?? "");

  const presetAssets = computed(() => {
    return options.libraryAssets.value.filter((asset) => asset.kind === "preset");
  });

  const currentPresetAsset = computed(() => {
    const assets = presetAssets.value;
    if (assets.length === 0) {
      return null;
    }

    const activePresetId = activePresetAssetId.value;
    if (!activePresetId) {
      return null;
    }

    return assets.find((asset) => asset.id === activePresetId) ?? null;
  });

  return {
    currentPresetAsset,
    presetAssets
  };
}
