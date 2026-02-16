<script setup lang="ts">
import { Clock3, Cpu, Zap } from "lucide-vue-next";

import { EMPTY_TIMELINE_SAMPLE } from "../../../composables/workspace/messages";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  runtimeCharacterName: string;
  t: Translator;
}>();
</script>

<template>
  <div class="group flex gap-4">
    <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-800 font-mono text-xs text-zinc-400">USR</div>
    <div class="max-w-3xl flex-1 space-y-1">
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold text-zinc-400">{{ props.t("chat.user") }}</span>
        <span class="font-mono text-[10px] text-zinc-600">10:42 AM</span>
      </div>
      <div class="leading-relaxed text-zinc-300">{{ EMPTY_TIMELINE_SAMPLE.user }}</div>
    </div>
  </div>

  <div class="group flex gap-4">
    <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-indigo-500/30 bg-indigo-900/30 font-mono text-xs text-indigo-300">AI</div>
    <div class="max-w-3xl flex-1 space-y-2">
      <div class="flex items-center gap-2">
        <span class="text-xs font-bold text-signal-accent">{{ props.runtimeCharacterName }}</span>
        <span class="font-mono text-[10px] text-zinc-600">10:42 AM</span>
      </div>
      <div class="leading-relaxed text-zinc-100">
        <p>{{ EMPTY_TIMELINE_SAMPLE.assistant[0] }}</p>
        <p class="mt-2">{{ EMPTY_TIMELINE_SAMPLE.assistant[1] }}</p>
      </div>
      <div class="mt-2 flex gap-4 border-t border-white/5 pt-2 font-mono text-[10px] text-zinc-500">
        <span class="flex items-center gap-1"><Clock3 class="h-3 w-3" /> 1.2s</span>
        <span class="flex items-center gap-1"><Cpu class="h-3 w-3" /> 240 tok</span>
        <span class="flex items-center gap-1 text-signal-accent"><Zap class="h-3 w-3" /> Cache Hit</span>
      </div>
    </div>
  </div>
</template>
