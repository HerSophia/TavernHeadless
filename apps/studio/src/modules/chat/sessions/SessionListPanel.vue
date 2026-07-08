<script setup lang="ts">
/**
 * 会话列表面板（SC1-1 列表 + 选择；SC1-2 生命周期操作）。
 *
 * 列表数据与选择读写 context store（单一事实源）：状态过滤、游标分页“加载更多”、显式选择。
 * 生命周期写操作（改名 / 归档 / 删除 / 批量）编排到 context store 的对应 action；
 * 破坏性操作（删除 / 批量删除）经最小 ConfirmDialog 二次确认。
 */
import { AlertCircle, Archive, ArchiveRestore, Trash2, X } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import { useContextStore, type SessionStatusFilter } from "../../../stores/context";
import UiButton from "../../../ui/UiButton.vue";
import UiIconButton from "../../../ui/UiIconButton.vue";
import UiSelect from "../../../ui/UiSelect.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import SessionListItem from "./SessionListItem.vue";

const { t } = useI18n();
const ctx = useContextStore();

const filterOptions = computed<{ value: SessionStatusFilter; label: string }[]>(() => [
  { value: "active", label: t("chat.sessions.filter.active") },
  { value: "archived", label: t("chat.sessions.filter.archived") },
  { value: "all", label: t("chat.sessions.filter.all") },
]);

// —— 多选状态（面板本地）：仅对已加载且仍存在的会话生效 ——
const selectedIds = ref<string[]>([]);
const selectedExisting = computed(() =>
  selectedIds.value.filter((id) => ctx.sessions.some((session) => session.id === id)),
);
const selectedCount = computed(() => selectedExisting.value.length);

function isSelected(id: string): boolean {
  return selectedIds.value.includes(id);
}

function toggleSelect(id: string): void {
  selectedIds.value = isSelected(id)
    ? selectedIds.value.filter((candidate) => candidate !== id)
    : [...selectedIds.value, id];
}

function clearSelection(): void {
  selectedIds.value = [];
}

// —— 二次确认（单条删除 / 批量删除共用一个最小对话框） ——
type ConfirmState =
  | { kind: "delete-one"; id: string }
  | { kind: "delete-batch"; ids: string[] };
const confirmState = ref<ConfirmState | null>(null);

const confirmMessage = computed(() => {
  const state = confirmState.value;
  if (!state) {
    return "";
  }
  return state.kind === "delete-one"
    ? t("chat.sessions.confirmDelete")
    : t("chat.sessions.confirmDeleteBatch", { count: state.ids.length });
});

async function onConfirm(): Promise<void> {
  const state = confirmState.value;
  if (!state) {
    return;
  }
  if (state.kind === "delete-one") {
    await ctx.deleteSession(state.id);
    selectedIds.value = selectedIds.value.filter((id) => id !== state.id);
  } else {
    await ctx.batchDelete(state.ids);
    clearSelection();
  }
  confirmState.value = null;
}

// —— 批量结果提示 ——
const batchResultMessage = computed(() => {
  const result = ctx.lastBatchResult;
  if (!result) {
    return "";
  }
  const parts: string[] = [];
  if (result.kind === "status") {
    parts.push(t("chat.sessions.result.updated", { count: result.meta.updated }));
  } else {
    parts.push(t("chat.sessions.result.deleted", { count: result.meta.deleted }));
  }
  if (result.meta.notFound > 0) {
    parts.push(t("chat.sessions.result.notFound", { count: result.meta.notFound }));
  }
  return parts.join(", ");
});

// —— 事件编排 ——
function onFilterChange(next: SessionStatusFilter): void {
  void ctx.setSessionStatusFilter(next);
}

function onSelect(id: string): void {
  ctx.selectSession(id);
}

function onRename(id: string, title: string): void {
  void ctx.renameSession(id, title);
}

function onArchive(id: string): void {
  selectedIds.value = selectedIds.value.filter((candidate) => candidate !== id);
  void ctx.archiveSession(id);
}

function onUnarchive(id: string): void {
  void ctx.unarchiveSession(id);
}

function onDelete(id: string): void {
  confirmState.value = { kind: "delete-one", id };
}

function onBatchArchive(): void {
  void ctx.batchArchive(selectedExisting.value).then(clearSelection);
}

function onBatchUnarchive(): void {
  void ctx.batchUnarchive(selectedExisting.value).then(clearSelection);
}

function onBatchDelete(): void {
  confirmState.value = { kind: "delete-batch", ids: [...selectedExisting.value] };
}

function onLoadMore(): void {
  void ctx.loadMoreSessions();
}
</script>

