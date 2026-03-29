<script setup lang="ts">
import { RefreshCw } from "lucide-vue-next";
import { toRef } from "vue";

import { useWorkspaceInspectorMemory } from "../../../composables/workspace/inspector/memory";
import WorkspaceInspectorSection from "./WorkspaceInspectorSection.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  activeSessionId: string | null;
  currentAccount: string;
  t: Translator;
}>();

const { error, items, jobs, loading, refresh, scopeState, stats } = useWorkspaceInspectorMemory({
  accountId: toRef(props, "currentAccount"),
  sessionId: toRef(props, "activeSessionId"),
});

function formatDateTime(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "—";
  }

  return new Date(value).toLocaleString();
}

function formatCount(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : "—";
}

function formatMemoryContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatCoverage(start: number | null, end: number | null): string | null {
  if (typeof start !== "number" && typeof end !== "number") {
    return null;
  }

  if (typeof start === "number" && typeof end === "number") {
    return start === end ? `${start}` : `${start} → ${end}`;
  }

  return typeof start === "number" ? `${start}` : `${end}`;
}

function formatEnumLabel(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return value.replaceAll("_", " ");
}

function resolveTypeBadgeClass(type: string): string {
  switch (type) {
    case "fact":
      return "border-sky-500/30 bg-sky-500/10 text-sky-300";
    case "summary":
      return "border-violet-500/30 bg-violet-500/10 text-violet-300";
    case "open_loop":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    default:
      return "border-zinc-700 bg-zinc-800/80 text-zinc-300";
  }
}

function resolveLifecycleBadgeClass(status: string): string {
  switch (status) {
    case "compacted":
      return "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300";
    case "deprecated":
      return "border-rose-500/30 bg-rose-500/10 text-rose-300";
    default:
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }
}

function resolveJobStatusBadgeClass(status: string): string {
  switch (status) {
    case "succeeded":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "dead_letter":
      return "border-rose-500/30 bg-rose-500/10 text-rose-300";
    case "retry_waiting":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "running":
    case "leased":
      return "border-sky-500/30 bg-sky-500/10 text-sky-300";
    case "cancelled":
      return "border-zinc-700 bg-zinc-800/80 text-zinc-300";
    default:
      return "border-zinc-700 bg-zinc-800/80 text-zinc-300";
  }
}
</script>

