<script setup lang="ts">
import { Cpu, Server, SlidersHorizontal } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import BackendConnectionPanel from "./backend/BackendConnectionPanel.vue";
import LlmInstancePanel from "./instances/LlmInstancePanel.vue";
import ModelProfilePanel from "./profiles/ModelProfilePanel.vue";

const { t } = useI18n();

type SettingsTab = "backend" | "profiles" | "instances";

const tab = ref<SettingsTab>("backend");

const tabs = computed(() => [
  { id: "backend" as const, label: t("settings.tabs.backend"), icon: Server },
  { id: "profiles" as const, label: t("settings.tabs.profiles"), icon: Cpu },
  { id: "instances" as const, label: t("settings.tabs.instances"), icon: SlidersHorizontal },
]);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <nav class="flex shrink-0 items-center gap-1 border-b border-line-subtle bg-panel px-3">
      <button
        v-for="item in tabs"
        :key="item.id"
        type="button"
        class="inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs transition-colors duration-150 focus:outline-none"
        :class="
          tab === item.id
            ? 'border-b-signal-accent text-text-primary'
            : 'border-b-transparent text-text-muted hover:text-text-secondary'
        "
        @click="tab = item.id"
      >
        <component :is="item.icon" :size="14" :stroke-width="1.5" />
        {{ item.label }}
      </button>
    </nav>

    <div class="min-h-0 flex-1 overflow-auto">
      <BackendConnectionPanel v-if="tab === 'backend'" />
      <ModelProfilePanel v-else-if="tab === 'profiles'" />
      <LlmInstancePanel v-else-if="tab === 'instances'" />
    </div>
  </div>
</template>
