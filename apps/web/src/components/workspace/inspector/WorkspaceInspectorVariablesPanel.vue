<script setup lang="ts">
import { RefreshCw } from "lucide-vue-next";
import { toRef } from "vue";

import { useWorkspaceInspectorVariables } from "../../../composables/workspace/inspector/variables";
import type { TimelineMessage } from "../../../stores/workspace";
import WorkspaceInspectorSection from "./WorkspaceInspectorSection.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  activeSessionId: string | null;
  activeTimeline: TimelineMessage[];
  currentAccount: string;
  t: Translator;
}>();

const { error, loading, refresh, rows } = useWorkspaceInspectorVariables({
  accountId: toRef(props, "currentAccount"),
  sessionId: toRef(props, "activeSessionId"),
  timeline: toRef(props, "activeTimeline"),
});

function formatUpdatedAt(updatedAt: number): string {
  return new Date(updatedAt).toLocaleString();
}

function resolveScopeBadgeClass(scope: string): string {
  switch (scope) {
    case "page":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "floor":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "chat":
      return "border-sky-500/30 bg-sky-500/10 text-sky-300";
    default:
      return "border-zinc-700 bg-zinc-800/80 text-zinc-300";
  }
}
</script>

<template>
  <WorkspaceInspectorSection :title="props.t('inspector.variables')">
    <template #header-end>
      <button
        class="rounded border border-white/10 p-1 text-zinc-500 transition hover:border-white/20 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="loading"
        :title="props.t('actions.refresh')"
        type="button"
        @click="void refresh(true)"
      >
        <RefreshCw class="h-3 w-3" :class="loading ? 'animate-spin' : ''" />
      </button>
    </template>

    <div class="space-y-2 rounded border border-white/5 bg-[#121215] p-2">
      <div v-if="!props.activeSessionId" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
        {{ props.t("inspector.variablesNoSession") }}
      </div>

      <div
        v-else-if="loading && rows.length === 0"
        class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500"
      >
        {{ props.t("inspector.variablesLoading") }}
      </div>

      <template v-else>
        <div
          v-if="error"
          class="rounded border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
        >
          {{ props.t("inspector.variablesError") }}: {{ error }}
        </div>

        <div
          v-if="rows.length === 0"
          class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500"
        >
          {{ props.t("inspector.variablesEmpty") }}
        </div>

        <div
          v-for="row in rows"
          v-else
          :key="row.key"
          class="rounded border border-white/5 bg-white/[0.02] p-2"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-mono text-xs text-zinc-200">{{ row.key }}</div>
              <div class="mt-1 break-all font-mono text-xs text-zinc-400">{{ row.preview }}</div>
            </div>
            <span
              class="shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide"
              :class="resolveScopeBadgeClass(row.sourceScope)"
            >
              {{ row.sourceScope }}
            </span>
          </div>

          <div class="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.variableSourceId") }}</span>
            <span class="break-all text-right font-mono text-[10px] text-zinc-400">{{ row.sourceScopeId }}</span>

            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.variableUpdated") }}</span>
            <span class="text-right font-mono text-[10px] text-zinc-400">{{ formatUpdatedAt(row.updatedAt) }}</span>
          </div>
        </div>
      </template>
    </div>
  </WorkspaceInspectorSection>
</template>
