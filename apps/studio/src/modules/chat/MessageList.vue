<script setup lang="ts">
import {
  ChevronLeft,
  ChevronRight,
  ListRestart,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  ScrollText,
} from "lucide-vue-next";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { PageRecord, TimelineFloor } from "../../lib/chat";
import type { ChatStreamState } from "../../stores/chat";
import UiDropdown from "../../ui/UiDropdown.vue";
import UiIconButton from "../../ui/UiIconButton.vue";
import UiMenuItem from "../../ui/UiMenuItem.vue";
import RetryStepDialog from "./RetryStepDialog.vue";
import ConfirmDialog from "./sessions/ConfirmDialog.vue";

const props = defineProps<{
  floors: TimelineFloor[];
  stream: ChatStreamState;
  loading?: boolean;
  regenerating?: boolean;
  /** 运行态忙碌（SC1-5）：本地发送/重生 或 服务端在跑，用于禁用重生入口。 */
  busy?: boolean;
  activeTraceFloorId?: string | null;
  /** 时间线分页（SC1-4）：是否还有更多楼层可加载 / 加载中。 */
  hasMore?: boolean;
  loadingMore?: boolean;
  /** SC1-7：当前处于 fork 分支（非 main），禁用“重生最新”（regenerate 非分支感知）。 */
  onFork?: boolean;
  /** SC1-8：按 floorId 缓存的全量页（懒加载），用于构建 swipe 控件。 */
  floorPages?: Record<string, PageRecord[]>;
  /** SC1-8：正在切换（activate）的页 id（切换中禁用 + 轻量 loading）。 */
  activatingPageId?: string | null;
}>();

const emit = defineEmits<{
  (event: "retry"): void;
  (event: "inspect", payload: { floorId: string; floorNo: number }): void;
  (event: "load-more"): void;
  (event: "retry-floor", payload: { floorId: string }): void;
  (event: "retry-floor-step", payload: { floorId: string; fromStepIndex: number }): void;
  (event: "edit-message", payload: { messageId: string; content: string }): void;
  (event: "edit-assistant", payload: { messageId: string; content: string }): void;
  (event: "load-pages", payload: { floorId: string }): void;
  (event: "activate-page", payload: { floorId: string; pageId: string }): void;
}>();

const { t, te } = useI18n();

const scroller = ref<HTMLElement | null>(null);

// SC1-6 楼层重跑：待确认的原地重跑 / 分步重跑目标楼层 id（null=对话框关闭）。
const confirmRetryFloorId = ref<string | null>(null);
const stepRetryFloorId = ref<string | null>(null);

function openConfirmRetry(floorId: string): void {
  confirmRetryFloorId.value = floorId;
}
function confirmRetry(): void {
  const id = confirmRetryFloorId.value;
  confirmRetryFloorId.value = null;
  if (id) {
    emit("retry-floor", { floorId: id });
  }
}
function cancelRetry(): void {
  confirmRetryFloorId.value = null;
}

function openStepRetry(floorId: string): void {
  stepRetryFloorId.value = floorId;
}
function confirmStepRetry(fromStepIndex: number): void {
  const id = stepRetryFloorId.value;
  stepRetryFloorId.value = null;
  if (id) {
    emit("retry-floor-step", { floorId: id, fromStepIndex });
  }
}
function cancelStepRetry(): void {
  stepRetryFloorId.value = null;
}

// SC1-7 编辑并重生：行内编辑中的消息 id / 草稿；待二次确认的编辑载荷（null=对话框关闭）。
const editingMessageId = ref<string | null>(null);
const editDraft = ref("");
const pendingEdit = ref<{ messageId: string; content: string } | null>(null);

function startEdit(messageId: string, content: string): void {
  editingMessageId.value = messageId;
  editDraft.value = content;
}
function cancelEdit(): void {
  editingMessageId.value = null;
  editDraft.value = "";
}
/** 提交前二次确认（空内容不弹框）。 */
function requestEditConfirm(messageId: string): void {
  const content = editDraft.value.trim();
  if (!content) {
    return;
  }
  pendingEdit.value = { messageId, content };
}
function confirmEdit(): void {
  const payload = pendingEdit.value;
  pendingEdit.value = null;
  if (payload) {
    emit("edit-message", payload);
    cancelEdit();
  }
}
function cancelEditConfirm(): void {
  pendingEdit.value = null;
}

