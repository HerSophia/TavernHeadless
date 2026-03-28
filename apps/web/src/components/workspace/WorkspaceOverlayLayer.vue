<script setup lang="ts">
import { X } from "lucide-vue-next";

import type {
  CharacterManagerDialogProps,
  EntryPatch,
  PresetManagerDialogProps,
  PresetManagerView,
  WorldbookManagerDialogProps
} from "../../composables/workspace/assets/managers";
import type { WorkspaceMcpManagerDialogState } from "../../composables/workspace/mcp";
import type { AssetMenuAction, SessionAction } from "../../composables/workspace/menus";
import type { WorkspaceToolManagerDialogState } from "../../composables/workspace/tools";
import type { AssetImportReadyEntry } from "../../lib/asset-import";
import type {
  LibraryImportDuplicatePolicy,
  LibraryImportFailure,
  LibraryImportProgress,
  WorkspaceAsset
} from "../../stores/workspace";
import type { WorkspaceToast } from "../../stores/workspace-ui";
import AssetContextMenu from "./AssetContextMenu.vue";
import type {
  WorkspaceLlmDiscoveredModel,
  WorkspaceLlmGenerationParams,
  WorkspaceLlmInstanceSlot,
  WorkspaceLlmProfile,
  WorkspaceLlmRuntimeSlot
} from "../../lib/workspace-api";
import type { WorkspaceReplayBlockingExecution } from "../../lib/workspace-api";
import AssetImportDialog from "./AssetImportDialog.vue";
import CharacterAssetManagerDialog from "./CharacterAssetManagerDialog.vue";
import MessageActionDialogs from "./MessageActionDialogs.vue";
import ToolReplayConfirmDialog from "./ToolReplayConfirmDialog.vue";
import PresetAssetManagerDialog from "./PresetAssetManagerDialog.vue";
import WorkspaceMcpManagerDialog from "./WorkspaceMcpManagerDialog.vue";
import WorkspaceAssetBrowserDialog from "./WorkspaceAssetBrowserDialog.vue";
import SessionContextMenu from "./SessionContextMenu.vue";
import WorkspaceToolManagerDialog from "./WorkspaceToolManagerDialog.vue";
import WorldbookAssetManagerDialog from "./WorldbookAssetManagerDialog.vue";
import WorkspaceToastStack from "./WorkspaceToastStack.vue";
import WorkspaceLlmInstanceManagerDialog from "./WorkspaceLlmInstanceManagerDialog.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

type MessageRole = "assistant" | "narrator" | "system" | "user";

type MessageDialogState = {
  deleteOpen: boolean;
  draft: string;
  editOpen: boolean;
  retryOpen: boolean;
  targetRole: MessageRole | null;
};

type AssetImportDialogState = {
  duplicatePolicy: LibraryImportDuplicatePolicy;
  importing: boolean;
  importFailures: LibraryImportFailure[];
  kind: WorkspaceAsset["kind"];
  open: boolean;
  progress: LibraryImportProgress;
};

type SessionContextMenuState = {
  visible: boolean;
  x: number;
  y: number;
};

type AssetBrowserDialogState = {
  open: boolean;
};

type AssetContextMenuState = {
  targetAssetKind: WorkspaceAsset["kind"];
  visible: boolean;
  worldbookBound: boolean;
  x: number;
  y: number;
};

type PresetManagerDialogState = Omit<PresetManagerDialogProps, "t">;
type CharacterManagerDialogState = Omit<CharacterManagerDialogProps, "t">;
type WorldbookManagerDialogState = Omit<WorldbookManagerDialogProps, "t">;
type ToolManagerDialogState = WorkspaceToolManagerDialogState;
type McpManagerDialogState = WorkspaceMcpManagerDialogState;
type LlmManagerDialogState = {
  page: "instances" | "profiles";
  applyingSlot: WorkspaceLlmInstanceSlot | null;
  applyingPresetParams: boolean;
  drawerOpen: boolean;
  drawerSlot: WorkspaceLlmInstanceSlot | null;
  errorMessage: string;
  loading: boolean;
  open: boolean;
  profileDeletingId: string | null;
  profileDraft: {
    apiKey: string;
    apiKeyName: string;
    baseUrl: string;
    id: string;
    mode: "create" | "edit";
    modelId: string;
    presetName: string;
    provider: WorkspaceLlmProfile["provider"];
    status: "active" | "disabled";
  };
  profileEditorOpen: boolean;
  profileModelOptions: WorkspaceLlmDiscoveredModel[];
  profileModelsLoading: boolean;
  profileSaving: boolean;
  profileTesting: boolean;
  profiles: WorkspaceLlmProfile[];
  presetAssets: Array<{ id: string; name: string }>;
  runtimeSlots: WorkspaceLlmRuntimeSlot[];
  scope: "global" | "session";
  selectedPresetBySlot: Record<WorkspaceLlmInstanceSlot, string>;
  selectedProfileBySlot: Record<WorkspaceLlmInstanceSlot, string>;
  slotParamsDraft: WorkspaceLlmGenerationParams;
};

