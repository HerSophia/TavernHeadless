<script setup lang="ts">
import {
  ArrowRightLeft,
  Download,
  Ellipsis,
  MessageSquare,
  Plus,
  PlugZap,
  SlidersHorizontal,
  SquarePen,
  Wrench
} from "lucide-vue-next";

import type { SessionState, WorkspaceAsset } from "../../stores/workspace";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  activeSessionIndex: number;
  currentPresetName: string;
  activeModelDetail: string;
  activeModelName: string;
  getSessionTitle: (session: SessionState | null) => string;
  libraryAssets: WorkspaceAsset[];
  sessions: SessionState[];
  showNavDrawer: boolean;
  desktopWidth: number;
  t: Translator;
}>();

const emit = defineEmits<{
  createSession: [];
  openContextMenu: [event: MouseEvent, index: number];
  openSession: [index: number];
  editCurrentPreset: [];
  switchCurrentPreset: [];
  exportCurrentPreset: [];
  openAssetBrowser: [];
  openLlmManager: [];
  openMcpManager: [];
  openToolManager: [];
}>();
</script>

<template>
  <nav
    class="border-r-subtle fixed inset-y-12 left-0 z-30 flex w-64 flex-col bg-[#09090b] transition-transform duration-200 lg:static lg:inset-auto lg:w-[var(--workspace-nav-width)] lg:translate-x-0"
    :class="props.showNavDrawer ? 'translate-x-0' : '-translate-x-full'"
    :style="{
      '--workspace-nav-width': `${props.desktopWidth}px`
    }"
  >
    <div class="flex-1 space-y-3 overflow-y-auto p-3">
      <section class="space-y-1">
        <div class="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">{{ props.t("nav.runtime") }}</div>

        <a href="#" class="flex items-center gap-3 rounded border border-white/5 bg-white/5 px-3 py-2 text-zinc-100">
          <MessageSquare class="h-4 w-4 text-signal-accent" />
          <span>{{ props.t("nav.sessions") }}</span>
        </a>

        <div class="mt-3 space-y-2 rounded border border-white/5 bg-white/[0.02] px-3 py-2">
          <div class="flex items-center justify-between">
            <div class="font-mono text-[10px] uppercase tracking-widest text-zinc-500">{{ props.t("nav.sessionList") }}</div>
            <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dynamic.sessionCount", { count: props.sessions.length }) }}</span>
          </div>
          <div class="font-mono text-[10px] text-zinc-600">{{ props.t("nav.sessionHint") }}</div>

          <div class="space-y-1">
            <button
              v-for="(session, index) in props.sessions"
              :key="session.id"
              class="session-item px-2 py-1.5 transition-colors"
              :class="index === props.activeSessionIndex ? 'border-signal-accent/40 bg-signal-accent/10 text-zinc-100' : 'text-zinc-400 hover:bg-white/5'"
              data-session-item
              type="button"
              @click="emit('openSession', index)"
              @contextmenu.prevent="emit('openContextMenu', $event, index)"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-[11px]">{{ props.t("dynamic.sessionLabel", { title: props.getSessionTitle(session) }) }}</span>
                <div class="flex items-center gap-2">
                  <span class="font-mono text-[10px] text-zinc-600">{{ session.id }}</span>
                  <Ellipsis class="session-item-kebab h-3 w-3 text-zinc-600" />
                </div>
              </div>

              <div
                v-if="session.archived"
                class="mt-1 font-mono text-[10px] text-signal-warn"
              >
                {{ props.t("dynamic.sessionArchived") }}
              </div>
            </button>
          </div>
        </div>

        <div class="mt-3 space-y-2 rounded border border-white/5 bg-white/[0.02] px-3 py-2">
          <div class="font-mono text-[10px] uppercase tracking-widest text-zinc-500">{{ props.t("nav.currentPreset") }}</div>
          <div class="flex items-center gap-2 text-xs text-zinc-300">
            <SlidersHorizontal class="h-3.5 w-3.5 text-signal-accent" />
            <span class="truncate">{{ props.currentPresetName || props.t("nav.currentPresetEmpty") }}</span>
          </div>
          <div class="font-mono text-[10px] text-zinc-600">{{ props.t("nav.currentPresetHint") }}</div>
          <div class="font-mono text-[10px] text-amber-300/80">{{ props.t("nav.presetCreateTip") }}</div>
          <div class="grid grid-cols-3 gap-1.5">
            <button
              class="btn-ghost justify-center px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="!props.currentPresetName"
              type="button"
              @click="emit('editCurrentPreset')"
            >
              <SquarePen class="h-3.5 w-3.5" />
              <span>{{ props.t("actions.editPreset") }}</span>
            </button>
            <button
              class="btn-ghost justify-center px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="!props.currentPresetName"
              type="button"
              @click="emit('switchCurrentPreset')"
            >
              <ArrowRightLeft class="h-3.5 w-3.5" />
              <span>{{ props.t("actions.switchPreset") }}</span>
            </button>
            <button
              class="btn-ghost justify-center px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="!props.currentPresetName"
              type="button"
              @click="emit('exportCurrentPreset')"
            >
              <Download class="h-3.5 w-3.5" />
              <span>{{ props.t("actions.exportPreset") }}</span>
            </button>
          </div>
        </div>

      </section>

      <section class="space-y-2">
        <div class="px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500">{{ props.t("nav.library") }}</div>
        <div class="space-y-2 rounded border border-white/5 bg-white/[0.02] p-3">
          <div class="flex items-center justify-between gap-2">
            <span class="font-mono text-[10px] uppercase tracking-widest text-zinc-500">{{ props.t("nav.assetBrowser") }}</span>
            <span class="font-mono text-[10px] text-zinc-600">{{ props.t("dynamic.assetCount", { count: props.libraryAssets.length }) }}</span>
          </div>
          <div class="font-mono text-[10px] text-zinc-600">{{ props.t("nav.assetBrowserHint") }}</div>
          <button class="btn-ghost w-full justify-center text-[11px]" type="button" @click="emit('openAssetBrowser')">
            <SlidersHorizontal class="h-3.5 w-3.5" />
            <span>{{ props.t("actions.openAssetBrowser") }}</span>
          </button>
        </div>
      </section>
    </div>

    <div class="mt-auto border-t-subtle p-4">
      <div class="mb-3 flex gap-2">
        <button class="btn-primary w-full" type="button" @click="emit('createSession')">
          <Plus class="h-4 w-4" />
          <span>{{ props.t("nav.newSession") }}</span>
        </button>
      </div>

      <div class="glass-panel flex flex-col gap-2 rounded p-3">
        <div class="flex items-center justify-between">
          <span class="data-label">{{ props.t("nav.activeModel") }}</span>
          <button class="btn-ghost px-2 py-1 text-[11px]" type="button" @click.stop="emit('openLlmManager')">
            {{ props.t("session.open") }}
          </button>
        </div>

        <button
          class="rounded border border-transparent bg-transparent p-0 text-left transition hover:border-white/10"
          type="button"
          @click="emit('openLlmManager')"
        >
          <div class="truncate font-mono text-xs text-zinc-300">{{ props.activeModelName }}</div>
          <div class="mt-1 truncate font-mono text-[10px] text-zinc-500">{{ props.activeModelDetail }}</div>
        </button>

        <div class="h-1 w-full overflow-hidden rounded bg-zinc-800">
          <div class="h-full w-[58%] bg-signal-info" />
        </div>
        <div class="font-mono text-[10px] text-zinc-500">
          {{ props.t("dialogs.llmManagerEntryHint") }}
        </div>

        <div class="grid grid-cols-3 gap-1.5 pt-1">
          <button class="btn-ghost justify-center px-2 py-1 text-[11px]" type="button" @click="emit('openLlmManager')">
            <SlidersHorizontal class="h-3.5 w-3.5" />
            <span>{{ props.t("nav.llmManager") }}</span>
          </button>
          <button class="btn-ghost justify-center px-2 py-1 text-[11px]" type="button" @click="emit('openToolManager')">
            <Wrench class="h-3.5 w-3.5" />
            <span>{{ props.t("nav.toolManager") }}</span>
          </button>
          <button class="btn-ghost justify-center px-2 py-1 text-[11px]" type="button" @click="emit('openMcpManager')">
            <PlugZap class="h-3.5 w-3.5" />
            <span>{{ props.t("nav.mcpManager") }}</span>
          </button>
        </div>
      </div>
    </div>
  </nav>
</template>
