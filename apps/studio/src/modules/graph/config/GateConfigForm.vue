<script setup lang="ts">
import type { NodeGraphDiagnostic, NodeGraphOnSkipBehavior } from "@tavern/core/node-graph";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import ConditionConfigForm from "./ConditionConfigForm.vue";
import {
  CONTROL_GATE_ON_SKIP_OPTIONS,
  readGateOnSkip,
  writeGateOnSkipConfig,
} from "./control-node-config";

const props = defineProps<{
  config?: unknown;
  diagnostics?: NodeGraphDiagnostic[];
}>();

const emit = defineEmits<{
  (event: "update:config", config: Record<string, unknown>): void;
}>();

const { t } = useI18n();

const onSkip = computed(() => readGateOnSkip(props.config));
const onSkipOptions = CONTROL_GATE_ON_SKIP_OPTIONS;

function selectValue(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}

function updateOnSkip(event: Event): void {
  emit("update:config", writeGateOnSkipConfig(props.config, selectValue(event) as NodeGraphOnSkipBehavior));
}
</script>

<template>
  <div class="space-y-3">
    <div class="rounded-md border border-line-subtle bg-float/50 p-2">
      <label class="block">
        <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.controlConfig.onSkip") }}</span>
        <select
          class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 font-mono text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :value="onSkip"
          @change="updateOnSkip"
        >
          <option v-for="behavior in onSkipOptions" :key="behavior" :value="behavior">
            {{ t(`graph.controlConfig.onSkipValue.${behavior}`) }}
          </option>
        </select>
      </label>
      <p class="mt-1 text-[10px] leading-relaxed text-text-muted">{{ t("graph.controlConfig.onSkipHint") }}</p>
    </div>

    <ConditionConfigForm
      node-type="control.gate"
      :config="config"
      :diagnostics="diagnostics"
      @update:config="(next) => emit('update:config', next)"
    />
  </div>
</template>
