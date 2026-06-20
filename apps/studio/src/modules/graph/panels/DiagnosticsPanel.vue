<script setup lang="ts">
import type { NodeGraphDiagnostic } from "@tavern/core/node-graph";
import { AlertCircle, AlertTriangle, Check, Info } from "lucide-vue-next";
import { computed, type Component } from "vue";
import { useI18n } from "vue-i18n";

import { diagnosticTarget, sortDiagnostics, type DiagnosticTarget } from "../validate/local-validation";

const props = defineProps<{
  diagnostics: NodeGraphDiagnostic[];
  activeTarget?: DiagnosticTarget | null;
}>();

const emit = defineEmits<{ (event: "locate", target: DiagnosticTarget): void }>();

const { t } = useI18n();

const sorted = computed(() => sortDiagnostics(props.diagnostics));

const severityMeta: Record<NodeGraphDiagnostic["severity"], { icon: Component; color: string }> = {
  error: { icon: AlertCircle, color: "var(--color-signal-error)" },
  warning: { icon: AlertTriangle, color: "var(--color-signal-warn)" },
  info: { icon: Info, color: "var(--color-signal-info)" },
};

const counts = computed(() => {
  const result = { error: 0, warning: 0, info: 0 };
  for (const diagnostic of props.diagnostics) {
    result[diagnostic.severity] += 1;
  }
  return result;
});

function targetLabel(diagnostic: NodeGraphDiagnostic): string | null {
  if (diagnostic.nodeId) {
    return diagnostic.port ? `${diagnostic.nodeId}:${diagnostic.port}` : diagnostic.nodeId;
  }
  if (diagnostic.edgeId) {
    return diagnostic.edgeId;
  }
  if (diagnostic.groupId) {
    return diagnostic.groupId;
  }
  return null;
}

function isActive(diagnostic: NodeGraphDiagnostic): boolean {
  const target = diagnosticTarget(diagnostic);
  const active = props.activeTarget;
  if (!target || !active) {
    return false;
  }
  return (
    target.nodeId === active.nodeId &&
    target.edgeId === active.edgeId &&
    target.groupId === active.groupId
  );
}

function onRowClick(diagnostic: NodeGraphDiagnostic): void {
  const target = diagnosticTarget(diagnostic);
  if (target) {
    emit("locate", target);
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header
      class="flex h-9 shrink-0 items-center gap-3 border-b border-line-subtle px-3 text-xs"
    >
      <span class="font-medium text-text-secondary">{{ t("graph.diagnostics.title") }}</span>
      <span class="ml-auto flex items-center gap-3 font-mono">
        <span class="flex items-center gap-1" :style="{ color: 'var(--color-signal-error)' }">
          <AlertCircle :size="12" :stroke-width="1.5" />{{ counts.error }}
        </span>
        <span class="flex items-center gap-1" :style="{ color: 'var(--color-signal-warn)' }">
          <AlertTriangle :size="12" :stroke-width="1.5" />{{ counts.warning }}
        </span>
        <span class="flex items-center gap-1" :style="{ color: 'var(--color-signal-info)' }">
          <Info :size="12" :stroke-width="1.5" />{{ counts.info }}
        </span>
      </span>
    </header>

    <div
      v-if="diagnostics.length === 0"
      class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center"
    >
      <Check :size="22" :stroke-width="1.5" class="text-signal-success" />
      <p class="text-xs text-text-muted">{{ t("graph.diagnostics.empty") }}</p>
    </div>

    <ul v-else class="min-h-0 flex-1 overflow-auto">
      <li v-for="(diagnostic, index) in sorted" :key="`${diagnostic.code}-${index}`">
        <button
          type="button"
          class="flex w-full items-start gap-2 border-l-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-float focus:outline-none focus-visible:bg-float"
          :class="isActive(diagnostic) ? 'border-l-signal-accent bg-float' : 'border-l-transparent'"
          @click="onRowClick(diagnostic)"
        >
          <component
            :is="severityMeta[diagnostic.severity].icon"
            class="mt-0.5 shrink-0"
            :size="13"
            :stroke-width="1.5"
            :style="{ color: severityMeta[diagnostic.severity].color }"
          />
          <span class="min-w-0 flex-1">
            <span class="block text-xs leading-snug text-text-primary">{{ diagnostic.message }}</span>
            <span class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span class="font-mono text-[10px] text-text-muted">{{ diagnostic.code }}</span>
              <span
                v-if="targetLabel(diagnostic)"
                class="rounded border border-line-subtle px-1 font-mono text-[10px] text-text-secondary"
              >{{ targetLabel(diagnostic) }}</span>
            </span>
          </span>
        </button>
      </li>
    </ul>
  </div>
</template>
