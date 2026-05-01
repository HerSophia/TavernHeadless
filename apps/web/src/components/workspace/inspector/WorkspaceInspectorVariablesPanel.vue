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

const { error, loading, promotionGroups, refresh, rows, stagedWrites } = useWorkspaceInspectorVariables({
  accountId: toRef(props, "currentAccount"),
  sessionId: toRef(props, "activeSessionId"),
  timeline: toRef(props, "activeTimeline"),
});

function formatDateTime(value: number | null | undefined): string {
  if (typeof value !== "number") {
    return "—";
  }

  return new Date(value).toLocaleString();
}

function formatSourceSummary(source: Record<string, unknown>): string {
  const parts = [
    typeof source.toolName === "string" ? source.toolName : null,
    typeof source.providerId === "string" ? source.providerId : null,
    typeof source.agentId === "string" ? source.agentId : null,
    typeof source.nodeId === "string" ? source.nodeId : null,
    typeof source.stepId === "string" ? source.stepId : null,
  ].filter((item): item is string => Boolean(item));

  return parts.length > 0 ? parts.join(" · ") : "—";
}

function formatEvidenceSummary(evidence: Record<string, unknown>): string {
  const parts = [
    typeof evidence.runId === "string" ? evidence.runId : null,
    typeof evidence.generationAttemptNo === "number" ? `${props.t("inspector.variableAttempt")} ${evidence.generationAttemptNo}` : null,
    typeof evidence.scope === "string"
      ? `${evidence.scope}:${typeof evidence.scopeId === "string" ? evidence.scopeId : ""}`
      : null,
  ].filter((item): item is string => Boolean(item));

  return parts.length > 0 ? parts.join(" · ") : "—";
}

function resolveScopeBadgeClass(scope: string): string {
  switch (scope) {
    case "page":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "floor":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "branch":
      return "border-violet-500/30 bg-violet-500/10 text-violet-300";
    case "chat":
      return "border-sky-500/30 bg-sky-500/10 text-sky-300";
    default:
      return "border-zinc-700 bg-zinc-800/80 text-zinc-300";
  }
}

function resolveStatusBadgeClass(status: string): string {
  switch (status) {
    case "promoted":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "accepted_page_only":
      return "border-sky-500/30 bg-sky-500/10 text-sky-300";
    case "staged":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "rejected":
    case "discarded":
      return "border-rose-500/30 bg-rose-500/10 text-rose-300";
    case "rerouted_to_session_state":
      return "border-violet-500/30 bg-violet-500/10 text-violet-300";
    default:
      return "border-zinc-700 bg-zinc-800/80 text-zinc-300";
  }
}

function resolveOperationBadgeClass(op: string): string {
  return op === "delete"
    ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
    : "border-zinc-700 bg-zinc-800/80 text-zinc-300";
}

function formatIntent(intent: string): string {
  return intent.replaceAll("_", " ");
}

