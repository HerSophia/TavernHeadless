import { computed, ref, watch } from "vue";

import type { WorkspaceAsset } from "../../../stores/workspace";

type UseWorkspacePresetSelectionOptions = {
  libraryAssets: {
    value: WorkspaceAsset[];
  };
};

export function useWorkspacePresetSelection(options: UseWorkspacePresetSelectionOptions) {
  const activePresetAssetId = ref("");

  const presetAssets = computed(() => {
    return options.libraryAssets.value.filter((asset) => asset.kind === "preset");
  });

  const currentPresetAsset = computed(() => {
    const assets = presetAssets.value;
    if (assets.length === 0) {
      return null;
    }

    const active = activePresetAssetId.value;
    if (active) {
      const matched = assets.find((asset) => asset.id === active);
      if (matched) {
        return matched;
      }
    }

    return assets[0] ?? null;
  });

  watch(
    presetAssets,
    (assets) => {
      if (assets.length === 0) {
        activePresetAssetId.value = "";
        return;
      }

      if (!assets.some((asset) => asset.id === activePresetAssetId.value)) {
        activePresetAssetId.value = assets[0]!.id;
      }
    },
    { immediate: true }
  );

  return {
    activePresetAssetId,
    currentPresetAsset,
    presetAssets
  };
}
