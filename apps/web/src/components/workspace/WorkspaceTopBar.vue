<script setup lang="ts">
import {
  Bell,
  Box,
  Building2,
  ChevronDown,
  Menu,
  PanelRightOpen,
  Settings,
  Users
} from "lucide-vue-next";

type Locale = "zh-CN" | "en";

type Props = {
  accountMode: "single" | "multi";
  apiStatus: string;
  currentAccount: string;
  lang: Locale;
  t: (key: string, vars?: Record<string, number | string>) => string;
};

defineProps<Props>();

defineEmits<{
  "switch-account": [];
  "toggle-inspector-drawer": [];
  "toggle-lang": [];
  "toggle-nav-drawer": [];
}>();
</script>

<template>
  <div class="flex w-full items-center justify-between gap-1.5">
    <div class="flex min-w-0 flex-1 items-center gap-1 sm:gap-3">
      <button
        class="btn-ghost shrink-0 whitespace-nowrap px-2 max-[379px]:px-1.5 lg:hidden"
        type="button"
        @click="$emit('toggle-nav-drawer')"
      >
        <Menu class="h-4 w-4" />
        <span class="hidden sm:inline">{{ t("header.openRuntime") }}</span>
      </button>

      <div class="flex min-w-0 items-center gap-2 text-zinc-100">
        <Box class="h-4 w-4 shrink-0 text-signal-accent sm:h-5 sm:w-5" />
        <span class="truncate text-sm font-semibold tracking-tight sm:text-base">Tavern<span class="hidden font-light opacity-50 sm:inline">Headless</span></span>
      </div>

      <div class="hidden h-4 w-px bg-white/10 lg:block" />

      <div class="hidden min-w-0 items-center gap-2 font-mono text-xs text-zinc-400 lg:flex">
        <span class="h-2 w-2 rounded-full bg-signal-success shadow-[0_0_8px_rgba(74,222,128,0.5)]" />
        <span class="rounded border border-sky-400/30 px-1 py-0.5 text-sky-300">{{ accountMode === "multi" ? t("status.accountMode") : "ACCOUNT_MODE=single" }}</span>
        <span class="text-zinc-600">|</span>
        <span>{{ t("status.engineOnline") }}</span>
        <span class="text-zinc-600">|</span>
        <span>WS: 45ms</span>
        <span class="text-zinc-600">|</span>
        <span class="max-w-[220px] truncate">{{ apiStatus }}</span>
      </div>
    </div>

    <div class="ml-1.5 flex shrink-0 items-center">
      <div class="hidden items-center gap-1 lg:flex">
        <button
          v-if="accountMode === 'multi'"
          class="btn-ghost max-w-[8.75rem] whitespace-nowrap px-2"
          type="button"
          @click="$emit('switch-account')"
        >
          <Building2 class="h-4 w-4 text-signal-info" />
          <span class="hidden font-mono text-xs text-zinc-400 min-[380px]:inline">acct:</span>
          <span class="max-w-[5rem] truncate font-mono text-xs sm:max-w-[9rem]">{{ currentAccount }}</span>
          <ChevronDown class="h-3 w-3" />
        </button>

        <button class="btn-ghost" type="button">
          <Users class="h-4 w-4" />
          <span class="font-mono text-xs">{{ t("header.users") }}</span>
        </button>

        <button class="btn-ghost" type="button" @click="$emit('toggle-lang')">
          {{ lang === "zh-CN" ? "EN" : "中" }}
        </button>

        <button class="btn-ghost" type="button">
          <Settings class="h-4 w-4" />
        </button>

        <button class="btn-ghost" type="button">
          <Bell class="h-4 w-4" />
        </button>
      </div>

      <button
        class="btn-ghost ml-1 shrink-0 whitespace-nowrap px-2 max-[379px]:px-1.5 lg:hidden"
        type="button"
        @click="$emit('toggle-inspector-drawer')"
      >
        <PanelRightOpen class="h-4 w-4" />
        <span class="hidden sm:inline">{{ t("header.openInspector") }}</span>
      </button>
    </div>
  </div>
</template>
