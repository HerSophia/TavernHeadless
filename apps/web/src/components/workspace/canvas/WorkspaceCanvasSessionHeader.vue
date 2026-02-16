<script setup lang="ts">
type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  currentAccount: string;
  runtimeCharacterName: string;
  runtimeUserName: string;
  runtimeWorldbookCount: number;
  sessionId: string;
  sessionTitle: string;
  t: Translator;
}>();

const emit = defineEmits<{
  attachWorldbook: [];
  detachWorldbook: [];
  replaceUser: [];
}>();
</script>

<template>
  <div class="border-b-subtle flex h-10 items-center justify-between gap-2 bg-[#09090b] px-4">
    <div class="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
      <span class="text-sm font-medium text-zinc-300">{{ props.t("dynamic.sessionTitle", { title: props.sessionTitle }) }}</span>
      <span class="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">{{ props.t("dynamic.sessionId", { id: props.sessionId }) }}</span>
      <span class="rounded border border-teal-500/20 bg-teal-500/10 px-2 py-0.5 font-mono text-[10px] text-teal-300">Character: {{ props.runtimeCharacterName }}</span>
      <span class="rounded border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 font-mono text-[10px] text-sky-300">{{ props.t("dynamic.sessionAccount", { account: props.currentAccount }) }}</span>
      <span class="rounded border border-sky-500/20 bg-sky-500/10 px-2 py-0.5 font-mono text-[10px] text-sky-300">{{ props.t("dynamic.sessionUser", { user: props.runtimeUserName }) }}</span>
      <span class="rounded border border-zinc-700 bg-zinc-800/70 px-2 py-0.5 font-mono text-[10px] text-zinc-400">{{ props.t("dynamic.sessionWorldbooks", { count: props.runtimeWorldbookCount }) }}</span>
    </div>

    <div class="hidden shrink-0 gap-2 lg:flex">
      <button class="rounded border border-teal-500/20 bg-teal-500/10 p-1.5 font-mono text-[10px] text-teal-300 transition-colors hover:bg-teal-500/15" type="button" @click="emit('attachWorldbook')">{{ props.t("main.attach") }}</button>
      <button class="rounded border border-zinc-700 p-1.5 font-mono text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200" type="button" @click="emit('replaceUser')">{{ props.t("main.replaceUser") }}</button>
      <button class="rounded border border-zinc-700 p-1.5 font-mono text-[10px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200" type="button" @click="emit('detachWorldbook')">{{ props.t("main.detachAsset") }}</button>
    </div>
  </div>
</template>
