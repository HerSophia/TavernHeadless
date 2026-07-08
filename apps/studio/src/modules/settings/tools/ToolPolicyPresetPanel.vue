<script setup lang="ts">
/**
 * 工具策略预设配置面板（SC2-10 / #b4-7）。
 *
 * 参考 `modules/graph/assistant/ToolPolicyPanel.vue`：项目级、后端持久。
 * 左侧列出预设（内置 `regular-chat` / `asset-management` + 自定义），右侧编辑选中预设：
 * 逐工具「启用 / 停用」+「auto / confirm」，按目录分类分组。内置预设可编辑（写覆盖）与重置，
 * 不可删除；自定义预设可删除。`confirm` 工具在执行前确认闸落地前会被后端 withheld（不暴露给 LLM）。
 */
import { AlertTriangle, Check, Plus, RotateCcw, Trash2 } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { useContextStore } from "../../../stores/context";
import { useToolPolicyPresetStore } from "../../../stores/tool-policy-preset";
import type {
  ToolPolicyDecision,
  ToolPolicyPresetToolItem,
} from "../../../lib/tool-policy-preset-api";
import UiButton from "../../../ui/UiButton.vue";
import UiDialog from "../../../ui/UiDialog.vue";
import UiTextInput from "../../../ui/UiTextInput.vue";
import {
  groupPresetToolsByCategory,
  isDangerTool,
  shortToolName,
  toolI18nKey,
  type ToolPresetCategoryGroup,
} from "./tool-preset-grouping";

const { t, te } = useI18n();
const context = useContextStore();
const store = useToolPolicyPresetStore();

interface CategoryGroup extends ToolPresetCategoryGroup {
  label: string;
}

const groups = computed<CategoryGroup[]>(() =>
  groupPresetToolsByCategory(store.detail?.tools ?? []).map((group) => ({
    ...group,
    label: t(`settings.tools.category.${group.category}`),
  })),
);

/** 预设的本地化名称：内置预设有 i18n 则用 i18n，否则回退到后端存的 display_name。 */
function presetLabel(presetKey: string, kind: string, displayName: string): string {
  const key = `settings.tools.preset.${presetKey}`;
  if (kind === "builtin" && te(key)) {
    return t(key);
  }
  return displayName;
}

/**
 * 工具的本地化显示名：有 i18n 文案则用之，否则回退到去前缀的裸工具名。
 * 原始工具名仍作为 title 提示保留，便于按技术名检索。
 */
function toolLabel(toolName: string): string {
  const key = `settings.tools.toolName.${toolI18nKey(toolName)}`;
  return te(key) ? t(key) : shortToolName(toolName);
}

/**
 * 工具的本地化描述：有 i18n 文案则用之，否则回退到后端目录里的英文描述
 * （节点图工具后端描述为空，此时完全依赖 i18n）。
 */
function toolDescription(tool: ToolPolicyPresetToolItem): string {
  const key = `settings.tools.toolDesc.${toolI18nKey(tool.tool_name)}`;
  return te(key) ? t(key) : tool.description;
}

async function loadForCurrentProject(): Promise<void> {
  if (context.currentProjectId) {
    await store.load(context.currentProjectId);
  }
}

onMounted(loadForCurrentProject);
watch(() => context.currentProjectId, loadForCurrentProject);

async function guarded(action: () => Promise<void>): Promise<void> {
  if (store.saving) return;
  try {
    await action();
  } catch {
    // 错误已写入 store.error，UI 顶部已展示。
  }
}

function onToggleEnabled(tool: ToolPolicyPresetToolItem): void {
  void guarded(() => store.setToolEnabled(tool.tool_name, !tool.enabled));
}

function onSetDecision(tool: ToolPolicyPresetToolItem, decision: ToolPolicyDecision): void {
  if (!tool.enabled || tool.decision === decision) return;
  void guarded(() => store.setToolDecision(tool.tool_name, decision));
}

function onSetAll(decision: ToolPolicyDecision): void {
  void guarded(() => store.setAllDecisions(decision));
}

function onSetCategoryEnabled(group: CategoryGroup, enabled: boolean): void {
  void guarded(() => store.setCategoryEnabled(group.items.map((item) => item.tool_name), enabled));
}

