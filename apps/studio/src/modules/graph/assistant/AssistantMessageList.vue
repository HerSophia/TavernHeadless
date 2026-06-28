<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { AssistantMessage, AssistantStreamState } from "../../../stores/graph-assistant";

const props = defineProps<{
  messages: AssistantMessage[];
  stream: AssistantStreamState;
  loading?: boolean;
}>();

const { t, te } = useI18n();

const scroller = ref<HTMLElement | null>(null);

function roleLabel(role: string): string {
  const key = `graphAssistant.role.${role}`;
  return te(key) ? t(key) : role;
}

function isUser(role: string): boolean {
  return role === "user";
}

function scrollToBottom(): void {
  const el = scroller.value;
  if (el) {
    el.scrollTop = el.scrollHeight;
  }
}

watch(
  () => [props.messages.length, props.stream.text, props.stream.active] as const,
  () => {
    void nextTick(scrollToBottom);
  },
);
</script>

<template>
  <div ref="scroller" class="min-h-0 flex-1 overflow-auto">
    <!-- 加载骨架 -->
    <div v-if="loading && messages.length === 0" class="space-y-3 p-3">
      <div class="h-12 w-full animate-pulse rounded bg-float" />
      <div class="h-20 w-full animate-pulse rounded bg-float" />
    </div>

    <!-- 空态引导 -->
    <div
      v-else-if="messages.length === 0 && !stream.active"
      class="flex h-full items-center justify-center p-6"
    >
      <p class="max-w-xs text-center text-xs leading-relaxed text-text-muted">
        {{ t("graphAssistant.emptyHint") }}
      </p>
    </div>

    <div v-else class="px-3 py-3">
      <div
        v-for="message in messages"
        :key="message.id"
        class="msg"
        :class="isUser(message.role) ? 'msg--user' : 'msg--assistant'"
      >
        <div class="msg__meta">
          <span class="msg__role">{{ roleLabel(message.role) }}</span>
        </div>
        <div class="msg__content">{{ message.content }}</div>
      </div>

      <!-- 流式临时气泡：乐观回显用户输入 + 正在生成的助手正文 -->
      <template v-if="stream.active">
        <div class="msg msg--user">
          <div class="msg__meta"><span class="msg__role">{{ roleLabel("user") }}</span></div>
          <div class="msg__content">{{ stream.pendingUserText }}</div>
        </div>
        <div class="msg msg--assistant">
          <div class="msg__meta">
            <span class="msg__role">{{ roleLabel("assistant") }}</span>
            <span v-if="!stream.text && !stream.error" class="msg__phase">
              <span class="msg__pulse" aria-hidden="true" />
              {{ t("graphAssistant.thinking") }}
            </span>
          </div>
          <div v-if="stream.text" class="msg__content">{{ stream.text }}</div>
          <div v-if="stream.error" class="msg__error">{{ stream.error }}</div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.msg {
  padding: 8px 0;
}

.msg__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.msg__role {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.msg--user .msg__role {
  color: var(--color-signal-accent);
}

.msg--assistant .msg__role {
  color: var(--color-text-secondary);
}

.msg__content {
  font-size: 13px;
  line-height: 1.55;
  color: var(--color-text-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.msg--user .msg__content {
  color: var(--color-text-secondary);
}

.msg__phase {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-muted);
}

.msg__pulse {
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: var(--color-signal-accent);
  animation: msg-pulse 1.4s ease-in-out infinite;
}

@keyframes msg-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}

.msg__error {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-signal-error);
}
</style>
