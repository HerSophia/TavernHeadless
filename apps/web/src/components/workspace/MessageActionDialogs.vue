<script setup lang="ts">
import {
  AlertDialogAction,
  AlertDialogCancel,
  DialogClose
} from "radix-vue";

import UiAlertDialogShell from "../ui/UiAlertDialogShell.vue";
import UiDialogActions from "../ui/UiDialogActions.vue";
import UiDialogButton from "../ui/UiDialogButton.vue";
import UiDialogShell from "../ui/UiDialogShell.vue";
import UiTextArea from "../ui/UiTextArea.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;
type MessageRole = "assistant" | "narrator" | "system" | "user";

const props = defineProps<{
  deleteOpen: boolean;
  editDraft: string;
  editOpen: boolean;
  retryOpen: boolean;
  t: Translator;
  targetLabel: string;
  targetRole: MessageRole | null;
}>();

const emit = defineEmits<{
  confirmDelete: [];
  confirmEdit: [];
  confirmEditRegenerate: [];
  confirmRetry: [];
  "update:deleteOpen": [value: boolean];
  "update:editDraft": [value: string];
  "update:editOpen": [value: boolean];
  "update:retryOpen": [value: boolean];
}>();

function handleDraftInput(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) {
    return;
  }

  emit("update:editDraft", target.value);
}
</script>

<template>
  <UiDialogShell
    :description="props.t('dialogs.editDescription', { role: props.targetLabel })"
    :open="props.editOpen"
    :title="props.t('dialogs.editTitle')"
    @update:open="emit('update:editOpen', $event)"
  >
    <UiTextArea
      rows="7"
      :value="props.editDraft"
      @input="handleDraftInput"
    />

    <UiDialogActions>
      <DialogClose as-child>
        <UiDialogButton type="button">{{ props.t("dialogs.cancel") }}</UiDialogButton>
      </DialogClose>
      <UiDialogButton type="button" @click="emit('confirmEdit')">{{ props.t("dialogs.saveEdit") }}</UiDialogButton>
      <UiDialogButton
        v-if="props.targetRole === 'user'"
        type="button"
        variant="primary"
        @click="emit('confirmEditRegenerate')"
      >
        {{ props.t("dialogs.editRegenerate") }}
      </UiDialogButton>
    </UiDialogActions>
  </UiDialogShell>

  <UiAlertDialogShell
    :description="props.t('dialogs.deleteDescription', { role: props.targetLabel })"
    :open="props.deleteOpen"
    :title="props.t('dialogs.deleteTitle')"
    width="sm"
    @update:open="emit('update:deleteOpen', $event)"
  >
    <UiDialogActions>
      <AlertDialogCancel as-child>
        <UiDialogButton type="button">{{ props.t("dialogs.cancel") }}</UiDialogButton>
      </AlertDialogCancel>
      <AlertDialogAction as-child>
        <UiDialogButton type="button" variant="danger" @click="emit('confirmDelete')">
          {{ props.t("dialogs.confirmDelete") }}
        </UiDialogButton>
      </AlertDialogAction>
    </UiDialogActions>
  </UiAlertDialogShell>

  <UiAlertDialogShell
    :description="props.t('dialogs.retryDescription', { role: props.targetLabel })"
    :open="props.retryOpen"
    :title="props.t('dialogs.retryTitle')"
    width="sm"
    @update:open="emit('update:retryOpen', $event)"
  >
    <UiDialogActions>
      <AlertDialogCancel as-child>
        <UiDialogButton type="button">{{ props.t("dialogs.cancel") }}</UiDialogButton>
      </AlertDialogCancel>
      <AlertDialogAction as-child>
        <UiDialogButton type="button" variant="primary" @click="emit('confirmRetry')">
          {{ props.t("dialogs.confirmRetry") }}
        </UiDialogButton>
      </AlertDialogAction>
    </UiDialogActions>
  </UiAlertDialogShell>
</template>
