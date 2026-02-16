<script setup lang="ts">
import { Send } from "lucide-vue-next";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  isStreaming: boolean;
  messageInput: string;
  onInput: (event: Event) => void;
  t: Translator;
}>();

const emit = defineEmits<{
  composerKeydown: [event: KeyboardEvent];
  sendMessage: [];
}>();
</script>

<template>
  <div class="border-t-subtle bg-[#09090b] p-4">
    <div class="group relative">
      <textarea
        class="w-full resize-none rounded-lg border border-zinc-800 bg-[#121215] p-3 text-sm text-zinc-200 placeholder-zinc-600 transition-all focus:border-signal-accent focus:outline-none focus:ring-1 focus:ring-signal-accent/20"
        rows="3"
        :value="props.messageInput"
        :placeholder="props.t('main.inputPlaceholder')"
        @input="props.onInput"
        @keydown="emit('composerKeydown', $event)"
      />
      <div class="absolute bottom-3 right-3 flex gap-2">
        <button class="btn-primary" type="button" :disabled="props.isStreaming" @click="emit('sendMessage')">
          <Send class="h-4 w-4" />
          <span>{{ props.isStreaming ? props.t("main.sending") : props.t("main.send") }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
