<script setup lang="ts">
import UiDialogRow from "../../../ui/UiDialogRow.vue";
import UiTextArea from "../../../ui/UiTextArea.vue";
import UiTextInput from "../../../ui/UiTextInput.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  clearError: () => void;
  draftJson: string;
  draftName: string;
  t: Translator;
  updateDraftJson: (event: Event) => void;
  updateDraftName: (event: Event) => void;
}>();
</script>

<template>
  <UiDialogRow :label="props.t('dialogs.worldbookManagerName')" row-class="mt-3">
    <UiTextInput
      :value="props.draftName"
      autocomplete="off"
      type="text"
      @focus="props.clearError"
      @input="props.updateDraftName"
    />
  </UiDialogRow>

  <UiDialogRow :label="props.t('dialogs.worldbookManagerJson')" row-class="mt-3">
    <UiTextArea
      textarea-class="mt-2 min-h-[260px] font-mono text-[11px]"
      :value="props.draftJson"
      @focus="props.clearError"
      @input="props.updateDraftJson"
    />
  </UiDialogRow>
</template>
