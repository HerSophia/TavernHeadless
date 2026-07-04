<script setup lang="ts">
import {
  ArrowLeft,
  Bot,
  Braces,
  Check,
  Cpu,
  FileText,
  Layers,
  Wrench,
} from "lucide-vue-next";
import { computed, onMounted, ref, type Component } from "vue";
import { useI18n } from "vue-i18n";

import { useModelsStore } from "../../../stores/models";
import {
  useGraphAssistantGenerationStore,
  type ReasoningEffortLevel,
  type ReasoningThinkingMode,
  type ToggleableNumberParam,
} from "../../../stores/graph-assistant-generation";
import {
  useGraphAssistantToolTransportStore,
  type ToolTransportPreference,
} from "../../../stores/graph-assistant-tool-transport";
import UiIconButton from "../../../ui/UiIconButton.vue";
import UiSelect from "../../../ui/UiSelect.vue";
import ToolPolicyPanel from "./ToolPolicyPanel.vue";
import PromptSettingsPanel from "./PromptSettingsPanel.vue";
import ContextSettingsPanel from "./ContextSettingsPanel.vue";

const emit = defineEmits<{ (event: "back"): void }>();

const { t } = useI18n();
const store = useModelsStore();
const generationStore = useGraphAssistantGenerationStore();
const toolTransportStore = useGraphAssistantToolTransportStore();

/** 工具调用协议三档：自动 / 原生 / 文本协议。 */
const toolTransportOptions = computed<{ value: ToolTransportPreference; label: string }[]>(() => [
  { value: "auto", label: t("graphAssistant.toolTransport.option.auto") },
  { value: "native", label: t("graphAssistant.toolTransport.option.native") },
  { value: "text_protocol", label: t("graphAssistant.toolTransport.option.textProtocol") },
]);

/**
 * 思考模式与努力级别（Effort）是两个独立维度，可以共存：
 * 自适应（adaptive）下也能指定 effort 级别；手动（manual）下填思考预算 token 数。
 */
const thinkingModeOptions = computed<{ value: ReasoningThinkingMode; label: string }[]>(() => [
  { value: "adaptive", label: t("graphAssistant.reasoningEffort.mode.adaptive") },
  { value: "manual", label: t("graphAssistant.reasoningEffort.mode.manual") },
]);

const effortLevelOptions = computed<{ value: ReasoningEffortLevel; label: string }[]>(() => [
  { value: "default", label: t("graphAssistant.reasoningEffort.effortLevel.default") },
  { value: "low", label: t("graphAssistant.reasoningEffort.effortLevel.low") },
  { value: "medium", label: t("graphAssistant.reasoningEffort.effortLevel.medium") },
{ value: "high", label: t("graphAssistant.reasoningEffort.effortLevel.high") },
  { value: "xhigh", label: t("graphAssistant.reasoningEffort.effortLevel.xhigh") },
  { value: "max", label: t("graphAssistant.reasoningEffort.effortLevel.max") },
]);

/** 可开关的数值参数项定义（驱动 UI 生成）。 */
interface NumberParamItem {
  key: "temperature" | "topP" | "maxOutputTokens" | "maxContextTokens";
  param: ToggleableNumberParam;
  min: number;
  max?: number;
  step: number;
}

const numberParamItems = computed<NumberParamItem[]>(() => [
  { key: "temperature", param: generationStore.temperature, min: 0, max: 2, step: 0.1 },
  { key: "topP", param: generationStore.topP, min: 0, max: 1, step: 0.05 },
  { key: "maxOutputTokens", param: generationStore.maxOutputTokens, min: 1, step: 1 },
  { key: "maxContextTokens", param: generationStore.maxContextTokens, min: 1, step: 1 },
]);

type SettingsSection =
  | "profile"
  | "mcp"
  | "tools"
  | "summary"
  | "context"
  | "prompt";

interface SectionItem {
  id: SettingsSection;
  label: string;
  icon: Component;
  ready: boolean;
}

const section = ref<SettingsSection>("profile");

// 左侧栏导航项：ready 为 false 的项暂为占位（待后续阶段实现）
const items = computed<SectionItem[]>(() => [
  { id: "profile", label: t("graphAssistant.settingsNav.profile"), icon: Cpu, ready: true },
  { id: "mcp", label: t("graphAssistant.settingsNav.mcp"), icon: Braces, ready: false },
  { id: "tools", label: t("graphAssistant.settingsNav.tools"), icon: Wrench, ready: true },
  { id: "summary", label: t("graphAssistant.settingsNav.summary"), icon: FileText, ready: false },
  { id: "context", label: t("graphAssistant.settingsNav.context"), icon: Layers, ready: true },
 { id: "prompt", label: t("graphAssistant.settingsNav.prompt"), icon: Bot, ready: true },
]);

const currentReady = computed(() => items.value.find((item) => item.id === section.value)?.ready ?? false);

// 正在切换的档案 id（请求期间禁用同项重复点击）
const activating = ref<string | null>(null);

/** 仅展示可用（active）档案；停用档案不出现在选用列表。 */
const selectableProfiles = computed(() => store.profiles.filter((profile) => profile.status === "active"));

