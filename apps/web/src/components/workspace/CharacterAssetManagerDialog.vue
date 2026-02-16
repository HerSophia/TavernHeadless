<script setup lang="ts">
import { DialogClose } from "radix-vue";

import {
  useCharacterManagerDialog,
  type CharacterManagerDialogEmits,
  type CharacterManagerDialogProps
} from "../../composables/workspace/assets/managers";
import CharacterManagerDraftGrid from "./asset-managers/character/CharacterManagerDraftGrid.vue";
import UiDialogActions from "../ui/UiDialogActions.vue";
import UiDialogButton from "../ui/UiDialogButton.vue";
import UiDialogRow from "../ui/UiDialogRow.vue";
import UiDialogShell from "../ui/UiDialogShell.vue";
import UiTextInput from "../ui/UiTextInput.vue";

const props = defineProps<CharacterManagerDialogProps>();
const emit = defineEmits<CharacterManagerDialogEmits>();

const {
  confirm,
  confirmKey,
  descriptionKey,
  isDeletedStatus,
  isDeleteMode,
  isEditingMode,
  isRestoreMode,
  requestDelete,
  requestRestore,
  statusKey,
  titleKey,
  updateDraftDescription,
  updateDraftFirstMessage,
  updateDraftName,
  updateDraftPersonality,
  updateDraftScenario
} = useCharacterManagerDialog(props, emit);
</script>

<template>
  <UiDialogShell
    :content-class="'character-manager-dialog'"
    :description="props.t(descriptionKey, { asset: props.sourceName })"
    :open="props.open"
    :title="props.t(titleKey)"
    @update:open="emit('update:open', $event)"
  >
    <div v-if="props.loading" class="asset-manager-loading">
      {{ props.t("dialogs.characterManagerLoading") }}
    </div>

    <template v-else>
      <div class="asset-manager-source">{{ props.sourceName }}</div>

      <div class="character-manager-meta">
        <span>{{ props.t("dialogs.characterManagerStatus") }}: {{ props.t(statusKey) }}</span>
        <span>{{ props.t("dialogs.characterManagerVersion") }}: {{ props.latestVersionNo ?? 0 }}</span>
      </div>

      <template v-if="isEditingMode">
        <p class="character-manager-tip">{{ props.t("dialogs.characterManagerFieldTip") }}</p>

        <div v-if="isDeletedStatus" class="asset-manager-loading">
          {{ props.t("dialogs.characterManagerDeletedReadonlyTip") }}
        </div>

        <template v-else>
          <UiDialogRow :label="props.t('dialogs.characterManagerName')" row-class="mt-2">
            <UiTextInput
              type="text"
              :value="props.draftName"
              @input="updateDraftName"
            />
          </UiDialogRow>
          <CharacterManagerDraftGrid
            :draft-description="props.draftDescription"
            :draft-first-message="props.draftFirstMessage"
            :draft-personality="props.draftPersonality"
            :draft-scenario="props.draftScenario"
            :t="props.t"
            :update-draft-description="updateDraftDescription"
            :update-draft-first-message="updateDraftFirstMessage"
            :update-draft-personality="updateDraftPersonality"
            :update-draft-scenario="updateDraftScenario"
          />
        </template>
      </template>
    </template>

    <p v-if="props.errorMessage" class="asset-manager-error mt-3">{{ props.errorMessage }}</p>

    <UiDialogActions>
      <DialogClose as-child>
        <UiDialogButton type="button">{{ props.t("dialogs.cancel") }}</UiDialogButton>
      </DialogClose>

      <UiDialogButton
        v-if="isEditingMode && !isDeletedStatus"
        type="button"
        variant="danger"
        :disabled="props.loading || props.saving"
        @click="requestDelete"
      >
        {{ props.t("dialogs.characterManagerSwitchDelete") }}
      </UiDialogButton>

      <UiDialogButton
        v-if="isDeletedStatus && !isRestoreMode"
        type="button"
        :disabled="props.loading || props.saving"
        @click="requestRestore"
      >
        {{ props.t("dialogs.characterManagerSwitchRestore") }}
      </UiDialogButton>

      <UiDialogButton
        type="button"
        :disabled="props.loading || props.saving"
        :variant="isDeleteMode ? 'danger' : 'primary'"
        @click="confirm"
      >
        {{ props.saving ? props.t("dialogs.characterManagerSaving") : props.t(confirmKey) }}
      </UiDialogButton>
    </UiDialogActions>
  </UiDialogShell>
</template>
