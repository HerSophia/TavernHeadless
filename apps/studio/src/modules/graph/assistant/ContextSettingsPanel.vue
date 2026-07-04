<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { useContextStore } from "../../../stores/context";
import { useGraphAssistantPromptStore } from "../../../stores/graph-assistant-prompt";
import {
  defaultContextConfig,
  type DiagnosticKind,
  type GraphAssistantContextConfig,
} from "./context-config";

const { t } = useI18n();
const context = useContextStore();
const store = useGraphAssistantPromptStore();

/** 本地编辑态：上下文数据块配置的深拷贝。加载 / 保存后与 store 同步。 */
const draft = ref<GraphAssistantContextConfig>(defaultContextConfig());

function cloneConfig(config: GraphAssistantContextConfig): GraphAssistantContextConfig {
  return JSON.parse(JSON.stringify(config)) as GraphAssistantContextConfig;
}

/** 本地编辑态相对已保存配置是否有改动。 */
const dirty = computed(
  () => JSON.stringify(draft.value) !== JSON.stringify(store.contextConfig),
);

function syncFromStore(): void {
  draft.value = cloneConfig(store.contextConfig);
}

async function loadForCurrentProject(): Promise<void> {
  if (context.currentProjectId) {
    await store.load(context.currentProjectId);
    syncFromStore();
  }
}

onMounted(loadForCurrentProject);
watch(() => context.currentProjectId, loadForCurrentProject);

/** 切换诊断问题类型多选。 */
function toggleDiagnosticKind(kind: DiagnosticKind): void {
  const types = draft.value.diagnostics.types;
  const index = types.indexOf(kind);
  if (index >= 0) {
    types.splice(index, 1);
  } else {
    types.push(kind);
  }
}

async function onSave(): Promise<void> {
  if (store.saving || !dirty.value) {
    return;
  }
  try {
    await store.saveContext(draft.value);
    syncFromStore();
  } catch {
    // 错误已写入 store.error，UI 顶部已展示。
  }
}

function onReset(): void {
  syncFromStore();
}
</script>

