<script setup lang="ts">
import { Send, Square } from "lucide-vue-next";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import UiButton from "../../../ui/UiButton.vue";
import UiIconButton from "../../../ui/UiIconButton.vue";
import MentionHighlightOverlay from "./MentionHighlightOverlay.vue";
import MentionPopup from "./MentionPopup.vue";
import { findActiveMentionQuery } from "./mention-query";
import { filterCandidates } from "./mention-providers";
import type { MentionCandidate, MentionRef } from "./mention-types";
import { collectMentionRefs, segmentMentionText } from "./segment-mention-text";
import { useMentionSources } from "./use-mention-sources";

const props = defineProps<{
  disabled?: boolean;
  busy?: boolean;
  /** 当前项目 id，用于按需加载图候选。 */
  projectId?: string | null;
}>();

const emit = defineEmits<{
  (event: "send", payload: { text: string; mentions: MentionRef[] }): void;
  (event: "stop"): void;
}>();

const { t } = useI18n();

const text = ref("");
const textarea = ref<HTMLTextAreaElement | null>(null);
const scrollTop = ref(0);

const { sources, index, loadingGraphs, ensureGraphs, register } = useMentionSources();

// —— 提及弹层状态 ——
const popupOpen = ref(false);
const candidates = ref<MentionCandidate[]>([]);
const activeIndex = ref(0);
/** 当前激活的 @query 在文本中的起始下标（含 @）。 */
const queryStart = ref(-1);

function autoGrow(): void {
  const el = textarea.value;
  if (!el) {
    return;
  }
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

watch(text, () => {
  void nextTick(autoGrow);
});

/** 关闭提及弹层并复位激活态。 */
function closePopup(): void {
  popupOpen.value = false;
  candidates.value = [];
  activeIndex.value =0;
  queryStart.value = -1;
}

/** 根据光标位置刷新提及弹层（输入 / 光标移动后调用）。 */
function refreshMention(): void {
  const el = textarea.value;
  if (!el) {
    closePopup();
    return;
  }
  const active = findActiveMentionQuery(text.value, el.selectionStart ?? text.value.length);
  if (!active) {
    closePopup();
    return;
  }
  queryStart.value = active.start;
  void ensureGraphs(props.projectId);
  candidates.value = filterCandidates(active.query, sources.value);
  activeIndex.value = 0;
  popupOpen.value = true;
}

function onInput(): void {
  refreshMention();
}

/** 光标移动（方向键 / 点击）后重新判定是否在提及中。 */
function onKeyup(event: KeyboardEvent): void {
  if (["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(event.key) && popupOpen.value) {
    return;
  }
  refreshMention();
}

function onScroll(): void {
  scrollTop.value = textarea.value?.scrollTop ?? 0;
}

/**确认一个候选：替换 @query 片段为完整 @名称 并补空格，写解析索引。 */
function applyCandidate(candidate: MentionCandidate): void {
  const el = textarea.value;
  if (!el || queryStart.value < 0) {
    return;
  }
  const caret = el.selectionStart ?? text.value.length;
  const before = text.value.slice(0, queryStart.value);
  const after = text.value.slice(caret);
  const token = `@${candidate.name} `;
  register(candidate);
  text.value = before + token + after;
  closePopup();
const nextCaret = before.length + token.length;
  void nextTick(() => {
    const node = textarea.value;
    if (node) {
      node.focus();
      node.setSelectionRange(nextCaret, nextCaret);
      autoGrow();
    }
  });
}

// —— 键盘：弹层打开时拦截导航键，优先于回车发送 ——
function onArrowDown(event: KeyboardEvent): void {
  if (!popupOpen.value || candidates.value.length === 0){
    return;
  }
  event.preventDefault();
  activeIndex.value = (activeIndex.value + 1) % candidates.value.length;
}

function onArrowUp(event: KeyboardEvent): void {
  if (!popupOpen.value || candidates.value.length === 0) {
    return;
  }
  event.preventDefault();
  activeIndex.value = (activeIndex.value - 1 + candidates.value.length) % candidates.value.length;
}

function onEscape(): void {
  if (popupOpen.value) {
closePopup();
  }
}

/** Enter：弹层打开时确认候选，否则发送。 */
function onEnter(event: KeyboardEvent): void {
  if (popupOpen.value && candidates.value.length > 0) {
    event.preventDefault();
    const picked = candidates.value[activeIndex.value];
    if (picked) {
      applyCandidate(picked);
    }
    return;
  }
  event.preventDefault();
  submit();
}

/** Tab：弹层打开时确认候选（否则交回默认行为）。 */
function onTab(event: KeyboardEvent): void {
  if (popupOpen.value && candidates.value.length >0) {
    event.preventDefault();
    const picked = candidates.value[activeIndex.value];
    if (picked) {
      applyCandidate(picked);
    }
  }
}

function submit():void {
  if (props.disabled || props.busy) {
    return;
  }
  const value = text.value.trim();
  if (!value) {
    return;
  }
  const segments = segmentMentionText(text.value, index.value);
  const mentions = collectMentionRefs(segments);
  emit("send", { text: value, mentions });
  text.value = "";
  closePopup();
  void nextTick(autoGrow);
}

const placeholder = computed(() =>
  props.disabled ? t("graphAssistant.composerDisabled") : t("graphAssistant.composerPlaceholder"),
);
</script>

<template>
  <div class="relative flex items-end gap-2 border-t border-line-subtle bg-panel px-3 py-2.5">
    <MentionPopup
      v-if="popupOpen"
      :candidates="candidates"
      :active-index="activeIndex"
      :loading="loadingGraphs"
      @select="applyCandidate"
      @hover="(i) => (activeIndex = i)"
    />

    <div
      class="relative flex-1 rounded-md border border-line-subtle bg-float transition-colors duration-150 hover:border-line-active focus-within:border-line-active focus-within:ring-1 focus-within:ring-signal-accent"
    >
      <!-- 镜像高亮层：垫在 textarea 下方、点击全穿透；纯展示提及高亮，删除由 textarea 的 backspace 完成 -->
      <MentionHighlightOverlay :text="text" :index="index" :scroll-top="scrollTop" />
      <textarea
        ref="textarea"
        v-model="text"
        rows="1"
        spellcheck="false"
        :disabled="disabled"
        :placeholder="placeholder"
        class="relative block max-h-[120px] min-h-9 w-full resize-none border-0 bg-transparent px-3 py-2 text-sm leading-relaxed text-transparent caret-text-primary placeholder:text-text-muted focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        @input="onInput"
        @keyup="onKeyup"
        @scroll="onScroll"
        @keydown.down="onArrowDown"
        @keydown.up="onArrowUp"
        @keydown.esc="onEscape"
        @keydown.tab="onTab"
        @keydown.enter.exact="onEnter"
      />
    </div>

    <UiIconButton
      v-if="busy"
      :label="t('graphAssistant.stop')"
      @click="emit('stop')"
    >
      <Square :size="15" :stroke-width="1.5" />
    </UiIconButton>
    <UiButton
      v-else
      :disabled="disabled || text.trim().length === 0"
      @click="submit"
    >
      <Send :size="14" :stroke-width="1.5" />
      {{ t("graphAssistant.send") }}
    </UiButton>
  </div>
</template>
