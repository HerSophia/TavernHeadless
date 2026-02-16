import { computed, ref, watch, type Ref } from "vue";

import type { WorkspaceAsset, WorkspaceAssetKind } from "../../../stores/workspace";

export type WorkspaceAssetFilter = "all" | WorkspaceAssetKind;
export type WorkspaceAssetSortMode = "name" | "updated";

type UseWorkspaceAssetBrowserOptions = {
  assets: Ref<WorkspaceAsset[]>;
  onApplyAsset: (assetId: string) => void;
  onOpenAsset: (assetId: string) => void;
  onOpenAssetContextMenu: (event: MouseEvent, assetId: string) => void;
  onOpenImport: (kind: WorkspaceAssetKind) => void;
};

export function useWorkspaceAssetBrowser(options: UseWorkspaceAssetBrowserOptions) {
  const searchText = ref("");
  const filter = ref<WorkspaceAssetFilter>("all");
  const selectedAssetId = ref("");
  const sortMode = ref<WorkspaceAssetSortMode>("updated");
  const searchInputRef = ref<HTMLInputElement | null>(null);

  const filterOptions: Array<{ key: WorkspaceAssetFilter; labelKey: string }> = [
    { key: "all", labelKey: "nav.assetFilterAll" },
    { key: "character", labelKey: "nav.characters" },
    { key: "worldbook", labelKey: "nav.worldbooks" },
    { key: "user", labelKey: "nav.users" },
    { key: "preset", labelKey: "nav.presets" }
  ];

  const visibleAssets = computed(() => {
    const keyword = searchText.value.trim().toLowerCase();

    const filtered = options.assets.value.filter((asset) => {
      const byType = filter.value === "all" || asset.kind === filter.value;
      if (!byType) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      const haystack = `${asset.name} ${asset.summary} ${asset.tags.join(" ")}`.toLowerCase();
      return haystack.includes(keyword);
    });

    const sorted = [...filtered];
    if (sortMode.value === "name") {
      sorted.sort((left, right) => left.name.localeCompare(right.name));
    } else {
      sorted.sort((left, right) => right.updatedAt - left.updatedAt);
    }

    return sorted;
  });

  const selectedAsset = computed(() => {
    return visibleAssets.value.find((asset) => asset.id === selectedAssetId.value) ?? null;
  });

  const importKind = computed<WorkspaceAssetKind>(() => {
    return filter.value === "all" ? "preset" : filter.value;
  });

  watch(
    visibleAssets,
    (next) => {
      if (next.length === 0) {
        selectedAssetId.value = "";
        return;
      }

      if (!next.some((asset) => asset.id === selectedAssetId.value)) {
        selectedAssetId.value = next[0]?.id ?? "";
      }
    },
    {
      immediate: true
    }
  );

  function cycleSortMode(): void {
    sortMode.value = sortMode.value === "updated" ? "name" : "updated";
  }

  function focusSearch(): void {
    searchInputRef.value?.focus();
    searchInputRef.value?.select();
  }

  function setFilter(nextFilter: WorkspaceAssetFilter): void {
    filter.value = nextFilter;
  }

  function selectAsset(assetId: string): void {
    selectedAssetId.value = assetId;
  }

  function openAsset(assetId: string): void {
    selectedAssetId.value = assetId;
    options.onOpenAsset(assetId);
  }

  function openAssetContextMenu(event: MouseEvent, assetId: string): void {
    selectedAssetId.value = assetId;
    options.onOpenAssetContextMenu(event, assetId);
  }

  function moveSelection(step: number): void {
    if (visibleAssets.value.length === 0) {
      return;
    }

    const currentIndex = visibleAssets.value.findIndex((asset) => asset.id === selectedAssetId.value);
    const base = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = Math.min(visibleAssets.value.length - 1, Math.max(0, base + step));
    const nextAsset = visibleAssets.value[nextIndex];
    if (nextAsset) {
      selectedAssetId.value = nextAsset.id;
    }
  }

  function openImport(): void {
    options.onOpenImport(importKind.value);
  }

  function openSelectedAsset(): void {
    if (!selectedAsset.value) {
      return;
    }

    options.onOpenAsset(selectedAsset.value.id);
  }

  function applySelectedAsset(): void {
    if (!selectedAsset.value) {
      return;
    }

    options.onApplyAsset(selectedAsset.value.id);
  }

  function handleBrowserKeydown(event: KeyboardEvent): void {
    const target = event.target;
    const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      focusSearch();
      return;
    }

    if (editing) {
      return;
    }

    if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") {
      event.preventDefault();
      moveSelection(1);
      return;
    }

    if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") {
      event.preventDefault();
      moveSelection(-1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      openSelectedAsset();
      return;
    }

    if (event.key.toLowerCase() === "a") {
      event.preventDefault();
      applySelectedAsset();
    }

    if (event.key.toLowerCase() === "i") {
      event.preventDefault();
      openImport();
    }
  }

  function formatAssetUpdatedAt(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  return {
    applySelectedAsset,
    cycleSortMode,
    filter,
    filterOptions,
    formatAssetUpdatedAt,
    handleBrowserKeydown,
    importKind,
    openAsset,
    openAssetContextMenu,
    openImport,
    openSelectedAsset,
    searchInputRef,
    searchText,
    selectAsset,
    selectedAsset,
    selectedAssetId,
    setFilter,
    sortMode,
    visibleAssets
  };
}
