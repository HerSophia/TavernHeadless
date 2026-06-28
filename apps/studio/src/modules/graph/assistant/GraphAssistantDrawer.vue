<script setup lang="ts">
import {
  Bot,
  CheckCheck,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  Settings,
  ShieldQuestion,
  Trash2,
  X,
} from "lucide-vue-next";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import { useGraphAssistantStore } from "../../../stores/graph-assistant";
import UiIconButton from "../../../ui/UiIconButton.vue";
import AssistantComposer from "./AssistantComposer.vue";
import AssistantMessageList from "./AssistantMessageList.vue";
import AssistantSettings from "./AssistantSettings.vue";
import PendingToolCallCard from "./PendingToolCallCard.vue";
import { useFloatingWindow } from "./use-floating-window";

const props = defineProps<{
  projectId: string | null;
  sessionId: string | null;
}>();

const emit = defineEmits<{ (event: "close"): void }>();

const { t, te } = useI18n();
const store = useGraphAssistantStore();

// 窗口化（停靠 / 浮动）与拖拽、缩放状态
const { floating, x, y, width, height, toggleFloating, startDrag, startResize } = useFloatingWindow();

// 设置面板展开态：收纳生命周期操作与临时语义说明
const settingsOpen = ref(false);

/** 懒创建上下文：图编辑器以 Project 作用域为主。 */
const ctx = computed(() => ({ projectId: props.projectId, sessionId: props.sessionId }));

/** 浮动时用内联样式定位与定尺；停靠时交回 class 控制。 */
const rootStyle = computed(() => {
  if (!floating.value) {
    return undefined;
  }
  return {
    left: `${x.value}px`,
    top: `${y.value}px`,
    width: `${width.value}px`,
    height: `${height.value}px`,
  };
});

/** 会话状态徽标文案（无会话时不显示）。 */
const statusLabel = computed(() => {
  const status = store.conversation?.status;
  if (!status) {
    return "";
  }
  const key = `graphAssistant.status.${status}`;
  return te(key) ? t(key) : status;
});

/** 状态徽标圆点配色：active 绿、expired 橙、其余终态灰。 */
const statusTone = computed(() => {
  const status = store.conversation?.status;
  if (status === "active") {
    return "var(--color-signal-success)";
  }
  if (status === "expired") {
    return "var(--color-signal-warn)";
  }
  return "var(--color-text-muted)";
});

/** 有会话且非 active：处于终态，输入禁用、仅可新开。 */
const terminal = computed(() => Boolean(store.conversation) && !store.isActive);

/** 输入禁用：终态、或停在执行前确认闸、或正在批准 / 拒绝续跑。 */
const composerDisabled = computed(() => terminal.value || store.hasPending || store.resolving);

/** 是否已过期（状态为 expired）：终态中的一种，文案另行引导新开。 */
const expired = computed(() => store.conversation?.status === "expired");

/** 终态提示文案：过期与其他终态分开叙述。 */
const terminalHintKey = computed(() => (expired.value ? "graphAssistant.expiredHint" : "graphAssistant.terminalHint"));

/** TTL 提示文案（active 且有 expiresAt 时）：「临时 · 约 N 分钟后过期」。 */
const ttlLabel = computed(() => {
  if (!store.isActive || store.expiresAt === null) {
    return "";
  }
  const remainMs = store.expiresAt - Date.now();
  if (remainMs <= 0) {
    return t("graphAssistant.ttlExpiringSoon");
  }
  const minutes = Math.ceil(remainMs / 60000);
  return t("graphAssistant.ttlNotice", { minutes });
});

/** 错误条文案（有错时才显示）；软错误以引导口吻、不弹红。 */
const errorMessage = computed(() => store.error);

/** 窗口化按钮文案：浮动时提示「停靠回侧栏」，停靠时提示「窗口化」。 */
const windowizeLabel = computed(() => (floating.value ? t("graphAssistant.dock") : t("graphAssistant.windowize")));

function onSend(text: string): void {
  void store.sendMessage(ctx.value, text);
}

function onStop(): void {
  store.abort();
}

function onApprove(confirmationId: string): void {
  void store.approveToolCall(confirmationId);
}

function onReject(confirmationId: string): void {
  void store.rejectToolCall(confirmationId);
}

function onFinalize(): void {
  void store.finalize();
}

function onDiscard(): void {
  // 丢弃为终态转换（不可逆），二次确认后才执行。
  if (!window.confirm(t("graphAssistant.discardConfirm"))) {
    return;
  }
  void store.discard();
}

/** 新开一段：仅清本地态，下次发送重新懒创建。 */
function onNew(): void {
  store.reset();
}

/** 仅浮动状态下，从标题区按下才触发拖拽。 */
function onHeaderPointerDown(event: PointerEvent): void {
  if (!floating.value) {
    return;
  }
  startDrag(event);
}
</script>

