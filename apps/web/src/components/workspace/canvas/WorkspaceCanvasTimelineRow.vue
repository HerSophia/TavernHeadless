<script setup lang="ts">
import { Clock3, Cpu, Pencil, RefreshCcw, Sparkles, Trash2, Zap } from "lucide-vue-next";

import MarkdownBlock from "../MarkdownBlock.vue";
import type { TimelineMessage } from "../../../stores/workspace";
import WorkspaceCanvasTimelineActionButton from "./WorkspaceCanvasTimelineActionButton.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

type MessageRole = TimelineMessage["role"];

const props = defineProps<{
  canEditAndRegenerate: (message: TimelineMessage) => boolean;
  canRetryFloor: (message: TimelineMessage) => boolean;
  formatTime: (timestamp: number) => string;
  isAssistantSide: (role: MessageRole) => boolean;
  message: TimelineMessage;
  messageBadge: (role: MessageRole) => string;
  messageLabel: (role: MessageRole) => string;
  t: Translator;
}>();

const emit = defineEmits<{
  deleteMessage: [messageId: string];
  editAndRegenerate: [messageId: string];
  editMessage: [messageId: string];
  retryFloor: [messageId: string];
}>();
</script>

<template>
  <div class="group flex gap-4">
    <div
      class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border font-mono text-xs"
      :class="props.isAssistantSide(props.message.role) ? 'border-indigo-500/30 bg-indigo-900/30 text-indigo-300' : 'border-white/10 bg-zinc-800 text-zinc-400'"
    >
      {{ props.messageBadge(props.message.role) }}
    </div>
    <div class="max-w-3xl flex-1 space-y-2">
      <div class="flex items-center justify-between gap-2">
        <span class="min-w-0 truncate text-xs font-bold" :class="props.isAssistantSide(props.message.role) ? 'text-signal-accent' : 'text-zinc-400'">
          {{ props.messageLabel(props.message.role) }}
        </span>
        <div class="flex shrink-0 items-center gap-2">
          <span class="font-mono text-[10px] text-zinc-600">{{ props.formatTime(props.message.at) }}</span>
          <WorkspaceCanvasTimelineActionButton :disabled="props.message.streaming" tone="neutral" @click="emit('editMessage', props.message.id)">
            <Pencil class="h-3 w-3" />
          </WorkspaceCanvasTimelineActionButton>
          <WorkspaceCanvasTimelineActionButton v-if="props.canEditAndRegenerate(props.message)" :disabled="!props.canEditAndRegenerate(props.message)" tone="sky" @click="emit('editAndRegenerate', props.message.id)">
            <Sparkles class="h-3 w-3" />
          </WorkspaceCanvasTimelineActionButton>
          <WorkspaceCanvasTimelineActionButton v-if="props.canRetryFloor(props.message)" :disabled="!props.canRetryFloor(props.message)" tone="teal" @click="emit('retryFloor', props.message.id)">
            <RefreshCcw class="h-3 w-3" />
          </WorkspaceCanvasTimelineActionButton>
          <WorkspaceCanvasTimelineActionButton :disabled="props.message.streaming" tone="danger" @click="emit('deleteMessage', props.message.id)">
            <Trash2 class="h-3 w-3" />
          </WorkspaceCanvasTimelineActionButton>
        </div>
      </div>
      <MarkdownBlock
        class="leading-relaxed"
        :class="props.isAssistantSide(props.message.role) ? 'text-zinc-100' : 'text-zinc-300'"
        :content="props.message.content"
        :format="props.message.contentFormat"
      />
      <div
        v-if="props.message.role === 'assistant'"
        class="mt-2 border-t border-white/5 pt-2 font-mono text-[10px]"
      >
        <span v-if="props.message.streaming" class="animate-pulse text-signal-accent">{{ props.t("main.sending") }}</span>
        <div v-else class="flex gap-4 text-zinc-500">
          <span class="flex items-center gap-1"><Clock3 class="h-3 w-3" /> {{ props.message.latencyMs ?? 0 }}ms</span>
          <span class="flex items-center gap-1"><Cpu class="h-3 w-3" /> {{ props.message.tokens ?? 0 }} tok</span>
          <span class="flex items-center gap-1 text-signal-accent"><Zap class="h-3 w-3" /> {{ props.message.source === "remote" ? "Synced" : "Local" }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
