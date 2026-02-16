<script setup lang="ts">
import WorkspaceInspectorDataPair from "./WorkspaceInspectorDataPair.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  runtimeCharacterName: string;
  t: Translator;
}>();
</script>

<template>
  <div class="space-y-2 border-t border-white/5 pt-2">
    <WorkspaceInspectorDataPair
      :label="props.t('inspector.characterBinding')"
      label-class="data-label"
      :value="props.t('inspector.applied')"
      value-class="font-mono text-[10px] text-signal-success"
    />
    <div class="flex items-center justify-between">
      <span class="text-xs text-zinc-300">{{ props.runtimeCharacterName }}</span>
      <button class="rounded border border-zinc-700 px-2 py-0.5 font-mono text-[10px] text-zinc-400 hover:text-zinc-200" type="button">{{ props.t("actions.replace") }}</button>
    </div>
  </div>
</template>
