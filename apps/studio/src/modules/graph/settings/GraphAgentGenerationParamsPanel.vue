<script setup lang="ts">
import { useI18n } from "vue-i18n";

import type { GraphAgentGenerationParamKey } from "./graph-settings-view";

const props = defineProps<{
  generation?: Record<string, unknown>;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  (event: "update:generation", value: Record<string, unknown> | undefined): void;
}>();

const { t } = useI18n();

const params: Array<{ key: GraphAgentGenerationParamKey; min?: number; max?: number; step: number }> = [
  { key: "temperature", min: 0, max: 2, step: 0.1 },
  { key: "topP", min: 0, max: 1, step: 0.05 },
  { key: "maxOutputTokens", min: 1, step: 1 },
  { key: "maxContextTokens", min: 1, step: 1 },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readParam(key: string): { enabled: boolean; value: number | undefined } {
  const item = props.generation?.[key];
  if (!isRecord(item)) {
    return { enabled: false, value: undefined };
  }
  return {
    enabled: item.enabled === true,
    value: typeof item.value === "number" ? item.value : undefined,
  };
}

function writeParam(key: GraphAgentGenerationParamKey, patch: Partial<{ enabled: boolean; value: number | undefined }>): void {
  const next = { ...(props.generation ?? {}) };
  const current = readParam(key);
  const item = { ...current, ...patch };
  if (item.enabled === false && item.value === undefined) {
    delete next[key];
  } else {
    next[key] = item;
  }
  emit("update:generation", Object.keys(next).length > 0 ? next : undefined);
}

function onToggle(key: GraphAgentGenerationParamKey, event: Event): void {
  writeParam(key, { enabled: (event.target as HTMLInputElement).checked });
}

function onValue(key: GraphAgentGenerationParamKey, event: Event): void {
  const value = (event.target as HTMLInputElement).valueAsNumber;
  writeParam(key, { value: Number.isFinite(value) ? value : undefined });
}
</script>

<template>
  <div class="space-y-2">
    <div
      v-for="param in params"
      :key="param.key"
      class="rounded-md border border-line-subtle bg-float/40 p-2"
    >
      <label class="flex items-center gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          class="size-3.5 accent-signal-accent"
          :checked="readParam(param.key).enabled"
          :disabled="readonly"
          @change="onToggle(param.key, $event)"
        />
        <span class="font-medium">{{ param.key }}</span>
      </label>
      <input
        type="number"
        class="mt-2 w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent disabled:cursor-not-allowed disabled:opacity-50"
        :value="readParam(param.key).value ?? ''"
        :min="param.min"
        :max="param.max"
        :step="param.step"
        :disabled="readonly || !readParam(param.key).enabled"
        @change="onValue(param.key, $event)"
      />
      <p v-if="!readParam(param.key).enabled" class="mt-1 text-[10px] text-text-muted">
        {{ t("graph.settings.agentExecution.generationParamDisabledHint") }}
      </p>
    </div>
  </div>
</template>
