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
    <WorkspaceInspectorSection :title="props.t('inspector.memoryActivation')">
      <div class="rounded-r border border-l-2 border-l-signal-accent border-r-white/5 border-y-white/5 bg-white/[0.02] p-2">
        <WorkspaceInspectorDataPair
          label="MEM-291"
          label-class="font-mono text-[10px] text-zinc-500"
          value="92% Match"
          value-class="font-mono text-[10px] text-signal-accent"
        />
        <p class="text-xs text-zinc-300">{{ props.t("memory.item1") }}</p>
      </div>
      <div class="rounded-r border border-l-2 border-l-zinc-700 border-r-white/5 border-y-white/5 bg-white/[0.01] p-2 opacity-70">
        <WorkspaceInspectorDataPair
          label="WB-ENTRY-5"
          label-class="font-mono text-[10px] text-zinc-500"
          value="65% Match"
          value-class="font-mono text-[10px] text-zinc-500"
        />
        <p class="text-xs text-zinc-300">{{ props.t("memory.item2") }}</p>
      </div>
    </WorkspaceInspectorSection>
  </div>
</template>
