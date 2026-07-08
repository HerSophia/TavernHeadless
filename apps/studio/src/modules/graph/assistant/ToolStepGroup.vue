<script setup lang="ts">
import {
  Ban,
  Check,
  ChevronRight,
  Clock,
  Loader,
  RotateCcw,
  Wrench,
  X,
} from "lucide-vue-next";
import { computed, ref, type Component } from "vue";
import { useI18n } from "vue-i18n";

import ToolCallCard from "./ToolCallCard.vue";
import {
  aggregateToolCallStatus,
  type ToolCallStatusKind,
  type ToolCallView,
} from "./tool-call-view";

/** 工具分组内单步：视图 + 全局 step 序号（供 step 级重试定位）。 */
interface ToolStepItem {
  view: ToolCallView;
  /** 在该楼层 step 序列中的全局 index；流式期间退化为分组内序号。 */
  stepIndex: number;
}

const props = defineProps<{
  /**该段内连续的工具步。 */
  items: ToolStepItem[];
  /** 默认是否展开：流式期间默认展开，历史楼层默认折叠。 */
  defaultOpen?: boolean;
  /** 所属楼层 id，供 step 级重试事件回传。 */
  floorId: string;
  /** 任何生成进行中（全局忙碌或本楼层未落定）时禁用重试此步。 */
  disabled?: boolean;
}>();

const emit = defineEmits<{
  /** step 级重试：丢弃该步及其之后的往返，从该步重新生成（实际发起与副作用预判在上层完成）。 */
  (event: "retry-step", payload: { floorId: string; stepIndex: number }): void;
}>();

const { t } = useI18n();

const open = ref(Boolean(props.defaultOpen));

const views = computed(() => props.items.map((item) => item.view));

/** 分组头聚合状态：驱动右侧状态徽标的图标与颜色。 */
const aggregateStatus = computed(() => aggregateToolCallStatus(views.value));

const STATUS_ICON: Record<ToolCallStatusKind, Component> = {
  running: Loader,
  success: Check,
  error: X,
  blocked: Ban,
  pending: Clock,
};

const statusIcon = computed(() => STATUS_ICON[aggregateStatus.value]);
</script>

<template>
  <div class="tsg">
    <button type="button" class="tsg__toggle" @click="open = !open">
      <ChevronRight
        class="tsg__chevron"
        :class="open ? 'tsg__chevron--open' : ''"
        :size="12"
        :stroke-width="1.5"
      />
      <Wrench :size="12" :stroke-width="1.5" />
      {{ t("graphAssistant.floor.tools") }}
      <span class="tsg__count">{{ items.length }}</span>
      <component
        :is="statusIcon"
        class="tsg__status"
        :class="[
          `tsg__status--${aggregateStatus}`,
          aggregateStatus === 'running' ? 'tsg__spin' : '',
        ]"
        :size="12"
        :stroke-width="1.5"
      />
    </button>
    <div v-if="open" class="tsg__list">
      <div v-for="item in items" :key="item.view.key" class="tsg__step">
        <ToolCallCard :view="item.view" />
        <!-- step 级重试：从该步重新生成。写类起点拦截与副作用确认弹框在上层处理。 -->
        <button
          type="button"
          class="tsg__retry"
          :disabled="disabled"
          :title="t('graphAssistant.floor.retryStep')"
          @click="emit('retry-step', { floorId, stepIndex: item.stepIndex })"
        >
          <RotateCcw :size="11" :stroke-width="1.5" />
          {{ t("graphAssistant.floor.retryStep") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tsg {
  margin: 6px 0;
}

.tsg__toggle {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-muted);
  transition: color 150ms;
}

.tsg__toggle:hover {
  color: var(--color-text-secondary);
}

.tsg__chevron {
  transition: transform 150ms;
}

.tsg__chevron--open {
  transform: rotate(90deg);
}

.tsg__count {
  font-size: 9px;
  color: var(--color-text-muted);
}

.tsg__status {
  margin-left: auto;
  flex-shrink: 0;
}

.tsg__status--success {
  color: var(--color-signal-success);
}

.tsg__status--error {
  color: var(--color-signal-error);
}

.tsg__status--blocked {
  color: var(--color-signal-warn);
}

.tsg__status--pending {
  color: var(--color-signal-info);
}

.tsg__status--running {
  color: var(--color-text-muted);
}

.tsg__list {
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 单个工具 step：卡片 + 末尾重试骨架按钮，体现「同一回合内的连续推进」 */
.tsg__step {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tsg__retry {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: color 150ms;
}

.tsg__retry:hover:not(:disabled) {
  color: var(--color-text-secondary);
}

.tsg__retry:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.tsg__spin {
  animation: tsg-spin 1s linear infinite;
}

@keyframes tsg-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
