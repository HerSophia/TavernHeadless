<script setup lang="ts">
import {
  AlertCircle,
  AlertTriangle,
  GitBranch,
  Info,
  ListRestart,
  Loader2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Undo2,
  Workflow,
  X,
} from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { CreateSessionInput } from "../../lib/chat";
import { useChatStore } from "../../stores/chat";
import { useContextStore } from "../../stores/context";
import { useSessionTodoStore } from "../../stores/session-todo";
import UiButton from "../../ui/UiButton.vue";
import UiIconButton from "../../ui/UiIconButton.vue";
import ChatComposer from "./ChatComposer.vue";
import CreateSessionDialog from "./CreateSessionDialog.vue";
import FloorGraphBindingPanel from "./detail/FloorGraphBindingPanel.vue";
import SessionInfoPanel from "./detail/SessionInfoPanel.vue";
import MessageList from "./MessageList.vue";
import SessionListPanel from "./sessions/SessionListPanel.vue";
import TodoListCard from "./TodoListCard.vue";
import TraceDrawer from "./trace/TraceDrawer.vue";

const { t, te } = useI18n();
const ctx = useContextStore();
const chat = useChatStore();
const todo = useSessionTodoStore();

const sessionTitle = computed(() => {
  const id = ctx.currentSessionId;
  if (!id) {
    return null;
  }
  const session = ctx.sessions.find((candidate) => candidate.id === id);
  return session?.title ?? id;
});

const composerBusy = computed(() => chat.sending);
// 发送禁用（SC1-5）：未选会话 / 本地重生 / “别处正在生成”（remoteBusy）时禁用。
const composerDisabled = computed(
  () => !ctx.currentSessionId || chat.regenerating || chat.remoteBusy,
);

// 运行态提示（SC1-5）：仅在 remoteBusy（别处正在生成）时展示；自己在跑不叠加，避免重复。
const activeRunMessage = computed(() => {
  const phase = chat.activeRunPhase;
  if (phase) {
    const key = `chat.phase.${phase}`;
    const phaseText = te(key) ? t(key) : phase;
    return t("chat.activeRun.busyPhase", { phase: phaseText });
  }
  return t("chat.activeRun.busy");
});

// 时间线所属分支（SC1-4）：非 main 分支时展示只读徽标，main / 缺省时隐藏。
const branchBadge = computed(() => {
  const id = chat.timeline?.branchId;
  return id && id !== "main" ? id : null;
});

// 会话列表面板（SC1-1）：默认展开，可折叠。
const sessionListOpen = ref(true);

// 创建会话对话框（SC2-4）：顶栏「新建会话」打开，收集资产绑定后再建。
const createDialogOpen = ref(false);

const traceOpen = ref(false);
const traceFloorId = ref<string | null>(null);
const traceFloorNo = ref<number | null>(null);

// 会话信息面板（SC1-3）：独立右侧抽屉，与 trace 抽屉互斥（同时最多打开其一）。
const infoOpen = ref(false);

// 楼层图绑定面板（SC2-5）：project 级右侧抽屉，与 info / trace 抽屉互斥。
const floorGraphOpen = ref(false);

function onInspect(payload: { floorId: string; floorNo: number }): void {
  traceFloorId.value = payload.floorId;
  traceFloorNo.value = payload.floorNo;
  infoOpen.value = false;
  floorGraphOpen.value = false;
  traceOpen.value = true;
}

function toggleTrace(): void {
  traceOpen.value = !traceOpen.value;
  if (traceOpen.value) {
    infoOpen.value = false;
    floorGraphOpen.value = false;
    // 打开但未指定回合时，默认聚焦最新楼层。
    if (!traceFloorId.value) {
      const latest = chat.latestFloor;
      if (latest) {
        traceFloorId.value = latest.id;
        traceFloorNo.value = latest.floorNo;
      }
    }
  }
}

function toggleInfo(): void {
  infoOpen.value = !infoOpen.value;
  if (infoOpen.value) {
    traceOpen.value = false;
    floorGraphOpen.value = false;
  }
}