<template>
  <section class="space-y-3">
    <div class="space-y-0.5">
   <h3 class="text-xs font-medium text-text-primary">{{ t("graphAssistant.context.title") }}</h3>
      <p class="text-[11px] leading-snug text-text-muted">{{ t("graphAssistant.context.subtitle") }}</p>
    </div>

    <p
      v-if="!context.currentProjectId"
      class="rounded-md border border-line-subtle px-3 py-6 text-center text-[11px] text-text-muted"
    >
      {{ t("graphAssistant.context.noProject") }}
   </p>

    <template v-else>
      <p v-if="store.error" class="text-[11px] text-signal-error">{{ store.error }}</p>

      <!-- 图结构概要 -->
      <div class="space-y-2 rounded-md border border-line-subtle p-2.5">
        <label class="flex items-center gap-2">
          <input v-model="draft.graphSummary.enabled" type="checkbox" class="size-3.5 accent-signal-accent" />
          <span class="flex-1 text-[11px] font-medium text-text-secondary">{{ t("graphAssistant.context.blocks.graphSummary.label") }}</span>
 </label>
        <p class="text-[11px] leading-snug text-text-muted">{{ t("graphAssistant.context.blocks.graphSummary.desc") }}</p>
        <div v-if="draft.graphSummary.enabled" class="space-y-2 pl-5">
          <label class="flex items-center gap-2">
            <input v-model="draft.graphSummary.includeNodeList" type="checkbox" class="size-3.5 accent-signal-accent" />
            <span class="text-[11px] text-text-secondary">{{ t("graphAssistant.context.params.includeNodeList") }}</span>
          </label>
          <label v-if="draft.graphSummary.includeNodeList" class="flex items-center gap-2">
          <span class="text-[11px] text-text-muted">{{ t("graphAssistant.context.params.maxNodes") }}</span>
            <input
              v-model.number="draft.graphSummary.maxNodes"
              type="number"
              min="-1"
              class="w-20 rounded border border-line-subtle bg-panel px-1.5 py-0.5 text-[11px] text-text-primary focus:border-signal-accent focus:outline-none"
       />
          </label>
        </div>
      </div>

      <!-- 当前选中 -->
      <div class="space-y-2 rounded-md border border-line-subtle p-2.5">
        <label class="flex items-center gap-2">
          <input v-model="draft.selection.enabled" type="checkbox" class="size-3.5 accent-signal-accent" />
          <span class="flex-1 text-[11px] font-medium text-text-secondary">{{ t("graphAssistant.context.blocks.selection.label") }}</span>
        </label>
      <p class="text-[11px] leading-snug text-text-muted">{{ t("graphAssistant.context.blocks.selection.desc") }}</p>
      </div>

      <!-- 图版本 -->
      <div class="space-y-2 rounded-md border border-line-subtle p-2.5">
        <label class="flex items-center gap-2">
          <input v-model="draft.graphVersion.enabled" type="checkbox" class="size-3.5 accent-signal-accent" />
          <span class="flex-1 text-[11px] font-medium text-text-secondary">{{ t("graphAssistant.context.blocks.graphVersion.label") }}</span>
        </label>
        <p class="text-[11px] leading-snug text-text-muted">{{ t("graphAssistant.context.blocks.graphVersion.desc") }}</p>
        <label v-if="draft.graphVersion.enabled" class="flex items-center gap-2 pl-5">
          <span class="text-[11px] text-text-muted">{{ t("graphAssistant.context.params.maxVersions") }}</span>
          <input
            v-model.number="draft.graphVersion.maxVersions"
            type="number"
            min="-1"
            class="w-20 rounded border border-line-subtle bg-panel px-1.5 py-0.5 text-[11px] text-text-primary focus:border-signal-accent focus:outline-none"
          />
        </label>
      </div>

      <!-- 诊断信息 -->
      <div class="space-y-2 rounded-md border border-line-subtle p-2.5">
        <label class="flex items-center gap-2">
          <input v-model="draft.diagnostics.enabled" type="checkbox" class="size-3.5 accent-signal-accent" />
          <span class="flex-1 text-[11px] font-medium text-text-secondary">{{ t("graphAssistant.context.blocks.diagnostics.label") }}</span>
        </label>
        <p class="text-[11px] leading-snug text-text-muted">{{ t("graphAssistant.context.blocks.diagnostics.desc") }}</p>
        <div v-if="draft.diagnostics.enabled" class="space-y-2 pl-5">
          <div class="space-y-1">
            <span class="text-[11px] text-text-muted">{{ t("graphAssistant.context.params.diagnosticTypes") }}</span>
            <div class="flex gap-1.5">
              <button
                v-for="kind in (['error', 'warning'] as const)"
                :key="kind"
                type="button"
                class="rounded-md border px-2 py-1 text-[11px] transition-colors duration-150 focus:outline-none"
                :class="
                  draft.diagnostics.types.includes(kind)
                    ? 'border-signal-accent text-text-primary'
                    : 'border-line-subtle text-text-muted hover:text-text-secondary'
                "
                @click="toggleDiagnosticKind(kind)"
              >
                {{ t(`graphAssistant.context.diagnosticKind.${kind}`) }}
              </button>
            </div>
          </div>
          <label class="flex items-center gap-2">
            <span class="text-[11px] text-text-muted">{{ t("graphAssistant.context.params.maxPerType") }}</span>
            <input
              v-model.number="draft.diagnostics.maxPerType"
              type="number"
              min="-1"
              class="w-20 rounded border border-line-subtle bg-panel px-1.5 py-0.5 text-[11px] text-text-primary focus:border-signal-accent focus:outline-none"
            />
          </label>
        </div>
      </div>

      <!-- 项目元信息 -->
      <div class="space-y-2 rounded-md border border-line-subtle p-2.5">
        <label class="flex items-center gap-2">
          <input v-model="draft.projectMeta.enabled" type="checkbox" class="size-3.5 accent-signal-accent" />
          <span class="flex-1 text-[11px] font-medium text-text-secondary">{{ t("graphAssistant.context.blocks.projectMeta.label") }}</span>
  </label>
        <p class="text-[11px] leading-snug text-text-muted">{{ t("graphAssistant.context.blocks.projectMeta.desc") }}</p>
      </div>

      <!-- 总 token 预算 -->
      <div class="space-y-1.5 rounded-md border border-line-subtle p-2.5">
        <label class="flex items-center gap-2">
          <span class="flex-1 text-[11px] font-medium text-text-secondary">{{ t("graphAssistant.context.params.maxTokens") }}</span>
          <input
            v-model.number="draft.maxTokens"
            type="number"
            min="-1"
            class="w-24 rounded border border-line-subtle bg-panel px-1.5 py-0.5 text-[11px] text-text-primary focus:border-signal-accent focus:outline-none"
          />
        </label>
        <p class="text-[11px] leading-snug text-text-muted">{{ t("graphAssistant.context.params.maxTokensHint") }}</p>
      </div>

      <p class="text-[11px] leading-snug text-text-muted">{{ t("graphAssistant.context.budgetHint") }}</p>

      <!-- 操作 -->
      <div class="flex items-center justify-end gap-2">
        <button
          type="button"
          :disabled="!dirty || store.saving"
          class="rounded-md px-2.5 py-1.5 text-[11px] text-text-muted transition-colors duration-150 hover:text-text-secondary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          @click="onReset"
        >
          {{ t("graphAssistant.context.reset") }}
        </button>
        <button
          type="button"
          :disabled="!dirty || store.saving"
          class="rounded-md border border-signal-accent px-3 py-1.5 text-[11px] text-signal-accent transition-colors duration-150 hover:bg-float focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          @click="onSave"
        >
          {{ store.saving ? t("graphAssistant.context.saving") : t("graphAssistant.context.save") }}
        </button>
      </div>
    </template>
  </section>
</template>
