<script setup lang="ts">
import { AlertCircle, MessageSquare, PanelRightClose, PanelRightOpen, Plus, X } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { useChatStore } from "../../stores/chat";
import { useContextStore } from "../../stores/context";
import UiButton from "../../ui/UiButton.vue";
import UiIconButton from "../../ui/UiIconButton.vue";
import ChatComposer from "./ChatComposer.vue";
import MessageList from "./MessageList.vue";
import TraceDrawer from "./trace/TraceDrawer.vue";

const { t } = useI18n();
const ctx = useContextStore();
const chat = useChatStore();

const sessionTitle = computed(() => {
  const id = ctx.currentSessionId;
  if (!id) {
    return null;
  }
  const session = ctx.sessions.find((candidate) => candidate.id === id);
  return session?.title ?? id;
});

const composerBusy = computed(() => chat.sending);
const composerDisabled = computed(() => !ctx.currentSessionId || chat.regenerating);

const traceOpen = ref(false);
const traceFloorId = ref<string | null>(null);
const traceFloorNo = ref<number | null>(null);

function onInspect(payload: { floorId: string; floorNo: number }): void {
  traceFloorId.value = payload.floorId;
  traceFloorNo.value = payload.floorNo;
  traceOpen.value = true;
}

function toggleTrace(): void {
  traceOpen.value = !traceOpen.value;
  // 打开但未指定回合时，默认聚焦最新楼层。
  if (traceOpen.value && !traceFloorId.value) {
    const latest = chat.latestFloor;
    if (latest) {
      traceFloorId.value = latest.id;
      traceFloorNo.value = latest.floorNo;
    }
  }
}

function onSend(text: string): void {
  if (ctx.currentSessionId) {
    void chat.sendMessage(ctx.currentSessionId, text);
  }
}

function onRetry(): void {
  if (ctx.currentSessionId) {
    void chat.regenerateLatest(ctx.currentSessionId);
  }
}

async function onNewSession(): Promise<void> {
  const projectId = ctx.currentProjectId;
  if (!projectId || chat.creating) {
    return;
  }
  const session = await chat.createSession(projectId, t("chat.newSessionTitle"));
  if (session) {
    await ctx.loadSessions(projectId);
    ctx.selectSession(session.id);
  }
}

watch(
  () => ctx.currentSessionId,
  (id) => {
    traceFloorId.value = null;
    traceFloorNo.value = null;
    if (id) {
      void chat.loadTimeline(id);
    } else {
      chat.reset();
    }
  },
  { immediate: true },
);
</script>

<template>
  <section class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex h-10 shrink-0 items-center gap-3 border-b border-line-subtle bg-panel px-3">
      <MessageSquare :size="15" :stroke-width="1.5" class="text-text-muted" />
      <span v-if="sessionTitle" class="truncate text-sm text-text-secondary">{{ sessionTitle }}</span>
      <span v-else class="text-sm text-text-muted">{{ t("chat.noSession") }}</span>

      <div class="ml-auto flex items-center gap-2">
        <UiButton
          class="!h-7 !px-2 text-xs"
          :disabled="!ctx.currentProjectId || chat.creating"
          :title="!ctx.currentProjectId ? t('chat.selectProjectFirst') : t('chat.newSession')"
          @click="onNewSession"
        >
          <Plus :size="13" :stroke-width="1.5" />
          {{ t("chat.newSession") }}
        </UiButton>
        <UiIconButton
          v-if="ctx.currentSessionId"
          :label="t('chat.trace.toggle')"
          :active="traceOpen"
          @click="toggleTrace"
        >
          <PanelRightClose v-if="traceOpen" :size="16" :stroke-width="1.5" />
          <PanelRightOpen v-else :size="16" :stroke-width="1.5" />
        </UiIconButton>
      </div>
    </div>

    <!-- Error banner -->
    <div
      v-if="chat.error"
      class="flex shrink-0 items-center gap-2 border-b border-line-subtle bg-panel px-3 py-1.5 text-xs text-signal-error"
    >
      <AlertCircle :size="13" :stroke-width="1.5" />
      <span class="min-w-0 flex-1 truncate">{{ chat.error }}</span>
      <UiIconButton :label="t('chat.dismiss')" @click="chat.clearError()">
        <X :size="13" :stroke-width="1.5" />
      </UiIconButton>
    </div>

    <!-- Body -->
    <div v-if="ctx.currentSessionId" class="flex min-h-0 flex-1">
      <div class="flex min-w-0 flex-1 flex-col">
        <MessageList
          :floors="chat.floors"
          :stream="chat.stream"
          :loading="chat.loadingTimeline"
          :regenerating="chat.regenerating"
          :active-trace-floor-id="traceOpen ? traceFloorId : null"
          @retry="onRetry"
          @inspect="onInspect"
        />
        <ChatComposer
          :disabled="composerDisabled"
          :busy="composerBusy"
          @send="onSend"
          @stop="chat.abort()"
        />
      </div>

      <TraceDrawer
        v-if="traceOpen"
        :floor-id="traceFloorId"
        :floor-no="traceFloorNo"
        :session-id="ctx.currentSessionId"
        @close="traceOpen = false"
      />
    </div>

    <div v-else class="flex flex-1 items-center justify-center p-8">
      <div class="flex max-w-md flex-col items-center text-center">
        <MessageSquare :size="32" :stroke-width="1.25" class="text-text-muted" />
        <h1 class="mt-4 text-base font-medium text-text-primary">{{ t("chat.emptyTitle") }}</h1>
        <p class="mt-2 text-sm leading-relaxed text-text-secondary">
          {{ ctx.currentProjectId ? t("chat.selectSession") : t("chat.selectProjectFirst") }}
        </p>
      </div>
    </div>
  </section>
</template>