// —— 重置（内置回 baseline） ——
function onReset(): void {
  void guarded(() => store.resetPreset());
}

// —— 删除自定义预设（内联确认） ——
const confirmingDelete = ref(false);
function onDelete(): void {
  const key = store.selectedKey;
  if (!key) return;
  void guarded(async () => {
    await store.deleteCustomPreset(key);
    confirmingDelete.value = false;
  });
}

// —— 新建自定义预设 ——
const createOpen = ref(false);
const newPresetKey = ref("");
const newDisplayName = ref("");

const createValid = computed(
  () => /^[a-z0-9][a-z0-9-]{1,63}$/.test(newPresetKey.value.trim()) && newDisplayName.value.trim().length > 0,
);

function openCreate(): void {
  newPresetKey.value = "";
  newDisplayName.value = "";
  createOpen.value = true;
}

function onCreate(): void {
  if (!createValid.value) return;
  void guarded(async () => {
    await store.createCustomPreset({
      presetKey: newPresetKey.value.trim(),
      displayName: newDisplayName.value.trim(),
    });
    createOpen.value = false;
  });
}

const detailSummary = computed(() => {
  const summary = store.selectedSummary;
  if (!summary) return "";
  return t("settings.tools.summary", {
    enabled: summary.enabled_count,
    auto: summary.auto_count,
    confirm: summary.confirm_count,
  });
});
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-4 p-4">
    <div class="space-y-0.5">
      <h3 class="text-xs font-medium text-text-primary">{{ t("settings.tools.title") }}</h3>
      <p class="text-[11px] leading-snug text-text-muted">{{ t("settings.tools.subtitle") }}</p>
    </div>

    <p
      v-if="!context.currentProjectId"
      class="rounded-md border border-line-subtle px-3 py-6 text-center text-[11px] text-text-muted"
    >
      {{ t("settings.tools.noProject") }}
    </p>

    <template v-else>
      <p v-if="store.error" class="text-[11px] text-signal-error">{{ store.error }}</p>

      <div class="grid grid-cols-[13rem_1fr] gap-4">
        <!-- 预设列表 -->
        <aside class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[10px] font-medium uppercase tracking-wide text-text-muted">
              {{ t("settings.tools.presetsLabel") }}
            </span>
            <button
              type="button"
              :disabled="store.saving || store.loadingList"
              class="inline-flex items-center gap-0.5 rounded-md border border-line-subtle px-1.5 py-0.5 text-[10px] text-text-secondary transition-colors duration-150 hover:bg-float disabled:cursor-not-allowed disabled:opacity-50"
              :title="t('settings.tools.preset.newTitle')"
              @click="openCreate"
            >
              <Plus :size="11" :stroke-width="1.5" />
              {{ t("settings.tools.preset.new") }}
            </button>
          </div>

          <div class="space-y-1">
            <button
              v-for="preset in store.presets"
              :key="preset.preset_key"
              type="button"
              class="flex w-full flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left transition-colors duration-150"
              :class="
                preset.preset_key === store.selectedKey
                  ? 'border-signal-accent/50 bg-signal-accent/10'
                  : 'border-line-subtle hover:bg-float'
              "
              @click="store.selectPreset(preset.preset_key)"
            >
              <span class="flex w-full items-center gap-1.5">
                <span class="min-w-0 flex-1 truncate text-[11px] text-text-primary">
                  {{ presetLabel(preset.preset_key, preset.kind, preset.display_name) }}
                </span>
                <span
                  v-if="preset.kind === 'builtin'"
                  class="shrink-0 rounded border border-line-subtle px-1 py-px text-[9px] uppercase text-text-muted"
                >
                  {{ t("settings.tools.preset.builtin") }}
                </span>
                <span
                  v-if="preset.customized"
                  class="shrink-0 font-mono text-[9px] uppercase text-signal-accent"
                  :title="t('settings.tools.preset.customized')"
                >
                  ●
                </span>
              </span>
              <span class="font-mono text-[9px] text-text-muted">
                {{ t("settings.tools.presetCount", { count: preset.enabled_count }) }}
              </span>
            </button>
          </div>
        </aside>

        <!-- 选中预设明细 -->
        <section class="min-w-0 space-y-3">
          <p
            v-if="!store.detail && !store.loadingDetail"
            class="rounded-md border border-line-subtle px-3 py-6 text-center text-[11px] text-text-muted"
          >
            {{ t("settings.tools.empty") }}
          </p>

          <template v-else-if="store.detail">
            <!-- 预设头部 + 操作 -->
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-mono text-[10px] text-text-muted">{{ detailSummary }}</span>
              <div class="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  :disabled="store.saving"
                  class="inline-flex items-center gap-1 rounded-md border border-line-subtle px-2 py-1 text-[11px] text-text-secondary transition-colors duration-150 hover:bg-float disabled:cursor-not-allowed disabled:opacity-50"
                  @click="onReset"
                >
                  <RotateCcw :size="12" :stroke-width="1.5" />
                  {{ t("settings.tools.reset") }}
                </button>
                <template v-if="store.detail.kind === 'custom'">
                  <button
                    v-if="!confirmingDelete"
                    type="button"
                    :disabled="store.saving"
                    class="inline-flex items-center gap-1 rounded-md border border-line-subtle px-2 py-1 text-[11px] text-signal-error transition-colors duration-150 hover:bg-signal-error/10 disabled:cursor-not-allowed disabled:opacity-50"
                    @click="confirmingDelete = true"
                  >
                    <Trash2 :size="12" :stroke-width="1.5" />
                    {{ t("settings.tools.delete") }}
                  </button>
                  <template v-else>
                    <button
                      type="button"
                      :disabled="store.saving"
                      class="rounded-md border border-signal-error/50 bg-signal-error/10 px-2 py-1 text-[11px] text-signal-error transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
                      @click="onDelete"
                    >
                      {{ t("settings.tools.confirmDelete") }}
                    </button>
                    <button
                      type="button"
                      :disabled="store.saving"
                      class="rounded-md border border-line-subtle px-2 py-1 text-[11px] text-text-secondary transition-colors duration-150 hover:bg-float"
                      @click="confirmingDelete = false"
                    >
                      {{ t("settings.tools.cancel") }}
                    </button>
                  </template>
                </template>
              </div>
            </div>

            <p
              class="rounded-md border border-line-subtle bg-float px-2.5 py-2 text-[11px] leading-snug text-text-muted"
            >
              {{ t("settings.tools.withheldNotice") }}
            </p>

            <div class="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                :disabled="store.saving"
                class="rounded-md border border-line-subtle px-2 py-1 text-[11px] text-text-secondary transition-colors duration-150 hover:bg-float disabled:cursor-not-allowed disabled:opacity-50"
                @click="onSetAll('auto')"
              >
                {{ t("settings.tools.allAuto") }}
              </button>
              <button
                type="button"
                :disabled="store.saving"
                class="rounded-md border border-line-subtle px-2 py-1 text-[11px] text-text-secondary transition-colors duration-150 hover:bg-float disabled:cursor-not-allowed disabled:opacity-50"
                @click="onSetAll('confirm')"
              >
                {{ t("settings.tools.allConfirm") }}
              </button>
            </div>

            <!-- 工具分组 -->
            <div v-for="group in groups" :key="group.category" class="space-y-1">
              <div class="flex items-center gap-2 px-0.5">
                <h4 class="text-[10px] font-medium uppercase tracking-wide text-text-muted">
                  {{ group.label }}
                </h4>
                <div class="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    :disabled="store.saving"
                    class="rounded border border-line-subtle px-1.5 py-px text-[9px] text-text-muted transition-colors duration-150 hover:bg-float disabled:cursor-not-allowed disabled:opacity-50"
                    @click="onSetCategoryEnabled(group, true)"
                  >
                    {{ t("settings.tools.enableAll") }}
                  </button>
                  <button
                    type="button"
                    :disabled="store.saving"
                    class="rounded border border-line-subtle px-1.5 py-px text-[9px] text-text-muted transition-colors duration-150 hover:bg-float disabled:cursor-not-allowed disabled:opacity-50"
                    @click="onSetCategoryEnabled(group, false)"
                  >
                    {{ t("settings.tools.disableAll") }}
                  </button>
                </div>
              </div>

              <div class="divide-y divide-line-subtle overflow-hidden rounded-md border border-line-subtle">
                <div
                  v-for="tool in group.items"
                  :key="tool.tool_name"
                  class="flex items-center gap-2 px-2.5 py-2"
                  :class="tool.enabled ? '' : 'opacity-60'"
                >
                  <!-- 启用复选框 -->
                  <button
                    type="button"
                    role="checkbox"
                    :aria-checked="tool.enabled"
                    :disabled="store.saving"
                    class="flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
                    :class="
                      tool.enabled
                        ? 'border-signal-accent bg-signal-accent/20 text-signal-accent'
                        : 'border-line-active text-transparent hover:border-signal-accent/60'
                    "
                    :title="tool.enabled ? t('settings.tools.enabled') : t('settings.tools.disabled')"
                    @click="onToggleEnabled(tool)"
                  >
                    <Check v-if="tool.enabled" :size="11" :stroke-width="2" />
                  </button>

                  <span class="min-w-0 flex-1">
                    <span class="flex items-center gap-1.5">
                      <span class="truncate text-[11px] text-text-primary" :title="tool.tool_name">{{
                        toolLabel(tool.tool_name)
                      }}</span>
                      <span class="shrink-0 truncate font-mono text-[9px] text-text-muted">{{
                        shortToolName(tool.tool_name)
                      }}</span>
                      <span
                        v-if="isDangerTool(tool.side_effect_level)"
                        class="inline-flex shrink-0 items-center gap-0.5 rounded border border-signal-error/40 px-1 py-px text-[9px] uppercase text-signal-error"
                      >
                        <AlertTriangle :size="9" :stroke-width="1.5" />
                        {{ t("settings.tools.danger") }}
                      </span>
                    </span>
                    <span v-if="toolDescription(tool)" class="block truncate text-[10px] text-text-muted">
                      {{ toolDescription(tool) }}
                    </span>
                  </span>

                  <!-- 决策：auto / confirm -->
                  <div class="inline-flex shrink-0 overflow-hidden rounded-md border border-line-subtle">
                    <button
                      type="button"
                      :disabled="store.saving || !tool.enabled"
                      class="px-2 py-1 text-[11px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
                      :class="
                        tool.enabled && tool.decision === 'auto'
                          ? 'bg-signal-accent/15 text-signal-accent'
                          : 'text-text-muted hover:bg-float hover:text-text-secondary'
                      "
                      @click="onSetDecision(tool, 'auto')"
                    >
                      {{ t("settings.tools.auto") }}
                    </button>
                    <button
                      type="button"
                      :disabled="store.saving || !tool.enabled"
                      class="border-l border-line-subtle px-2 py-1 text-[11px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50"
                      :class="
                        tool.enabled && tool.decision === 'confirm'
                          ? 'bg-float text-text-primary'
                          : 'text-text-muted hover:bg-float hover:text-text-secondary'
                      "
                      @click="onSetDecision(tool, 'confirm')"
                    >
                      {{ t("settings.tools.confirm") }}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </section>
      </div>
    </template>

    <!-- 新建自定义预设对话框 -->
    <UiDialog
      :open="createOpen"
      :title="t('settings.tools.preset.newTitle')"
      size="sm"
      :busy="store.saving"
      @close="createOpen = false"
    >
      <div class="space-y-4">
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-text-secondary">{{ t("settings.tools.preset.presetKey") }}</label>
          <UiTextInput
            v-model="newPresetKey"
            :placeholder="t('settings.tools.preset.presetKeyPlaceholder')"
            :disabled="store.saving"
          />
          <p class="text-[10px] text-text-muted">{{ t("settings.tools.preset.presetKeyHint") }}</p>
        </div>
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-text-secondary">{{ t("settings.tools.preset.displayName") }}</label>
          <UiTextInput
            v-model="newDisplayName"
            :placeholder="t('settings.tools.preset.displayNamePlaceholder')"
            :disabled="store.saving"
          />
        </div>
      </div>
      <template #footer>
        <UiButton variant="ghost" :disabled="store.saving" @click="createOpen = false">
          {{ t("settings.tools.cancel") }}
        </UiButton>
        <UiButton :disabled="store.saving || !createValid" @click="onCreate">
          {{ t("settings.tools.preset.create") }}
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>
