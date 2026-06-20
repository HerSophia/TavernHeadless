<script setup lang="ts">
import { RotateCcw, ScrollText } from "lucide-vue-next";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { TimelineFloor } from "../../lib/chat";
import type { ChatStreamState } from "../../stores/chat";

const props = defineProps<{
  floors: TimelineFloor[];
  stream: ChatStreamState;
  loading?: boolean;
  regenerating?: boolean;
  activeTraceFloorId?: string | null;
}>();

const emit = defineEmits<{
  (event: "retry"): void;
  (event: "inspect", payload: { floorId: string; floorNo: number }): void;
}>();

const { t, te } = useI18n();

const scroller = ref<HTMLElement | null>(null);

const stateColor: Record<string, string> = {
  committed: "var(--color-signal-success)",
  generating: "var(--color-signal-accent)",
  draft: "var(--color-text-muted)",
  failed: "var(--color-signal-error)",
};

function roleLabel(role: string): string {
  const key = `chat.role.${role}`;
  return te(key) ? t(key) : role;
}

function isUser(role: string): boolean {
  return role === "user";
}

function stateLabel(state: string): string {
  const key = `chat.state.${state}`;
  return te(key) ? t(key) : state;
}

function phaseLabel(phase: string | null): string {
  if (!phase) {
    return "";
  }
  const key = `chat.phase.${phase}`;
  return te(key) ? t(key) : phase;
}

const lastFloorId = computed(() => props.floors.at(-1)?.id ?? null);

function scrollToBottom(): void {
  const el = scroller.value;
  if (el) {
    el.scrollTop = el.scrollHeight;
  }
}

watch(
  () => [props.floors.length, props.stream.text, props.stream.active] as const,
  () => {
    void nextTick(scrollToBottom);
  },
);
</script>

<template>
  <div ref="scroller" class="min-h-0 flex-1 overflow-auto">
    <!-- Loading skeleton -->
    <div v-if="loading && floors.length === 0" class="space-y-3 p-4">
      <div class="h-16 w-full animate-pulse rounded bg-float" />
      <div class="h-24 w-full animate-pulse rounded bg-float" />
    </div>

    <!-- Empty -->
    <div
      v-else-if="floors.length === 0 && !stream.active"
      class="flex h-full items-center justify-center p-8"
    >
      <p class="max-w-sm text-center text-sm leading-relaxed text-text-muted">
        {{ t("chat.noMessages") }}
      </p>
    </div>

    <div v-else class="mx-auto max-w-3xl px-4 py-4">
      <!-- Floors -->
      <article
        v-for="floor in floors"
        :key="floor.id"
        class="floor"
        :class="{ 'floor--active': floor.id === activeTraceFloorId }"
      >
        <div
          v-for="message in floor.messages"
          :key="message.id"
          class="msg"
          :class="isUser(message.role) ? 'msg--user' : 'msg--assistant'"
        >
          <div class="msg__meta">
            <span class="msg__role">{{ roleLabel(message.role) }}</span>
          </div>
          <div class="msg__content">{{ message.content }}</div>
        </div>

        <footer class="floor__footer">
          <span class="floor__no">#{{ floor.floorNo }}</span>
          <span class="floor__state" :style="{ color: stateColor[floor.state] ?? 'var(--color-text-muted)' }">
            {{ stateLabel(floor.state) }}
          </span>
          <span v-if="floor.pageCount > 1" class="floor__pages">{{ floor.pageCount }} {{ t("chat.pages") }}</span>
          <span v-if="floor.tokenOut > 0" class="floor__tokens">{{ floor.tokenOut }} tok</span>

          <button
            type="button"
            class="floor__action"
            :class="{ 'floor__action--active': floor.id === activeTraceFloorId }"
            :title="t('chat.trace.inspect')"
            @click="emit('inspect', { floorId: floor.id, floorNo: floor.floorNo })"
          >
            <ScrollText :size="12" :stroke-width="1.5" />
            {{ t("chat.trace.label") }}
          </button>
          <button
            v-if="floor.id === lastFloorId"
            type="button"
            class="floor__action"
            :disabled="regenerating || stream.active"
            @click="emit('retry')"
          >
            <RotateCcw :size="12" :stroke-width="1.5" />
            {{ regenerating ? t("chat.regenerating") : t("chat.retry") }}
          </button>
        </footer>
      </article>

      <!-- Provisional streaming floor -->
      <article v-if="stream.active" class="floor floor--streaming">
        <div class="msg msg--user">
          <div class="msg__meta"><span class="msg__role">{{ roleLabel("user") }}</span></div>
          <div class="msg__content">{{ stream.pendingUserText }}</div>
        </div>
        <div class="msg msg--assistant">
          <div class="msg__meta">
            <span class="msg__role">{{ roleLabel("assistant") }}</span>
            <span v-if="stream.phase" class="msg__phase">
              <span class="msg__pulse" aria-hidden="true" />
              {{ phaseLabel(stream.phase) }}
            </span>
          </div>
          <div v-if="stream.text" class="msg__content">{{ stream.text }}</div>
          <div v-else-if="!stream.error" class="msg__content msg__content--pending">{{ t("chat.thinking") }}</div>
          <div v-if="stream.error" class="msg__error">{{ stream.error }}</div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.floor {
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--color-line-subtle);
}

.floor:last-child {
  border-bottom: 0;
  margin-bottom: 0;
}

.floor--active {
  /* 受 trace 抽屉聚焦的回合：左侧 accent 细条，克制不喧哗。 */
  box-shadow: inset 2px 0 0 var(--color-signal-accent);
  padding-left: 10px;
  margin-left: -12px;
}

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
  font-size: 14px;
  line-height: 1.55;
  color: var(--color-text-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.msg--user .msg__content {
  color: var(--color-text-secondary);
}

.msg__content--pending {
  color: var(--color-text-muted);
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

.floor__footer {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-muted);
}

.floor__footer > button:first-of-type {
  margin-left: auto;
}

.floor__action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--color-text-secondary);
  transition: background-color 150ms cubic-bezier(0.2, 0, 0, 1);
}

.floor__action:hover:not(:disabled) {
  background: var(--color-float);
  color: var(--color-text-primary);
}

.floor__action--active {
  background: var(--color-float);
  color: var(--color-signal-accent);
}

.floor__action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.floor__action:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px var(--color-signal-accent);
}
</style>