// 编辑助手（LLM）回复内容（人工修订，不重生）：行内编辑中的消息 id / 草稿；待二次确认载荷。
const editingAssistantId = ref<string | null>(null);
const assistantDraft = ref("");
const pendingAssistantEdit = ref<{ messageId: string; content: string } | null>(null);

function startAssistantEdit(messageId: string, content: string): void {
  editingAssistantId.value = messageId;
  assistantDraft.value = content;
}
function cancelAssistantEdit(): void {
  editingAssistantId.value = null;
  assistantDraft.value = "";
}
/** 提交前二次确认（空内容不弹框）。 */
function requestAssistantEditConfirm(messageId: string): void {
  const content = assistantDraft.value.trim();
  if (!content) {
    return;
  }
  pendingAssistantEdit.value = { messageId, content };
}
function confirmAssistantEdit(): void {
  const payload = pendingAssistantEdit.value;
  pendingAssistantEdit.value = null;
  if (payload) {
    emit("edit-assistant", payload);
    cancelAssistantEdit();
  }
}
function cancelAssistantEditConfirm(): void {
  pendingAssistantEdit.value = null;
}

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

const KNOWN_ROLES = new Set(["user", "assistant", "narrator", "system"]);

/** 按角色映射消息样式 class；未知角色走通用兜底（assistant 视觉基线）。 */
function roleClass(role: string): string {
  return KNOWN_ROLES.has(role) ? `msg--${role}` : "msg--other";
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

// —— SC1-8 翻页 / swipes —— //

/** 同一 (floorId, pageNo) 槽位下、版本数 > 1 的 swipe 组。 */
interface SwipeGroup {
  pageNo: number;
  /** 槽内按 version 升序（tiebreak createdAt）的页。 */
  pages: PageRecord[];
  /** 当前活跃页在 pages 中的 0-based 下标（-1 表示无活跃页）。 */
  activeIndex: number;
}

/** 从某楼层的全量页构建 swipe 组：按 pageNo 分组、仅保留版本数 > 1 的槽位、槽内按 version 升序。 */
function buildSwipeGroups(pages: PageRecord[]): SwipeGroup[] {
  const byNo = new Map<number, PageRecord[]>();
  for (const page of pages) {
    const bucket = byNo.get(page.pageNo);
    if (bucket) {
      bucket.push(page);
    } else {
      byNo.set(page.pageNo, [page]);
    }
  }
  const groups: SwipeGroup[] = [];
  for (const [pageNo, bucket] of byNo) {
    if (bucket.length <= 1) {
      continue;
    }
    const sorted = bucket
      .slice()
      .sort((a, b) => a.version - b.version || a.createdAt - b.createdAt);
    groups.push({ pageNo, pages: sorted, activeIndex: sorted.findIndex((p) => p.isActive) });
  }
  return groups.sort((a, b) => a.pageNo - b.pageNo);
}

/**
 * 仅为**最新楼层**预计算 swipe 组：过往（非最新）楼层即使有多版本也不显示 swipe 切换控件，
 * 只在最新楼层存在多版本槽位时才提供翻页切换（其余楼层回落页文字）。
 */
const latestSwipeGroups = computed<SwipeGroup[]>(() => {
  const id = lastFloorId.value;
  if (!id) {
    return [];
  }
  const pages = props.floorPages?.[id];
  if (!pages || pages.length === 0) {
    return [];
  }
  return buildSwipeGroups(pages);
});

/** swipe 是写操作：忙碌 / 流式中 / 已有切换在途时禁用全部切换控件。 */
const swipeDisabled = computed(
  () => Boolean(props.busy) || props.stream.active || props.activatingPageId != null,
);

function groupSwitching(group: SwipeGroup): boolean {
  const id = props.activatingPageId;
  return id != null && group.pages.some((p) => p.id === id);
}

function onSwipePrev(floorId: string, group: SwipeGroup): void {
  if (group.activeIndex <= 0) {
    return;
  }
  const target = group.pages[group.activeIndex - 1];
  if (target) {
    emit("activate-page", { floorId, pageId: target.id });
  }
}

function onSwipeNext(floorId: string, group: SwipeGroup): void {
  if (group.activeIndex < 0 || group.activeIndex >= group.pages.length - 1) {
    return;
  }
  const target = group.pages[group.activeIndex + 1];
  if (target) {
    emit("activate-page", { floorId, pageId: target.id });
  }
}

// 懒加载触发：仅对**最新楼层**（唯一会显示 swipe 的楼层）在 pageCount > 1 且尚未缓存时拉取全量页。
// 监听 floors 引用变化（loadTimeline 会替换数组）以覆盖会话切换 / reset 后重入同一会话的场景。
watch(
  () => props.floors,
  (floors) => {
    const last = floors.at(-1);
    if (last && last.pageCount > 1 && !props.floorPages?.[last.id]) {
      emit("load-pages", { floorId: last.id });
    }
  },
  { immediate: true },
);

function scrollToBottom(): void {
  const el = scroller.value;
  if (el) {
    el.scrollTop = el.scrollHeight;
  }
}

// 自动滚动到底：仅在“首窗 / 重载完成（loading 由 true→false）”与流式正文更新时触发。
// 「加载更多」向底部追加更新楼层（loadingMore）时不自动滚动，避免打断阅读。
watch(
  () => props.loading,
  (now, prev) => {
    if (prev && !now) {
      void nextTick(scrollToBottom);
    }
  },
);
watch(
  () => [props.stream.text, props.stream.active] as const,
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
          :class="roleClass(message.role)"
        >
          <div class="msg__meta">
            <span class="msg__role">{{ roleLabel(message.role) }}</span>
            <!-- SC1-7：仅 committed 楼层内的用户消息可“编辑并重生”（悬停出现） -->
            <button
              v-if="floor.state === 'committed' && message.role === 'user' && editingMessageId !== message.id"
              type="button"
              class="msg__edit-btn"
              :disabled="busy || stream.active"
              :title="t('chat.edit.action')"
              @click="startEdit(message.id, message.content)"
            >
              <Pencil :size="12" :stroke-width="1.5" />
            </button>
            <!-- 编辑助手回复内容（人工修订，不重生；仅 committed 楼层内的 assistant 消息） -->
            <button
              v-if="floor.state === 'committed' && message.role === 'assistant' && editingAssistantId !== message.id"
              type="button"
              class="msg__edit-btn"
              :disabled="busy || stream.active"
              :title="t('chat.editAssistant.action')"
              @click="startAssistantEdit(message.id, message.content)"
            >
              <Pencil :size="12" :stroke-width="1.5" />
            </button>
          </div>
          <!-- 行内编辑：Esc 取消、显式“保存”提交（失焦不自动提交，避免误触分叉） -->
          <template v-if="editingMessageId === message.id">
            <div class="msg__edit">
              <textarea
                v-model="editDraft"
                class="msg__edit-input"
                rows="3"
                :placeholder="t('chat.edit.placeholder')"
                @keydown.esc.prevent="cancelEdit"
              />
              <div class="msg__edit-actions">
                <button type="button" class="msg__edit-cancel" @click="cancelEdit">
                  {{ t("chat.edit.cancel") }}
                </button>
                <button
                  type="button"
                  class="msg__edit-save"
                  :disabled="!editDraft.trim() || busy || stream.active"
                  @click="requestEditConfirm(message.id)"
                >
                  {{ t("chat.edit.save") }}
                </button>
              </div>
            </div>
          </template>
          <!-- 行内编辑：助手回复内容（人工修订）—Esc 取消、显式“保存”提交（失焦不自动提交） -->
          <template v-else-if="editingAssistantId === message.id">
            <div class="msg__edit">
              <textarea
                v-model="assistantDraft"
                class="msg__edit-input"
                rows="3"
                :placeholder="t('chat.editAssistant.placeholder')"
                @keydown.esc.prevent="cancelAssistantEdit"
              />
              <div class="msg__edit-actions">
                <button type="button" class="msg__edit-cancel" @click="cancelAssistantEdit">
                  {{ t("chat.editAssistant.cancel") }}
                </button>
                <button
                  type="button"
                  class="msg__edit-save"
                  :disabled="!assistantDraft.trim() || busy || stream.active"
                  @click="requestAssistantEditConfirm(message.id)"
                >
                  {{ t("chat.editAssistant.save") }}
                </button>
              </div>
            </div>
          </template>
          <template v-else>
            <div v-if="message.content" class="msg__content">{{ message.content }}</div>
            <div v-else class="msg__content msg__content--empty">—</div>
          </template>
        </div>

        <footer class="floor__footer">
          <span class="floor__no">#{{ floor.floorNo }}</span>
          <span class="floor__state" :style="{ color: stateColor[floor.state] ?? 'var(--color-text-muted)' }">
            {{ stateLabel(floor.state) }}
          </span>
          <!-- SC1-8（收窄）：仅最新楼层且存在多版本槽位时渲染 swipe 切换控件；否则回落 SC1-4 页文字 -->
          <template v-if="floor.id === lastFloorId && latestSwipeGroups.length">
            <span
              v-for="group in latestSwipeGroups"
              :key="group.pageNo"
              class="floor__swipe"
            >
              <button
                type="button"
                class="floor__swipe-btn"
                :disabled="swipeDisabled || group.activeIndex <= 0"
                :title="t('chat.swipe.prev')"
                @click="onSwipePrev(floor.id, group)"
              >
                <ChevronLeft :size="12" :stroke-width="1.5" />
              </button>
              <span class="floor__swipe-pos">
                <template v-if="groupSwitching(group)">{{ t("chat.swipe.switching") }}</template>
                <template v-else>
                  {{ t("chat.swipe.position", { current: group.activeIndex + 1, total: group.pages.length }) }}
                </template>
              </span>
              <button
                type="button"
                class="floor__swipe-btn"
                :disabled="swipeDisabled || group.activeIndex >= group.pages.length - 1"
                :title="t('chat.swipe.next')"
                @click="onSwipeNext(floor.id, group)"
              >
                <ChevronRight :size="12" :stroke-width="1.5" />
              </button>
            </span>
          </template>
          <span v-else-if="floor.pageCount > 1" class="floor__pages">
            <template v-if="floor.activePage">
              {{ t("chat.pageIndicator", { current: floor.activePage.pageNo, total: floor.pageCount }) }}
            </template>
            <template v-else>{{ floor.pageCount }} {{ t("chat.pages") }}</template>
          </span>
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
          <!-- SC1-7：fork 分支下禁用“重生最新”（regenerate 非分支感知），引导改用楼层级重跑 -->
          <button
            v-if="floor.id === lastFloorId"
            type="button"
            class="floor__action"
            :disabled="busy || stream.active || onFork"
            :title="onFork ? t('chat.edit.retryOnForkHint') : undefined"
            @click="emit('retry')"
          >
            <RotateCcw :size="12" :stroke-width="1.5" />
            {{ regenerating ? t("chat.regenerating") : t("chat.retry") }}
          </button>

          <!-- SC1-6：“更多”菜单（仅 committed 楼层）—原地重跑 / 从某步重跑 -->
          <UiDropdown v-if="floor.state === 'committed'" align="right" panel-width="12rem">
            <template #trigger="{ toggle, open }">
              <UiIconButton
                :label="t('chat.retryMenu.more')"
                :active="open"
                :disabled="busy || stream.active"
                @click="toggle"
              >
                <MoreHorizontal :size="14" :stroke-width="1.5" />
              </UiIconButton>
            </template>
            <template #default="{ close }">
              <UiMenuItem
                :label="t('chat.retryMenu.retryFloor')"
                @click="close(); openConfirmRetry(floor.id)"
              >
                <template #icon><RotateCcw :size="13" :stroke-width="1.5" /></template>
              </UiMenuItem>
              <UiMenuItem
                :label="t('chat.retryMenu.retryStep')"
                @click="close(); openStepRetry(floor.id)"
              >
                <template #icon><ListRestart :size="13" :stroke-width="1.5" /></template>
              </UiMenuItem>
            </template>
          </UiDropdown>
        </footer>
      </article>

      <!-- 加载更多（向更新方向追加历史；不自动滚动到底） -->
      <div v-if="hasMore" class="timeline-more">
        <button
          type="button"
          class="timeline-more__btn"
          :disabled="loadingMore"
          @click="emit('load-more')"
        >
          {{ loadingMore ? t("chat.timeline.loadingMore") : t("chat.timeline.loadMore") }}
        </button>
      </div>

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

  <!-- SC1-6：原地重跑二次确认 -->
  <ConfirmDialog
    :open="confirmRetryFloorId !== null"
    :title="t('chat.retryMenu.confirmRetryTitle')"
    :message="t('chat.retryMenu.confirmRetry')"
    :confirm-label="t('chat.retryMenu.retryFloor')"
    :cancel-label="t('chat.sessions.cancel')"
    @confirm="confirmRetry"
    @cancel="cancelRetry"
  />

  <!-- SC1-7：编辑并重生二次确认（分叉操作显式化） -->
  <ConfirmDialog
    :open="pendingEdit !== null"
    :title="t('chat.edit.confirmTitle')"
    :message="t('chat.edit.confirm')"
    :confirm-label="t('chat.edit.save')"
    :cancel-label="t('chat.edit.cancel')"
    @confirm="confirmEdit"
    @cancel="cancelEditConfirm"
  />

  <!-- 编辑助手回复内容二次确认（记录为一次人工修订，不重生） -->
  <ConfirmDialog
    :open="pendingAssistantEdit !== null"
    :title="t('chat.editAssistant.confirmTitle')"
    :message="t('chat.editAssistant.confirm')"
    :confirm-label="t('chat.editAssistant.save')"
    :cancel-label="t('chat.editAssistant.cancel')"
    @confirm="confirmAssistantEdit"
    @cancel="cancelAssistantEditConfirm"
  />

  <!-- SC1-6：分步重跑步号输入 -->
  <RetryStepDialog
    :open="stepRetryFloorId !== null"
    :title="t('chat.retryMenu.stepTitle')"
    :label="t('chat.retryMenu.stepLabel')"
    :hint="t('chat.retryMenu.stepHint')"
    :confirm-label="t('chat.retryMenu.retryStep')"
    :cancel-label="t('chat.sessions.cancel')"
    @confirm="confirmStepRetry"
    @cancel="cancelStepRetry"
  />
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

.msg--assistant .msg__role,
.msg--other .msg__role {
  color: var(--color-text-secondary);
}

.msg--narrator .msg__role {
  color: var(--color-signal-success);
}

.msg--system .msg__role {
  color: var(--color-text-muted);
}

/* narrator / system 正文用次要色，克制区分于 user/assistant。 */
.msg--narrator .msg__content,
.msg--system .msg__content {
  color: var(--color-text-secondary);
}

.msg--system .msg__content {
  font-style: italic;
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

.msg__content--empty {
  color: var(--color-text-muted);
}

/* SC1-7 编辑入口：悬停时显现的小铅笔（克制、不呶嗈） */
.msg__edit-btn {
  display: inline-flex;
  align-items: center;
  padding: 1px 3px;
  border-radius: 3px;
  color: var(--color-text-muted);
  opacity: 0;
  transition:
    opacity 150ms cubic-bezier(0.2, 0, 0, 1),
    background-color 150ms cubic-bezier(0.2, 0, 0, 1);
}

.msg:hover .msg__edit-btn {
  opacity: 1;
}

.msg__edit-btn:hover:not(:disabled) {
  background: var(--color-float);
  color: var(--color-text-primary);
}

.msg__edit-btn:disabled {
  opacity: 0;
  cursor: not-allowed;
}

.msg__edit {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.msg__edit-input {
  width: 100%;
  resize: vertical;
  border-radius: 6px;
  border: 1px solid var(--color-line-active);
  background: var(--color-float);
  padding: 6px 8px;
  font-size: 14px;
  line-height: 1.55;
  color: var(--color-text-primary);
}

.msg__edit-input:focus {
  outline: none;
  box-shadow: 0 0 0 1px var(--color-signal-accent);
}

.msg__edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.msg__edit-cancel,
.msg__edit-save {
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 12px;
  transition: background-color 150ms cubic-bezier(0.2, 0, 0, 1);
}

.msg__edit-cancel {
  color: var(--color-text-secondary);
}

.msg__edit-cancel:hover {
  background: var(--color-float);
  color: var(--color-text-primary);
}

.msg__edit-save {
  border: 1px solid var(--color-signal-accent);
  color: var(--color-signal-accent);
}

.msg__edit-save:hover:not(:disabled) {
  background: var(--color-float);
}

.msg__edit-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.timeline-more {
  display: flex;
  justify-content: center;
  padding: 4px 0 16px;
}

.timeline-more__btn {
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-line-subtle);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-secondary);
  transition: background-color 150ms cubic-bezier(0.2, 0, 0, 1);
}

.timeline-more__btn:hover:not(:disabled) {
  background: var(--color-float);
  color: var(--color-text-primary);
}

.timeline-more__btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.timeline-more__btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px var(--color-signal-accent);
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

/* SC1-8 swipe 控件：紧凑的“‹ 第 i / 共 n ›”，克制不喧哗。 */
.floor__swipe {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.floor__swipe-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 2px;
  border-radius: 3px;
  color: var(--color-text-secondary);
  transition: background-color 150ms cubic-bezier(0.2, 0, 0, 1);
}

.floor__swipe-btn:hover:not(:disabled) {
  background: var(--color-float);
  color: var(--color-text-primary);
}

.floor__swipe-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.floor__swipe-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px var(--color-signal-accent);
}

.floor__swipe-pos {
  min-width: 3.5em;
  text-align: center;
  white-space: nowrap;
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
