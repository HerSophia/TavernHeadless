import type { Ref } from "vue";

import type { EventTone } from "../../../stores/workspace-ui";

type AddEvent = (key: string, tone?: EventTone, vars?: Record<string, number | string>) => void;

type WorkspaceHydrateResult = {
  librarySyncFailed: boolean;
  sessionSyncFailed: boolean;
  timelineSyncFailed: boolean;
};

type WorkspaceLifecycleStore = {
  hydrateFromApi: (accountId: string) => Promise<WorkspaceHydrateResult>;
  resetWorkspaceContext: () => void;
  switchAccount: () => string;
};

type WorkspaceUiLifecycleStore = {
  resetFeedback: () => void;
};

type UseWorkspaceLifecycleOptions = {
  addEvent: AddEvent;
  clearMessageDialogTarget: () => void;
  closeAssetContextMenu: () => void;
  closeAssetImportDialog: () => void;
  closeAssetBrowserDialog: () => void;
  closeDrawers: () => void;
  closeMessageDialogs: () => void;
  closeLlmManagerDialog: () => void;
  closeSessionContextMenu: () => void;
  currentAccount: Ref<string>;
  messageInput: Ref<string>;
  resetActiveTab: () => void;
  resetAssetImportDialog: () => void;
  resetCharacterManagerDialog: () => void;
  resetAssetBrowserDialog: () => void;
  resetPresetManagerDialog: () => void;
  resetWorldbookManagerDialog: () => void;
  workspace: WorkspaceLifecycleStore;
  workspaceUi: WorkspaceUiLifecycleStore;
};

export function useWorkspaceLifecycle(options: UseWorkspaceLifecycleOptions) {
  async function hydrateFromApi(accountId = options.currentAccount.value): Promise<void> {
    const result = await options.workspace.hydrateFromApi(accountId);
    if (result.sessionSyncFailed) {
      options.addEvent("events.apiSyncFailed", "warn");
    }

    if (result.timelineSyncFailed) {
      options.addEvent("events.timelineSyncFailed", "warn");
    }

    if (result.librarySyncFailed) {
      options.addEvent("events.librarySyncFailed", "warn");
    }
  }

  function resetWorkspaceContext(): void {
    options.workspace.resetWorkspaceContext();
    options.resetActiveTab();
    options.messageInput.value = "";
    options.closeSessionContextMenu();
    options.closeAssetContextMenu();
    options.closeDrawers();
    options.closeMessageDialogs();
    options.closeLlmManagerDialog();
    options.closeAssetBrowserDialog();
    options.clearMessageDialogTarget();
    options.resetAssetImportDialog();
    options.resetPresetManagerDialog();
    options.resetCharacterManagerDialog();
    options.resetAssetBrowserDialog();
    options.resetWorldbookManagerDialog();
  }

  function switchAccount(): void {
    const account = options.workspace.switchAccount();

    resetWorkspaceContext();
    options.workspaceUi.resetFeedback();
    options.addEvent("events.switchAccount", "info", {
      account
    });
    options.addEvent("events.accountReset", "info");

    options.closeAssetImportDialog();
    void hydrateFromApi(account);
  }

  return {
    hydrateFromApi,
    resetWorkspaceContext,
    switchAccount
  };
}