<template>
  <aside class="flex h-full w-60 shrink-0 flex-col border-r border-line-subtle bg-panel">
    <!-- Header + status filter -->
    <div class="flex shrink-0 flex-col gap-2 border-b border-line-subtle px-3 py-2">
      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-text-secondary">{{ t("chat.sessions.title") }}</span>
        <div class="ml-auto w-28">
          <UiSelect
            :model-value="ctx.sessionStatusFilter"
            :options="filterOptions"
            :disabled="ctx.loadingSessions"
            @update:model-value="onFilterChange"
          />
        </div>
      </div>

      <!-- Batch toolbar -->
      <div
        v-if="selectedCount > 0"
        class="flex flex-wrap items-center gap-1.5 rounded-md border border-line-subtle bg-float px-2 py-1.5"
      >
        <span class="text-[11px] text-text-secondary">
          {{ t("chat.sessions.batch.selectedCount", { count: selectedCount }) }}
        </span>
        <div class="ml-auto flex items-center gap-1">
          <UiIconButton
            :label="t('chat.sessions.batch.archive')"
            :disabled="ctx.mutating"
            @click="onBatchArchive"
          >
            <Archive :size="14" :stroke-width="1.5" />
          </UiIconButton>
          <UiIconButton
            :label="t('chat.sessions.batch.unarchive')"
            :disabled="ctx.mutating"
            @click="onBatchUnarchive"
          >
            <ArchiveRestore :size="14" :stroke-width="1.5" />
          </UiIconButton>
          <UiIconButton
            :label="t('chat.sessions.batch.delete')"
            :disabled="ctx.mutating"
            @click="onBatchDelete"
          >
            <Trash2 :size="14" :stroke-width="1.5" />
          </UiIconButton>
          <UiIconButton :label="t('chat.sessions.batch.clearSelection')" @click="clearSelection">
            <X :size="14" :stroke-width="1.5" />
          </UiIconButton>
        </div>
      </div>
    </div>

    <!-- Batch result -->
    <div
      v-if="batchResultMessage"
      class="flex shrink-0 items-center gap-2 border-b border-line-subtle px-3 py-1.5 text-xs text-text-secondary"
    >
      <span class="min-w-0 flex-1 truncate">{{ batchResultMessage }}</span>
      <UiIconButton :label="t('chat.dismiss')" @click="ctx.clearLastBatchResult()">
        <X :size="13" :stroke-width="1.5" />
      </UiIconButton>
    </div>

    <!-- Error banner -->
    <div
      v-if="ctx.error"
      class="flex shrink-0 items-center gap-2 border-b border-line-subtle px-3 py-1.5 text-xs text-signal-error"
    >
      <AlertCircle :size="13" :stroke-width="1.5" />
      <span class="min-w-0 flex-1 truncate">{{ ctx.error }}</span>
    </div>

    <!-- List -->
    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="ctx.loadingSessions" class="px-3 py-3 text-xs text-text-muted">
        {{ t("chat.sessions.loading") }}
      </div>

      <div v-else-if="ctx.sessions.length === 0" class="px-3 py-6 text-center text-xs text-text-muted">
        {{ t("chat.sessions.empty") }}
      </div>

      <ul v-else class="flex flex-col py-1">
        <SessionListItem
          v-for="session in ctx.sessions"
          :key="session.id"
          :session="session"
          :selected="isSelected(session.id)"
          :active="session.id === ctx.currentSessionId"
          :disabled="ctx.mutating"
          @select="onSelect"
          @toggle-select="toggleSelect"
          @rename="onRename"
          @archive="onArchive"
          @unarchive="onUnarchive"
          @delete="onDelete"
        />
      </ul>
    </div>

    <!-- Load more -->
    <div v-if="ctx.sessionsHasMore" class="shrink-0 border-t border-line-subtle p-2">
      <UiButton
        variant="ghost"
        class="w-full justify-center !text-xs"
        :disabled="ctx.loadingMoreSessions"
        @click="onLoadMore"
      >
        {{ ctx.loadingMoreSessions ? t("chat.sessions.loadingMore") : t("chat.sessions.loadMore") }}
      </UiButton>
    </div>

    <ConfirmDialog
      :open="confirmState !== null"
      :title="t('chat.sessions.confirmDeleteTitle')"
      :message="confirmMessage"
      :confirm-label="t('chat.sessions.delete')"
      :cancel-label="t('chat.sessions.cancel')"
      :busy="ctx.mutating"
      @confirm="onConfirm"
      @cancel="confirmState = null"
    />
  </aside>
</template>
