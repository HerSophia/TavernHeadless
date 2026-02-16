import { reactive } from "vue";

import type { WorkspaceAsset } from "../../../stores/workspace";

type WorkspaceAssetContextMenuStore = {
  isWorldbookBoundToActiveSession: (assetId: string) => boolean;
  previewLibraryAsset: (assetId: string) => WorkspaceAsset | null;
};

type UseWorkspaceAssetContextMenuOptions = {
  onOpen?: () => void;
  workspace: WorkspaceAssetContextMenuStore;
};

export function useWorkspaceAssetContextMenu(options: UseWorkspaceAssetContextMenuOptions) {
  const assetContextMenu = reactive({
    targetAssetId: "",
    targetAssetKind: "preset" as WorkspaceAsset["kind"],
    visible: false,
    worldbookBound: false,
    x: 0,
    y: 0
  });

  function closeAssetContextMenu(): void {
    assetContextMenu.visible = false;
    assetContextMenu.targetAssetId = "";
    assetContextMenu.targetAssetKind = "preset";
    assetContextMenu.worldbookBound = false;
  }

  function openAssetContextMenu(event: MouseEvent, assetId: string): void {
    const asset = options.workspace.previewLibraryAsset(assetId);
    if (!asset) {
      return;
    }

    const width = 196;
    const height = asset.kind === "worldbook" ? 246 : 182;
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - width - 10));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - height - 10));

    options.onOpen?.();
    assetContextMenu.targetAssetId = assetId;
    assetContextMenu.targetAssetKind = asset.kind;
    assetContextMenu.worldbookBound =
      asset.kind === "worldbook"
        ? options.workspace.isWorldbookBoundToActiveSession(asset.id)
        : false;
    assetContextMenu.x = x;
    assetContextMenu.y = y;
    assetContextMenu.visible = true;
  }

  return {
    assetContextMenu,
    closeAssetContextMenu,
    openAssetContextMenu
  };
}
