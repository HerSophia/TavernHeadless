<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import WorkspaceCanvas from "./components/workspace/WorkspaceCanvas.vue";
import WorkspaceInspector from "./components/workspace/WorkspaceInspector.vue";
import WorkspaceNav from "./components/workspace/WorkspaceNav.vue";
import WorkspaceOverlayLayer from "./components/workspace/WorkspaceOverlayLayer.vue";
import WorkspaceTopBar from "./components/workspace/WorkspaceTopBar.vue";
import WorkspaceViewportFrame from "./components/workspace/WorkspaceViewportFrame.vue";
import { useWorkspaceLlmManagerDialog } from "./composables/workspace/llm";
import { useWorkspaceAssetContextMenu, useWorkspaceAssetImportDialog, useWorkspaceAssetManagerDialogs, useWorkspaceAssetMenuActions, useWorkspaceRuntimeActions } from "./composables/workspace/assets";
import { useWorkspaceMessageDialog } from "./composables/workspace/messages";
import { useWorkspacePresetActions, useWorkspacePresetSelection } from "./composables/workspace/presets";
import { useWorkspaceSessionActionDispatch, useWorkspaceSessionActions, useWorkspaceSessionContextMenuState } from "./composables/workspace/sessions";
import { useWorkspaceDisplayHelpers, useWorkspaceEventRouting, useWorkspaceLifecycle, useWorkspacePaneLayout, useWorkspaceShellState, useWorkspaceViewLifecycle } from "./composables/workspace/shell";
import {
  useWorkspaceStore,
  type WorkspaceAsset,
  type WorkspaceLocale
} from "./stores/workspace";
import { useWorkspaceUiStore, type EventTone } from "./stores/workspace-ui";

type Locale = "zh-CN" | "en";

const LEFT_PANE_MIN = 240;
const RIGHT_PANE_MIN = 260;
const CENTER_PANE_MIN = 420;
const accountMode = import.meta.env.VITE_ACCOUNT_MODE === "single" ? "single" : "multi";

const { locale, t: i18nT } = useI18n();

const lang = computed<Locale>({
  get() {
    return locale.value === "zh-CN" ? "zh-CN" : "en";
  },
  set(value) {
    locale.value = value;
  }
});

const workspaceLocale = computed<WorkspaceLocale>(() => (lang.value === "zh-CN" ? "zh" : "en"));

function t(key: string, vars?: Record<string, number | string>): string {
  return i18nT(key, vars ?? {}) as string;
}

const workspace = useWorkspaceStore();
const {
  activeSession,
  activeSessionIndex,
  activeTimeline,
  apiStatus,
  currentAccount,
  isStreaming,
  runtimeCharacterName,
  runtimeUserName,
  libraryAssets,
  runtimeWorldbookCount,
  sessions
} = storeToRefs(workspace);

const workspaceUi = useWorkspaceUiStore();
const { events, toasts } = storeToRefs(workspaceUi);

const messageInput = ref("");
const {
  beginPaneResize,
  clampPaneWidths,
  leftPaneDesktopWidth,
  paneLayoutStyles,
  rightPaneDesktopWidth,
  stopPaneResize
} = useWorkspacePaneLayout({ centerMin: CENTER_PANE_MIN, leftMin: LEFT_PANE_MIN, rightMin: RIGHT_PANE_MIN });

const {
  activeTab,
  bindingFlash,
  closeDrawers,
  closeInspectorDrawer,
  closeNavDrawer,
  flashBindingCard,
  handleWindowResize,
  resetActiveTab,
  setActiveTab,
  showInspectorDrawer,
  showNavDrawer,
  toggleInspectorDrawer,
  toggleNavDrawer
} = useWorkspaceShellState({
  clampPaneWidths
});

const {
  activePresetAssetId,
  currentPresetAsset,
  presetAssets
} = useWorkspacePresetSelection({
  libraryAssets
});

const {
  closeSessionContextMenu,
  contextActionDisabled,
  contextMenu,
  openSessionContextMenu
} = useWorkspaceSessionContextMenuState({
  sessions
});

const {
  assetContextMenu,
  closeAssetContextMenu,
  openAssetContextMenu
} = useWorkspaceAssetContextMenu({
  onOpen: closeSessionContextMenu,
  workspace
});

const {
  formatTime,
  getSessionTitle,
  toggleLang
} = useWorkspaceDisplayHelpers({
  lang
});

function addEvent(key: string, tone: EventTone = "info", vars: Record<string, number | string> = {}): void {
  workspaceUi.addEvent(key, tone, vars);
}

