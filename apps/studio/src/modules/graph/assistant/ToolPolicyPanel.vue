<script setup lang="ts">
import { AlertTriangle, ChevronRight, RotateCcw } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { useContextStore } from "../../../stores/context";
import {
  useGraphAssistantToolPolicyStore,
} from "../../../stores/graph-assistant-tool-policy";
import type {
  GraphAssistantToolDecision,
  GraphAssistantToolPolicyItem,
} from "../../../lib/graph-assistant-tool-policy-api";
import {
  groupToolPoliciesByCategory,
  isDangerTool,
  shortToolName,
  toolI18nKey,
  type ToolCategory,
} from "./tool-policy-grouping";

const { t, te } = useI18n();
const context = useContextStore();
const store = useGraphAssistantToolPolicyStore();

/** 当前展开查看详情的工具名集合（仅前端 UI 状态）。 */
const expanded = ref<Set<string>>(new Set());

function isExpanded(toolName: string): boolean {
  return expanded.value.has(toolName);
}

function toggleExpanded(toolName: string): void {
  if (expanded.value.has(toolName)) {
    expanded.value.delete(toolName);
  } else {
    expanded.value.add(toolName);
  }
}

/** 工具的本地化展示名；缺失 i18n 时回退到去前缀的短名。 */
function toolDisplayName(toolName: string): string {
  const key = `graphAssistant.toolPolicy.tool.${toolI18nKey(toolName)}.name`;
  return te(key) ? t(key) : shortToolName(toolName);
}

/** 工具的本地化描述；缺失 i18n 时返回空串（详情区不渲染描述）。 */
function toolDisplayDesc(toolName: string): string {
  const key = `graphAssistant.toolPolicy.tool.${toolI18nKey(toolName)}.desc`;
  return te(key) ? t(key) : "";
}

interface CategoryGroup {
  category: ToolCategory;
  label: string;
  items: GraphAssistantToolPolicyItem[];
}

const groups = computed<CategoryGroup[]>(() =>
  groupToolPoliciesByCategory(store.items).map((group) => ({
    category: group.category,
    label: t(`graphAssistant.toolPolicy.category.${group.category}`),
    items: group.items,
  })),
);

const summary = computed(() =>
  t("graphAssistant.toolPolicy.summary", { auto: store.autoCount, confirm: store.confirmCount }),
);

async function loadForCurrentProject(): Promise<void> {
  if (context.currentProjectId) {
    await store.load(context.currentProjectId);
  }
}

onMounted(loadForCurrentProject);
watch(() => context.currentProjectId, loadForCurrentProject);

async function onSetDecision(toolName: string, decision: GraphAssistantToolDecision): Promise<void> {
  if (store.saving) return;
  try {
    await store.setDecision(toolName, decision);
  } catch {
    // 错误已写入 store.error，UI 顶部已展示。
  }
}

async function onSetAll(decision: GraphAssistantToolDecision): Promise<void> {
  if (store.saving) return;
  try {
    await store.setAll(decision);
  } catch {
    // 同上。
  }
}

async function onResetDefault(): Promise<void> {
  if (store.saving) return;
  try {
    await store.resetToDefault();
  } catch {
    // 同上。
  }
}
</script>

