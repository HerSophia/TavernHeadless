<script setup lang="ts">
/**
 * 会话列表行（SC1-2）。
 *
 * 承载：多选框、行内改名（双击标题 / 菜单“重命名” → 输入，Enter 提交、Escape 取消、blur 提交）、
 * 状态徽标、更新时间、行操作菜单（归档 / 取消归档 / 删除）。
 * 行本身只做展示与事件派发，写操作由 SessionListPanel 编排到 context store（单一事实源）。
 */
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Trash2 } from "lucide-vue-next";
import { nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";

import UiDropdown from "../../../ui/UiDropdown.vue";
import UiIconButton from "../../../ui/UiIconButton.vue";
import UiMenuItem from "../../../ui/UiMenuItem.vue";

type SessionRow = {
  id: string;
  title: string | null;
  status: "active" | "archived";
  updatedAt: number;
};

const props = defineProps<{
  session: SessionRow;
  selected: boolean;
  active: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  select: [id: string];
  "toggle-select": [id: string];
  rename: [id: string, title: string];
  archive: [id: string];
  unarchive: [id: string];
  delete: [id: string];
}>();

const { t } = useI18n();

const editing = ref(false);
const draft = ref("");
const inputEl = ref<HTMLInputElement | null>(null);

async function startEdit(): Promise<void> {
  if (props.disabled) {
    return;
  }
  draft.value = props.session.title ?? "";
  editing.value = true;
  await nextTick();
  inputEl.value?.focus();
  inputEl.value?.select();
}

function commitEdit(): void {
  if (!editing.value) {
    return;
  }
  editing.value = false;
  const next = draft.value.trim();
  const previous = props.session.title ?? "";
  if (next && next !== previous) {
    emit("rename", props.session.id, next);
  }
}

function cancelEdit(): void {
  editing.value = false;
}

function formatUpdatedAt(ts: number): string {
  if (!ts) {
    return "";
  }
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}
</script>

<template>
  <li
    class="flex items-start gap-2 border-l-2 px-2 py-2 transition-colors duration-150"
    :class="active ? 'border-signal-accent bg-float' : 'border-transparent hover:bg-float'"
  >
    <input
      type="checkbox"
      class="mt-1 shrink-0 accent-signal-accent"
      :checked="selected"
      :disabled="disabled"
      :aria-label="t('chat.sessions.batch.select')"
      @change="emit('toggle-select', session.id)"
    />

    <div class="min-w-0 flex-1">
      <!-- Title / inline rename -->
      <input
        v-if="editing"
        ref="inputEl"
        v-model="draft"
        class="w-full rounded border border-line-active bg-float px-1.5 py-0.5 text-sm text-text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
        :placeholder="t('chat.sessions.renamePlaceholder')"
        @keydown.enter.prevent="commitEdit"
        @keydown.esc.prevent="cancelEdit"
        @blur="commitEdit"
      />
      <button
        v-else
        type="button"
        class="block w-full truncate text-left text-sm text-text-primary focus:outline-none"
        @click="emit('select', session.id)"
        @dblclick="startEdit"
      >
        {{ session.title ?? session.id }}
      </button>

      <div class="mt-0.5 flex items-center gap-1.5">
        <span
          class="shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none"
          :class="session.status === 'archived' ? 'bg-panel text-text-muted' : 'bg-panel text-text-secondary'"
        >
          {{ t(`chat.sessions.status.${session.status}`) }}
        </span>
        <span class="truncate text-[11px] text-text-muted">
          {{ formatUpdatedAt(session.updatedAt) }}
        </span>
      </div>
    </div>

    <!-- Row actions -->
    <UiDropdown align="right" panel-width="10rem">
      <template #trigger="{ toggle, open }">
        <UiIconButton :label="t('chat.sessions.actions')" :active="open" :disabled="disabled" @click="toggle">
          <MoreHorizontal :size="15" :stroke-width="1.5" />
        </UiIconButton>
      </template>
      <template #default="{ close }">
        <UiMenuItem :label="t('chat.sessions.rename')" @click="close(); startEdit()">
          <template #icon><Pencil :size="13" :stroke-width="1.5" /></template>
        </UiMenuItem>
        <UiMenuItem
          v-if="session.status === 'active'"
          :label="t('chat.sessions.archive')"
          @click="close(); emit('archive', session.id)"
        >
          <template #icon><Archive :size="13" :stroke-width="1.5" /></template>
        </UiMenuItem>
        <UiMenuItem
          v-else
          :label="t('chat.sessions.unarchive')"
          @click="close(); emit('unarchive', session.id)"
        >
          <template #icon><ArchiveRestore :size="13" :stroke-width="1.5" /></template>
        </UiMenuItem>
        <UiMenuItem danger :label="t('chat.sessions.delete')" @click="close(); emit('delete', session.id)">
          <template #icon><Trash2 :size="13" :stroke-width="1.5" /></template>
        </UiMenuItem>
      </template>
    </UiDropdown>
  </li>
</template>