type ToolReplayConfirmDialogState = {
  blockingExecutions: WorkspaceReplayBlockingExecution[];
  busy: boolean;
  open: boolean;
};

type MaybePromise = Promise<void> | void;

const props = defineProps<{
  activeSessionId: string | null;
  assetContextMenu: AssetContextMenuState;
  assetImportDialog: AssetImportDialogState;
  characterManagerDialog: CharacterManagerDialogState;
  assetBrowserDialog: AssetBrowserDialogState;
  contextActionDisabled: {
    archive: boolean;
    delete: boolean;
  };
  contextMenu: SessionContextMenuState;
  formatTime: (timestamp: number) => string;
  mcpManagerDialog: McpManagerDialogState;
  messageDialog: MessageDialogState;
  messageDialogRoleLabel: string;
  hasActiveSession: boolean;
  llmProfileDraftTitle: string;
  llmManagerDialog: LlmManagerDialogState;
  libraryAssets: WorkspaceAsset[];
  onAddPresetManagerEntry: () => void;
  onClearAssetImportFailures: () => void;
  onClearCharacterManagerError: () => void;
  onClearPresetManagerError: () => void;
  onClearWorldbookManagerError: () => void;
  onCloseInspectorDrawer: () => void;
  onCloseNavDrawer: () => void;
  onConfirmCharacterManagerAction: () => MaybePromise;
  onConfirmDeleteMessage: () => MaybePromise;
  onCancelLlmProfileDraft: () => void;
  onCloseLlmSlotDrawer: () => void;
  onConfirmEditAndRegenerate: () => MaybePromise;
  onConfirmEditMessage: () => MaybePromise;
  onConfirmSaveMcpServer: () => MaybePromise;
  onConfirmSaveToolDefinition: () => MaybePromise;
  onConfirmPresetManagerAction: () => MaybePromise;
  onOpenLlmSlotDrawer: (slot: WorkspaceLlmInstanceSlot) => void;
  onApplyLlmSlotPresetParams: () => MaybePromise;
  onPatchLlmSlotParams: (patch: Partial<WorkspaceLlmGenerationParams>) => void;
  onResetLlmSlotParams: () => void;
  onSubmitLlmSlotDrawer: () => MaybePromise;
  onCreateLlmProfileDraft: () => void;
  onConfirmRetryFloor: () => MaybePromise;
  onConfirmWorldbookManagerAction: () => MaybePromise;
  onDeletePresetManagerEntry: (identifier: string) => void;
  onHandleAssetImport: (entries: AssetImportReadyEntry[]) => MaybePromise;
  onHandleAssetMenuAction: (action: AssetMenuAction) => MaybePromise;
  onHandleSessionAction: (action: SessionAction) => void;
  onConfirmToolReplay: () => MaybePromise;
  onConnectMcpServer: () => MaybePromise;
  onCreateMcpServerDraft: () => void;
  onCreateToolDefinitionDraft: () => void;
  onApplyAssetFromBrowser: (assetId: string) => void;
  onDeleteMcpServer: (serverId: string) => MaybePromise;
  onDeleteToolDefinition: (definitionId: string) => MaybePromise;
  onDisconnectMcpServer: () => MaybePromise;
  onOpenAssetFromBrowser: (assetId: string) => void;
  onOpenAssetContextMenuFromBrowser: (event: MouseEvent, assetId: string) => void;
  onOpenAssetImportDialogFromBrowser: (kind: WorkspaceAsset["kind"]) => void;
  onSetAssetBrowserDialogOpen: (open: boolean) => void;
  onToggleAssetFavoriteFromBrowser: (assetId: string) => void;
  onMovePresetManagerEntry: (payload: { delta: -1 | 1; identifier: string }) => void;
  onRefreshMcpManagerDialog: () => MaybePromise;
  onRefreshToolManagerDialog: () => MaybePromise;
  onSaveSessionToolPermissions: () => MaybePromise;
  onSelectMcpServer: (serverId: string) => MaybePromise;
  onSelectToolDefinition: (definitionId: string) => MaybePromise;
  onTestMcpServer: () => MaybePromise;
  onToggleMcpServer: (payload: { serverId: string; enabled: boolean }) => MaybePromise;
  onToggleToolDefinition: (payload: { definitionId: string; enabled: boolean }) => MaybePromise;
  onDeleteLlmProfile: (profileId: string) => MaybePromise;
  onDiscoverLlmProfileModels: () => MaybePromise;
  onOpenPresetManagerEntry: (identifier: string) => void;
  onRequestCharacterDelete: () => void;
  onRequestCharacterRestore: () => void;
  onSetPresetManagerView: (view: PresetManagerView) => void;
  onTogglePresetManagerEntryEnabled: (identifier: string) => void;
  onRefreshLlmManagerDialog: () => MaybePromise;
  onSetLlmManagerPresetSelection: (payload: { presetId: string; slot: WorkspaceLlmInstanceSlot }) => void;
  onSetLlmManagerProfileSelection: (payload: { profileId: string; slot: WorkspaceLlmInstanceSlot }) => void;
  onSetLlmManagerPage: (page: "instances" | "profiles") => void;
  onSetLlmManagerScope: (scope: "global" | "session") => void;
  onPatchLlmProfileDraft: (patch: Partial<LlmManagerDialogState["profileDraft"]>) => void;
  onEditLlmProfileDraft: (profileId: string) => void;
  onSubmitLlmProfileDraft: () => MaybePromise;
  onTestLlmProfileModel: () => MaybePromise;
  onUpdatePresetManagerEntry: (payload: { identifier: string; patch: EntryPatch }) => void;
  presetManagerDialog: PresetManagerDialogState;
  showInspectorDrawer: boolean;
  showNavDrawer: boolean;
  t: Translator;
  toolManagerDialog: ToolManagerDialogState;
  toolReplayConfirmDialog: ToolReplayConfirmDialogState;
  toasts: WorkspaceToast[];
  worldbookManagerDialog: WorldbookManagerDialogState;
}>();
</script>