<template>
  <section class="space-y-3">
    <div class="space-y-0.5">
      <h3 class="text-xs font-medium text-text-primary">{{ t("graphAssistant.toolPolicy.title") }}</h3>
      <p class="text-[11px] leading-snug text-text-muted">{{ t("graphAssistant.toolPolicy.subtitle") }}</p>
    </div>

    <p
      v-if="!context.currentProjectId"
 class="rounded-md border border-line-subtle px-3 py-6 text-center text-[11px] text-text-muted"
    >
      {{ t("graphAssistant.toolPolicy.noProject") }}
    </p>

    <template v-else>
      <p
        class="rounded-md border border-line-subtle bg-float px-2.5 py-2 text-[11px] leading-snug text-text-muted"
      >
        {{ t("graphAssistant.toolPolicy.withheldNotice") }}
      </p>

      <p v-if="store.error" class="text-[11px] text-signal-error">{{ store.error }}</p>

      <div class="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          :disabled="store.saving|| store.loading"
          class="rounded-md border border-line-subtle px-2 py-1 text-[11px] text-text-secondary transition-colors duration-150 hover:bg-float disabled:cursor-not-allowed disabled:opacity-50"
          @click="onSetAll('auto')"
        >
          {{ t("graphAssistant.toolPolicy.allAuto") }}
        </button>
    <button
          type="button"
          :disabled="store.saving || store.loading"
          class="rounded-md border border-line-subtle px-2 py-1 text-[11px] text-text-secondary transition-colors duration-150 hover:bg-float disabled:cursor-not-allowed disabled:opacity-50"
          @click="onSetAll('confirm')"
        >
          {{ t("graphAssistant.toolPolicy.allConfirm") }}
        </button>
        <button
          type="button"
          :disabled="store.saving || store.loading"
          class="inline-flex items-center gap-1 rounded-md border border-line-subtle px-2 py-1 text-[11px] text-text-secondary transition-colors duration-150 hover:bg-float disabled:cursor-not-allowed disabled:opacity-50"
          @click="onResetDefault"
        >
          <RotateCcw :size="12" :stroke-width="1.5" />
         {{ t("graphAssistant.toolPolicy.resetDefault") }}
        </button>
        <span class="ml-auto font-mono text-[10px] text-text-muted">{{ summary }}</span>
      </div>

      <p
        v-if="!store.loading && store.items.length=== 0"
        class="rounded-md border border-line-subtle px-3 py-6 text-center text-[11px] text-text-muted"
 >
        {{ t("graphAssistant.toolPolicy.empty") }}
      </p>

      <div v-for="group in groups" :key="group.category" class="space-y-1">
        <h4 class="px-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">{{ group.label }}</h4>
        <div class="divide-y divide-line-subtle overflow-hidden rounded-md border border-line-subtle">
          <div v-for="entry in group.items" :key="entry.tool_name">
            <div class="flex items-center gap-2 px-2.5 py-2">
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1.5 text-left focus:outline-none"
                :aria-expanded="isExpanded(entry.tool_name)"
                :title="isExpanded(entry.tool_name) ? t('graphAssistant.toolPolicy.collapse') : t('graphAssistant.toolPolicy.expand')"
                @click="toggleExpanded(entry.tool_name)"
              >
                <ChevronRight
                  :size="12"
                  :stroke-width="1.5"
                  class="shrink-0 text-text-muted transition-transform duration-150"
                  :class="isExpanded(entry.tool_name) ? 'rotate-90' : ''"
                />
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-1.5">
                    <span class="truncate text-[11px] text-text-primary">{{ toolDisplayName(entry.tool_name) }}</span>
                    <span
                      v-if="isDangerTool(entry.tool_name)"
                      class="inline-flex shrink-0 items-center gap-0.5 rounded border border-signal-error/40 px-1 py-px text-[9px] uppercase text-signal-error"
                    >
                      <AlertTriangle :size="9" :stroke-width="1.5" />
                      {{ t("graphAssistant.toolPolicy.danger") }}
                    </span>
                    <span
                      v-if="entry.source === 'override'"
                      class="shrink-0 font-mono text-[9px] uppercase text-text-muted"
                    >
                      {{ t("graphAssistant.toolPolicy.decisionOverride") }}
                    </span>
                  </span>
                  <span class="block truncate font-mono text-[10px] text-text-muted">{{ shortToolName(entry.tool_name) }}</span>
                </span>
              </button>

              <div class="inline-flex shrink-0 overflow-hidden rounded-md border border-line-subtle">
                <button
                  type="button"
                  :disabled="store.saving"
                  class="px-2 py-1 text-[11px] transition-colors duration-150 disabled:cursor-not-allowed"
                  :class="
                    entry.decision === 'auto'
                      ? 'bg-signal-accent/15 text-signal-accent'
                      : 'text-text-muted hover:bg-float hover:text-text-secondary'
                  "
                  @click="onSetDecision(entry.tool_name, 'auto')"
                >
                  {{ t("graphAssistant.toolPolicy.auto") }}
                </button>
                <button
                  type="button"
                  :disabled="store.saving"
                  class="border-l border-line-subtle px-2 py-1 text-[11px] transition-colors duration-150 disabled:cursor-not-allowed"
                  :class="
                    entry.decision === 'confirm'
                      ? 'bg-float text-text-primary'
                      : 'text-text-muted hover:bg-float hover:text-text-secondary'
                  "
                  @click="onSetDecision(entry.tool_name, 'confirm')"
                >
                  {{ t("graphAssistant.toolPolicy.confirm") }}
                </button>
              </div>
            </div>

            <div
              v-if="isExpanded(entry.tool_name)"
              class="space-y-2 border-t border-line-subtle bg-float/40 px-2.5 py-2"
            >
              <p
                v-if="toolDisplayDesc(entry.tool_name)"
                class="text-[11px] leading-snug text-text-secondary"
              >
                {{ toolDisplayDesc(entry.tool_name) }}
              </p>
              <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px]">
                <dt class="text-text-muted">{{ t("graphAssistant.toolPolicy.detail.toolId") }}</dt>
                <dd class="break-all font-mono text-text-secondary">{{ entry.tool_name }}</dd>
                <dt class="text-text-muted">{{ t("graphAssistant.toolPolicy.detail.sideEffect") }}</dt>
                <dd class="text-text-secondary">{{ t(`graphAssistant.toolPolicy.sideEffect.${entry.side_effect_level}`) }}</dd>
                <dt class="text-text-muted">{{ t("graphAssistant.toolPolicy.detail.default") }}</dt>
                <dd class="text-text-secondary">{{ t(`graphAssistant.toolPolicy.${entry.default_decision}`) }}</dd>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
