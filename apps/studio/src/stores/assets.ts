/**
 * 资产库 store（AST10 / 阶段 C）。
 *
 * 四类资产（character/preset/worldbook/regex）列表 + 导入态。仅依赖 `lib/assets` 薄封装，可纯单测。
 * 文件校验为纯函数（`validateAssetImportFile`），由导入组件直接调用；store 负责导入提交与列表刷新。
 */
import { defineStore } from "pinia";
import { reactive, ref } from "vue";

import { importAsset } from "../lib/assets/imports";
import { libraryApi } from "../lib/assets/library";
import type {
  AssetImportValidationResult,
  AssetKind,
  AssetVersionItem,
  ImportedAssetSummary,
  LibraryAsset,
} from "../lib/assets/types";

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export const useAssetsStore = defineStore("assets", () => {
  const lists = reactive<Record<AssetKind, LibraryAsset[]>>({
    character: [],
    preset: [],
    worldbook: [],
    regex: [],
  });
  const loading = ref<AssetKind | null>(null);
  const importing = ref(false);
  const error = ref<string | null>(null);

  async function loadAssets(kind: AssetKind): Promise<void> {
    loading.value = kind;
    error.value = null;
    try {
      lists[kind] = await libraryApi.list(kind);
    } catch (cause) {
      error.value = toMessage(cause);
    } finally {
      loading.value = null;
    }
  }

  async function importValidated(kind: AssetKind, result: AssetImportValidationResult): Promise<ImportedAssetSummary> {
    importing.value = true;
    error.value = null;
    try {
      const summary = await importAsset(kind, result);
      await loadAssets(kind);
      return summary;
    } finally {
      importing.value = false;
    }
  }

  async function removeAsset(kind: AssetKind, id: string): Promise<void> {
    await libraryApi.remove(kind, id);
    await loadAssets(kind);
  }

  function listVersions(kind: AssetKind, id: string): Promise<AssetVersionItem[]> {
    return libraryApi.listVersions(kind, id);
  }

  return {
    lists,
    loading,
    importing,
    error,
    loadAssets,
    importValidated,
    removeAsset,
    listVersions,
  };
});