const {
  activeModelDetail,
  activeModelName,
  beginCreateLlmProfileDraft,
  beginEditLlmProfileDraft,
  cancelLlmProfileDraft,
  applyLlmSlotBinding,
  closeLlmManagerDialog,
  fetchLlmProfileModels,
  hasActiveSession,
  llmManagerDialog,
  openLlmManagerDialog,
  patchLlmProfileDraft,
  profileDraftTitle,
  refreshLlmManagerDialog,
  refreshLlmRuntime,
  removeLlmProfile,
  setLlmManagerPage,
  setLlmManagerProfileSelection,
  setLlmManagerScope,
  submitLlmProfileDraft,
  testLlmProfileModel
} = useWorkspaceLlmManagerDialog({ activeSessionId: computed(() => activeSession.value?.id ?? null), addEvent, currentAccount, t });

const {
  assetImportDialog,
  clearAssetImportFailures,
  closeAssetImportDialog,
  handleAssetImport,
  openAssetImportDialog,
  resetAssetImportDialog
} = useWorkspaceAssetImportDialog({
  addEvent,
  resolveAssetKindLabel: getAssetKindLabel,
  workspace
});
const {
  addPresetManagerEntry,
  characterManagerDialog,
  clearCharacterManagerError,
  clearPresetManagerError,
  clearWorldbookManagerError,
  confirmCharacterManagerAction,
  confirmPresetManagerAction,
  confirmWorldbookManagerAction,
  deletePresetManagerEntry,
  movePresetManagerEntry,
  openCharacterManagerDialog,
  openPresetManagerDialog,
  openPresetManagerEntry,
  openWorldbookManagerDialog,
  presetManagerDialog,
  requestCharacterDelete,
  requestCharacterRestore,
  resetCharacterManagerDialog,
  resetPresetManagerDialog,
  resetWorldbookManagerDialog,
  setPresetManagerView,
  togglePresetManagerEntryEnabled,
  updatePresetManagerEntry,
  worldbookManagerDialog
} = useWorkspaceAssetManagerDialogs({
  addEvent,
  t,
  workspace
});



const {
  clearMessageDialogTarget,
  closeMessageDialogs,
  confirmDeleteMessage,
  confirmEditAndRegenerate,
  confirmEditMessage,
  confirmRetryFloor,
  messageDialog,
  messageDialogRoleLabel,
  openDeleteMessageDialog,
  openEditMessageDialog,
  openRetryFloorDialog
} = useWorkspaceMessageDialog({
  activeTimeline,
  addEvent,
  runtimeCharacterName,
  t,
  workspace
});

const {
  hydrateFromApi,
  switchAccount
} = useWorkspaceLifecycle({
  addEvent,
  clearMessageDialogTarget,
  closeAssetContextMenu,
  closeAssetImportDialog,
  closeDrawers,
  closeMessageDialogs,
  closeLlmManagerDialog,
  closeSessionContextMenu,
  currentAccount,
  messageInput,
  resetActiveTab,
  resetAssetImportDialog,
  resetCharacterManagerDialog,
  resetPresetManagerDialog,
  resetWorldbookManagerDialog,
  workspace,
  workspaceUi
});

const {
  archiveSession,
  createSession,
  deleteSession,
  openSession,
  renameSession
} = useWorkspaceSessionActions({
  addEvent,
  onSessionOpened() {
    closeMessageDialogs();
    clearMessageDialogTarget();
    closeSessionContextMenu();
    closeAssetContextMenu();
    closeNavDrawer();
  },
  resolveSessionTitle: getSessionTitle,
  sessions,
  workspace,
  workspaceLocale
});

const { handleSessionAction } = useWorkspaceSessionActionDispatch({
  archiveSession,
  closeSessionContextMenu,
  createSession,
  deleteSession,
  openSession,
  renameSession,
  resolveTargetIndex() {
    return contextMenu.targetIndex;
  }
});

function openContextMenu(event: MouseEvent, index: number): void {
  closeAssetContextMenu();
  openSessionContextMenu(event, index);
}


const { handleAssetMenuAction } = useWorkspaceAssetMenuActions({
  addEvent,
  closeAssetContextMenu,
  flashBindingCard,
  openCharacterManagerDialog,
  openPresetManagerDialog,
  openWorldbookManagerDialog,
  resolveTargetAssetId() {
    return assetContextMenu.targetAssetId;
  },
  workspace
});

function getAssetKindLabel(kind: WorkspaceAsset["kind"]): string {
  return t(`dynamic.assetKind.${kind}`);
}

