<script setup lang="ts">
import type { NodeGraphDiagnostic } from "@tavern/core/node-graph";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import ConditionExprEditor from "./ConditionExprEditor.vue";
import {
  defaultConditionExpr,
  readControlConditionExpr,
  validateControlConditionExpr,
  writeControlConditionExpr,
} from "./control-node-config";

const props = defineProps<{
  config?: unknown;
  nodeType: "control.condition" | "control.branch" | "control.gate";
  diagnostics?: NodeGraphDiagnostic[];
}>();

const emit = defineEmits<{
  (event: "update:config", config: Record<string, unknown>): void;
}>();

const { t } = useI18n();

const inlineCondition = computed(() => readControlConditionExpr(props.config));
const allowInputCondition = computed(() => props.nodeType !== "control.condition");
const conditionMode = computed<"input" | "inline">(() =>
  allowInputCondition.value && inlineCondition.value === null ? "input" : "inline",
);
const editorExpr = computed(() => inlineCondition.value ?? defaultConditionExpr("exists"));
const conditionIssues = computed(() =>
  conditionMode.value === "inline" ? validateControlConditionExpr(editorExpr.value) : [],
);
const nodeDiagnostics = computed(() => props.diagnostics ?? []);

function selectValue(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}

function updateConditionMode(event: Event): void {
  const mode = selectValue(event);
  if (mode === "input") {
    emit("update:config", writeControlConditionExpr(props.config, null));
    return;
  }
  emit("update:config", writeControlConditionExpr(props.config, editorExpr.value));
}

function updateCondition(expr: typeof editorExpr.value): void {
  emit("update:config", writeControlConditionExpr(props.config, expr));
}
</script>

<template>
  <div class="space-y-3 rounded-md border border-line-subtle bg-float/50 p-2">
    <div class="space-y-1 text-[10px] leading-relaxed text-text-muted">
      <p v-if="nodeType === 'control.condition'">{{ t("graph.controlConfig.conditionNodeHint") }}</p>
      <p v-else-if="nodeType === 'control.branch'">{{ t("graph.controlConfig.branchHint") }}</p>
      <p v-else>{{ t("graph.controlConfig.gateConditionHint") }}</p>
    </div>

    <label v-if="allowInputCondition" class="block">
      <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.controlConfig.conditionSource") }}</span>
      <select
        class="w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
        :value="conditionMode"
        @change="updateConditionMode"
      >
        <option value="input">{{ t("graph.controlConfig.conditionFromInput") }}</option>
        <option value="inline">{{ t("graph.controlConfig.conditionInline") }}</option>
      </select>
    </label>

    <ConditionExprEditor
      v-if="conditionMode === 'inline'"
      :expr="editorExpr"
      @update:expr="updateCondition"
    />

    <div v-if="nodeType === 'control.branch'" class="rounded-md border border-line-subtle bg-panel/70 p-2 text-[10px] leading-relaxed text-text-muted">
      <p>{{ t("graph.controlConfig.branchTrueHint") }}</p>
      <p>{{ t("graph.controlConfig.branchFalseHint") }}</p>
    </div>

    <div class="space-y-1 text-[10px] leading-relaxed">
      <p v-for="issue in conditionIssues" :key="issue.code + issue.message" class="text-signal-error">
        {{ issue.message }}
      </p>
      <p v-for="diagnostic in nodeDiagnostics" :key="diagnostic.code + diagnostic.message" class="text-signal-warn">
        {{ diagnostic.message }}
      </p>
      <p class="text-text-muted">{{ t("graph.controlConfig.unknownFieldsHint") }}</p>
    </div>
  </div>
</template>
