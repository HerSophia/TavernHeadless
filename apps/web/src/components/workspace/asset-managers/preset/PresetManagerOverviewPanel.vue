<script setup lang="ts">
import UiCheckboxField from "../../../ui/UiCheckboxField.vue";
import UiDialogButton from "../../../ui/UiDialogButton.vue";
import type { WorkspacePresetEditorEntry } from "../../../../lib/workspace-api";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  addEntry: () => void;
  deleteEntry: (identifier: string) => void;
  entries: WorkspacePresetEditorEntry[];
  moveEntryDown: (identifier: string) => void;
  moveEntryUp: (identifier: string) => void;
  openEntry: (identifier: string) => void;
  t: Translator;
  toggleEntryEnabled: (identifier: string) => void;
}>();
</script>

<template>
  <div class="preset-manager-toolbar">
    <span class="dialog-label">{{ props.t("dialogs.presetManagerEntryCount", { count: props.entries.length }) }}</span>
    <UiDialogButton type="button" variant="primary" @click="props.addEntry">
      {{ props.t("dialogs.presetManagerAddEntry") }}
    </UiDialogButton>
  </div>

  <div class="preset-manager-list">
    <div
      v-for="entry in props.entries"
      :key="entry.identifier"
      class="preset-entry-row"
    >
      <button class="preset-entry-main" type="button" @click="props.openEntry(entry.identifier)">
        <strong>{{ entry.name || entry.identifier }}</strong>
        <span>{{ entry.identifier }}</span>
      </button>
      <div class="preset-entry-meta">{{ entry.role }}</div>
      <UiCheckboxField
        class="preset-entry-toggle"
        :checked="entry.enabled"
        @update:checked="() => props.toggleEntryEnabled(entry.identifier)"
      >
        <span>{{ props.t("dialogs.presetManagerEnabled") }}</span>
      </UiCheckboxField>
      <div class="preset-entry-actions">
        <UiDialogButton type="button" @click="props.moveEntryUp(entry.identifier)">&#8593;</UiDialogButton>
        <UiDialogButton type="button" @click="props.moveEntryDown(entry.identifier)">&#8595;</UiDialogButton>
        <UiDialogButton type="button" variant="danger" @click="props.deleteEntry(entry.identifier)">x</UiDialogButton>
      </div>
    </div>
  </div>
</template>
