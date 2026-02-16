<script setup lang="ts">
import { X } from "lucide-vue-next";

import type {
  CharacterManagerDialogProps,
  EntryPatch,
  PresetManagerDialogProps,
  PresetManagerView,
  WorldbookManagerDialogProps
} from "../../composables/workspace/assets/managers";
import type { AssetMenuAction, SessionAction } from "../../composables/workspace/menus";
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
  WorkspaceLlmInstanceSlot,
  WorkspaceLlmProfile,
  WorkspaceLlmRuntimeSlot
} from "../../lib/workspace-api";
import AssetImportDialog from "./AssetImportDialog.vue";
import CharacterAssetManagerDialog from "./CharacterAssetManagerDialog.vue";
import MessageActionDialogs from "./MessageActionDialogs.vue";
import PresetAssetManagerDialog from "./PresetAssetManagerDialog.vue";
import SessionContextMenu from "./SessionContextMenu.vue";
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
type LlmManagerDialogState = {
  page: "instances" | "profiles";
  applyingSlot: WorkspaceLlmInstanceSlot | null;
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
  runtimeSlots: WorkspaceLlmRuntimeSlot[];
  scope: "global" | "session";
  selectedProfileBySlot: Record<WorkspaceLlmInstanceSlot, string>;
};

type MaybePromise = Promise<void> | void;

const props = defineProps<{
  assetContextMenu: AssetContextMenuState;
  assetImportDialog: AssetImportDialogState;
  characterManagerDialog: CharacterManagerDialogState;
  contextActionDisabled: {
    archive: boolean;
    delete: boolean;
  };
  contextMenu: SessionContextMenuState;
  formatTime: (timestamp: number) => string;
  messageDialog: MessageDialogState;
  messageDialogRoleLabel: string;
  hasActiveSession: boolean;
  llmProfileDraftTitle: string;
  llmManagerDialog: LlmManagerDialogState;
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
  onConfirmEditAndRegenerate: () => MaybePromise;
  onConfirmLlmSlotBinding: (slot: WorkspaceLlmInstanceSlot) => MaybePromise;
  onConfirmEditMessage: () => MaybePromise;
  onConfirmPresetManagerAction: () => MaybePromise;
  onCreateLlmProfileDraft: () => void;
  onConfirmRetryFloor: () => MaybePromise;
  onConfirmWorldbookManagerAction: () => MaybePromise;
  onDeletePresetManagerEntry: (identifier: string) => void;
  onHandleAssetImport: (entries: AssetImportReadyEntry[]) => MaybePromise;
  onHandleAssetMenuAction: (action: AssetMenuAction) => MaybePromise;
  onHandleSessionAction: (action: SessionAction) => void;
  onMovePresetManagerEntry: (payload: { delta: -1 | 1; identifier: string }) => void;
  onDeleteLlmProfile: (profileId: string) => MaybePromise;
  onDiscoverLlmProfileModels: () => MaybePromise;
  onOpenPresetManagerEntry: (identifier: string) => void;
  onRequestCharacterDelete: () => void;
  onRequestCharacterRestore: () => void;
  onSetPresetManagerView: (view: PresetManagerView) => void;
  onTogglePresetManagerEntryEnabled: (identifier: string) => void;
  onRefreshLlmManagerDialog: () => MaybePromise;
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
    :active-entry-id="props.presetManagerDialog.activeEntryId"
    v-model:draft-name="props.presetManagerDialog.draftName"
    v-model:open="props.presetManagerDialog.open"
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
    :runtime-slots="props.llmManagerDialog.runtimeSlots"
    :scope="props.llmManagerDialog.scope"
    :selected-profile-by-slot="props.llmManagerDialog.selectedProfileBySlot"
    :t="props.t"
    @apply-slot-binding="void props.onConfirmLlmSlotBinding($event)"
    @cancel-profile-draft="props.onCancelLlmProfileDraft"
    @create-profile-draft="props.onCreateLlmProfileDraft"
    @delete-profile="void props.onDeleteLlmProfile($event)"
    @discover-profile-models="void props.onDiscoverLlmProfileModels()"
    @edit-profile-draft="props.onEditLlmProfileDraft"
    @refresh="void props.onRefreshLlmManagerDialog()"
    @submit-profile-draft="void props.onSubmitLlmProfileDraft()"
    @test-profile-model="void props.onTestLlmProfileModel()"
    @update:page="props.onSetLlmManagerPage"
    @update:profile-draft="props.onPatchLlmProfileDraft"
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
