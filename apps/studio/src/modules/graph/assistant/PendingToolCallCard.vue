<script setup lang="ts">
import { AlertTriangle, Check, X } from "lucide-vue-next";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import type { GraphAssistantPendingToolCall } from "../../../lib/graph-assistant-confirmation-api";
import { isDangerSideEffect, shortToolName, summarizeToolArgs } from "./pending-tool-call-view";

const props = defineProps<{
  pending: GraphAssistantPendingToolCall;
  busy?: boolean;
}>();

const emit = defineEmits<{
  (event: "approve", confirmationId: string): void;
  (event: "reject", confirmationId: string): void;
}>();

const { t } = useI18n();

const danger = computed(() => isDangerSideEffect(props.pending.side_effect_level));
const summary = computed(() => summarizeToolArgs(props.pending.args));
const toolLabel = computed(() => shortToolName(props.pending.tool_name));
</script>

<template>
  <div class="rounded-md border border-line-subtle bg-float px-2.5 py-2" :class="danger ? 'border-signal-error/40' : ''">
    <div class="flex items-center gap-1.5">
      <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-text-primary">{{ toolLabel }}</span>
      <span
        v-if="danger"
        class="inline-flex shrink-0 items-center gap-0.5 rounded border border-signal-error/40 px-1 py-px text-[9px] uppercase text-signal-error"
      >
        <AlertTriangle :size="9" :stroke-width="1.5" />
        {{ t("graphAssistant.confirmation.danger") }}
      </span>
    </div>

    <dl v-if="summary.entries.length > 0" class="mt-1.5 space-y-0.5">
      <div v-for="entry in summary.entries" :key="entry.key" class="flex gap-1.5 text-[11px] leading-snug">
        <dt class="shrink-0 font-mono text-text-muted">{{ entry.key }}</dt>
        <dd class="min-w-0 flex-1 truncate text-text-secondary" :title="entry.value">{{ entry.value }}</dd>
      </div>
      <p v-if="summary.truncatedCount > 0" class="font-mono text-[10px] text-text-muted">
        {{ t("graphAssistant.confirmation.moreArgs", { count: summary.truncatedCount }) }}
      </p>
    </dl>
    <p v-else class="mt-1.5 text-[11px] text-text-muted">{{ t("graphAssistant.confirmation.noArgs") }}</p>

    <div class="mt-2 flex items-center justify-end gap-1.5">
      <button
        type="button"
        :disabled="busy"
        class="inline-flex items-center gap-1 rounded-md border border-line-subtle px-2 py-1 text-[11px] text-text-secondary transition-colors duration-150 hover:bg-panel hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        @click="emit('reject', pending.id)"
      >
        <X :size="12" :stroke-width="1.5" />
        {{ t("graphAssistant.confirmation.reject") }}
      </button>
      <button
        type="button"
        :disabled="busy"
        class="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
        :class="
          danger
            ? 'border-signal-error/40 text-signal-error hover:bg-signal-error/10'
            : 'border-signal-accent/40 text-signal-accent hover:bg-signal-accent/10'
        "
        @click="emit('approve', pending.id)"
      >
        <Check :size="12" :stroke-width="1.5" />
        {{ t("graphAssistant.confirmation.approve") }}
      </button>
    </div>
  </div>
</template>