const {
  applyLibraryAsset,
  applyUserAsset,
  attachWorldbook,
  detachWorldbook,
  openLibraryAsset,
  replaceUser,
  sendMessage,
  toggleAssetFavorite
} = useWorkspaceRuntimeActions({
  activePresetAssetId,
  activeSession,
  addEvent,
  flashBindingCard,
  isStreaming,
  messageInput,
  resolveAssetKindLabel: getAssetKindLabel,
  workspace
});

const {
  editCurrentPreset,
  exportCurrentPreset,
  switchCurrentPreset
} = useWorkspacePresetActions({
  activePresetAssetId,
  addEvent,
  applyLibraryAsset,
  currentAccount,
  currentPresetAsset,
  openPresetManagerDialog,
  presetAssets
});

const {
  handleComposerKeydown,
  handleDocumentPointer,
  handleGlobalKeydown
} = useWorkspaceEventRouting({
  closeAssetContextMenu,
  closeAssetImportDialog,
  closeDrawers,
  closeMessageDialogs,
  closeLlmManagerDialog,
  closeSessionContextMenu,
  createSession,
  resetCharacterManagerDialog,
  resetPresetManagerDialog,
  resetWorldbookManagerDialog,
  sendMessage,
  setActiveTab
});

useWorkspaceViewLifecycle({
  clampPaneWidths,
  clearToasts() {
    workspaceUi.clearToasts();
  },
  handleDocumentPointer,
  handleGlobalKeydown,
  handleWindowResize,
  hydrateFromApi,
  lang,
  stopPaneResize
});

watch(
  [() => currentAccount.value, () => activeSession.value?.id ?? ""],
  () => {
    void refreshLlmRuntime();
  },
  {
    immediate: true
  }
);
</script>

