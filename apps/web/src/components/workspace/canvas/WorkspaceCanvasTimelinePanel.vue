<script setup lang="ts">
import WorkspaceCanvasEmptyTimeline from "./WorkspaceCanvasEmptyTimeline.vue";
import WorkspaceCanvasTimelineRow from "./WorkspaceCanvasTimelineRow.vue";
import type { TimelineMessage } from "../../../stores/workspace";

type Translator = (key: string, vars?: Record<string, number | string>) => string;
type MessageRole = TimelineMessage["role"];

const props = defineProps<{
  activeTimeline: TimelineMessage[];
  canEditAndRegenerate: (message: TimelineMessage) => boolean;
  canRetryFloor: (message: TimelineMessage) => boolean;
  formatTime: (timestamp: number) => string;
  isAssistantSide: (role: MessageRole) => boolean;
  messageBadge: (role: MessageRole) => string;
  messageLabel: (role: MessageRole) => string;
  runtimeCharacterName: string;
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
  <div class="flex-1 space-y-8 overflow-y-auto p-8">
    <template v-if="props.activeTimeline.length === 0">
      <WorkspaceCanvasEmptyTimeline
        :runtime-character-name="props.runtimeCharacterName"
        :t="props.t"
      />
    </template>

    <WorkspaceCanvasTimelineRow
      v-for="message in props.activeTimeline"
      :key="message.id"
      :can-edit-and-regenerate="props.canEditAndRegenerate"
      :can-retry-floor="props.canRetryFloor"
      :format-time="props.formatTime"
      :is-assistant-side="props.isAssistantSide"
      :message="message"
      :message-badge="props.messageBadge"
      :message-label="props.messageLabel"
      :t="props.t"
      @delete-message="emit('deleteMessage', $event)"
      @edit-and-regenerate="emit('editAndRegenerate', $event)"
      @edit-message="emit('editMessage', $event)"
      @retry-floor="emit('retryFloor', $event)"
    />
  </div>
</template>
