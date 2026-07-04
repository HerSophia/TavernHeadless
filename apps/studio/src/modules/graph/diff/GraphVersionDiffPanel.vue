<script setup lang="ts">
import type { NodeGraphDocument } from "@tavern/core/node-graph";
import { GitCompare, X } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { NodeGraphVersionResponse } from "../../../lib/nodegraph-api";
import UiButton from "../../../ui/UiButton.vue";
import { diffNodeGraphDocuments, type GraphDocumentDiffEntry } from "./graph-document-diff";

const props = defineProps<{
  currentDocument: NodeGraphDocument;
  currentVersionId?: string | null;
  versions: NodeGraphVersionResponse[];
  graphName?: string;
}>();

const emit = defineEmits<{ (event: "close"): void }>();

const { t, te } = useI18n();

const compareVersionId = ref("");

function defaultCompareVersionId(): string {
  return props.versions.find((version) => version.id !== props.currentVersionId)?.id
    ?? props.versions[0]?.id
    ?? "";
}

watch(
  () => [props.currentVersionId, props.versions.map((version) => version.id).join("\n")],
  () => {
    if (!props.versions.some((version) => version.id === compareVersionId.value)) {
      compareVersionId.value = defaultCompareVersionId();
    }
  },
  { immediate: true },
);

const compareVersion = computed(
  () => props.versions.find((version) => version.id === compareVersionId.value) ?? null,
);

const currentVersionLabel = computed(() => {
  const version = props.versions.find((candidate) => candidate.id === props.currentVersionId);
  return version ? `v${version.version_no}` : t("graph.diff.currentDraft");
});

const result = computed(() =>
  compareVersion.value
    ? diffNodeGraphDocuments(compareVersion.value.document, props.currentDocument)
    : null,
);

function kindLabel(entry: GraphDocumentDiffEntry): string {
  const key = `graph.diff.kind.${entry.kind}`;
  return te(key) ? t(key) : entry.kind;
}

function targetLabel(entry: GraphDocumentDiffEntry): string {
  if (entry.targetId) {
    return `${entry.targetType}:${entry.targetId}`;
  }
  return entry.targetType;
}

function valueText(value: unknown): string {
  if (value === undefined) {
    return "—";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex justify-end bg-app/60" @click.self="emit('close')">
    <section class="flex h-full w-full max-w-xl flex-col border-l border-line-active bg-panel shadow-xl">
      <header class="flex shrink-0 items-center gap-2 border-b border-line-subtle px-4 py-3">
        <GitCompare :size="16" :stroke-width="1.5" class="text-text-secondary" />
        <div class="min-w-0 flex-1">
          <h2 class="truncate text-sm font-medium text-text-primary">{{ t("graph.diff.title") }}</h2>
          <p class="mt-0.5 truncate text-[11px] text-text-muted">
            {{ graphName || currentDocument.name }} · {{ t("graph.diff.current") }} {{ currentVersionLabel }}
          </p>
        </div>
        <button
          type="button"
          class="inline-flex size-7 items-center justify-center rounded text-text-muted transition-colors duration-150 hover:bg-float hover:text-text-secondary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :aria-label="t('graph.diff.close')"
          :title="t('graph.diff.close')"
          @click="emit('close')"
        >
          <X :size="14" :stroke-width="1.5" />
        </button>
      </header>

      <div class="shrink-0 space-y-2 border-b border-line-subtle px-4 py-3">
        <label class="block">
          <span class="mb-1 block text-[11px] text-text-muted">{{ t("graph.diff.compareWith") }}</span>
          <select
            v-model="compareVersionId"
            class="w-full rounded-md border border-line-subtle bg-float px-2 py-1 text-xs text-text-secondary transition-colors duration-150 hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          >
            <option v-for="version in versions" :key="version.id" :value="version.id">
              v{{ version.version_no }}{{ version.id === currentVersionId ? ` · ${t("graph.versionCurrent")}` : "" }}
            </option>
          </select>
        </label>
        <p class="text-[11px] leading-relaxed text-text-muted">
          {{ t("graph.diff.hint") }}
        </p>
      </div>

      <div class="min-h-0 flex-1 overflow-auto px-4 py-3">
        <div v-if="!compareVersion" class="rounded-md border border-line-subtle bg-float px-3 py-3 text-xs text-text-muted">
          {{ t("graph.diff.noVersion") }}
        </div>

        <template v-else-if="result">
          <div class="mb-3 flex flex-wrap gap-2 text-[10px] text-text-muted">
            <span class="rounded border border-line-subtle px-1.5 py-0.5">
              {{ t("graph.diff.total", { count: result.entries.length }) }}
            </span>
            <span v-for="kind in Object.keys(result.counts).filter((key) => result?.counts[key as keyof typeof result.counts])" :key="kind" class="rounded border border-line-subtle px-1.5 py-0.5">
              {{ t(`graph.diff.kind.${kind}`) }}: {{ result.counts[kind as keyof typeof result.counts] }}
            </span>
          </div>

          <div v-if="!result.hasChanges" class="rounded-md border border-line-subtle bg-float px-3 py-3 text-xs text-text-muted">
            {{ t("graph.diff.empty") }}
          </div>

          <ul v-else class="space-y-2">
            <li
              v-for="(entry, index) in result.entries"
              :key="`${entry.kind}-${entry.path}-${index}`"
              class="rounded-md border border-line-subtle bg-float/60 px-3 py-2"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs font-medium text-text-primary">{{ kindLabel(entry) }}</span>
                <span class="rounded border border-line-subtle px-1 font-mono text-[10px] text-text-muted">
                  {{ targetLabel(entry) }}
                </span>
                <span class="font-mono text-[10px] text-text-muted">{{ entry.path }}</span>
              </div>
              <div class="mt-2 grid gap-2 text-[10px] text-text-secondary sm:grid-cols-2">
                <div>
                  <div class="mb-1 text-text-muted">{{ t("graph.diff.before") }}</div>
                  <pre class="max-h-28 overflow-auto rounded border border-line-subtle bg-app px-2 py-1 font-mono leading-relaxed">{{ valueText(entry.before) }}</pre>
                </div>
                <div>
                  <div class="mb-1 text-text-muted">{{ t("graph.diff.after") }}</div>
                  <pre class="max-h-28 overflow-auto rounded border border-line-subtle bg-app px-2 py-1 font-mono leading-relaxed">{{ valueText(entry.after) }}</pre>
                </div>
              </div>
            </li>
          </ul>
        </template>
      </div>

      <footer class="flex shrink-0 justify-end border-t border-line-subtle px-4 py-3">
        <UiButton variant="ghost" class="!h-7 !px-2 text-xs" @click="emit('close')">
          {{ t("graph.diff.close") }}
        </UiButton>
      </footer>
    </section>
  </div>
</template>