<template>
  <WorkspaceViewportFrame :pane-layout-styles="paneLayoutStyles">
    <template #header>
      <WorkspaceTopBar
        :account-mode="accountMode"
        :api-status="apiStatus"
        :current-account="currentAccount"
        :lang="lang"
        :t="t"
        @switch-account="switchAccount"
        @toggle-inspector-drawer="toggleInspectorDrawer"
        @toggle-lang="toggleLang"
        @toggle-nav-drawer="toggleNavDrawer"
      />
    </template>

    <template #backdrop>
      <button
        v-if="showNavDrawer || showInspectorDrawer"
        class="fixed inset-0 z-20 bg-black/50 lg:hidden"
        type="button"
        @click="closeDrawers"
      />
    </template>

    <template #sidebar>
      <WorkspaceNav
        :active-session-index="activeSessionIndex"
        :active-model-detail="activeModelDetail"
        :active-model-name="activeModelName"
        :current-preset-name="currentPresetAsset?.name ?? ''"
        :get-session-title="getSessionTitle"
        :library-assets="libraryAssets"
        :desktop-width="leftPaneDesktopWidth"
        :sessions="sessions"
        :show-nav-drawer="showNavDrawer"
        :t="t"
        @create-session="void createSession()"
        @edit-current-preset="void editCurrentPreset()"
        @open-context-menu="openContextMenu"
        @open-session="openSession"
        @apply-asset="applyLibraryAsset"
        @open-asset="openLibraryAsset"
        @toggle-favorite="toggleAssetFavorite"
        @open-asset-context-menu="openAssetContextMenu"
        @open-import-dialog="openAssetImportDialog"
        @switch-current-preset="switchCurrentPreset"
        @export-current-preset="void exportCurrentPreset()"
        @open-llm-manager="void openLlmManagerDialog()"
      />
    </template>

    <template #left-resizer>
      <button
        class="pane-resize-handle hidden lg:flex"
        type="button"
        :title="t('layout.resizeLeft')"
        @mousedown="beginPaneResize('left', $event)"
      />
    </template>

    <template #center>
      <WorkspaceCanvas
        class="workspace-center-pane"
        v-model:message-input="messageInput"
        :active-session="activeSession"
        :active-timeline="activeTimeline"
        :current-account="currentAccount"
        :format-time="formatTime"
        :get-session-title="getSessionTitle"
        :is-streaming="isStreaming"
        :runtime-character-name="runtimeCharacterName"
        :runtime-user-name="runtimeUserName"
        :runtime-worldbook-count="runtimeWorldbookCount"
        :t="t"
        @attach-worldbook="attachWorldbook"
        @composer-keydown="handleComposerKeydown"
        @detach-worldbook="detachWorldbook"
        @replace-user="replaceUser"
        @send-message="void sendMessage()"
        @edit-message="openEditMessageDialog"
        @delete-message="openDeleteMessageDialog"
        @edit-and-regenerate="openEditMessageDialog"
        @retry-floor="openRetryFloorDialog"
      />
    </template>

    <template #right-resizer>
      <button
        class="pane-resize-handle hidden lg:flex"
        type="button"
        :title="t('layout.resizeRight')"
        @mousedown="beginPaneResize('right', $event)"
      />
    </template>

    <template #inspector>
      <WorkspaceInspector
        :account-mode="accountMode"
        :desktop-width="rightPaneDesktopWidth"
        :active-tab="activeTab"
        :binding-flash="bindingFlash"
        :current-account="currentAccount"
        :events="events"
        :lang="lang"
        :runtime-character-name="runtimeCharacterName"
        :runtime-user-name="runtimeUserName"
        :show-inspector-drawer="showInspectorDrawer"
        :t="t"
        @apply-user-asset="applyUserAsset"
        @attach-worldbook="attachWorldbook"
        @replace-user="replaceUser"
        @set-active-tab="setActiveTab"
        @switch-account="switchAccount"
        @toggle-lang="toggleLang"
      />
    </template>

    <template #overlays>
      <WorkspaceOverlayLayer
        :asset-context-menu="assetContextMenu"
        :asset-import-dialog="assetImportDialog"
        :character-manager-dialog="characterManagerDialog"
        :context-action-disabled="contextActionDisabled"
        :context-menu="contextMenu"
        :format-time="formatTime"
        :has-active-session="hasActiveSession"
        :llm-manager-dialog="llmManagerDialog"
        :llm-profile-draft-title="profileDraftTitle"
        :message-dialog="messageDialog"
        :message-dialog-role-label="messageDialogRoleLabel"
        :on-add-preset-manager-entry="addPresetManagerEntry"
        :on-clear-asset-import-failures="clearAssetImportFailures"
        :on-clear-character-manager-error="clearCharacterManagerError"
        :on-clear-preset-manager-error="clearPresetManagerError"
        :on-clear-worldbook-manager-error="clearWorldbookManagerError"
        :on-close-inspector-drawer="closeInspectorDrawer"
        :on-close-nav-drawer="closeNavDrawer"
        :on-confirm-character-manager-action="confirmCharacterManagerAction"
        :on-cancel-llm-profile-draft="cancelLlmProfileDraft"
        :on-confirm-delete-message="confirmDeleteMessage"
        :on-confirm-edit-and-regenerate="confirmEditAndRegenerate"
        :on-confirm-llm-slot-binding="applyLlmSlotBinding"
        :on-confirm-edit-message="confirmEditMessage"
        :on-confirm-preset-manager-action="confirmPresetManagerAction"
        :on-confirm-retry-floor="confirmRetryFloor"
        :on-confirm-worldbook-manager-action="confirmWorldbookManagerAction"
        :on-delete-preset-manager-entry="deletePresetManagerEntry"
        :on-create-llm-profile-draft="beginCreateLlmProfileDraft"
        :on-delete-llm-profile="removeLlmProfile"
        :on-discover-llm-profile-models="fetchLlmProfileModels"
        :on-handle-asset-import="handleAssetImport"
        :on-handle-asset-menu-action="handleAssetMenuAction"
        :on-handle-session-action="handleSessionAction"
        :on-move-preset-manager-entry="movePresetManagerEntry"
        :on-open-preset-manager-entry="openPresetManagerEntry"
        :on-request-character-delete="requestCharacterDelete"
        :on-request-character-restore="requestCharacterRestore"
        :on-edit-llm-profile-draft="beginEditLlmProfileDraft"
        :on-patch-llm-profile-draft="patchLlmProfileDraft"
        :on-refresh-llm-manager-dialog="refreshLlmManagerDialog"
        :on-set-llm-manager-page="setLlmManagerPage"
        :on-set-llm-manager-profile-selection="setLlmManagerProfileSelection"
        :on-set-llm-manager-scope="setLlmManagerScope"
        :on-submit-llm-profile-draft="submitLlmProfileDraft"
        :on-test-llm-profile-model="testLlmProfileModel"
        :on-set-preset-manager-view="setPresetManagerView"
        :on-toggle-preset-manager-entry-enabled="togglePresetManagerEntryEnabled"
        :on-update-preset-manager-entry="updatePresetManagerEntry"
        :preset-manager-dialog="presetManagerDialog"
        :show-inspector-drawer="showInspectorDrawer"
        :show-nav-drawer="showNavDrawer"
        :t="t"
        :toasts="toasts"
        :worldbook-manager-dialog="worldbookManagerDialog"
      />
    </template>
  </WorkspaceViewportFrame>
</template>