<template>
  <SessionContextMenu
    :action-disabled="props.contextActionDisabled"
    :t="props.t"
    :visible="props.contextMenu.visible"
    :x="props.contextMenu.x"
    :y="props.contextMenu.y"
    @action="props.onHandleSessionAction"
  />

  <AssetContextMenu
    :asset-kind="props.assetContextMenu.targetAssetKind"
    :t="props.t"
    :visible="props.assetContextMenu.visible"
    :worldbook-bound="props.assetContextMenu.worldbookBound"
    :x="props.assetContextMenu.x"
    :y="props.assetContextMenu.y"
    @action="void props.onHandleAssetMenuAction($event)"
  />

  <WorkspaceToastStack
    :format-time="props.formatTime"
    :t="props.t"
    :toasts="props.toasts"
  />

  <MessageActionDialogs
    v-model:delete-open="props.messageDialog.deleteOpen"
    v-model:edit-draft="props.messageDialog.draft"
    v-model:edit-open="props.messageDialog.editOpen"
    v-model:retry-open="props.messageDialog.retryOpen"
    :t="props.t"
    :target-label="props.messageDialogRoleLabel"
    :target-role="props.messageDialog.targetRole"
    @confirm-delete="void props.onConfirmDeleteMessage()"
    @confirm-edit="void props.onConfirmEditMessage()"
    @confirm-edit-regenerate="void props.onConfirmEditAndRegenerate()"
    @confirm-retry="void props.onConfirmRetryFloor()"
  />

  <ToolReplayConfirmDialog
    v-model:open="props.toolReplayConfirmDialog.open"
    :blocking-executions="props.toolReplayConfirmDialog.blockingExecutions"
    :busy="props.toolReplayConfirmDialog.busy"
    :t="props.t"
    @confirm="void props.onConfirmToolReplay()"
  />

  <WorkspaceToolManagerDialog
    v-model:open="props.toolManagerDialog.open"
    :active-session-id="props.activeSessionId"
    :t="props.t"
    :tool-manager-dialog="props.toolManagerDialog"
    @create-definition-draft="props.onCreateToolDefinitionDraft"
    @delete-definition="void props.onDeleteToolDefinition($event)"
    @refresh="void props.onRefreshToolManagerDialog()"
    @save-definition="void props.onConfirmSaveToolDefinition()"
    @save-permissions="void props.onSaveSessionToolPermissions()"
    @select-definition="void props.onSelectToolDefinition($event)"
    @toggle-definition="void props.onToggleToolDefinition($event)"
  />

  <WorkspaceMcpManagerDialog
    v-model:open="props.mcpManagerDialog.open"
    :mcp-manager-dialog="props.mcpManagerDialog"
    :t="props.t"
    @connect-server="void props.onConnectMcpServer()"
    @create-server-draft="props.onCreateMcpServerDraft"
    @delete-server="void props.onDeleteMcpServer($event)"
    @disconnect-server="void props.onDisconnectMcpServer()"
    @refresh="void props.onRefreshMcpManagerDialog()"
    @save-server="void props.onConfirmSaveMcpServer()"
    @select-server="void props.onSelectMcpServer($event)"
    @test-server="void props.onTestMcpServer()"
    @toggle-server="void props.onToggleMcpServer($event)"
  />

  <WorkspaceAssetBrowserDialog
    :assets="props.libraryAssets"
    :open="props.assetBrowserDialog.open"
    :t="props.t"
    @apply-asset="props.onApplyAssetFromBrowser"
    @open-asset="props.onOpenAssetFromBrowser"
    @open-asset-context-menu="(event, assetId) => props.onOpenAssetContextMenuFromBrowser(event, assetId)"
    @open-import="props.onOpenAssetImportDialogFromBrowser"
    @toggle-favorite="props.onToggleAssetFavoriteFromBrowser"
    @update:open="props.onSetAssetBrowserDialogOpen"
  />

  <AssetImportDialog
    v-model:duplicate-policy="props.assetImportDialog.duplicatePolicy"
    v-model:kind="props.assetImportDialog.kind"
    v-model:open="props.assetImportDialog.open"
    :importing="props.assetImportDialog.importing"
    :import-failures="props.assetImportDialog.importFailures"
    :progress="props.assetImportDialog.progress"
    :t="props.t"
    @clear-failures="props.onClearAssetImportFailures"
    @submit="void props.onHandleAssetImport($event)"
  />

  <PresetAssetManagerDialog
    v-model:draft-name="props.presetManagerDialog.draftName"
    v-model:open="props.presetManagerDialog.open"
    :active-entry-id="props.presetManagerDialog.activeEntryId"
    :editor-draft="props.presetManagerDialog.editorDraft"
    :error-message="props.presetManagerDialog.errorMessage"
    :loading="props.presetManagerDialog.loading"
    :mode="props.presetManagerDialog.mode"
    :saving="props.presetManagerDialog.saving"
    :source-name="props.presetManagerDialog.sourceName"
    :view="props.presetManagerDialog.view"
    :t="props.t"
    @add-entry="props.onAddPresetManagerEntry"
    @clear-error="props.onClearPresetManagerError"
    @delete-entry="props.onDeletePresetManagerEntry"
    @move-entry="props.onMovePresetManagerEntry"
    @open-entry="props.onOpenPresetManagerEntry"
    @toggle-entry-enabled="props.onTogglePresetManagerEntryEnabled"
    @update-entry="props.onUpdatePresetManagerEntry"
    @update-view="props.onSetPresetManagerView"
    @confirm="void props.onConfirmPresetManagerAction()"
  />

  <CharacterAssetManagerDialog
    v-model:draft-description="props.characterManagerDialog.draftDescription"
    v-model:draft-first-message="props.characterManagerDialog.draftFirstMessage"
    v-model:draft-name="props.characterManagerDialog.draftName"
    v-model:draft-personality="props.characterManagerDialog.draftPersonality"
    v-model:draft-scenario="props.characterManagerDialog.draftScenario"
    v-model:open="props.characterManagerDialog.open"
    :error-message="props.characterManagerDialog.errorMessage"
    :latest-version-no="props.characterManagerDialog.latestVersionNo"
    :loading="props.characterManagerDialog.loading"
    :mode="props.characterManagerDialog.mode"
    :saving="props.characterManagerDialog.saving"
    :source-name="props.characterManagerDialog.sourceName"
    :status="props.characterManagerDialog.status"
    :t="props.t"
    @clear-error="props.onClearCharacterManagerError"
    @request-delete="props.onRequestCharacterDelete"
    @request-restore="props.onRequestCharacterRestore"
    @confirm="void props.onConfirmCharacterManagerAction()"
  />

  <WorldbookAssetManagerDialog
    v-model:draft-json="props.worldbookManagerDialog.draftJson"
    v-model:draft-name="props.worldbookManagerDialog.draftName"
    v-model:open="props.worldbookManagerDialog.open"
    :error-message="props.worldbookManagerDialog.errorMessage"
    :loading="props.worldbookManagerDialog.loading"
    :mode="props.worldbookManagerDialog.mode"
    :saving="props.worldbookManagerDialog.saving"
    :source-name="props.worldbookManagerDialog.sourceName"
    :t="props.t"
    @clear-error="props.onClearWorldbookManagerError"
    @confirm="void props.onConfirmWorldbookManagerAction()"
  />

  <WorkspaceLlmInstanceManagerDialog
    v-model:open="props.llmManagerDialog.open"
    :applying-slot="props.llmManagerDialog.applyingSlot"
    :applying-preset-params="props.llmManagerDialog.applyingPresetParams"
    :drawer-open="props.llmManagerDialog.drawerOpen"
    :drawer-slot="props.llmManagerDialog.drawerSlot"
    :error-message="props.llmManagerDialog.errorMessage"
    :has-active-session="props.hasActiveSession"
    :loading="props.llmManagerDialog.loading"
    :page="props.llmManagerDialog.page"
    :profile-deleting-id="props.llmManagerDialog.profileDeletingId"
    :profile-draft="props.llmManagerDialog.profileDraft"
    :profile-draft-title="props.llmProfileDraftTitle"
    :profile-editor-open="props.llmManagerDialog.profileEditorOpen"
    :profile-model-options="props.llmManagerDialog.profileModelOptions"
    :profile-models-loading="props.llmManagerDialog.profileModelsLoading"
    :profile-saving="props.llmManagerDialog.profileSaving"
    :profile-testing="props.llmManagerDialog.profileTesting"
    :profiles="props.llmManagerDialog.profiles"
    :preset-assets="props.llmManagerDialog.presetAssets"
    :runtime-slots="props.llmManagerDialog.runtimeSlots"
    :scope="props.llmManagerDialog.scope"
    :selected-profile-by-slot="props.llmManagerDialog.selectedProfileBySlot"
    :selected-preset-by-slot="props.llmManagerDialog.selectedPresetBySlot"
    :slot-params-draft="props.llmManagerDialog.slotParamsDraft"
    :t="props.t"
    @apply-slot-preset-params="void props.onApplyLlmSlotPresetParams()"
    @cancel-profile-draft="props.onCancelLlmProfileDraft"
    @close-slot-drawer="props.onCloseLlmSlotDrawer"
    @create-profile-draft="props.onCreateLlmProfileDraft"
    @delete-profile="void props.onDeleteLlmProfile($event)"
    @discover-profile-models="void props.onDiscoverLlmProfileModels()"
    @edit-profile-draft="props.onEditLlmProfileDraft"
    @open-slot-drawer="props.onOpenLlmSlotDrawer"
    @patch-slot-params="props.onPatchLlmSlotParams"
    @refresh="void props.onRefreshLlmManagerDialog()"
    @reset-slot-params="props.onResetLlmSlotParams"
    @submit-profile-draft="void props.onSubmitLlmProfileDraft()"
    @submit-slot-drawer="void props.onSubmitLlmSlotDrawer()"
    @test-profile-model="void props.onTestLlmProfileModel()"
    @update:page="props.onSetLlmManagerPage"
    @update:profile-draft="props.onPatchLlmProfileDraft"
    @update:selected-preset="props.onSetLlmManagerPresetSelection"
    @update:scope="props.onSetLlmManagerScope"
    @update:selected-profile="props.onSetLlmManagerProfileSelection"
  />

  <button
    v-if="props.showNavDrawer"
    class="absolute right-3 top-14 z-40 rounded border border-white/10 bg-zinc-900/90 p-1 lg:hidden"
    type="button"
    @click="props.onCloseNavDrawer"
  >
    <X class="h-4 w-4" />
  </button>

  <button
    v-if="props.showInspectorDrawer"
    class="absolute left-3 top-14 z-40 rounded border border-white/10 bg-zinc-900/90 p-1 lg:hidden"
    type="button"
    @click="props.onCloseInspectorDrawer"
  >
    <X class="h-4 w-4" />
  </button>
</template>
