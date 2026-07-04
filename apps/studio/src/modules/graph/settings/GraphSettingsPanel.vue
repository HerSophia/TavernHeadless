<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type {
  NodeGraphBudgetOverrides,
  NodeGraphDocument,
  NodeGraphNode,
  NodeGraphPermissionManifest,
  NodeGraphPolicies,
} from "@tavern/core/node-graph";

import GraphAgentExecutionSection from "./GraphAgentExecutionSection.vue";
import { buildGraphSettingsView, type GraphBudgetViewItem } from "./graph-settings-view";
import type { SourcedNodeGraphDiagnostic } from "../validate/local-validation";
import type { InlineConfigLlmProfileOption } from "../inline-config/node-inline-config";

const props = defineProps<{
  document: NodeGraphDocument | null;
  diagnostics: SourcedNodeGraphDiagnostic[];
  selectedNode: NodeGraphNode | null;
  llmProfiles?: InlineConfigLlmProfileOption[];
  readonly?: boolean;
}>();

const emit = defineEmits<{
  (event: "update-policies", policies: NodeGraphPolicies): void;
  (event: "update-permissions", permissions: NodeGraphPermissionManifest | undefined): void;
  (event: "update-budgets", budgets: NodeGraphBudgetOverrides | undefined): void;
  (event: "update-node-config", nodeId: string, config: Record<string, unknown>): void;
  (event: "focus-node", nodeId: string): void;
}>();

const { t } = useI18n();

const view = computed(() => props.document ? buildGraphSettingsView(props.document, props.diagnostics) : null);

function patchPolicies(patch: Partial<NodeGraphPolicies>): void {
  if (!props.document) {
    return;
  }
  emit("update-policies", { ...props.document.policies, ...patch });
}

function addMissingPermissions(): void {
  if (!props.document || !view.value) {
    return;
  }
  const required = new Set(props.document.permissions?.required ?? []);
  for (const permission of view.value.permissions.missingRequired) {
    required.add(permission);
  }
  emit("update-permissions", {
    ...(props.document.permissions ?? {}),
    required: [...required].sort(),
  });
}

function setOutputTargetsMode(mode: "unscoped" | "deny_all" | "scoped"): void {
  if (!props.document) {
    return;
  }
  const next = { ...(props.document.permissions ?? {}) };
  if (mode === "unscoped") {
    delete next.outputTargets;
  } else if (mode === "deny_all") {
    next.outputTargets = [];
  } else {
    next.outputTargets = props.document.permissions?.outputTargets ?? [];
  }
  emit("update-permissions", Object.keys(next).length > 0 ? next : undefined);
}

