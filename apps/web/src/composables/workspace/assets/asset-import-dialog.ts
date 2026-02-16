import { reactive } from "vue";

import type {
  LibraryImportDuplicatePolicy,
  LibraryImportFailure,
  LibraryImportOptions,
  LibraryImportProgress,
  LibraryImportResult,
  WorkspaceAsset,
  WorkspaceAssetImportEntry
} from "../../../stores/workspace";
import type { EventTone } from "../../../stores/workspace-ui";

type AddEvent = (key: string, tone?: EventTone, vars?: Record<string, number | string>) => void;

type WorkspaceAssetImportStore = {
  importAssetsIntoLibrary: (
    kind: WorkspaceAsset["kind"],
    entries: WorkspaceAssetImportEntry[],
    options?: LibraryImportOptions
  ) => Promise<LibraryImportResult>;
};

type UseWorkspaceAssetImportDialogOptions = {
  addEvent: AddEvent;
  resolveAssetKindLabel: (kind: WorkspaceAsset["kind"]) => string;
  workspace: WorkspaceAssetImportStore;
};

function createAssetImportProgress(): LibraryImportProgress {
  return {
    currentFile: "",
    failed: 0,
    imported: 0,
    phase: "done",
    processed: 0,
    skipped: 0,
    total: 0
  };
}

export function useWorkspaceAssetImportDialog(options: UseWorkspaceAssetImportDialogOptions) {
  const assetImportDialog = reactive({
    duplicatePolicy: "skip" as LibraryImportDuplicatePolicy,
    importing: false,
    importFailures: [] as LibraryImportFailure[],
    kind: "preset" as WorkspaceAsset["kind"],
    open: false,
    progress: createAssetImportProgress()
  });

  function resetAssetImportDialogProgress(): void {
    assetImportDialog.progress = createAssetImportProgress();
  }

  function updateAssetImportDialogProgress(progress: LibraryImportProgress): void {
    assetImportDialog.progress = { ...progress };
  }

  function clearAssetImportFailures(): void {
    assetImportDialog.importFailures = [];
    if (!assetImportDialog.importing) {
      resetAssetImportDialogProgress();
    }
  }

  function resetAssetImportDialog(): void {
    assetImportDialog.open = false;
    assetImportDialog.importing = false;
    assetImportDialog.importFailures = [];
    assetImportDialog.duplicatePolicy = "skip";
    resetAssetImportDialogProgress();
  }

  function closeAssetImportDialog(): void {
    assetImportDialog.open = false;
  }

  function openAssetImportDialog(kind: WorkspaceAsset["kind"] = "preset"): void {
    assetImportDialog.kind = kind;
    assetImportDialog.importFailures = [];
    resetAssetImportDialogProgress();
    assetImportDialog.open = true;
  }

  async function handleAssetImport(entries: WorkspaceAssetImportEntry[]): Promise<void> {
    if (assetImportDialog.importing) {
      return;
    }

    assetImportDialog.importing = true;
    const kind = assetImportDialog.kind;

    try {
      assetImportDialog.importFailures = [];
      resetAssetImportDialogProgress();

      const result = await options.workspace.importAssetsIntoLibrary(kind, entries, {
        duplicatePolicy: assetImportDialog.duplicatePolicy,
        onProgress(progress) {
          updateAssetImportDialogProgress(progress);
        }
      });
      if (result.reason === "empty") {
        options.addEvent("events.assetImportEmpty", "warn");
        return;
      }

      if (result.imported > 0) {
        options.addEvent("events.assetImportDone", "success", {
          count: result.imported,
          kind: options.resolveAssetKindLabel(kind)
        });
      }

      if (result.skipped > 0) {
        options.addEvent("events.assetImportSkipped", "info", {
          count: result.skipped,
          kind: options.resolveAssetKindLabel(kind)
        });
      }

      if (result.failures.length > 0) {
        assetImportDialog.importFailures = result.failures;
      }

      if (result.failed > 0) {
        options.addEvent("events.assetImportFailed", "warn", {
          count: result.failed,
          kind: options.resolveAssetKindLabel(kind)
        });
      }

      if (result.apiSyncFailed) {
        options.addEvent("events.librarySyncFailed", "warn");
      }

      if (result.imported > 0 && result.failed === 0 && result.skipped === 0) {
        assetImportDialog.open = false;
      }
    } finally {
      if (assetImportDialog.progress.phase !== "done") {
        resetAssetImportDialogProgress();
      }
      assetImportDialog.importing = false;
    }
  }

  return {
    assetImportDialog,
    clearAssetImportFailures,
    closeAssetImportDialog,
    handleAssetImport,
    openAssetImportDialog,
    resetAssetImportDialog,
    resetAssetImportDialogProgress
  };
}
