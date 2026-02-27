import { reactive } from "vue";

export function useWorkspaceAssetBrowserDialog() {
  const assetBrowserDialog = reactive({
    open: false
  });

  function openAssetBrowserDialog(): void {
    assetBrowserDialog.open = true;
  }

  function closeAssetBrowserDialog(): void {
    assetBrowserDialog.open = false;
  }

  function resetAssetBrowserDialog(): void {
    assetBrowserDialog.open = false;
  }

  return {
    assetBrowserDialog,
    closeAssetBrowserDialog,
    openAssetBrowserDialog,
    resetAssetBrowserDialog
  };
}
