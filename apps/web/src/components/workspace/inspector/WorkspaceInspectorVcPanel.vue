<script setup lang="ts">
import type { OperationLogRecord, PromptRuntimeHistoricalExplain } from "@tavern/sdk";
import { RefreshCw } from "lucide-vue-next";
import { toRef } from "vue";

import {
  useWorkspaceInspectorVc,
  type WorkspaceInspectorVcBranch,
  type WorkspaceInspectorVcExplainEntry,
} from "../../../composables/workspace/inspector/vc";
import WorkspaceInspectorSection from "./WorkspaceInspectorSection.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

type AssetRef = {
  label: string;
  value: string;
};

const props = defineProps<{
  activeSessionId: string | null;
  currentAccount: string;
  t: Translator;
}>();

const { branches, error, explains, loading, operationLogs, refresh } = useWorkspaceInspectorVc({
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

function formatId(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  if (value.length <= 14) {
    return value;
  }

  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function formatEnumLabel(value: string | null | undefined): string {
  return value ? value.replaceAll("_", " ") : "—";
}

function resolveBranchDiffText(branch: WorkspaceInspectorVcBranch): string {
  if (branch.summary.branchId === "main") {
    return props.t("inspector.vcMainBranch");
  }

  if (!branch.diff) {
    return props.t("inspector.vcDiffUnavailable");
  }

  return props.t("inspector.vcDiffSummary", {
    base: branch.diff.baseOnlyFloors.length,
    shared: branch.diff.sharedFloorNos.length,
    target: branch.diff.targetOnlyFloors.length,
  });
}

function resolveOperationBadgeClass(status: string): string {
  switch (status) {
    case "succeeded":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "failed":
    case "denied":
      return "border-rose-500/30 bg-rose-500/10 text-rose-300";
    case "cancelled":
      return "border-zinc-700 bg-zinc-800/80 text-zinc-300";
    default:
      return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  }
}

function summarizeDiff(diff: unknown): string {
  const record = asRecord(diff);
  if (!record) {
    return "—";
  }

  const totalChanges = typeof record.total_changes === "number" ? record.total_changes : null;
  const changes = Array.isArray(record.changes) ? record.changes : [];
  if (totalChanges !== null) {
    return props.t("inspector.vcDiffChanges", { count: totalChanges });
  }

  if (changes.length > 0) {
    return props.t("inspector.vcDiffChanges", { count: changes.length });
  }

  return "—";
}

function summarizeOperationRef(log: OperationLogRecord): string {
  const afterRef = asRecord(log.afterRef);
  const beforeRef = asRecord(log.beforeRef);
  const ref = afterRef ?? beforeRef;
  if (!ref) {
    return log.targetId ?? "—";
  }

  const sourceBranch = typeof ref.source_branch_id === "string" ? ref.source_branch_id : null;
  const targetBranch = typeof ref.target_branch_id === "string" ? ref.target_branch_id : null;
  const mergedFloorCount = typeof ref.merged_floor_count === "number" ? ref.merged_floor_count : null;
  if (sourceBranch && targetBranch) {
    return mergedFloorCount === null
      ? `${sourceBranch} → ${targetBranch}`
      : `${sourceBranch} → ${targetBranch}, ${mergedFloorCount}`;
  }

  const branch = typeof ref.branch_id === "string" ? ref.branch_id : null;
  const head = typeof ref.head_floor_no === "number" ? ref.head_floor_no : null;
  return branch && head !== null ? `${branch} #${head}` : log.targetId ?? "—";
}

function assetRefs(explain: PromptRuntimeHistoricalExplain | null): AssetRef[] {
  if (!explain) {
    return [];
  }

  const snapshot = explain.promptSnapshot;
  return [
    { label: "preset", value: snapshot.presetVersionId ?? snapshot.presetContentHash ?? snapshot.presetId ?? "" },
    { label: "worldbook", value: snapshot.worldbookVersionId ?? snapshot.worldbookContentHash ?? snapshot.worldbookId ?? "" },
    { label: "regex", value: snapshot.regexProfileVersionId ?? snapshot.regexProfileContentHash ?? snapshot.regexProfileId ?? "" },
    { label: "character", value: snapshot.characterVersionId ?? snapshot.characterContentHash ?? snapshot.characterId ?? "" },
    { label: "manifest", value: snapshot.assetManifestDigest ?? "" },
  ].filter((item) => item.value.length > 0);
}

function diagnosticsCount(explain: PromptRuntimeHistoricalExplain | null): number {
  return explain?.diagnostics?.length ?? 0;
}

function sectionStatsSummary(explain: PromptRuntimeHistoricalExplain | null): string {
  const stats = explain?.sectionStats ?? [];
  if (stats.length === 0) {
    return "—";
  }

  return stats.slice(0, 3).map((item) => `${item.sectionName}:${item.tokenCount}`).join(" · ");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
</script>

<template>
  <div class="space-y-6">
    <WorkspaceInspectorSection :title="props.t('inspector.vcOverview')">
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
          {{ props.t("inspector.vcNoSession") }}
        </div>

        <div
          v-else-if="loading && branches.length === 0 && operationLogs.length === 0"
          class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500"
        >
          {{ props.t("inspector.vcLoading") }}
        </div>

        <template v-else>
          <div
            v-if="error"
            class="rounded border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"
          >
            {{ props.t("inspector.vcError") }}: {{ error }}
          </div>

          <div class="grid grid-cols-3 gap-2">
            <div class="rounded border border-white/5 bg-white/[0.02] p-2">
              <div class="text-[10px] uppercase tracking-wide text-zinc-500">{{ props.t("inspector.vcBranches") }}</div>
              <div class="mt-1 font-mono text-sm text-zinc-100">{{ formatCount(branches.length) }}</div>
            </div>
            <div class="rounded border border-white/5 bg-white/[0.02] p-2">
              <div class="text-[10px] uppercase tracking-wide text-zinc-500">{{ props.t("inspector.vcSnapshots") }}</div>
              <div class="mt-1 font-mono text-sm text-zinc-100">{{ formatCount(explains.length) }}</div>
            </div>
            <div class="rounded border border-white/5 bg-white/[0.02] p-2">
              <div class="text-[10px] uppercase tracking-wide text-zinc-500">{{ props.t("inspector.vcOperations") }}</div>
              <div class="mt-1 font-mono text-sm text-zinc-100">{{ formatCount(operationLogs.length) }}</div>
            </div>
          </div>
        </template>
      </div>
    </WorkspaceInspectorSection>

    <WorkspaceInspectorSection :title="props.t('inspector.vcBranches')">
      <div class="space-y-2 rounded border border-white/5 bg-[#121215] p-2">
        <div v-if="!props.activeSessionId" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
          {{ props.t("inspector.vcNoSession") }}
        </div>
        <div v-else-if="!loading && branches.length === 0" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
          {{ props.t("inspector.vcBranchesEmpty") }}
        </div>
        <div
          v-for="branch in branches"
          v-else
          :key="branch.summary.branchId"
          class="rounded border border-white/5 bg-white/[0.02] p-2"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-mono text-xs text-zinc-100">{{ branch.summary.branchId }}</div>
              <div class="mt-1 text-[10px] text-zinc-500">{{ resolveBranchDiffText(branch) }}</div>
            </div>
            <span class="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
              {{ props.t("inspector.vcFloorCount", { count: branch.summary.floorCount }) }}
            </span>
          </div>
          <div class="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.vcLatestFloor") }}</span>
            <span class="text-right font-mono text-[10px] text-zinc-300">#{{ branch.summary.latestFloorNo ?? "—" }} · {{ formatId(branch.summary.latestFloorId) }}</span>
            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.vcForkFloor") }}</span>
            <span class="text-right font-mono text-[10px] text-zinc-300">{{ branch.diff?.forkFloorNo ?? "—" }}</span>
            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.vcLatestState") }}</span>
            <span class="text-right font-mono text-[10px] text-zinc-300">{{ formatEnumLabel(branch.summary.latestState) }}</span>
          </div>
        </div>
      </div>
    </WorkspaceInspectorSection>

    <WorkspaceInspectorSection :title="props.t('inspector.vcLineage')">
      <div class="space-y-2 rounded border border-white/5 bg-[#121215] p-2">
        <div v-if="branches.every((branch) => branch.floors.length === 0)" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
          {{ props.t("inspector.vcLineageEmpty") }}
        </div>
        <div v-for="branch in branches.filter((item) => item.floors.length > 0)" :key="branch.summary.branchId" class="rounded border border-white/5 bg-white/[0.02] p-2">
          <div class="mb-2 flex items-center justify-between gap-2">
            <span class="truncate font-mono text-xs text-zinc-100">{{ branch.summary.branchId }}</span>
            <span class="font-mono text-[10px] text-zinc-500">{{ branch.floors.length }}</span>
          </div>
          <div class="space-y-1">
            <div v-for="floor in branch.floors.slice().reverse()" :key="floor.id" class="grid grid-cols-[auto,1fr,auto] gap-2 rounded border border-white/5 bg-black/10 px-2 py-1">
              <span class="font-mono text-[10px] text-zinc-300">#{{ floor.floorNo }}</span>
              <span class="truncate font-mono text-[10px] text-zinc-500">{{ floor.id }}</span>
              <span class="font-mono text-[10px] text-zinc-400">{{ formatEnumLabel(floor.state) }}</span>
            </div>
          </div>
        </div>
      </div>
    </WorkspaceInspectorSection>

    <WorkspaceInspectorSection :title="props.t('inspector.vcPromptSnapshots')">
      <div class="space-y-2 rounded border border-white/5 bg-[#121215] p-2">
        <div v-if="!loading && explains.length === 0" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
          {{ props.t("inspector.vcSnapshotsEmpty") }}
        </div>
        <div v-for="entry in explains" :key="entry.floor.id" class="rounded border border-white/5 bg-white/[0.02] p-2">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-mono text-xs text-zinc-100">{{ entry.branchId }} #{{ entry.floor.floorNo }}</div>
              <div class="mt-1 truncate font-mono text-[10px] text-zinc-500">{{ entry.floor.id }}</div>
            </div>
            <span class="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
              {{ entry.explain ? props.t("inspector.vcSnapshotReady") : props.t("inspector.vcSnapshotMissing") }}
            </span>
          </div>

          <div v-if="entry.error" class="mt-2 rounded border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
            {{ entry.error }}
          </div>

          <template v-if="entry.explain">
            <div class="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.vcPromptDigest") }}</span>
              <span class="break-all text-right font-mono text-[10px] text-zinc-300">{{ formatId(entry.explain.promptSnapshot.promptDigest) }}</span>
              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.vcTokenEstimate") }}</span>
              <span class="text-right font-mono text-[10px] text-zinc-300">{{ entry.explain.promptSnapshot.tokenEstimate }}</span>
              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.vcExplainDiagnostics") }}</span>
              <span class="text-right font-mono text-[10px] text-zinc-300">{{ diagnosticsCount(entry.explain) }}</span>
              <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.vcSectionStats") }}</span>
              <span class="text-right font-mono text-[10px] text-zinc-300">{{ sectionStatsSummary(entry.explain) }}</span>
            </div>

            <div v-if="assetRefs(entry.explain).length > 0" class="mt-2 flex flex-wrap gap-1">
              <span
                v-for="asset in assetRefs(entry.explain)"
                :key="`${entry.floor.id}:${asset.label}`"
                class="rounded border border-sky-500/20 bg-sky-500/5 px-1.5 py-0.5 font-mono text-[10px] text-sky-200"
              >
                {{ asset.label }}:{{ formatId(asset.value) }}
              </span>
            </div>
          </template>
        </div>
      </div>
    </WorkspaceInspectorSection>

    <WorkspaceInspectorSection :title="props.t('inspector.vcOperationLogs')">
      <div class="space-y-2 rounded border border-white/5 bg-[#121215] p-2">
        <div v-if="!loading && operationLogs.length === 0" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
          {{ props.t("inspector.vcOperationLogsEmpty") }}
        </div>
        <div v-for="log in operationLogs" :key="log.id" class="rounded border border-white/5 bg-white/[0.02] p-2">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-mono text-xs text-zinc-100">{{ formatEnumLabel(log.action) }}</div>
              <div class="mt-1 text-[10px] text-zinc-500">{{ summarizeOperationRef(log) }}</div>
            </div>
            <span class="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide" :class="resolveOperationBadgeClass(log.status)">
              {{ formatEnumLabel(log.status) }}
            </span>
          </div>
          <div class="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.vcCreatedAt") }}</span>
            <span class="text-right font-mono text-[10px] text-zinc-300">{{ formatDateTime(log.createdAt) }}</span>
            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.vcDiff") }}</span>
            <span class="text-right font-mono text-[10px] text-zinc-300">{{ summarizeDiff(log.diff) }}</span>
            <span class="font-mono text-[10px] text-zinc-500">ID</span>
            <span class="break-all text-right font-mono text-[10px] text-zinc-300">{{ log.id }}</span>
          </div>
        </div>
      </div>
    </WorkspaceInspectorSection>
  </div>
</template>