function onBudgetChange(item: GraphBudgetViewItem, event: Event): void {
  if (!props.document) {
    return;
  }
  const raw = (event.target as HTMLInputElement).value;
  const next = { ...(props.document.budgets ?? {}) };
  if (raw.trim().length === 0) {
    delete next[item.key];
  } else {
    const value = Number(raw);
    if (Number.isFinite(value)) {
      next[item.key] = Math.trunc(value);
    }
  }
  emit("update-budgets", Object.keys(next).length > 0 ? next : undefined);
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header class="flex h-9 shrink-0 items-center border-b border-line-subtle px-3 text-xs">
      <span class="font-medium text-text-secondary">{{ t("graph.settings.title") }}</span>
    </header>

    <div v-if="!document || !view" class="flex flex-1 items-center justify-center p-6 text-center">
      <p class="text-xs text-text-muted">{{ t("graph.settings.empty") }}</p>
    </div>

    <div v-else class="min-h-0 flex-1 space-y-4 overflow-auto px-3 py-3">
      <section class="rounded-md border border-line-subtle bg-float/30 p-2">
        <h3 class="text-xs font-medium text-text-primary">{{ t("graph.settings.overview.title") }}</h3>
        <div class="mt-2 grid grid-cols-2 gap-1 font-mono text-[10px] text-text-muted">
          <span>{{ t("graph.settings.overview.schema", { version: view.overview.schemaVersion }) }}</span>
          <span>{{ t("graph.settings.overview.nodes", { count: view.overview.nodeCount }) }}</span>
          <span>{{ t("graph.settings.overview.edges", { count: view.overview.edgeCount }) }}</span>
          <span>{{ t("graph.settings.overview.groups", { count: view.overview.groupCount }) }}</span>
        </div>
      </section>

      <section class="rounded-md border border-line-subtle bg-float/30 p-2">
        <h3 class="text-xs font-medium text-text-primary">{{ t("graph.settings.policies.title") }}</h3>
        <label class="mt-2 flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            class="size-3.5 accent-signal-accent"
            :checked="view.policies.allowBackgroundJobs"
            :disabled="readonly"
            @change="patchPolicies({ allowBackgroundJobs: ($event.target as HTMLInputElement).checked })"
          />
          {{ t("graph.settings.policies.allowBackgroundJobs") }}
        </label>
        <label class="mt-2 flex items-center gap-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            class="size-3.5 accent-signal-accent"
            :checked="view.policies.allowPersistentOutputs"
            :disabled="readonly"
            @change="patchPolicies({ allowPersistentOutputs: ($event.target as HTMLInputElement).checked })"
          />
          {{ t("graph.settings.policies.allowPersistentOutputs") }}
        </label>
        <p class="mt-2 text-[10px] leading-relaxed text-text-muted">
          {{ t("graph.settings.policies.maxParallelNodesHint") }}
        </p>
      </section>

      <GraphAgentExecutionSection
      :items="view.agentExecution"
        :selected-node="selectedNode"
        :llm-profiles="llmProfiles ?? []"
        :readonly="readonly"
        @focus-node="emit('focus-node', $event)"
        @update-node-config="(nodeId, config) => emit('update-node-config', nodeId, config)"
      />

      <section class="rounded-md border border-line-subtle bg-float/30 p-2">
        <div class="flex items-center gap-2">
          <h3 class="text-xs font-medium text-text-primary">{{ t("graph.settings.permissions.title") }}</h3>
          <button
            type="button"
            class="ml-auto rounded border border-line-subtle px-1.5 py-0.5 text-[10px] text-text-muted hover:text-text-secondary"
            :disabled="readonly || view.permissions.missingRequired.length === 0"
            @click="addMissingPermissions"
          >
            {{ t("graph.settings.permissions.addMissing") }}
          </button>
        </div>
        <div class="mt-2 space-y-1">
          <div
            v-for="item in view.permissions.required"
            :key="item.permission"
            class="rounded border border-line-subtle px-2 py-1 font-mono text-[10px]"
            :class="item.declared ? 'text-text-muted' : 'text-signal-error'"
          >
            {{ item.permission }} · {{ item.declared ? t("graph.settings.permissions.declared") : t("graph.settings.permissions.missing") }}
          </div>
        </div>
        <label class="mt-3 block text-[10px] text-text-muted">
          {{ t("graph.settings.permissions.outputTargets") }}
          <select
            class="mt-1 w-full rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-secondary"
            :value="view.permissions.outputTargetsMode"
            :disabled="readonly"
            @change="setOutputTargetsMode(($event.target as HTMLSelectElement).value as 'unscoped' | 'deny_all' | 'scoped')"
          >
            <option value="unscoped">{{ t("graph.settings.permissions.outputTargetsMode.unscoped") }}</option>
            <option value="deny_all">{{ t("graph.settings.permissions.outputTargetsMode.deny_all") }}</option>
            <option value="scoped">{{ t("graph.settings.permissions.outputTargetsMode.scoped") }}</option>
          </select>
        </label>
      </section>

      <section class="rounded-md border border-line-subtle bg-float/30 p-2">
        <h3 class="text-xs font-medium text-text-primary">{{ t("graph.settings.budgets.title") }}</h3>
        <div class="mt-2 space-y-2">
          <label
            v-for="item in view.budgets.runtime"
            :key="item.key"
            class="block rounded border border-line-subtle p-2"
          >
            <span class="text-[11px] text-text-secondary">{{ item.key }}</span>
            <div class="mt-1 flex items-center gap-2">
              <input
                type="number"
                class="min-w-0 flex-1 rounded-md border border-line-subtle bg-panel px-2 py-1 text-xs text-text-primary"
                :value="item.graphOverride ?? ''"
                :placeholder="String(item.platformLimit)"
                :disabled="readonly"
                @change="onBudgetChange(item, $event)"
              />
              <span class="font-mono text-[10px] text-text-muted">{{ t("graph.settings.budgets.effective", { value: item.effectiveLimit }) }}</span>
            </div>
            <p v-if="item.currentUsage !== undefined" class="mt-1 text-[10px]" :class="item.exceeded ? 'text-signal-error' : 'text-text-muted'">
              {{ t("graph.settings.budgets.current", { current: item.currentUsage, limit: item.effectiveLimit }) }}
            </p>
          </label>
        </div>
      </section>
    </div>
  </div>
</template>
