import type { WorkspaceInspectorTab } from "./inspector-view";

type UseWorkspaceEventRoutingOptions = {
  closeAssetContextMenu: () => void;
  closeAssetImportDialog: () => void;
  closeDrawers: () => void;
  closeLlmManagerDialog: () => void;
  closeMessageDialogs: () => void;
  closeSessionContextMenu: () => void;
  createSession: () => Promise<void>;
  resetCharacterManagerDialog: () => void;
  resetPresetManagerDialog: () => void;
  resetWorldbookManagerDialog: () => void;
  sendMessage: () => Promise<void>;
  setActiveTab: (tab: WorkspaceInspectorTab) => void;
};

export function useWorkspaceEventRouting(options: UseWorkspaceEventRoutingOptions) {
  function handleComposerKeydown(event: KeyboardEvent): void {
    const modifierPressed = event.ctrlKey || event.metaKey;
    if (modifierPressed && event.key === "Enter") {
      event.preventDefault();
      void options.sendMessage();
    }
  }

  function handleDocumentPointer(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest("[data-context-menu]") || target.closest("[data-session-item]") || target.closest("[data-asset-context-menu]") || target.closest("[data-asset-item]")) {
      return;
    }

    options.closeSessionContextMenu();
    options.closeAssetContextMenu();
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      options.closeSessionContextMenu();
      options.closeAssetContextMenu();
      options.closeDrawers();
      options.closeMessageDialogs();
      options.closeAssetImportDialog();
      options.resetPresetManagerDialog();
      options.resetCharacterManagerDialog();
      options.closeLlmManagerDialog();
      options.resetWorldbookManagerDialog();
      return;
    }

    const modifierPressed = event.ctrlKey || event.metaKey;
    if (!modifierPressed) {
      return;
    }

    const target = event.target;
    const editing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable);

    if (event.key === "Enter" && editing) {
      return;
    }

    if (editing) {
      return;
    }

    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      void options.createSession();
    } else if (event.key === "1") {
      event.preventDefault();
      options.setActiveTab("bindings");
    } else if (event.key === "2") {
      event.preventDefault();
      options.setActiveTab("memory");
    } else if (event.key === "3") {
      event.preventDefault();
      options.setActiveTab("impact");
    }
  }

  return {
    handleComposerKeydown,
    handleDocumentPointer,
    handleGlobalKeydown
  };
}
