<script setup lang="ts">
import UiCheckboxField from "../../../ui/UiCheckboxField.vue";
import UiDialogButton from "../../../ui/UiDialogButton.vue";
import UiDialogRow from "../../../ui/UiDialogRow.vue";
import UiSelectShell from "../../../ui/UiSelectShell.vue";
import UiTextArea from "../../../ui/UiTextArea.vue";
import UiTextInput from "../../../ui/UiTextInput.vue";
import type { WorkspacePresetEditorEntry } from "../../../../lib/workspace-api";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  activeEntry: WorkspacePresetEditorEntry;
  openOverview: () => void;
  t: Translator;
  toggleActiveEntryEnabled: () => void;
  updateActiveEntryContent: (event: Event) => void;
  updateActiveEntryForbidOverrides: (checked: boolean) => void;
  updateActiveEntryInjectionDepth: (event: Event) => void;
  updateActiveEntryInjectionOrder: (event: Event) => void;
  updateActiveEntryInjectionPosition: (event: Event) => void;
  updateActiveEntryMarker: (checked: boolean) => void;
  updateActiveEntryName: (event: Event) => void;
  updateActiveEntryRole: (value: string) => void;
  updateActiveEntrySystemPrompt: (checked: boolean) => void;
}>();

const roleOptions = [
  { label: "system", value: "system" },
  { label: "user", value: "user" },
  { label: "assistant", value: "assistant" }
] as const;
</script>

<template>
  <div class="preset-manager-entry-head">
    <UiDialogButton type="button" @click="props.openOverview">
      {{ props.t("dialogs.presetManagerBackOverview") }}
    </UiDialogButton>
    <span class="dialog-label">{{ props.activeEntry.identifier }}</span>
  </div>

  <UiDialogRow :label="props.t('dialogs.presetManagerEntryName')" row-class="mt-2">
    <UiTextInput
      type="text"
      :value="props.activeEntry.name"
      @input="props.updateActiveEntryName"
    />
  </UiDialogRow>

  <UiDialogRow :label="props.t('dialogs.presetManagerEntryRole')" row-class="mt-2">
    <UiSelectShell
      :model-value="props.activeEntry.role"
      :options="roleOptions"
      @update:model-value="props.updateActiveEntryRole"
    />
  </UiDialogRow>

  <div class="preset-manager-switches mt-2">
    <UiCheckboxField :checked="props.activeEntry.systemPrompt" @update:checked="props.updateActiveEntrySystemPrompt">
      <span>{{ props.t("dialogs.presetManagerSystemPrompt") }}</span>
    </UiCheckboxField>
    <UiCheckboxField :checked="props.activeEntry.marker" @update:checked="props.updateActiveEntryMarker">
      <span>{{ props.t("dialogs.presetManagerMarker") }}</span>
    </UiCheckboxField>
    <UiCheckboxField
      :checked="props.activeEntry.enabled"
      @update:checked="() => props.toggleActiveEntryEnabled()"
    >
      <span>{{ props.t("dialogs.presetManagerEnabled") }}</span>
    </UiCheckboxField>
  </div>

  <UiTextArea
    textarea-class="mt-3"
    rows="8"
    :value="props.activeEntry.content"
    @input="props.updateActiveEntryContent"
  />

  <div class="preset-manager-grid mt-2">
    <label>
      <span class="dialog-label">{{ props.t("dialogs.presetManagerInjectionPosition") }}</span>
      <UiTextInput
        type="number"
        :value="props.activeEntry.injectionPosition"
        @input="props.updateActiveEntryInjectionPosition"
      />
    </label>
    <label>
      <span class="dialog-label">{{ props.t("dialogs.presetManagerInjectionDepth") }}</span>
      <UiTextInput
        type="number"
        :value="props.activeEntry.injectionDepth ?? ''"
        @input="props.updateActiveEntryInjectionDepth"
      />
    </label>
    <label>
      <span class="dialog-label">{{ props.t("dialogs.presetManagerInjectionOrder") }}</span>
      <UiTextInput
        type="number"
        :value="props.activeEntry.injectionOrder ?? ''"
        @input="props.updateActiveEntryInjectionOrder"
      />
    </label>
  </div>

  <div class="preset-manager-switches mt-2">
    <UiCheckboxField
      :checked="props.activeEntry.forbidOverrides ?? false"
      @update:checked="props.updateActiveEntryForbidOverrides"
    >
      <span>{{ props.t("dialogs.presetManagerForbidOverrides") }}</span>
    </UiCheckboxField>
  </div>
</template>
