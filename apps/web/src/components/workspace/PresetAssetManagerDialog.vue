<script setup lang="ts">
import { DialogClose } from "radix-vue";

import {
  usePresetManagerDialog,
  type PresetManagerDialogEmits,
  type PresetManagerDialogProps
} from "../../composables/workspace/assets/managers";
import PresetManagerEntryEditorPanel from "./asset-managers/preset/PresetManagerEntryEditorPanel.vue";
import PresetManagerOverviewPanel from "./asset-managers/preset/PresetManagerOverviewPanel.vue";
import UiDialogActions from "../ui/UiDialogActions.vue";
import UiDialogButton from "../ui/UiDialogButton.vue";
import UiDialogRow from "../ui/UiDialogRow.vue";
import UiDialogShell from "../ui/UiDialogShell.vue";
import UiTextInput from "../ui/UiTextInput.vue";

const props = defineProps<PresetManagerDialogProps>();
const emit = defineEmits<PresetManagerDialogEmits>();

const {
  activeEntry,
  addEntry,
  confirm,
  confirmKey,
  deleteEntry,
  descriptionKey,
  entries,
  handleNameInput,
  isDeleteMode,
  moveEntryDown,
  moveEntryUp,
  openEntry,
  openOverview,
  titleKey,
  toggleActiveEntryEnabled,
  toggleEntryEnabled,
  updateActiveEntryContent,
  updateActiveEntryForbidOverrides,
  updateActiveEntryInjectionDepth,
  updateActiveEntryInjectionOrder,
  updateActiveEntryInjectionPosition,
  updateActiveEntryMarker,
  updateActiveEntryName,
  updateActiveEntryRole,
  updateActiveEntrySystemPrompt
} = usePresetManagerDialog(props, emit);
</script>

<template>
  <UiDialogShell
    :content-class="'preset-manager-dialog'"
    :description="props.t(descriptionKey, { asset: props.sourceName })"
    :open="props.open"
    :title="props.t(titleKey)"
    @update:open="emit('update:open', $event)"
  >
    <div v-if="props.loading" class="asset-manager-loading">
      {{ props.t("dialogs.presetManagerLoading") }}
    </div>

    <template v-else-if="isDeleteMode">
      <div class="asset-manager-source">{{ props.sourceName }}</div>
    </template>

    <template v-else>
      <UiDialogRow :label="props.t('dialogs.presetManagerName')" row-class="mt-3">
        <UiTextInput
          type="text"
          :value="props.draftName"
          @input="handleNameInput"
        />
      </UiDialogRow>

      <div class="preset-manager-body mt-3">
        <template v-if="props.view === 'overview'">
          <PresetManagerOverviewPanel
            :add-entry="addEntry"
            :delete-entry="deleteEntry"
            :entries="entries"
            :move-entry-down="moveEntryDown"
            :move-entry-up="moveEntryUp"
            :open-entry="openEntry"
            :t="props.t"
            :toggle-entry-enabled="toggleEntryEnabled"
          />
        </template>

        <template v-else-if="activeEntry">
          <PresetManagerEntryEditorPanel
            :active-entry="activeEntry"
            :open-overview="openOverview"
            :t="props.t"
            :toggle-active-entry-enabled="toggleActiveEntryEnabled"
            :update-active-entry-content="updateActiveEntryContent"
            :update-active-entry-forbid-overrides="updateActiveEntryForbidOverrides"
            :update-active-entry-injection-depth="updateActiveEntryInjectionDepth"
            :update-active-entry-injection-order="updateActiveEntryInjectionOrder"
            :update-active-entry-injection-position="updateActiveEntryInjectionPosition"
            :update-active-entry-marker="updateActiveEntryMarker"
            :update-active-entry-name="updateActiveEntryName"
            :update-active-entry-role="updateActiveEntryRole"
            :update-active-entry-system-prompt="updateActiveEntrySystemPrompt"
          />
        </template>

        <div v-else class="asset-manager-loading">
          {{ props.t("dialogs.presetManagerEntryMissing") }}
        </div>
      </div>
    </template>

    <p v-if="props.errorMessage" class="asset-manager-error mt-3">{{ props.errorMessage }}</p>

    <UiDialogActions>
      <DialogClose as-child>
        <UiDialogButton type="button">{{ props.t("dialogs.cancel") }}</UiDialogButton>
      </DialogClose>
      <UiDialogButton
        type="button"
        :disabled="props.loading || props.saving"
        :variant="isDeleteMode ? 'danger' : 'primary'"
        @click="confirm"
      >
        {{ props.saving ? props.t("dialogs.presetManagerSaving") : props.t(confirmKey) }}
      </UiDialogButton>
    </UiDialogActions>
  </UiDialogShell>
</template>
