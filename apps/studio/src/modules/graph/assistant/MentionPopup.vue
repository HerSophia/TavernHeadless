<script setup lang="ts">
/**
 * "@" 提及候选弹层（图助手 · 提及阶段）。
 *
 * 纯展示：接收过滤后的候选与当前高亮下标，抛出 hover / 选中事件。
 * 键盘导航与确认逻辑在 AssistantComposer 里处理，本组件只负责呈现与鼠标交互。
 */
import { Box, Network, MousePointerClick } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

import type { MentionCandidate, MentionKind } from "./mention-types";

defineProps<{
  candidates: MentionCandidate[];
  activeIndex: number;
  loading?: boolean;
}>();

const emit =defineEmits<{
  (event: "select", candidate: MentionCandidate): void;
  (event: "hover", index: number): void;
}>();

const { t } = useI18n();

/** 来源类别对应的图标组件。 */
const KIND_ICON: Record<MentionKind, typeof Box> = {
  graph: Network,
  node: Box,
  selection: MousePointerClick,
};
</script>

<template>
  <div
    class="absolute bottom-full left-0 z-40 mb-1 max-h-56 w-72 overflow-y-auto rounded-md border border-line-subtle bg-float py-1 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.55)]"
  >
    <p v-if="loading" class="px-3 py-2 text-xs text-text-muted">
      {{ t("graphAssistant.mention.loading") }}
    </p>
    <p v-else-if="candidates.length === 0" class="px-3 py-2 text-xs text-text-muted">
      {{ t("graphAssistant.mention.empty") }}
    </p>
    <button
      v-for="(candidate, index) in candidates"
      :key="`${candidate.kind}:${candidate.id}`"
      type="button"
      class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors duration-150"
      :class="index === activeIndex ? 'bg-signal-accent/15 text-text-primary' : 'text-text-secondary hover:bg-panel'"
      @mouseenter="emit('hover', index)"
      @mousedown.prevent="emit('select', candidate)"
    >
      <component :is="KIND_ICON[candidate.kind]" :size="14" :stroke-width="1.5" class="shrink-0 text-text-muted" />
      <span class="flex-1 truncate">{{ candidate.name }}</span>
      <span v-if="candidate.subtitle" class="shrink-0 text-[10px] text-text-muted">{{ candidate.subtitle }}</span>
    </button>
  </div>
</template>