function formatValuePreview(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
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

    <div class="space-y-3 rounded border border-white/5 bg-[#121215] p-2">
      <div v-if="!props.activeSessionId" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
        {{ props.t("inspector.variablesNoSession") }}
      </div>

      <div
        v-else-if="loading && rows.length === 0 && stagedWrites.length === 0 && promotionGroups.length === 0"
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

        <div class="rounded border border-white/5 bg-white/[0.02] p-2">
          <div class="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">{{ props.t("inspector.variablesResolvedSurface") }}</div>

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
            class="mb-2 rounded border border-white/5 bg-[#0f0f12] p-2 last:mb-0"
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
              <span class="text-right font-mono text-[10px] text-zinc-400">{{ formatDateTime(row.updatedAt) }}</span>
            </div>
          </div>
        </div>

        <div class="rounded border border-white/5 bg-white/[0.02] p-2">
          <div class="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">{{ props.t("inspector.variablesStagedSurface") }}</div>

          <div
            v-if="stagedWrites.length === 0"
            class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500"
          >
            {{ props.t("inspector.variablesStagedEmpty") }}
          </div>

          <div
            v-for="item in stagedWrites"
            v-else
            :key="item.id"
            class="mb-2 rounded border border-white/5 bg-[#0f0f12] p-2 last:mb-0"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="truncate font-mono text-xs text-zinc-200">{{ item.key }}</div>
                <div class="mt-1 break-all font-mono text-xs text-zinc-400">{{ item.preview }}</div>
              </div>
              <div class="flex shrink-0 flex-wrap justify-end gap-1">
                <span class="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide" :class="resolveOperationBadgeClass(item.op)">
                  {{ item.op }}
                </span>
                <span class="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide" :class="resolveStatusBadgeClass(item.status)">
                  {{ item.status }}
                </span>
              </div>
            </div>

            <div class="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.variableIntent") }}</span>
              <span class="text-right font-mono text-[10px] text-zinc-400">{{ formatIntent(item.intent) }}</span>

              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.variableReason") }}</span>
              <span class="break-all text-right font-mono text-[10px] text-zinc-400">{{ item.reason }}</span>

              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.variableSource") }}</span>
              <span class="break-all text-right font-mono text-[10px] text-zinc-400">{{ formatSourceSummary(item.source) }}</span>

              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.variableEvidence") }}</span>
              <span class="break-all text-right font-mono text-[10px] text-zinc-400">{{ formatEvidenceSummary(item.evidence) }}</span>

              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.variableCreated") }}</span>
              <span class="text-right font-mono text-[10px] text-zinc-400">{{ formatDateTime(item.createdAt) }}</span>

              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.variableResolved") }}</span>
              <span class="text-right font-mono text-[10px] text-zinc-400">{{ formatDateTime(item.resolvedAt) }}</span>

              <template v-if="item.decisionReason">
                <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.variableDecisionReason") }}</span>
                <span class="break-all text-right font-mono text-[10px] text-zinc-400">{{ item.decisionReason }}</span>
              </template>
            </div>
          </div>
        </div>

        <div class="rounded border border-white/5 bg-white/[0.02] p-2">
          <div class="mb-2 text-[10px] uppercase tracking-wide text-zinc-500">{{ props.t("inspector.variablesPromotionSurface") }}</div>

          <div
            v-if="promotionGroups.length === 0"
            class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500"
          >
            {{ props.t("inspector.variablesPromotionEmpty") }}
          </div>

          <div
            v-for="group in promotionGroups"
            v-else
            :key="group.key"
            class="mb-2 rounded border border-white/5 bg-[#0f0f12] p-2 last:mb-0"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="truncate font-mono text-xs text-zinc-200">{{ group.key }}</div>
                <div class="mt-1 text-[10px] text-zinc-500">{{ props.t("inspector.variablePromotionCount", { count: group.items.length }) }}</div>
              </div>
              <div class="font-mono text-[10px] text-zinc-400">{{ formatDateTime(group.latestCreatedAt) }}</div>
            </div>

            <div
              v-for="trace in group.items"
              :key="trace.id"
              class="mt-2 rounded border border-white/5 bg-white/[0.02] p-2"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 break-all font-mono text-xs text-zinc-300">
                  {{ trace.fromScope }} → {{ trace.toScope }}
                </div>
                <span class="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-emerald-300">
                  {{ trace.conflictPolicy }}
                </span>
              </div>

              <div class="mt-1 break-all font-mono text-xs text-zinc-400">{{ formatValuePreview(trace.value) }}</div>

              <div class="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
                <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.variableFromScopeId") }}</span>
                <span class="break-all text-right font-mono text-[10px] text-zinc-400">{{ trace.fromScopeId }}</span>

                <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.variableToScopeId") }}</span>
                <span class="break-all text-right font-mono text-[10px] text-zinc-400">{{ trace.toScopeId }}</span>

                <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.variableStagedWriteId") }}</span>
                <span class="break-all text-right font-mono text-[10px] text-zinc-400">{{ trace.stagedWriteId ?? '—' }}</span>

                <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.variableCreated") }}</span>
                <span class="text-right font-mono text-[10px] text-zinc-400">{{ formatDateTime(trace.createdAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </WorkspaceInspectorSection>
</template>
