<script setup lang="ts">
import type { NodeGraphDocument } from "@tavern/core/node-graph";
import { X } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import UiButton from "../../../ui/UiButton.vue";
import UiIconButton from "../../../ui/UiIconButton.vue";
import { validateGraphDocument } from "../validate/local-validation";
import {
  importSillyTavernPreset,
  type PresetClusterMode,
  type PresetImportPurpose,
  type PresetImportResult,
} from "./silly-tavern-preset";

const emit = defineEmits<{ loaded: [document: NodeGraphDocument, name: string]; close: [] }>();

const { t } = useI18n();

const fileName = ref("");
const name = ref("");
const phase = ref<"idle" | "parsing">("idle");
const error = ref<string | null>(null);
const result = ref<PresetImportResult | null>(null);
const clusterMode = ref<PresetClusterMode>("loose");
const importPurpose = ref<PresetImportPurpose>("narrator_graph");
const importPurposeOptions = ["narrator_graph", "compat_floor_graph"] as const;
/** 缓存已解析的原始 JSON 与回退名，供切换聚类模式时重新导入。 */
const parsedPreset = ref<unknown>(null);
const fallbackName = ref("");
/** 原始预设文件内容哈希（同一文件必得同哈希），随文档 metadata 一同写入，供重复导入检测。 */
const presetHash = ref("");

/** cyrb53：轻量同步字符串哈希（返回 16 进制），用于预设内容等价性比对。 */
function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const result = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return result.toString(16);
}

const counts = computed(() => {
  const doc = result.value?.document;
  if (!doc) {
    return null;
  }
  const validation = validateGraphDocument(doc);
  return {
    nodes: doc.nodes.length,
    edges: doc.edges.length,
    groups: doc.groups?.length ?? 0,
    error: validation.counts.error,
    warning: validation.counts.warning,
  };
});

const loadable = computed(() => Boolean(result.value) && (counts.value?.error ?? 1) === 0);

function purposeLabel(purpose: PresetImportPurpose): string {
  return t(purpose === "compat_floor_graph" ? "graph.preset.purposeCompat" : "graph.preset.purposeNarrator");
}

function purposeHint(purpose: PresetImportPurpose): string {
  return t(
    purpose === "compat_floor_graph"
      ? "graph.preset.purposeCompatHint"
      : "graph.preset.purposeNarratorHint",
  );
}

function reimportPreset(options: { name?: string; syncName?: boolean } = {}): void {
  if (parsedPreset.value === null) {
    return;
  }
  const imported = importSillyTavernPreset(parsedPreset.value, {
    name: options.name ?? (name.value.trim() || fallbackName.value),
    clusterMode: clusterMode.value,
    presetHash: presetHash.value || undefined,
    purpose: importPurpose.value,
  });
  result.value = imported;
  if (options.syncName === true) {
    name.value = imported.document.name;
  }
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  result.value = null;
  error.value = null;
  parsedPreset.value = null;
  presetHash.value = "";
  fallbackName.value = "";
  if (!file) {
    fileName.value = "";
    return;
  }
  fileName.value = file.name;
  phase.value = "parsing";
  try {
    const text = await file.text();
    parsedPreset.value = JSON.parse(text) as unknown;
    presetHash.value = hashText(text);
    fallbackName.value = file.name.replace(/\.json$/i, "");
    reimportPreset({ name: fallbackName.value, syncName: true });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "not_a_sillytavern_preset") {
      error.value = t("graph.preset.invalid");
    } else if (cause instanceof SyntaxError) {
      error.value = t("graph.preset.parseError");
    } else {
      error.value = cause instanceof Error ? cause.message : String(cause);
    }
  } finally {
    phase.value = "idle";
  }
}