<template>
  <div class="space-y-6">
    <WorkspaceInspectorSection :title="props.t('inspector.memoryOverview')">
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
          {{ props.t("inspector.memoryNoSession") }}
        </div>

        <div
          v-else-if="loading && !stats && items.length === 0 && jobs.length === 0"
          class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500"
        >
          {{ props.t("inspector.memoryLoading") }}
        </div>

        <template v-else>
          <div
            v-if="error"
            class="rounded border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
          >
            {{ props.t("inspector.memoryError") }}: {{ error }}
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="rounded border border-white/5 bg-white/[0.02] p-2">
              <div class="text-[10px] uppercase tracking-wide text-zinc-500">{{ props.t("inspector.memoryActiveCount") }}</div>
              <div class="mt-1 font-mono text-sm text-zinc-100">{{ formatCount(stats?.active) }}</div>
            </div>
            <div class="rounded border border-white/5 bg-white/[0.02] p-2">
              <div class="text-[10px] uppercase tracking-wide text-zinc-500">{{ props.t("inspector.memoryDeprecatedCount") }}</div>
              <div class="mt-1 font-mono text-sm text-zinc-100">{{ formatCount(stats?.deprecated) }}</div>
            </div>
            <div class="rounded border border-white/5 bg-white/[0.02] p-2">
              <div class="text-[10px] uppercase tracking-wide text-zinc-500">{{ props.t("inspector.memoryEstimatedTokens") }}</div>
              <div class="mt-1 font-mono text-sm text-zinc-100">{{ formatCount(stats?.estimatedTokens) }}</div>
            </div>
            <div class="rounded border border-white/5 bg-white/[0.02] p-2">
              <div class="text-[10px] uppercase tracking-wide text-zinc-500">{{ props.t("inspector.memorySummaries") }}</div>
              <div class="mt-1 font-mono text-sm text-zinc-100">{{ formatCount(stats?.byType.summary) }}</div>
            </div>
            <div class="rounded border border-white/5 bg-white/[0.02] p-2">
              <div class="text-[10px] uppercase tracking-wide text-zinc-500">{{ props.t("inspector.memoryFacts") }}</div>
              <div class="mt-1 font-mono text-sm text-zinc-100">{{ formatCount(stats?.byType.fact) }}</div>
            </div>
            <div class="rounded border border-white/5 bg-white/[0.02] p-2">
              <div class="text-[10px] uppercase tracking-wide text-zinc-500">{{ props.t("inspector.memoryOpenLoops") }}</div>
              <div class="mt-1 font-mono text-sm text-zinc-100">{{ formatCount(stats?.byType.openLoop) }}</div>
            </div>
          </div>

          <div class="rounded border border-white/5 bg-white/[0.02] p-2">
            <div class="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">{{ props.t("inspector.memoryScopeState") }}</div>

            <div v-if="scopeState" class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.memoryRevision") }}</span>
              <span class="text-right font-mono text-[10px] text-zinc-300">{{ scopeState.revision }}</span>

              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.memoryLastProcessedFloorNo") }}</span>
              <span class="text-right font-mono text-[10px] text-zinc-300">{{ formatCount(scopeState.lastProcessedFloorNo) }}</span>

              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.memoryLastCompactionAt") }}</span>
              <span class="text-right font-mono text-[10px] text-zinc-300">{{ formatDateTime(scopeState.lastCompactionAt) }}</span>

              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.memoryLeaseOwner") }}</span>
              <span class="break-all text-right font-mono text-[10px] text-zinc-300">
                {{ scopeState.leaseOwner ?? props.t("inspector.memoryLeaseIdle") }}
              </span>

              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.memoryLeaseUntil") }}</span>
              <span class="text-right font-mono text-[10px] text-zinc-300">{{ formatDateTime(scopeState.leaseUntil) }}</span>
            </div>

            <div v-else class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
              {{ props.t("inspector.memoryScopeStateEmpty") }}
            </div>
          </div>
        </template>
      </div>
    </WorkspaceInspectorSection>

    <WorkspaceInspectorSection :title="props.t('inspector.memoryItems')">
      <div class="space-y-2 rounded border border-white/5 bg-[#121215] p-2">
        <div v-if="!props.activeSessionId" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
          {{ props.t("inspector.memoryNoSession") }}
        </div>

        <div
          v-else-if="!loading && !error && items.length === 0"
          class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500"
        >
          {{ props.t("inspector.memoryEmpty") }}
        </div>

        <template v-else>
          <div
            v-for="item in items"
            :key="item.id"
            class="rounded border border-white/5 bg-white/[0.02] p-2"
          >
          <div class="flex items-start justify-between gap-2">
            <div class="flex flex-wrap gap-1">
              <span
                class="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide"
                :class="resolveTypeBadgeClass(item.type)"
              >
                {{ formatEnumLabel(item.type) }}
              </span>
              <span
                v-if="item.summaryTier"
                class="rounded border border-violet-500/20 bg-violet-500/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-violet-200"
              >
                {{ formatEnumLabel(item.summaryTier) }}
              </span>
              <span
                v-if="item.status !== 'active' || item.lifecycleStatus !== 'active'"
                class="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide"
                :class="resolveLifecycleBadgeClass(item.lifecycleStatus ?? item.status)"
              >
                {{ formatEnumLabel(item.lifecycleStatus ?? item.status) }}
              </span>
            </div>
            <div class="shrink-0 font-mono text-[10px] text-zinc-500">{{ formatDateTime(item.updatedAt) }}</div>
          </div>

          <pre class="mt-2 whitespace-pre-wrap break-words text-xs text-zinc-200">{{ formatMemoryContent(item.content) }}</pre>

          <div class="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.memoryItemImportance") }}</span>
            <span class="text-right font-mono text-[10px] text-zinc-300">{{ item.importance.toFixed(2) }}</span>

            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.memoryItemConfidence") }}</span>
            <span class="text-right font-mono text-[10px] text-zinc-300">{{ item.confidence.toFixed(2) }}</span>

            <template v-if="item.factKey">
              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.memoryItemFactKey") }}</span>
              <span class="break-all text-right font-mono text-[10px] text-zinc-300">{{ item.factKey }}</span>
            </template>

            <template v-if="formatCoverage(item.coverageStartFloorNo, item.coverageEndFloorNo)">
              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.memoryItemCoverage") }}</span>
              <span class="text-right font-mono text-[10px] text-zinc-300">{{ formatCoverage(item.coverageStartFloorNo, item.coverageEndFloorNo) }}</span>
            </template>

            <template v-if="item.sourceFloorId">
              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.memoryItemSourceFloor") }}</span>
              <span class="break-all text-right font-mono text-[10px] text-zinc-300">{{ item.sourceFloorId }}</span>
            </template>

            <template v-if="item.sourceJobId">
              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.memoryItemSourceJob") }}</span>
              <span class="break-all text-right font-mono text-[10px] text-zinc-300">{{ item.sourceJobId }}</span>
            </template>

            <template v-if="item.lastUsedAt !== null">
              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.memoryItemLastUsedAt") }}</span>
              <span class="text-right font-mono text-[10px] text-zinc-300">{{ formatDateTime(item.lastUsedAt) }}</span>
            </template>
          </div>
          </div>
        </template>
      </div>
    </WorkspaceInspectorSection>

    <WorkspaceInspectorSection :title="props.t('inspector.memoryJobs')">
      <div class="space-y-2 rounded border border-white/5 bg-[#121215] p-2">
        <div v-if="!props.activeSessionId" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
          {{ props.t("inspector.memoryNoSession") }}
        </div>

        <div
          v-else-if="!loading && !error && jobs.length === 0"
          class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500"
        >
          {{ props.t("inspector.memoryJobsEmpty") }}
        </div>

        <template v-else>
          <div
            v-for="job in jobs"
            :key="job.id"
            class="rounded border border-white/5 bg-white/[0.02] p-2"
          >
          <div class="flex items-start justify-between gap-2">
            <div class="flex min-w-0 flex-wrap gap-1">
              <span class="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-200">
                {{ formatEnumLabel(job.jobType) }}
              </span>
              <span
                class="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide"
                :class="resolveJobStatusBadgeClass(job.status)"
              >
                {{ formatEnumLabel(job.status) }}
              </span>
            </div>
            <div class="shrink-0 font-mono text-[10px] text-zinc-500">{{ props.t("inspector.memoryJobAttempts") }} {{ job.attemptCount }}/{{ job.maxAttempts }}</div>
          </div>

          <div class="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
            <span class="font-mono text-[10px] text-zinc-500">ID</span>
            <span class="break-all text-right font-mono text-[10px] text-zinc-300">{{ job.id }}</span>

            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.memoryJobCreatedAt") }}</span>
            <span class="text-right font-mono text-[10px] text-zinc-300">{{ formatDateTime(job.createdAt) }}</span>

            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.memoryJobFinishedAt") }}</span>
            <span class="text-right font-mono text-[10px] text-zinc-300">{{ formatDateTime(job.finishedAt) }}</span>
          </div>

          <div
            v-if="job.lastError"
            class="mt-2 rounded border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-200"
          >
            <span class="font-mono text-rose-300">{{ props.t("inspector.memoryJobLastError") }}</span>
            <span class="ml-1 break-words">{{ job.lastError }}</span>
          </div>
          </div>
        </template>
      </div>
    </WorkspaceInspectorSection>
  </div>
</template>
