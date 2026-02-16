<script setup lang="ts">
import WorkspaceInspectorDataPair from "./WorkspaceInspectorDataPair.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  runtimeUserName: string;
  t: Translator;
}>();

const emit = defineEmits<{
  applyUserAsset: [];
  replaceUser: [];
}>();
</script>

<template>
  <div class="space-y-2 border-t border-white/5 pt-2">
    <WorkspaceInspectorDataPair
      :label="props.t('inspector.userBinding')"
      label-class="data-label"
      :value="props.t('inspector.applied')"
      value-class="font-mono text-[10px] text-signal-success"
    />
    <div class="flex items-center justify-between">
      <span class="text-xs text-zinc-300">{{ props.runtimeUserName }}</span>
      <button class="rounded border border-zinc-700 px-2 py-0.5 font-mono text-[10px] text-zinc-400 hover:text-zinc-200" type="button" @click="emit('replaceUser')">{{ props.t("actions.replace") }}</button>
    </div>
    <div class="text-[10px] text-zinc-500">{{ props.t("inspector.userBindingHint") }}</div>
    <button class="rounded border border-sky-500/20 px-2 py-0.5 font-mono text-[10px] text-sky-300" type="button" @click="emit('applyUserAsset')">{{ props.t("actions.applyAssetUpdate") }}</button>
  </div>
</template>
