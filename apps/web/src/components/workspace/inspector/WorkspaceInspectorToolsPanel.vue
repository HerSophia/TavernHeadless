<script setup lang="ts">
import { groupToolEventsByExecution, type RespondStreamState } from "@tavern/client-helpers";
import { computed } from "vue";

import WorkspaceInspectorSection from "./WorkspaceInspectorSection.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  state: RespondStreamState;
  t: Translator;
}>();

const groupedExecutions = computed(() => {
  return [...groupToolEventsByExecution(props.state.toolEvents)].reverse();
});

const activeExecutions = computed(() => {
  return Object.values(props.state.activeTools);
});

function formatOptional(value: number | string | undefined): string {
  if (value === undefined || value === "") {
    return "—";
  }

  return String(value);
}
</script>

<template>
  <div class="space-y-6">
    <WorkspaceInspectorSection :title="props.t('inspector.tools')">
      <template #header-end>
        <span class="font-mono text-[10px] text-zinc-500">{{ props.t('inspector.toolsActiveCount', { count: activeExecutions.length }) }}</span>
      </template>

      <div class="rounded border border-white/5 bg-[#121215] p-3">
        <div class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs text-zinc-300">
          <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.toolsStreamStatus") }}</span>
          <span class="font-mono text-[10px] text-zinc-300">{{ props.state.status }}</span>

          <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.toolsBranchId") }}</span>
          <span class="break-all font-mono text-[10px] text-zinc-400">{{ formatOptional(props.state.branchId) }}</span>

          <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.toolsFloorId") }}</span>
          <span class="break-all font-mono text-[10px] text-zinc-400">{{ formatOptional(props.state.floorId) }}</span>

          <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.toolsFloorNo") }}</span>
          <span class="font-mono text-[10px] text-zinc-400">{{ formatOptional(props.state.floorNo) }}</span>
        </div>
      </div>
    </WorkspaceInspectorSection>

    <WorkspaceInspectorSection :title="props.t('inspector.toolsWarnings')">
      <div
        v-if="props.state.warnings.length === 0"
        class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500"
      >
        {{ props.t("inspector.toolsWarningsEmpty") }}
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="warning in props.state.warnings"
          :key="`${warning.code}-${warning.executionId ?? warning.toolName ?? 'warning'}`"
          class="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2"
        >
          <div class="font-mono text-[10px] text-amber-300">{{ warning.code }}</div>
          <div class="mt-1 text-xs text-zinc-200">{{ warning.message }}</div>
        </div>
      </div>
    </WorkspaceInspectorSection>

    <WorkspaceInspectorSection :title="props.t('inspector.toolsActive')">
      <div
        v-if="activeExecutions.length === 0"
        class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500"
      >
        {{ props.t("inspector.toolsActiveEmpty") }}
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="execution in activeExecutions"
          :key="execution.executionId"
          class="rounded border border-sky-500/20 bg-sky-500/5 px-3 py-2"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="font-mono text-[11px] text-zinc-100">{{ execution.toolName }}</div>
            <div class="font-mono text-[10px] text-sky-300">{{ execution.phase }}</div>
          </div>
          <div class="mt-1 font-mono text-[10px] text-zinc-500">{{ execution.executionId }}</div>
        </div>
      </div>
    </WorkspaceInspectorSection>

    <WorkspaceInspectorSection :title="props.t('inspector.toolsHistory')">
      <div
        v-if="groupedExecutions.length === 0"
        class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500"
      >
        {{ props.t("inspector.toolsHistoryEmpty") }}
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="group in groupedExecutions"
          :key="group.executionId"
          class="rounded border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-zinc-300"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="font-mono text-[11px] text-zinc-100">{{ group.toolName }}</div>
            <div class="font-mono text-[10px]" :class="group.isTerminal ? 'text-zinc-400' : 'text-sky-300'">{{ group.latest.phase }}</div>
          </div>

          <div class="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.toolsExecutionId") }}</span>
            <span class="break-all font-mono text-[10px] text-zinc-400">{{ group.executionId }}</span>

            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.toolsProvider") }}</span>
            <span class="font-mono text-[10px] text-zinc-400">{{ group.providerId }}</span>

            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.toolsReplaySafety") }}</span>
            <span class="font-mono text-[10px] text-zinc-400">{{ group.replaySafety }}</span>

            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.toolsDuration") }}</span>
            <span class="font-mono text-[10px] text-zinc-400">{{ group.durationMs !== undefined ? `${group.durationMs}ms` : '—' }}</span>

            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.toolsPhases") }}</span>
            <span class="font-mono text-[10px] text-zinc-400">{{ group.phases.join(" → ") }}</span>
          </div>

          <div v-if="group.message" class="mt-2 rounded border border-white/5 bg-black/20 px-2 py-1 text-[11px] text-zinc-300">
            {{ group.message }}
          </div>
        </div>
      </div>
    </WorkspaceInspectorSection>
  </div>
</template>
