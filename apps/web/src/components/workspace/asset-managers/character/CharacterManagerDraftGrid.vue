<script setup lang="ts">
import UiTextArea from "../../../ui/UiTextArea.vue";
type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  draftDescription: string;
  draftFirstMessage: string;
  draftPersonality: string;
  draftScenario: string;
  t: Translator;
  updateDraftDescription: (event: Event) => void;
  updateDraftFirstMessage: (event: Event) => void;
  updateDraftPersonality: (event: Event) => void;
  updateDraftScenario: (event: Event) => void;
}>();
</script>

<template>
  <div class="character-manager-grid mt-2">
    <label>
      <span class="dialog-label">{{ props.t("dialogs.characterManagerDescription") }}</span>
      <UiTextArea
        rows="4"
        :value="props.draftDescription"
        @input="props.updateDraftDescription"
      />
    </label>
    <label>
      <span class="dialog-label">{{ props.t("dialogs.characterManagerPersonality") }}</span>
      <UiTextArea
        rows="4"
        :value="props.draftPersonality"
        @input="props.updateDraftPersonality"
      />
    </label>
    <label>
      <span class="dialog-label">{{ props.t("dialogs.characterManagerFirstMessage") }}</span>
      <UiTextArea
        rows="4"
        :value="props.draftFirstMessage"
        @input="props.updateDraftFirstMessage"
      />
    </label>
    <label>
      <span class="dialog-label">{{ props.t("dialogs.characterManagerScenario") }}</span>
      <UiTextArea
        rows="4"
        :value="props.draftScenario"
        @input="props.updateDraftScenario"
      />
    </label>
  </div>
</template>
