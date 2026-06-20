<script setup lang="ts">
import { MessageSquare, Moon, Sun, Workflow } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, RouterView, useRoute } from "vue-router";

import UiIconButton from "../../ui/UiIconButton.vue";
import TopBarContext from "./TopBarContext.vue";

const { t } = useI18n();
const route = useRoute();

const navItems = computed(() => [
  { name: "graph", to: "/graph", label: t("nav.graph"), icon: Workflow },
  { name: "chat", to: "/chat", label: t("nav.chat"), icon: MessageSquare }
]);

const isDark = ref(true);

function applyTheme(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
}

onMounted(() => {
  const saved = localStorage.getItem("studio-theme");
  isDark.value = saved ? saved === "dark" : true;
  applyTheme(isDark.value);
});

function toggleTheme(): void {
  isDark.value = !isDark.value;
  applyTheme(isDark.value);
  localStorage.setItem("studio-theme", isDark.value ? "dark" : "light");
}
</script>

<template>
  <div class="flex h-screen flex-col bg-app text-text-primary">
    <!-- Top bar -->
    <header
      class="flex h-12 shrink-0 items-center justify-between border-b border-line-subtle bg-panel px-3"
    >
      <div class="flex items-center gap-2">
        <span class="font-mono text-sm font-medium tracking-tight text-signal-accent">
          {{ t("app.brand") }}
        </span>
        <span class="text-text-muted">/</span>
        <span class="text-sm text-text-secondary">TavernHeadless</span>
      </div>

      <div class="flex items-center gap-4">
        <div class="hidden sm:block">
          <TopBarContext />
        </div>
        <UiIconButton :label="t('topbar.theme')" @click="toggleTheme">
          <Sun v-if="isDark" :size="16" :stroke-width="1.5" />
          <Moon v-else :size="16" :stroke-width="1.5" />
        </UiIconButton>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <!-- Left icon rail -->
      <nav
        class="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line-subtle bg-panel py-3"
      >
        <RouterLink
          v-for="item in navItems"
          :key="item.name"
          :to="item.to"
          :aria-label="item.label"
          :title="item.label"
          class="inline-flex size-9 items-center justify-center rounded-md transition-colors duration-150 hover:bg-float"
          :class="
            route.name === item.name
              ? 'bg-float text-signal-accent'
              : 'text-text-muted hover:text-text-secondary'
          "
        >
          <component :is="item.icon" :size="18" :stroke-width="1.5" />
        </RouterLink>
      </nav>

      <!-- Main -->
      <main class="min-w-0 flex-1 overflow-auto bg-app">
        <RouterView />
      </main>
    </div>
  </div>
</template>
