<script setup lang="ts">
import WorkspaceInspectorDataPair from "./WorkspaceInspectorDataPair.vue";
import WorkspaceInspectorSection from "./WorkspaceInspectorSection.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  t: Translator;
}>();
</script>

<template>
  <div class="space-y-6">
    <WorkspaceInspectorSection :title="props.t('impact.title')">
      <div class="space-y-2 rounded border border-white/5 bg-[#121215] p-3">
        <div class="text-[10px] text-zinc-500">{{ props.t("impact.deleteHint") }}</div>
        <WorkspaceInspectorDataPair
          :label="props.t('impact.affectedSessions')"
          label-class="text-xs text-zinc-400"
          value="12"
          value-class="font-mono text-xs text-zinc-200"
        />
        <WorkspaceInspectorDataPair
          :label="props.t('impact.affectedFloors')"
          label-class="text-xs text-zinc-400"
          value="64"
          value-class="font-mono text-xs text-zinc-200"
        />
        <button class="w-full rounded border border-signal-warn/30 px-2 py-1 font-mono text-[10px] text-signal-warn" type="button">{{ props.t("impact.disableFirst") }}</button>
      </div>
    </WorkspaceInspectorSection>

    <WorkspaceInspectorSection :title="props.t('impact.tokenUsage')">
      <div class="flex h-16 items-end gap-px opacity-80">
        <div class="h-[20%] w-1 bg-zinc-800" />
        <div class="h-[30%] w-1 bg-zinc-800" />
        <div class="h-[25%] w-1 bg-zinc-800" />
        <div class="h-[40%] w-1 bg-zinc-800" />
        <div class="h-[35%] w-1 bg-zinc-800" />
        <div class="h-[50%] w-1 bg-zinc-700" />
        <div class="h-[60%] w-1 bg-zinc-700" />
        <div class="h-[55%] w-1 bg-zinc-700" />
        <div class="h-[70%] w-1 bg-zinc-600" />
        <div class="h-[85%] w-1 bg-zinc-600" />
        <div class="h-[90%] w-1 bg-signal-accent" />
      </div>
    </WorkspaceInspectorSection>
  </div>
</template>