function toggleFloorGraph(): void {
  floorGraphOpen.value = !floorGraphOpen.value;
  if (floorGraphOpen.value) {
    traceOpen.value = false;
    infoOpen.value = false;
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

function onLoadMore(): void {
  if (ctx.currentSessionId) {
    void chat.loadMoreTimeline(ctx.currentSessionId);
  }
}

// SC1-7：编辑已提交楼层内的用户消息并重生（服务端新开分支，视图跟随 fork）。
function onEditMessage(payload: { messageId: string; content: string }): void {
  const id = ctx.currentSessionId;
  if (id) {
    void chat.editAndRegenerate(id, payload.messageId, payload.content);
  }
}

// 编辑助手（LLM）回复内容：人工修订就地改写已提交内容（不重生、不分叉），成功后对账时间线。
function onEditAssistant(payload: { messageId: string; content: string }): void {
  const id = ctx.currentSessionId;
  if (id) {
    void chat.editAssistantMessage(id, payload.messageId, payload.content);
  }
}

// SC1-7：回到主分支（fork 视图的逆操作与逃生口，非分支浏览）。
function onBackToMain(): void {
  const id = ctx.currentSessionId;
  if (id) {
    void chat.loadTimeline(id, "main");
  }
}

// SC1-6：对指定 committed 楼层原地重跑 / 从指定步重跑（并发/对账由 store 收口）。
function onRetryFloor(payload: { floorId: string }): void {
  const id = ctx.currentSessionId;
  if (id) {
    void chat.retryFloor(id, payload.floorId);
  }
}

function onRetryFloorStep(payload: { floorId: string; fromStepIndex: number }): void {
  const id = ctx.currentSessionId;
  if (id) {
    void chat.retryFloorStep(id, payload.floorId, payload.fromStepIndex);
  }
}

// SC1-8：懒加载某楼层全量页（缓存 + 并发去重由 store 兜底）与 swipe 切换（切换后对账）。
function onLoadPages(payload: { floorId: string }): void {
  void chat.loadFloorPages(payload.floorId);
}

function onActivatePage(payload: { floorId: string; pageId: string }): void {
  const id = ctx.currentSessionId;
  if (id) {
    void chat.activatePage(id, payload.floorId, payload.pageId);
  }
}

// 手动刷新运行态并对账时间线（remoteBusy 提示条兜底，别处结束后可恢复）。
function onRefreshActiveRun(): void {
  const id = ctx.currentSessionId;
  if (id) {
    void chat.refreshActiveRun(id);
    void chat.loadTimeline(id);
  }
}

// SC2-4：打开创建会话对话框（清掉上次残留错误，避免旧错误串扰对话框回显）。
function openCreateDialog(): void {
  if (!ctx.currentProjectId || chat.creating) {
    return;
  }
  chat.clearError();
  createDialogOpen.value = true;
}

// SC2-4：对话框提交 → 建会话（透传资产绑定），成功后刷新会话列表、选中并关闭；失败保留对话框回显 chat.error。
async function onCreateSession(input: CreateSessionInput): Promise<void> {
  const projectId = ctx.currentProjectId;
  if (!projectId || chat.creating) {
    return;
  }
  const session = await chat.createSession(projectId, input);
  if (session) {
    await ctx.loadSessions(projectId);
    ctx.selectSession(session.id);
    createDialogOpen.value = false;
  }
}

watch(
  () => ctx.currentSessionId,
  (id) => {
    traceFloorId.value = null;
    traceFloorNo.value = null;
    if (id) {
      // SC1-7：进入 / 切换会话显式复位主分支，避免把上个会话的 fork 分支 id 带入新会话。
      void chat.loadTimeline(id, "main");
      // 进入 / 切换会话时轻量对账一次服务端运行态（与 loadTimeline 并行、各自降级）。
      void chat.refreshActiveRun(id);
      // SC2-12：加载会话待办清单（工具在回合中写入，进入会话时先取一次）。
      void todo.load(id);
    } else {
      chat.reset();
      todo.reset();
    }
  },
  { immediate: true },
);

// SC2-12：回合结束（busy 由 true→false）后刷新待办，捕获生成过程中工具的写入。
watch(
  () => chat.busy,
  (busy, prev) => {
    if (prev && !busy && ctx.currentSessionId) {
      void todo.refresh();
    }
  },
);
</script>

<template>
  <section class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex h-10 shrink-0 items-center gap-3 border-b border-line-subtle bg-panel px-3">
      <UiIconButton
        :label="t('chat.sessions.toggle')"
        :active="sessionListOpen"
        @click="sessionListOpen = !sessionListOpen"
      >
        <PanelLeftClose v-if="sessionListOpen" :size="16" :stroke-width="1.5" />
        <PanelLeftOpen v-else :size="16" :stroke-width="1.5" />
      </UiIconButton>
      <MessageSquare :size="15" :stroke-width="1.5" class="text-text-muted" />
      <span v-if="sessionTitle" class="truncate text-sm text-text-secondary">{{ sessionTitle }}</span>
      <span v-else class="text-sm text-text-muted">{{ t("chat.noSession") }}</span>
      <span
        v-if="branchBadge"
        class="shrink-0 rounded border border-line-subtle px-1.5 py-0.5 font-mono text-[10px] text-signal-accent"
        :title="t('chat.timeline.branch', { branch: branchBadge })"
      >
        {{ t("chat.timeline.branch", { branch: branchBadge }) }}
      </span>
      <!-- SC1-7：fork 视图的逃生口：回到主分支（非分支浏览） -->
      <button
        v-if="chat.onFork"
        type="button"
        class="inline-flex shrink-0 items-center gap-1 rounded border border-line-subtle px-1.5 py-0.5 text-[10px] text-text-secondary transition-colors hover:bg-float hover:text-text-primary"
        @click="onBackToMain"
      >
        <Undo2 :size="11" :stroke-width="1.5" />
        {{ t("chat.timeline.backToMain") }}
      </button>

      <div class="ml-auto flex items-center gap-2">
        <UiButton
          class="!h-7 !px-2 text-xs"
          :disabled="!ctx.currentProjectId || chat.creating"
          :title="!ctx.currentProjectId ? t('chat.selectProjectFirst') : t('chat.newSession')"
          @click="openCreateDialog"
        >
          <Plus :size="13" :stroke-width="1.5" />
          {{ t("chat.newSession") }}
        </UiButton>
        <UiIconButton
          v-if="ctx.currentProjectId"
          :label="t('chat.floorGraphBinding')"
          :active="floorGraphOpen"
          @click="toggleFloorGraph"
        >
          <Workflow :size="16" :stroke-width="1.5" />
        </UiIconButton>
        <UiIconButton
          v-if="ctx.currentSessionId"
          :label="t('chat.sessions.info.toggle')"
          :active="infoOpen"
          @click="toggleInfo"
        >
          <Info :size="16" :stroke-width="1.5" />
        </UiIconButton>
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
    <div class="flex min-h-0 flex-1">
      <SessionListPanel v-if="sessionListOpen" />

      <div v-if="ctx.currentSessionId" class="flex min-w-0 flex-1">
        <div class="flex min-w-0 flex-1 flex-col">
          <!-- SC1-7：fork 视图只读提示（如实承认稀疏历史限制） -->
          <div
            v-if="chat.onFork"
            class="flex shrink-0 items-start gap-2 border-b border-line-subtle bg-panel px-3 py-1.5 text-xs text-text-secondary"
          >
            <GitBranch :size="13" :stroke-width="1.5" class="mt-0.5 shrink-0 text-signal-accent" />
            <span class="min-w-0 flex-1">{{ t("chat.edit.forkNotice") }}</span>
          </div>
          <!-- SC2-12：待办事项摘要卡（顶部固定、可折叠；空清单不渲染） -->
          <TodoListCard v-if="todo.hasItems && todo.snapshot" :snapshot="todo.snapshot" />
          <MessageList
            :floors="chat.floors"
            :stream="chat.stream"
            :loading="chat.loadingTimeline"
            :regenerating="chat.regenerating"
            :busy="chat.busy"
            :has-more="chat.timelineHasMore"
            :loading-more="chat.loadingMoreTimeline"
            :on-fork="chat.onFork"
            :floor-pages="chat.floorPages"
            :activating-page-id="chat.activatingPageId"
            :active-trace-floor-id="traceOpen ? traceFloorId : null"
            @retry="onRetry"
            @inspect="onInspect"
            @load-more="onLoadMore"
            @retry-floor="onRetryFloor"
            @retry-floor-step="onRetryFloorStep"
            @edit-message="onEditMessage"
            @edit-assistant="onEditAssistant"
            @load-pages="onLoadPages"
            @activate-page="onActivatePage"
          />
          <!-- 分步重跑结果条（SC1-6）：只读展示 discardedFromStepIndex 与不可回滚副作用 -->
          <div
            v-if="chat.lastRetryStep"
            class="shrink-0 border-t border-line-subtle bg-panel px-3 py-2 text-xs"
          >
            <div class="flex items-center gap-2 text-text-secondary">
              <ListRestart :size="13" :stroke-width="1.5" class="shrink-0 text-signal-accent" />
              <span class="min-w-0 flex-1">
                {{ t("chat.retryMenu.result.discarded", { step: chat.lastRetryStep.discardedFromStepIndex }) }}
              </span>
              <UiIconButton :label="t('chat.dismiss')" @click="chat.clearLastRetryStep()">
                <X :size="13" :stroke-width="1.5" />
              </UiIconButton>
            </div>
            <div
              v-if="chat.lastRetryStep.irreversibleSideEffects.length > 0"
              class="mt-1.5 flex items-start gap-2 rounded border border-signal-warn/40 bg-signal-warn/10 px-2 py-1.5 text-signal-warn"
            >
              <AlertTriangle :size="13" :stroke-width="1.5" class="mt-0.5 shrink-0" />
              <div class="min-w-0 flex-1">
                <p>{{ t("chat.retryMenu.result.sideEffects") }}</p>
                <ul class="mt-1 space-y-0.5">
                  <li
                    v-for="(se, i) in chat.lastRetryStep.irreversibleSideEffects"
                    :key="se.executionId || i"
                    class="font-mono text-[11px]"
                  >
                    {{ t("chat.retryMenu.result.sideEffect", { tool: se.toolName, level: se.sideEffectLevel }) }}
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <!-- 运行态提示条（SC1-5）：别处正在生成时只读提示 + 手动刷新兜底 -->
          <div
            v-if="chat.remoteBusy"
            class="flex shrink-0 items-center gap-2 border-t border-line-subtle bg-panel px-3 py-1.5 text-xs text-text-secondary"
          >
            <Loader2 :size="13" :stroke-width="1.5" class="shrink-0 animate-spin text-signal-accent" />
            <span class="min-w-0 flex-1 truncate">{{ activeRunMessage }}</span>
            <UiButton
              class="!h-6 !px-2 text-xs"
              :disabled="chat.loadingActiveRun || chat.loadingTimeline"
              @click="onRefreshActiveRun"
            >
              {{ t("chat.activeRun.refresh") }}
            </UiButton>
          </div>
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

        <SessionInfoPanel
          v-if="infoOpen"
          :session-id="ctx.currentSessionId"
          @close="infoOpen = false"
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

      <!-- SC2-5：楼层图绑定面板（project 级，与 info / trace 抽屉互斥） -->
      <FloorGraphBindingPanel
        v-if="floorGraphOpen"
        :project-id="ctx.currentProjectId"
        @close="floorGraphOpen = false"
      />
    </div>

    <!-- SC2-4：创建会话对话框（选资产再建，失败回显 chat.error） -->
    <CreateSessionDialog
      :open="createDialogOpen"
      :project-id="ctx.currentProjectId"
      :busy="chat.creating"
      :error="chat.error"
      @create="onCreateSession"
      @close="createDialogOpen = false"
    />
  </section>
</template>
