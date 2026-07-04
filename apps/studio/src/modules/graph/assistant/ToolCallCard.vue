<script setup lang="ts">
import { AlertTriangle, Ban, Check, ChevronRight, Clock, Loader, X } from "lucide-vue-next";
import { computed, ref, type Component } from "vue";
import { useI18n } from "vue-i18n";

import type { ToolCallStatusKind, ToolCallView } from "./tool-call-view";

const props = defineProps<{
  view: ToolCallView;
}>();

const { t, te } = useI18n();

/**进行中默认展开（只显示状态文案），其余默认折叠。 */
const open = ref(props.view.running);

const STATUS_ICON: Record<ToolCallStatusKind, Component> = {
  running: Loader,
  success: Check,
  error: X,
  blocked: Ban,
  pending: Clock,
};

const statusIcon = computed(() => STATUS_ICON[props.view.statusKind]);

const categoryLabel = computed(() => {
  const key = `graphAssistant.toolPolicy.category.${props.view.category}`;
  return te(key) ? t(key) : props.view.category;
});

function phaseLabel(phase: string): string {
  const key = `graphAssistant.floor.toolPhase.${phase}`;
  return te(key) ? t(key) : phase;
}

const durationText = computed(() => {
  const ms = props.view.durationMs;
  if (ms === null || ms <= 0) {
    return null;
  }
  return `${(ms / 1000).toFixed(1)}s`;
});

/** message 行在失败 / 阻止态用错误色并带警示图标。 */
const messageIsError = computed(
  () => props.view.statusKind === "error" || props.view.statusKind === "blocked",
);

function toggle(): void {
  open.value = !open.value;
}
</script>

<template>
  <div class="tcc" :class="`tcc--${view.statusKind}`">
    <button type="button" class="tcc__head" :aria-expanded="open" @click="toggle">
      <component
        :is="statusIcon"
        class="tcc__status"
        :class="view.running ? 'tcc__spin' : ''"
        :size="13"
        :stroke-width="1.5"
      />
      <span class="tcc__category">{{categoryLabel }}</span>
      <span class="tcc__name" :title="view.shortName">{{ view.shortName }}</span>

      <span v-if="view.danger" class="tcc__danger">
        <AlertTriangle :size="9" :stroke-width="1.5" />
        {{ t("graphAssistant.toolPolicy.danger") }}
      </span>
      <span v-if="durationText" class="tcc__duration">{{ durationText }}</span>
      <ChevronRight class="tcc__chevron" :class="open ? 'tcc__chevron--open' : ''" :size="12" :stroke-width="1.5" />
    </button>

    <div v-if="open" class="tcc__body">
      <!-- 进行中：只显示状态文案，不铺开参数明细 -->
      <template v-if="view.running">
        <p class="tcc__statusText">{{ phaseLabel(view.phase) }}</p>
        <p v-if="view.hasArgs" class="tcc__progress">{{ t("graphAssistant.floor.toolArgsReceived") }}</p>
      </template>

      <!-- 已结束：message + 参数键值表 -->
      <template v-else>
        <p v-if="view.message" class="tcc__message" :class="messageIsError ? 'tcc__message--error' : ''">
          <AlertTriangle v-if="messageIsError" :size="11" :stroke-width="1.5" class="tcc__messageIcon" />
          {{ view.message }}
        </p>

        <dl v-if="view.argsSummary.entries.length > 0" class="tcc__args">
          <div v-for="entry in view.argsSummary.entries" :key="entry.key" class="tcc__arg">
            <dt>{{ entry.key }}</dt>
            <dd :title="entry.value">{{ entry.value }}</dd>
          </div>
          <p v-if="view.argsSummary.truncatedCount > 0" class="tcc__more">
            {{ t("graphAssistant.confirmation.moreArgs", { count: view.argsSummary.truncatedCount }) }}
          </p>
        </dl>
        <p v-else class="tcc__noArgs">{{ t("graphAssistant.confirmation.noArgs") }}</p>
      </template>
  </div>
  </div>
</template>

<style scoped>
.tcc {
  border: 1px solid var(--color-line-subtle);
  border-radius: 6px;
  background: var(--color-float);
}

/* 状态色仅作用于左侧状态图标，避免整卡片喧宾夺主 */
.tcc--success .tcc__status {
  color: var(--color-signal-success);
}

.tcc--error .tcc__status {
  color: var(--color-signal-error);
}

.tcc--blocked .tcc__status {
  color: var(--color-signal-warn);
}

.tcc--pending .tcc__status {
  color: var(--color-signal-info);
}

.tcc--running .tcc__status {
  color: var(--color-text-muted);
}

.tcc__head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  text-align: left;
}

.tcc__status {
  flex-shrink: 0;
}

.tcc__category {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}

.tcc__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-primary);
}

.tcc__danger {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
  padding: 1px 4px;
  border: 1px solid color-mix(in srgb, var(--color-signal-error) 40%, transparent);
  border-radius: 4px;
  font-size: 9px;
  text-transform: uppercase;
  color: var(--color-signal-error);
}

.tcc__duration {
  flex-shrink: 0;
  font-family: var(--font-mono);
 font-size: 10px;
  color: var(--color-text-muted);
}

.tcc__chevron {
  flex-shrink: 0;
  color: var(--color-text-muted);
  transition: transform 150ms;
}

.tcc__chevron--open {
  transform:rotate(90deg);
}

.tcc__body {
  padding: 0 8px 6px 8px;
}

.tcc__statusText {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-secondary);
}

.tcc__progress {
  margin-top: 2px;
  font-size: 10px;
  color: var(--color-text-muted);
}

.tcc__message {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  margin-bottom: 4px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.tcc__message--error {
  color: var(--color-signal-error);
}

.tcc__messageIcon {
  flex-shrink: 0;
  margin-top: 1px;
}

.tcc__args {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tcc__arg {
  display: flex;
  gap: 6px;
  font-size: 11px;
  line-height: 1.4;
}

.tcc__arg dt {
  flex-shrink: 0;
  font-family: var(--font-mono);
  color: var(--color-text-muted);
}

.tcc__arg dd {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-secondary);
}

.tcc__more {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-muted);
}

.tcc__noArgs {
  font-size: 11px;
  color: var(--color-text-muted);
}

.tcc__spin {
  animation: tcc-spin 1s linear infinite;
}

@keyframes tcc-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
