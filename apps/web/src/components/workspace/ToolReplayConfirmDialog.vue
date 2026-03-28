<script setup lang="ts">
import { AlertDialogAction, AlertDialogCancel } from "radix-vue";

import type { WorkspaceReplayBlockingExecution } from "../../lib/workspace-api";
import UiAlertDialogShell from "../ui/UiAlertDialogShell.vue";
import UiDialogActions from "../ui/UiDialogActions.vue";
import UiDialogButton from "../ui/UiDialogButton.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  blockingExecutions: WorkspaceReplayBlockingExecution[];
  busy: boolean;
  open: boolean;
  t: Translator;
}>();

const emit = defineEmits<{
  confirm: [];
  "update:open": [value: boolean];
}>();

function formatOptional(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "—";
}
</script>

<template>
  <UiAlertDialogShell
    :description="props.t('dialogs.toolReplayConfirmDescription', { count: props.blockingExecutions.length })"
    :open="props.open"
    :title="props.t('dialogs.toolReplayConfirmTitle')"
    @update:open="emit('update:open', $event)"
  >
    <div class="max-h-80 space-y-3 overflow-y-auto pr-1">
      <div
        v-if="props.blockingExecutions.length === 0"
        class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500"
      >
        {{ props.t("dialogs.toolReplayConfirmEmpty") }}
      </div>

      <div
        v-for="execution in props.blockingExecutions"
        :key="execution.executionId"
        class="rounded border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-zinc-300"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="font-mono text-[11px] text-zinc-100">{{ execution.toolName }}</div>
          <div class="font-mono text-[10px] text-amber-300">{{ execution.replaySafety }}</div>
        </div>

        <div class="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
          <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.toolReplayExecutionId") }}</span>
          <span class="break-all font-mono text-[10px] text-zinc-400">{{ execution.executionId }}</span>

          <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.toolReplayProvider") }}</span>
          <span class="break-all font-mono text-[10px] text-zinc-400">{{ execution.providerId }}</span>

          <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.toolReplayStatus") }}</span>
          <span class="font-mono text-[10px] text-zinc-400">{{ execution.status }}</span>

          <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.toolReplayReplaySafety") }}</span>
          <span class="font-mono text-[10px] text-zinc-400">{{ execution.replaySafety }}</span>

          <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.toolReplaySideEffectLevel") }}</span>
          <span class="font-mono text-[10px] text-zinc-400">{{ formatOptional(execution.sideEffectLevel) }}</span>

          <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.toolReplayReason") }}</span>
          <span class="text-[11px] text-zinc-300">{{ execution.reason }}</span>
        </div>

        <div v-if="execution.errorMessage" class="mt-2 rounded border border-white/5 bg-black/20 px-2 py-1 font-mono text-[10px] text-zinc-400">
          {{ execution.errorMessage }}
        </div>
      </div>
    </div>

    <UiDialogActions>
      <AlertDialogCancel as-child>
        <UiDialogButton type="button">{{ props.t("dialogs.cancel") }}</UiDialogButton>
      </AlertDialogCancel>
      <AlertDialogAction as-child>
        <UiDialogButton
          :disabled="props.busy || props.blockingExecutions.length === 0"
          type="button"
          variant="primary"
          @click="emit('confirm')"
        >
          {{ props.busy ? props.t("dialogs.toolReplayConfirmBusy") : props.t("dialogs.toolReplayConfirmAction") }}
        </UiDialogButton>
      </AlertDialogAction>
    </UiDialogActions>
  </UiAlertDialogShell>
</template>