<template>
  <aside
    :class="[
      'flex flex-col bg-panel',
      floating
        ? 'fixed z-30 rounded-lg border border-line-subtle shadow-[0_8px_32px_-12px_rgba(0,0,0,0.55)]'
        : 'absolute inset-y-0 right-0 z-20 w-96 border-l border-line-subtle shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.45)]',
    ]"
    :style="rootStyle"
  >
    <!-- 顶栏：标题区（浮动时可拖拽）+ 窗口化 / 关闭 -->
    <header class="flex h-10 shrink-0 items-center gap-2 border-b border-line-subtle px-3">
      <div
        class="flex flex-1 items-center gap-2 overflow-hidden"
        :class="floating ? 'cursor-move select-none' : ''"
        @pointerdown="onHeaderPointerDown"
      >
        <Bot :size="14" :stroke-width="1.5" class="shrink-0 text-text-muted" />
        <span class="truncate text-sm font-medium text-text-secondary">{{ t("graphAssistant.title") }}</span>
        <span
          v-if="statusLabel"
          class="ml-1 inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-text-muted"
        >
          <span class="size-1.5 rounded-full" :style="{ background: statusTone }" aria-hidden="true" />
          {{ statusLabel }}
        </span>
      </div>

      <div class="flex items-center gap-1">
        <UiIconButton :label="windowizeLabel" :active="floating" @click="toggleFloating">
          <Minimize2 v-if="floating" :size="14" :stroke-width="1.5" />
          <Maximize2 v-else :size="14" :stroke-width="1.5" />
        </UiIconButton>
        <UiIconButton :label="t('graphAssistant.close')" @click="emit('close')">
          <X :size="14" :stroke-width="1.5" />
        </UiIconButton>
      </div>
    </header>

    <!-- 设置视图：整块替换对话区（左栏导航 + LLM Profile 选择等） -->
    <AssistantSettings v-if="settingsOpen" @back="settingsOpen = false" />

    <template v-else>
      <!-- 操作 bar：左侧生命周期（active 时完成 / 丢弃），右侧新建对话 / 设置 -->
      <div class="flex h-9 shrink-0 items-center gap-1 border-b border-line-subtle px-2">
        <UiIconButton v-if="store.isActive" :label="t('graphAssistant.finalize')" @click="onFinalize">
          <CheckCheck :size="14" :stroke-width="1.5" />
        </UiIconButton>
        <UiIconButton v-if="store.isActive" :label="t('graphAssistant.discard')" @click="onDiscard">
          <Trash2 :size="14" :stroke-width="1.5" />
        </UiIconButton>

        <div class="ml-auto flex items-center gap-1">
          <button
            type="button"
            class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-text-secondary transition-colors duration-150 hover:bg-float hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            @click="onNew"
          >
            <MessageSquarePlus :size="14" :stroke-width="1.5" />
            {{ t("graphAssistant.newConversation") }}
          </button>
          <button
            type="button"
            class="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-text-secondary transition-colors duration-150 hover:bg-float hover:text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
            @click="settingsOpen = true"
          >
            <Settings :size="14" :stroke-width="1.5" />
            {{ t("graphAssistant.settings") }}
          </button>
        </div>
      </div>

      <!-- 临时语义：保留策略 + TTL（active 且有 expiresAt 时） -->
      <p
        v-if="ttlLabel"
        class="shrink-0 border-b border-line-subtle px-3 py-1.5 font-mono text-[10px] text-text-muted"
      >
        {{ ttlLabel }}
      </p>

      <!-- 终态引导：过期 / 已结束，以引导口吻提示新开，不弹红 -->
      <p
        v-if="terminal"
        class="shrink-0 border-b border-line-subtle px-3 py-2 text-[11px] leading-snug text-text-muted"
      >
        {{ t(terminalHintKey) }}
      </p>

      <AssistantMessageList
        :messages="store.messages"
        :stream="store.stream"
        :loading="store.loading"
      />

      <!-- 执行前确认闸：停在待确认时渲染卡片，批准（自动续跑）/ 拒绝（交回控制权） -->
      <div
        v-if="store.hasPending"
        class="shrink-0 space-y-1.5 border-t border-line-subtle px-3 py-2"
      >
        <p class="flex items-center gap-1.5 text-[11px] leading-snug text-text-secondary">
          <ShieldQuestion :size="13" :stroke-width="1.5" class="shrink-0 text-text-muted" />
          {{ t("graphAssistant.confirmation.awaitingHint") }}
        </p>
        <PendingToolCallCard
          v-for="pending in store.pendingToolCalls"
          :key="pending.id"
          :pending="pending"
          :busy="store.resolving"
          @approve="onApprove"
          @reject="onReject"
        />
      </div>

      <!-- 错误条：软错误（过期 / 终态 / 权限）以 muted 引导口吻；硬错误才用 error 色 -->
      <p
        v-if="errorMessage"
        class="shrink-0 border-t border-line-subtle px-3 py-2 text-[11px] leading-snug"
        :class="store.errorSoft ? 'text-text-muted' : 'text-signal-error'"
      >
        {{ errorMessage }}
      </p>

      <!--
        导出预留（Phase 2）：临时对话可经 exportToPageStagedWrite 导出到会话页，
        但需明确 targetPageId；图编辑器以 Project 作用域为主、缺乏目标页。
        待顶栏选中具体 session 且可定位活动页时再开放此入口。
      -->
      <AssistantComposer
        :disabled="composerDisabled"
        :busy="store.sending"
        @send="onSend"
        @stop="onStop"
      />
    </template>

    <!-- 浮动时右下角缩放手柄 -->
    <div
      v-if="floating"
      class="absolute bottom-0 right-0 z-10 size-3.5 cursor-nwse-resize"
      :title="t('graphAssistant.resize')"
      @pointerdown="startResize"
    >
      <span class="absolute bottom-1 right-1 size-1.5 border-b border-r border-line-active" aria-hidden="true" />
    </div>
  </aside>
</template>
