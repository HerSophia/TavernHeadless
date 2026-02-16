<script setup lang="ts">
import { DialogClose } from "radix-vue";

import {
  useWorldbookManagerDialog,
  type WorldbookManagerDialogEmits,
  type WorldbookManagerDialogProps
} from "../../composables/workspace/assets/managers";
import WorldbookManagerEditorPanel from "./asset-managers/worldbook/WorldbookManagerEditorPanel.vue";
import UiDialogActions from "../ui/UiDialogActions.vue";
import UiDialogButton from "../ui/UiDialogButton.vue";
import UiDialogShell from "../ui/UiDialogShell.vue";

const props = defineProps<WorldbookManagerDialogProps>();
const emit = defineEmits<WorldbookManagerDialogEmits>();

const {
  clearError,
  confirm,
  confirmKey,
  descriptionKey,
  isDeleteMode,
  titleKey,
  updateDraftJson,
  updateDraftName
} = useWorldbookManagerDialog(props, emit);
</script>

<template>
  <UiDialogShell
    :content-class="'worldbook-manager-dialog'"
    :description="props.t(descriptionKey, { asset: props.sourceName || '-' })"
    :open="props.open"
    :title="props.t(titleKey)"
    @update:open="emit('update:open', $event)"
  >
    <div v-if="props.loading" class="asset-manager-loading">
      {{ props.t("dialogs.worldbookManagerLoading") }}
    </div>

    <template v-else>
      <div v-if="props.sourceName" class="asset-manager-source">
        {{ props.sourceName }}
      </div>

      <template v-if="!isDeleteMode">
        <WorldbookManagerEditorPanel
          :clear-error="clearError"
          :draft-json="props.draftJson"
          :draft-name="props.draftName"
          :t="props.t"
          :update-draft-json="updateDraftJson"
          :update-draft-name="updateDraftName"
        />
      </template>
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
        {{ props.saving ? props.t("dialogs.worldbookManagerSaving") : props.t(confirmKey) }}
      </UiDialogButton>
    </UiDialogActions>
  </UiDialogShell>
</template>
