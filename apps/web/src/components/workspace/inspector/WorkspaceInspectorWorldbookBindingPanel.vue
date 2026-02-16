<script setup lang="ts">
type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  t: Translator;
}>();

const emit = defineEmits<{
  attachWorldbook: [];
}>();
</script>

<template>
  <div class="space-y-2 border-t border-white/5 pt-2">
    <div class="flex items-center justify-between">
      <span class="data-label">{{ props.t("inspector.worldbooks") }}</span>
      <button class="rounded border border-teal-500/20 px-2 py-0.5 font-mono text-[10px] text-teal-300" type="button" @click="emit('attachWorldbook')">{{ props.t("actions.attach") }}</button>
    </div>
    <div class="font-mono text-xs text-zinc-400">1. artifacts-core (priority 80)</div>
    <div class="font-mono text-xs text-zinc-500">2. museum-security (priority 40)</div>
    <div class="text-[10px] text-zinc-500">{{ props.t("inspector.worldbookHint") }}</div>
  </div>
</template>
