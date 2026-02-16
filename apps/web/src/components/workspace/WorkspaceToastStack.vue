<script setup lang="ts">
import type { WorkspaceToast } from "../../stores/workspace-ui";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  formatTime: (timestamp: number) => string;
  t: Translator;
  toasts: WorkspaceToast[];
}>();
</script>

<template>
  <div class="pointer-events-none fixed right-4 top-16 z-[70] flex w-[320px] flex-col gap-2">
    <div
      v-for="toast in props.toasts"
      :key="toast.id"
      class="rounded border px-3 py-2 text-xs backdrop-blur-sm"
      :class="{
        'border-sky-400/35 bg-sky-500/10 text-sky-200': toast.tone === 'info',
        'border-emerald-400/35 bg-emerald-500/10 text-emerald-200': toast.tone === 'success',
        'border-amber-400/35 bg-amber-500/10 text-amber-200': toast.tone === 'warn'
      }"
    >
      <div class="font-mono text-[10px] opacity-70">{{ props.formatTime(toast.at) }}</div>
      <div class="mt-1">{{ props.t(toast.key, toast.vars) }}</div>
    </div>
  </div>
</template>