onMounted(async () => {
  if (store.profiles.length === 0) {
    await store.loadProfiles();
  }
  await store.loadRuntime();
});

async function onSelect(profileId: string): Promise<void> {
  if (activating.value || profileId === store.activeProfileId) {
    return;
  }
  activating.value = profileId;
  try {
    await store.activateProfile(profileId);
  } finally {
    activating.value = null;
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 设置视图顶栏：返回 + 标题 -->
    <header class="flex h-9 shrink-0 items-center gap-2 border-b border-line-subtle px-2">
      <UiIconButton :label="t('graphAssistant.back')" @click="emit('back')">
        <ArrowLeft :size="14" :stroke-width="1.5" />
      </UiIconButton>
      <span class="text-sm font-medium text-text-secondary">{{ t("graphAssistant.settings") }}</span>
    </header>

    <div class="flex min-h-0 flex-1">
      <!-- 左侧栏导航 -->
      <nav class="flex w-32 shrink-0 flex-col gap-0.5 overflow-auto border-r border-line-subtle p-1.5">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
          :class="
            section === item.id
              ? 'bg-float text-text-primary'
              : 'text-text-muted hover:bg-float hover:text-text-secondary'
          "
          @click="section = item.id"
        >
          <component :is="item.icon" :size="13" :stroke-width="1.5" />
          <span class="flex-1 truncate">{{ item.label }}</span>
          <span v-if="!item.ready" class="font-mono text-[9px] uppercase text-text-muted">soon</span>
        </button>
      </nav>

      <!-- 右侧内容区 -->
      <div class="min-h-0 flex-1 overflow-auto p-3">
        <!-- LLM Profile：纯选择，全局默认 -->
        <section v-if="section === 'profile'" class="space-y-3">
          <div class="space-y-0.5">
            <h3 class="text-xs font-medium text-text-primary">{{ t("graphAssistant.profileSelect.title") }}</h3>
            <p class="text-[11px] leading-snug text-text-muted">{{ t("graphAssistant.profileSelect.subtitle") }}</p>
          </div>

          <p v-if="store.error" class="text-[11px] text-signal-error">{{ store.error }}</p>

          <div class="divide-y divide-line-subtle overflow-hidden rounded-md border border-line-subtle">
                    <p
              v-if="selectableProfiles.length === 0"
              class="px-3 py-5 text-center text-[11px] text-text-muted"
            >
              {{ t("graphAssistant.profileSelect.empty") }}
            </p>

            <button
              v-for="profile in selectableProfiles"
              :key="profile.id"
              type="button"
              :disabled="activating !== null"
              class="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-float focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent disabled:cursor-not-allowed"
              @click="onSelect(profile.id)"
            >
              <span
                class="flex size-6 shrink-0 items-center justify-center rounded-md border"
                :class="
                  profile.id === store.activeProfileId
                    ? 'border-signal-accent text-signal-accent'
                    : 'border-line-subtle text-text-muted'
                "
              >
                <Check v-if="profile.id === store.activeProfileId" :size="13" :stroke-width="1.5" />
                <Cpu v-else :size="13" :stroke-width="1.5" />
              </span>

              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="truncate text-xs text-text-primary">{{ profile.presetName }}</span>
                  <span class="shrink-0 rounded border border-line-subtle px-1 py-px font-mono text-[9px] uppercase text-text-muted">
                    {{ profile.provider }}
                  </span>
                  <span
                    v-if="profile.id === store.activeProfileId"
                    class="shrink-0 font-mono text-[9px] text-signal-accent"
                  >
                    {{ t("graphAssistant.profileSelect.inUse") }}
                  </span>
                </div>
                <div class="mt-0.5 truncate font-mono text-[11px] text-text-muted">{{ profile.modelId }}</div>
              </div>
            </button>
          </div>

          <!-- 思考配置：思考模式 + 努力级别（Effort）两维并存；每回合下发，本机保存 -->
          <div class="space-y-2 border-t border-line-subtle pt-3">
            <div class="flex items-start justify-between gap-3">
              <div class="space-y-0.5">
                <h4 class="text-xs font-medium text-text-primary">{{ t("graphAssistant.reasoningEffort.title") }}</h4>
                    <p class="text-[11px] leading-snug text-text-muted">{{ t("graphAssistant.reasoningEffort.subtitle") }}</p>
              </div>
              <button
                type="button"
                role="switch"
                :aria-checked="generationStore.reasoningEnabled"
                class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
                :class="generationStore.reasoningEnabled ? 'bg-signal-accent' : 'bg-line-subtle'"
                @click="generationStore.setReasoningEnabled(!generationStore.reasoningEnabled)"
              >
                <span
                  class="inline-block size-3.5 rounded-full bg-white transition-transform duration-150"
                  :class="generationStore.reasoningEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'"
                />
              </button>
            </div>

            <template v-if="generationStore.reasoningEnabled">
              <!-- 思考模式：自适应 / 手动 -->
              <div class="space-y-1">
                <label class="block text-[11px] font-medium text-text-secondary">
                  {{ t("graphAssistant.reasoningEffort.modeLabel") }}
                </label>
                <UiSelect
                  :model-value="generationStore.reasoningMode"
                  :options="thinkingModeOptions"
                  @update:model-value="generationStore.setReasoningMode($event)"
                />
              </div>

              <!-- 自适应：努力级别（Effort），与自适应共存 -->
              <div v-if="generationStore.reasoningMode === 'adaptive'" class="space-y-1">
                <label class="block text-[11px] font-medium text-text-secondary">
                  {{ t("graphAssistant.reasoningEffort.effortLabel") }}
                </label>
                <UiSelect
                  :model-value="generationStore.reasoningEffortLevel"
                  :options="effortLevelOptions"
                  @update:model-value="generationStore.setReasoningEffortLevel($event)"
                />
                <p class="text-[10px] leading-snug text-text-muted">{{ t("graphAssistant.reasoningEffort.effortHint") }}</p>
              </div>

              <!-- 手动：思考预算（Budget）token 数 -->
              <div v-else class="space-y-1">
                <label class="block text-[11px] font-medium text-text-secondary">
                  {{ t("graphAssistant.reasoningEffort.budgetLabel") }}
           </label>
                <input
                  :value="generationStore.reasoningBudgetTokens"
                  type="number"
                  min="1024"
                  step="1024"
                  :placeholder="t('graphAssistant.reasoningEffort.budgetPlaceholder')"
                  class="w-32 rounded border border-line-subtle bg-panel px-2py-1 text-[11px] text-text-primary focus:border-signal-accent focus:outline-none"
                  @change="generationStore.setReasoningBudgetTokens(($event.target as HTMLInputElement).valueAsNumber)"
                />
                <p class="text-[10px] leading-snug text-text-muted">{{ t("graphAssistant.reasoningEffort.budgetHint") }}</p>
              </div>
            </template>
          </div>

          <!-- 可选生成参数：每项由开关控制，关闭时置灰禁用且不下发 -->
          <div class="space-y-2 border-t border-line-subtle pt-3">
            <div class="space-y-0.5">
              <h4 class="text-xs font-medium text-text-primary">{{ t("graphAssistant.genParams.title") }}</h4>
              <p class="text-[11px] leading-snug text-text-muted">{{ t("graphAssistant.genParams.subtitle") }}</p>
            </div>
          <div
              v-for="item in numberParamItems"
              :key="item.key"
              class="space-y-1 rounded-md border border-line-subtle p-2.5"
            >
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  class="size-3.5 accent-signal-accent"
                  :checked="item.param.enabled"
                  @change="generationStore.setParamEnabled(item.param, ($event.target as HTMLInputElement).checked)"
                />
                <span class="flex-1 text-[11px] font-medium text-text-secondary">
                  {{ t(`graphAssistant.genParams.${item.key}.label`) }}
                </span>
              </label>
              <p class="pl-5.5 text-[10px] leading-snug text-text-muted">
                {{ t(`graphAssistant.genParams.${item.key}.hint`) }}
              </p>
              <div class="flex items-center gap-2 pl-5.5">
                <input
                  :value="item.param.value"
                  type="number"
                  :min="item.min"
                  :max="item.max"
                  :step="item.step"
                  :disabled="!item.param.enabled"
                  class="w-28 rounded border border-line-subtle bg-panel px-1.5 py-0.5 text-[11px] text-text-primary focus:border-signal-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                  @change="generationStore.setParamValue(item.param, ($event.target as HTMLInputElement).valueAsNumber)"
                />
              </div>
            </div>
                 </div>

                 <!-- 工具调用协议：自动 / 原生 / 文本协议三档；每回合下发，本机保存 -->
                 <div class="space-y-2 border-t border-line-subtle pt-3">
                   <div class="space-y-0.5">
                     <h4 class="text-xs font-medium text-text-primary">{{ t("graphAssistant.toolTransport.title") }}</h4>
                     <p class="text-[11px] leading-snug text-text-muted">{{ t("graphAssistant.toolTransport.subtitle") }}</p>
                   </div>
                   <UiSelect
                     :model-value="toolTransportStore.preference"
                     :options="toolTransportOptions"
                     @update:model-value="toolTransportStore.setPreference($event)"
                   />
                   <p class="text-[10px] leading-snug text-text-muted">{{ t("graphAssistant.toolTransport.hint") }}</p>
                 </div>
        </section>

        <!-- 工具：逐工具自动/确认策略（阶段 2） -->
        <ToolPolicyPanel v-else-if="section === 'tools'" />

        <!-- 上下文：画布数据块开关与预算（项目级） -->
        <ContextSettingsPanel v-else-if="section === 'context'" />

        <!-- 提示词：静态提示词（项目级可看可配） -->
        <PromptSettingsPanel v-else-if="section === 'prompt'" />

        <!-- 占位项：待后续阶段实现 -->
        <div
          v-else-if="!currentReady"
          class="rounded-md border border-line-subtle px-3 py-6 text-center text-[11px] text-text-muted"
        >
          {{ t("graphAssistant.settingsComingSoon") }}
        </div>
      </div>
    </div>
  </div>
</template>
