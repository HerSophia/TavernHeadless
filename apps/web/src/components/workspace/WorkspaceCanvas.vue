<script setup lang="ts">
import { useWorkspaceCanvasMessages } from "../../composables/workspace/messages";
import WorkspaceCanvasComposer from "./canvas/WorkspaceCanvasComposer.vue";
import WorkspaceCanvasSessionHeader from "./canvas/WorkspaceCanvasSessionHeader.vue";
import WorkspaceCanvasTimelinePanel from "./canvas/WorkspaceCanvasTimelinePanel.vue";
import type { SessionState, TimelineMessage } from "../../stores/workspace";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  activeSession: SessionState | null;
  activeTimeline: TimelineMessage[];
  currentAccount: string;
  formatTime: (timestamp: number) => string;
  getSessionTitle: (session: SessionState | null) => string;
  isStreaming: boolean;
  messageInput: string;
  runtimeCharacterName: string;
  runtimeUserName: string;
  runtimeWorldbookCount: number;
  t: Translator;
}>();

const emit = defineEmits<{
  attachWorldbook: [];
  composerKeydown: [event: KeyboardEvent];
  detachWorldbook: [];
  replaceUser: [];
  sendMessage: [];
  "update:messageInput": [value: string];
  deleteMessage: [messageId: string];
  editMessage: [messageId: string];
  editAndRegenerate: [messageId: string];
  retryFloor: [messageId: string];
}>();

const {
  canEditAndRegenerate,
  canRetryFloor,
  handleInput,
  isAssistantSide,
  messageBadge,
  messageLabel
} = useWorkspaceCanvasMessages({
  onUpdateMessageInput(value) {
    emit("update:messageInput", value);
  },
  resolveRuntimeCharacterName() {
    return props.runtimeCharacterName;
  },
  t: props.t
});
</script>

<template>
  <main class="relative flex min-w-0 flex-1 flex-col bg-[#050505]">
    <WorkspaceCanvasSessionHeader
      :current-account="props.currentAccount"
      :runtime-character-name="props.runtimeCharacterName"
      :runtime-user-name="props.runtimeUserName"
      :runtime-worldbook-count="props.runtimeWorldbookCount"
      :session-id="props.activeSession?.id ?? '-'"
      :session-title="props.getSessionTitle(props.activeSession)"
      :t="props.t"
      @attach-worldbook="emit('attachWorldbook')"
      @detach-worldbook="emit('detachWorldbook')"
      @replace-user="emit('replaceUser')"
    />

    <WorkspaceCanvasTimelinePanel
      :active-timeline="props.activeTimeline"
      :can-edit-and-regenerate="canEditAndRegenerate"
      :can-retry-floor="canRetryFloor"
      :format-time="props.formatTime"
      :is-assistant-side="isAssistantSide"
      :message-badge="messageBadge"
      :message-label="messageLabel"
      :runtime-character-name="props.runtimeCharacterName"
      :t="props.t"
      @delete-message="emit('deleteMessage', $event)"
      @edit-and-regenerate="emit('editAndRegenerate', $event)"
      @edit-message="emit('editMessage', $event)"
      @retry-floor="emit('retryFloor', $event)"
    />

    <WorkspaceCanvasComposer
      :is-streaming="props.isStreaming"
      :message-input="props.messageInput"
      :on-input="handleInput"
      :t="props.t"
      @composer-keydown="emit('composerKeydown', $event)"
      @send-message="emit('sendMessage')"
    />
  </main>
</template>
