<script setup lang="ts">
/**
 * 主聊天顶部待办事项摘要卡（SC2-12 / #b4-9，决策 F）。
 *
 * 展示会话当前待办清单（由「待办事项工具」在生成回合中写入）。顶部固定、可折叠，
 * 折叠时仅显示标题 + 进度；展开时按状态图标逐条列出。空清单不渲染（由父层控制）。
 */
import {
  ChevronDown,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleSlash,
  ListTodo,
} from "lucide-vue-next";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import type {
  SessionTodoItem,
  SessionTodoListSnapshot,
  TodoItemStatus,
} from "../../lib/session-todo-api";

const props = defineProps<{
  snapshot: SessionTodoListSnapshot;
}>();

const { t } = useI18n();

const collapsed = ref(false);

const counts = computed(() => props.snapshot.counts);
const items = computed(() => props.snapshot.items);

// 进度以「已完成 / 总数」计（已取消不计入分母，避免永远无法达成 100%）。
const denominator = computed(() =>
  Math.max(counts.value.total - counts.value.cancelled, 0),
);
const doneCount = computed(() => counts.value.completed);
const progressPercent = computed(() => {
  const total = denominator.value;
  if (total <= 0) return 0;
  return Math.round((doneCount.value / total) * 100);
});

const statusMeta: Record<
  TodoItemStatus,
  { icon: typeof Circle; class: string; strike?: boolean }
> = {
  pending: { icon: Circle, class: "text-text-muted" },
  in_progress: { icon: CircleDot, class: "text-signal-accent" },
  completed: { icon: CircleCheck, class: "text-signal-success" },
  blocked: { icon: CircleAlert, class: "text-signal-warn" },
  cancelled: { icon: CircleSlash, class: "text-text-muted", strike: true },
};

function metaFor(item: SessionTodoItem) {
  return statusMeta[item.status] ?? statusMeta.pending;
}
</script>

<template>
  <section
    class="shrink-0 border-b border-line-subtle bg-panel"
    :aria-label="t('chat.todo.title')"
  >
    <!-- 摘要头（点击折叠 / 展开） -->
    <button
      type="button"
      class="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-float"
      :aria-expanded="!collapsed"
      @click="collapsed = !collapsed"
    >
      <component
        :is="collapsed ? ChevronRight : ChevronDown"
        :size="14"
        :stroke-width="1.5"
        class="shrink-0 text-text-muted"
      />
      <ListTodo :size="14" :stroke-width="1.5" class="shrink-0 text-signal-accent" />
      <span class="text-xs font-medium text-text-secondary">{{ t("chat.todo.title") }}</span>
      <span class="font-mono text-[11px] text-text-muted">
        {{ t("chat.todo.progress", { done: doneCount, total: denominator }) }}
      </span>
      <!-- 迷你进度条 -->
      <div class="ml-auto h-1 w-16 overflow-hidden rounded-full bg-line-active">
        <div
          class="h-full rounded-full bg-signal-accent transition-all"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
    </button>

    <!-- 待办明细（展开时） -->
    <ul v-if="!collapsed" class="max-h-48 overflow-y-auto px-3 pb-2">
      <li
        v-for="item in items"
        :key="item.id"
        class="flex items-start gap-2 py-1 text-xs"
      >
        <component
          :is="metaFor(item).icon"
          :size="14"
          :stroke-width="1.5"
          :class="['mt-0.5 shrink-0', metaFor(item).class]"
        />
        <div class="min-w-0 flex-1">
          <p
            :class="[
              'leading-snug',
              metaFor(item).strike
                ? 'text-text-muted line-through'
                : item.status === 'completed'
                  ? 'text-text-muted'
                  : 'text-text-primary',
            ]"
          >
            {{ item.title }}
          </p>
          <p v-if="item.note" class="mt-0.5 text-[11px] leading-snug text-text-muted">
            {{ item.note }}
          </p>
        </div>
        <span class="shrink-0 text-[10px] text-text-muted">
          {{ t(`chat.todo.status.${item.status}`) }}
        </span>
      </li>
    </ul>
  </section>
</template>
