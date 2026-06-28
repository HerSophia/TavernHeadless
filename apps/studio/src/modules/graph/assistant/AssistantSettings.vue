<script setup lang="ts">
import {
  ArrowLeft,
  Bot,
  Braces,
  Check,
  Cpu,
  FileText,
  Layers,
  PlayCircle,
  Wrench,
} from "lucide-vue-next";
import { computed, onMounted, ref, type Component } from "vue";
import { useI18n } from "vue-i18n";

import { useModelsStore } from "../../../stores/models";
import UiIconButton from "../../../ui/UiIconButton.vue";
import ToolPolicyPanel from "./ToolPolicyPanel.vue";

const emit = defineEmits<{ (event: "back"): void }>();

const { t } = useI18n();
const store = useModelsStore();

type SettingsSection =
  | "profile"
  | "mcp"
  | "tools"
  | "autorun"
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
  { id: "autorun", label: t("graphAssistant.settingsNav.autorun"), icon: PlayCircle, ready: false },
  { id: "summary", label: t("graphAssistant.settingsNav.summary"), icon: FileText, ready: false },
  { id: "context", label: t("graphAssistant.settingsNav.context"), icon: Layers, ready: false },
  { id: "prompt", label: t("graphAssistant.settingsNav.prompt"), icon: Bot, ready: false },
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
        </section>

        <!-- 工具：逐工具自动/确认策略（阶段 2） -->
        <ToolPolicyPanel v-else-if="section === 'tools'" />

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