/** 切换聚类模式：用缓存的原始 JSON 重新导入（不需重新选文件）。 */
function onClusterModeChange(mode: PresetClusterMode): void {
  if (clusterMode.value === mode) {
    return;
  }
  clusterMode.value = mode;
  if (parsedPreset.value === null) {
    return;
  }
  error.value = null;
  try {
    reimportPreset();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

/** 切换导入用途：用缓存的原始 JSON 重新导入（不需重新选文件）。 */
function onImportPurposeChange(purpose: PresetImportPurpose): void {
  if (importPurpose.value === purpose) {
    return;
  }
  importPurpose.value = purpose;
  if (parsedPreset.value === null) {
    return;
  }
  error.value = null;
  try {
    reimportPreset();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  }
}

function onLoad(): void {
  if (!result.value || !loadable.value) {
    return;
  }
  emit("loaded", result.value.document, name.value.trim() || result.value.document.name);
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-app/70 p-4" @click.self="emit('close')">
    <div class="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line-active bg-panel">
      <header class="flex items-center justify-between border-b border-line-subtle px-4 py-2.5">
        <span class="text-sm font-medium text-text-primary">{{ t("graph.preset.importTitle") }}</span>
        <UiIconButton :label="t('graph.preset.close')" @click="emit('close')">
          <X :size="14" :stroke-width="1.5" />
        </UiIconButton>
      </header>

      <div class="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <p class="text-xs leading-relaxed text-text-muted">{{ t("graph.preset.hint") }}</p>

        <label class="block space-y-1">
          <span class="text-xs text-text-secondary">{{ t("graph.preset.pick") }}</span>
          <input
            type="file"
            accept=".json,application/json"
            class="block w-full text-xs text-text-secondary file:mr-3 file:rounded-md file:border file:border-line-subtle file:bg-float file:px-3 file:py-1.5 file:text-text-primary hover:file:border-line-active"
            @change="onFileChange"
          />
        </label>

        <div class="space-y-1">
          <span class="text-xs text-text-secondary">{{ t("graph.preset.purpose") }}</span>
          <div class="grid gap-2 sm:grid-cols-2">
            <button
              v-for="purpose in importPurposeOptions"
              :key="purpose"
              type="button"
              class="rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors duration-150"
              :class="importPurpose === purpose
                ? 'border-signal-accent bg-float text-text-primary'
                : 'border-line-subtle text-text-secondary hover:border-line-active'"
              @click="onImportPurposeChange(purpose)"
            >
              <span class="block font-medium">{{ purposeLabel(purpose) }}</span>
              <span class="mt-0.5 block text-[10px] leading-snug text-text-muted">
                {{ purposeHint(purpose) }}
              </span>
            </button>
          </div>
        </div>

        <div class="space-y-1">
          <span class="text-xs text-text-secondary">{{ t("graph.preset.clusterMode") }}</span>
          <div class="flex gap-2">
            <button
              v-for="mode in (['loose', 'strict'] as const)"
              :key="mode"
              type="button"
              class="flex-1 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors duration-150"
              :class="clusterMode === mode
                ? 'border-signal-accent bg-float text-text-primary'
                : 'border-line-subtle text-text-secondary hover:border-line-active'"
              @click="onClusterModeChange(mode)"
            >
              <span class="block font-medium">{{ t(`graph.preset.clusterMode_${mode}`) }}</span>
              <span class="mt-0.5 block text-[10px] leading-snug text-text-muted">
                {{ t(`graph.preset.clusterMode_${mode}_hint`) }}
              </span>
            </button>
          </div>
        </div>

        <p v-if="phase === 'parsing'" class="text-xs text-text-muted">{{ t("graph.preset.loading") }}</p>
        <p v-if="error" class="font-mono text-xs text-signal-error">{{ error }}</p>

        <template v-if="result && counts">
          <!-- Overview -->
          <section class="space-y-1.5 rounded-md border border-line-subtle p-3">
            <div class="flex items-center gap-2 text-sm">
              <span :class="loadable ? 'text-signal-success' : 'text-signal-error'">
                {{ loadable ? t("graph.preset.ready") : t("graph.preset.notReady") }}
              </span>
              <span class="truncate font-mono text-[11px] text-text-muted">· {{ result.summary.presetName }}</span>
            </div>
            <div class="flex flex-wrap gap-x-3 font-mono text-xs text-text-muted">
              <span>{{ counts.nodes }} {{ t("graph.nodes") }}</span>
              <span>{{ counts.edges }} {{ t("graph.edges") }}</span>
              <span class="text-signal-error">err {{ counts.error }}</span>
              <span class="text-signal-warn">warn {{ counts.warning }}</span>
            </div>
          </section>

          <!-- Mapping summary -->
          <dl class="grid grid-cols-2 gap-1.5">
            <div class="flex justify-between gap-2 rounded-md border border-line-subtle px-2.5 py-1.5 text-xs">
              <dt class="text-text-muted">{{ t("graph.preset.blocks") }}</dt>
              <dd class="font-mono text-text-secondary">
                {{ result.summary.blockCount
                }}<span v-if="result.summary.disabledCount > 0" class="text-text-muted">
                  · {{ result.summary.disabledCount }} {{ t("graph.preset.disabled") }}</span>
              </dd>
            </div>
            <div class="flex justify-between gap-2 rounded-md border border-line-subtle px-2.5 py-1.5 text-xs">
              <dt class="text-text-muted">{{ t("graph.preset.slots") }}</dt>
              <dd class="font-mono text-text-secondary">{{ result.summary.slotNodeCount }}</dd>
            </div>
            <div class="flex justify-between gap-2 rounded-md border border-line-subtle px-2.5 py-1.5 text-xs">
              <dt class="text-text-muted">{{ t("graph.groups") }}</dt>
              <dd class="font-mono text-text-secondary">{{ result.summary.groupCount }}</dd>
            </div>
            <div class="flex justify-between gap-2 rounded-md border border-line-subtle px-2.5 py-1.5 text-xs">
              <dt class="text-text-muted">{{ t("graph.preset.history") }}</dt>
              <dd class="font-mono text-text-secondary">{{ result.summary.hasHistory ? t("graph.preset.yes") : "—" }}</dd>
            </div>
            <div class="flex justify-between gap-2 rounded-md border border-line-subtle px-2.5 py-1.5 text-xs">
              <dt class="text-text-muted">{{ t("graph.preset.sampler") }}</dt>
              <dd class="font-mono text-text-secondary">{{ result.summary.samplerKeys.length }}</dd>
            </div>
            <div class="flex justify-between gap-2 rounded-md border border-line-subtle px-2.5 py-1.5 text-xs">
              <dt class="text-text-muted">{{ t("graph.preset.regex") }}</dt>
              <dd class="font-mono text-text-secondary">{{ result.summary.regexCount }}</dd>
            </div>
          </dl>

          <!-- Warnings -->
          <section v-if="result.warnings.length > 0" class="space-y-1">
            <h4 class="text-xs font-medium text-text-secondary">{{ t("graph.preset.warnings") }}</h4>
            <ul class="space-y-1">
              <li
                v-for="(warning, index) in result.warnings"
                :key="index"
                class="rounded-md border border-line-subtle px-2.5 py-1.5 text-xs text-text-secondary"
              >
                {{ warning }}
              </li>
            </ul>
          </section>

          <label class="block space-y-1">
            <span class="text-xs text-text-secondary">{{ t("graph.preset.name") }}</span>
            <input
              v-model="name"
              class="w-full rounded-md border border-line-subtle bg-float px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
              :placeholder="result.summary.presetName"
            />
          </label>
        </template>
      </div>

      <footer class="flex items-center gap-2 border-t border-line-subtle px-4 py-3">
        <UiButton :disabled="!loadable" @click="onLoad">{{ t("graph.preset.load") }}</UiButton>
        <UiButton variant="ghost" @click="emit('close')">{{ t("graph.preset.cancel") }}</UiButton>
      </footer>
    </div>
  </div>
</template>
