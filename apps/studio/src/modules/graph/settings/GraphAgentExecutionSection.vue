<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { NodeGraphNode } from "@tavern/core/node-graph";

import GraphAgentGenerationParamsPanel from "./GraphAgentGenerationParamsPanel.vue";
import type { GraphAgentExecutionSourceItem } from "./graph-settings-view";
import type { InlineConfigLlmProfileOption } from "../inline-config/node-inline-config";

const props = defineProps<{
  items: GraphAgentExecutionSourceItem[];
  selectedNode: NodeGraphNode | null;
  llmProfiles?: InlineConfigLlmProfileOption[];
  readonly?: boolean;
}>();

const emit = defineEmits<{
  (event: "focus-node", nodeId: string): void;
  (event: "update-node-config", nodeId: string, config: Record<string, unknown>): void;
}>();

const { t } = useI18n();

const selectedExecution = computed(() => readExecution(props.selectedNode?.config));
const selectedGeneration = computed(() => readRecord(selectedExecution.value.generation));

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readExecution(config: unknown): Record<string, unknown> {
  return readRecord(readRecord(config).execution);
}

function commitExecution(execution: Record<string, unknown>): void {
  if (!props.selectedNode) {
    return;
  }
  const base = readRecord(props.selectedNode.config);
  const next = { ...base };
  if (Object.keys(execution).length === 0) {
    delete next.execution;
  } else {
    next.execution = execution;
  }
  emit("update-node-config", props.selectedNode.id, next);
}

const selectedProfileId = computed(() => {
  const value = readRecord(selectedExecution.value.modelSource).profileId;
  return typeof value === "string" ? value : "";
});

// 当前选中 profile 不在列表时（未加载或已删除），仍保留为可见项，避免下拉丢值。
const profileOptions = computed(() => {
  const options = (props.llmProfiles ?? []).map((profile) => ({ value: profile.id, label: profile.name ?? profile.id }));
  if (selectedProfileId.value && !options.some((option) => option.value === selectedProfileId.value)) {
    options.push({ value: selectedProfileId.value, label: selectedProfileId.value });
  }
  return options;
});

function onProfileChange(event: Event): void {
  const profileId = (event.target as HTMLSelectElement).value.trim();
  const execution = { ...selectedExecution.value };
  if (profileId.length > 0) {
    execution.modelSource = { mode: "llm_profile", profileId };
  } else {
    delete execution.modelSource;
  }
  commitExecution(execution);
}

function onModelChange(event: Event): void {
  const modelId = (event.target as HTMLInputElement).value.trim();
  const execution = { ...selectedExecution.value };
  if (modelId.length === 0) {
    delete execution.modelId;
  } else {
    execution.modelId = modelId;
  }
  commitExecution(execution);
}

function onGenerationChange(generation: Record<string, unknown> | undefined): void {
  const execution = { ...selectedExecution.value };
  if (generation) {
    execution.generation = generation;
  } else {
    delete execution.generation;
  }
  commitExecution(execution);
}

function sourceModeLabel(mode: string): string {
  return t(`graph.settings.agentExecution.sourceMode.${mode}`);
}

function modelSourceLabel(item: GraphAgentExecutionSourceItem): string {
  return item.modelSourceLabel === item.sourceMode ? sourceModeLabel(item.sourceMode) : item.modelSourceLabel;
}

function sourceModeClass(mode: string): string {
  switch (mode) {
    case "node_override":
      return "border-signal-accent/50 text-signal-accent";
    case "agent_binding":
      return "border-signal-warn/60 text-signal-warn";
    case "unknown":
      return "border-signal-error/60 text-signal-error";
    default:
      return "border-line-subtle text-text-muted";
  }
}
</script>

<template>
  <section class="space-y-3">
    <div>
      <h3 class="text-xs font-medium text-text-primary">{{ t("graph.settings.agentExecution.title") }}</h3>
      <p class="mt-1 text-[11px] leading-relaxed text-text-muted">
        {{ t("graph.settings.agentExecution.hint") }}
      </p>
    </div>

    <p v-if="items.length === 0" class="text-[11px] text-text-muted">{{ t("graph.settings.agentExecution.empty") }}</p>

    <div class="space-y-1.5">
      <button
        v-for="item in items"
        :key="item.nodeId"
        type="button"
        class="w-full rounded-md border border-line-subtle bg-float/40 p-2 text-left transition-colors hover:border-line-active"
        @click="emit('focus-node', item.nodeId)"
      >
        <div class="flex items-center gap-2">
          <span class="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary">
            {{ item.nodeName || item.nodeId }}
          </span>
          <span class="rounded border px-1.5 py-0.5 font-mono text-[9px]" :class="sourceModeClass(item.sourceMode)">
            {{ sourceModeLabel(item.sourceMode) }}
          </span>
        </div>
        <div class="mt-1 font-mono text-[10px] text-text-muted">{{ item.nodeType }} · {{ modelSourceLabel(item) }}</div>
        <div v-if="item.generationParams.some((param) => param.enabled)" class="mt-1 flex flex-wrap gap-1">
          <span
            v-for="param in item.generationParams.filter((entry) => entry.enabled)"
            :key="param.key"
            class="rounded border border-line-subtle px-1 py-0.5 font-mono text-[9px] text-text-muted"
          >
            {{ param.key }}={{ param.value }}
          </span>
        </div>
      </button>
    </div>

    <div v-if="selectedNode" class="rounded-md border border-line-subtle bg-panel p-2">
      <div class="text-[11px] font-medium text-text-secondary">{{ t("graph.settings.agentExecution.currentNodeConfig") }}</div>
      <label class="mt-2 block">
        <span class="mb-1 block text-[10px] text-text-muted">{{ t("graph.settings.agentExecution.llmProfileId") }}</span>
        <select
          class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-primary"
          :value="selectedProfileId"
          :disabled="readonly"
          @change="onProfileChange"
        >
          <option value="">{{ t("graph.settings.agentExecution.llmProfileInherit") }}</option>
      <option v-for="option in profileOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <label class="mt-2 block">
        <span class="mb-1 block text-[10px] text-text-muted">{{ t("graph.settings.agentExecution.modelId") }}</span>
        <input
          class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-primary"
          :value="selectedExecution.modelId ?? ''"
          :disabled="readonly"
          :placeholder="t('graph.settings.agentExecution.modelPlaceholder')"
          @change="onModelChange"
        />
      </label>
      <div class="mt-3">
        <div class="mb-1 text-[10px] text-text-muted">{{ t("graph.settings.agentExecution.generationParams") }}</div>
        <GraphAgentGenerationParamsPanel
          :generation="selectedGeneration"
          :readonly="readonly"
          @update:generation="onGenerationChange"
        />
      </div>
    </div>
  </section>
</template>
