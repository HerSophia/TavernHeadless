<script setup lang="ts">
import type { RespondStreamState } from "@tavern/client-helpers";
import {
  Bell,
  Building2,
  ChevronDown,
  Settings,
  Users
} from "lucide-vue-next";
import {
  type WorkspaceInspectorTab
} from "../../composables/workspace/shell";
import WorkspaceInspectorBindingsPanel from "./inspector/WorkspaceInspectorBindingsPanel.vue";
import WorkspaceInspectorEventsPanel from "./inspector/WorkspaceInspectorEventsPanel.vue";
import WorkspaceInspectorImpactPanel from "./inspector/WorkspaceInspectorImpactPanel.vue";
import WorkspaceInspectorMemoryPanel from "./inspector/WorkspaceInspectorMemoryPanel.vue";
import WorkspaceInspectorToolsPanel from "./inspector/WorkspaceInspectorToolsPanel.vue";
import WorkspaceInspectorTabStrip from "./inspector/WorkspaceInspectorTabStrip.vue";
import type { WorkspaceEvent } from "../../stores/workspace-ui";
import type { TimelineMessage } from "../../stores/workspace";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  accountMode: "single" | "multi";
  activeTab: WorkspaceInspectorTab;
  bindingFlash: boolean;
  activeSessionId: string | null;
  activeTimeline: TimelineMessage[];
  currentAccount: string;
  lang: "zh-CN" | "en";
  events: WorkspaceEvent[];
  runtimeCharacterName: string;
  runtimeUserName: string;
  respondStreamState: RespondStreamState;
  showInspectorDrawer: boolean;
  desktopWidth: number;
  t: Translator;
}>();

const emit = defineEmits<{
  applyUserAsset: [];
  attachWorldbook: [];
  replaceUser: [];
  setActiveTab: [tab: WorkspaceInspectorTab];
  switchAccount: [];
  toggleLang: [];
}>();
</script>

<template>
  <aside
    class="border-l-subtle fixed inset-y-12 right-0 z-40 flex w-80 flex-col bg-[#09090b] transition-transform duration-200 lg:static lg:inset-auto lg:w-[var(--workspace-inspector-width)] lg:translate-x-0"
    :class="props.showInspectorDrawer ? 'translate-x-0' : 'translate-x-full'"
    :style="{
      '--workspace-inspector-width': `${props.desktopWidth}px`
    }"
    @click.stop
  >
    <div class="border-b-subtle p-2 lg:hidden">
      <div class="flex items-center gap-1">
        <button
          v-if="props.accountMode === 'multi'"
          class="btn-ghost min-w-0 flex-1 justify-between px-2"
          type="button"
          @click="emit('switchAccount')"
        >
          <span class="flex min-w-0 items-center gap-1.5">
            <Building2 class="h-4 w-4 shrink-0 text-signal-info" />
            <span class="font-mono text-xs text-zinc-400">acct:</span>
            <span class="truncate font-mono text-xs text-zinc-200">{{ props.currentAccount }}</span>
          </span>
          <ChevronDown class="h-3 w-3" />
        </button>

        <button
          class="btn-ghost shrink-0 px-2"
          type="button"
          @click="emit('toggleLang')"
        >
          {{ props.lang === "zh-CN" ? "EN" : "中" }}
        </button>
      </div>

      <div class="mt-2 flex items-center gap-1">
        <button class="btn-ghost flex-1 justify-center px-2" type="button">
          <Users class="h-4 w-4" />
          <span class="font-mono text-xs">{{ props.t("header.users") }}</span>
        </button>

        <button class="btn-ghost shrink-0 px-2" type="button">
          <Settings class="h-4 w-4" />
        </button>

        <button class="btn-ghost shrink-0 px-2" type="button">
          <Bell class="h-4 w-4" />
        </button>
      </div>
    </div>

    <WorkspaceInspectorTabStrip
      :active-tab="props.activeTab"
      :t="props.t"
      @set-active-tab="emit('setActiveTab', $event)"
    />

    <div class="flex-1 overflow-y-auto p-4">
      <WorkspaceInspectorBindingsPanel
        v-if="props.activeTab === 'bindings'"
        :binding-flash="props.bindingFlash"
        :active-session-id="props.activeSessionId"
        :active-timeline="props.activeTimeline"
        :current-account="props.currentAccount"
        :runtime-character-name="props.runtimeCharacterName"
        :runtime-user-name="props.runtimeUserName"
        :t="props.t"
        @apply-user-asset="emit('applyUserAsset')"
        @attach-worldbook="emit('attachWorldbook')"
        @replace-user="emit('replaceUser')"
      />
      <WorkspaceInspectorToolsPanel v-else-if="props.activeTab === 'tools'" :state="props.respondStreamState" :t="props.t" />
      <WorkspaceInspectorMemoryPanel
        v-else-if="props.activeTab === 'memory'"
        :active-session-id="props.activeSessionId"
        :current-account="props.currentAccount"
        :t="props.t"
      />
      <WorkspaceInspectorImpactPanel v-else :t="props.t" />
    </div>

    <WorkspaceInspectorEventsPanel :events="props.events" :t="props.t" />
  </aside>
</template>
