<script setup lang="ts">
import { RefreshCw } from "lucide-vue-next";
import { computed, ref, watch } from "vue";

import type { PromptRuntimeModeView } from "@tavern/sdk";

import { useWorkspaceInspectorPromptMode } from "../../../composables/workspace/inspector/prompt-mode";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const INHERIT_OPTION = "__inherit__";

const props = defineProps<{
  activeSessionId: string | null;
  currentAccount: string;
  t: Translator;
}>();

const { error, loading, mode, refresh, saving, updateMode } = useWorkspaceInspectorPromptMode({
  accountId: computed(() => props.currentAccount),
  sessionId: computed(() => props.activeSessionId),
});

const draftMode = ref<string>(INHERIT_OPTION);

watch(
  mode,
  (value) => {
    draftMode.value = value?.sessionPromptMode ?? INHERIT_OPTION;
  },
  { immediate: true },
);

const dirty = computed(() => normalizeDraftMode(draftMode.value) !== (mode.value?.sessionPromptMode ?? null));

async function applyMode(): Promise<void> {
  await updateMode(normalizeDraftMode(draftMode.value));
}

function normalizeDraftMode(value: string): PromptRuntimeModeView["sessionPromptMode"] {
  if (value === "compat_strict" || value === "compat_plus" || value === "native") {
    return value;
  }

  return null;
}

function formatMode(value: PromptRuntimeModeView["sessionPromptMode"] | null | undefined): string {
  return value ?? props.t("inspector.promptModeInherit");
}

function formatSource(value: PromptRuntimeModeView["source"] | undefined): string {
  switch (value) {
    case "session":
      return props.t("inspector.promptModeSourceSession");
    case "legacy_metadata":
      return props.t("inspector.promptModeSourceLegacyMetadata");
    case "default":
      return props.t("inspector.promptModeSourceDefault");
    default:
      return "—";
  }
}

function formatBoolean(value: boolean | undefined): string {
  if (value === undefined) {
    return "—";
  }

  return value ? props.t("common.yes") : props.t("common.no");
}
</script>

<template>
  <div class="space-y-2 border-t border-white/5 pt-2">
    <div class="flex items-center justify-between">
      <span class="data-label">{{ props.t("inspector.promptMode") }}</span>
      <button
        class="rounded border border-white/10 p-1 text-zinc-500 transition hover:border-white/20 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="loading || saving || !props.activeSessionId"
        :title="props.t('actions.refresh')"
        type="button"
        @click="void refresh()"
      >
        <RefreshCw class="h-3 w-3" :class="loading ? 'animate-spin' : ''" />
      </button>
    </div>

    <div v-if="!props.activeSessionId" class="text-[10px] text-zinc-500">
      {{ props.t("inspector.promptModeNoSession") }}
    </div>

    <template v-else>
      <div v-if="error" class="rounded border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-200">
        {{ props.t("inspector.promptModeError") }}: {{ error }}
      </div>

      <div v-else-if="loading && !mode" class="text-[10px] text-zinc-500">
        {{ props.t("inspector.promptModeLoading") }}
      </div>

      <template v-else>
        <div class="space-y-2 rounded border border-white/5 bg-white/[0.02] p-2">
          <label class="block text-[10px] uppercase tracking-wide text-zinc-500">
            {{ props.t("inspector.promptModeSelection") }}
          </label>

          <select
            v-model="draftMode"
            class="w-full rounded border border-white/10 bg-[#09090b] px-2 py-1 text-xs text-zinc-200 outline-none transition focus:border-sky-400/50"
          >
            <option :value="INHERIT_OPTION">{{ props.t("inspector.promptModeInherit") }}</option>
            <option value="compat_strict">{{ props.t("inspector.promptModeOptionCompatStrict") }}</option>
            <option value="compat_plus">{{ props.t("inspector.promptModeOptionCompatPlus") }}</option>
            <option value="native">{{ props.t("inspector.promptModeOptionNative") }}</option>
          </select>

          <div class="flex justify-end">
            <button
              class="rounded border border-sky-500/20 px-2 py-0.5 font-mono text-[10px] text-sky-300 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="loading || saving || !dirty"
              type="button"
              @click="void applyMode()"
            >
              {{ saving ? props.t("inspector.promptModeSaving") : props.t("actions.apply") }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs text-zinc-300">
          <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.promptModeExplicit") }}</span>
          <span class="text-right font-mono text-[10px] text-zinc-300">{{ formatMode(mode?.sessionPromptMode) }}</span>

          <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.promptModeEffective") }}</span>
          <span class="text-right font-mono text-[10px] text-zinc-300">{{ mode?.effectivePromptMode ?? "—" }}</span>

          <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.promptModeSource") }}</span>
          <span class="text-right font-mono text-[10px] text-zinc-300">{{ formatSource(mode?.source) }}</span>

          <span class="font-mono text-[10px] text-zinc-500">{{ props.t("inspector.promptModeLegacyFallback") }}</span>
          <span class="text-right font-mono text-[10px] text-zinc-300">{{ formatBoolean(mode?.legacyFallback) }}</span>
        </div>

        <div v-if="mode?.sessionPromptMode === null" class="text-[10px] text-zinc-500">
          {{ props.t("inspector.promptModeFallbackHint") }}
        </div>
      </template>
    </template>
  </div>
</template>
