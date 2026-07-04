<script setup lang="ts">
/**
 * "@" 提及镜像高亮层（图助手 · 提及阶段）。
 *
 * 纯展示：把 textarea 的同一段纯文本重画一遍，命中提及的 `@名称` 加上等宽高亮底色。
 * 数据层与视觉层分离——本层不持有事实源，只按解析索引切片渲染，高亮不进数据。
 *
 * 等宽约束（关键）：本层提及段渲染的文字必须与 textarea 里的纯文本逐字符等宽，
 * 否则光标与后续文字会错位。因此高亮段只用背景色与圆角着色（不占宽度），
 * 不加图标、边框、内外边距。删除整段由 textarea 的 backspace 完成，本层不承担交互。
 *
 * 对齐约束：本层与 textarea 共享同一套排版样式（字体、行高、padding、white-space、word-break），
 * 并随 textarea 滚动同步偏移。容器 pointer-events:none 让全部点击穿透到 textarea。
 */
import { computed } from "vue";

import { segmentMentionText, type MentionIndex } from "./segment-mention-text";

const props = defineProps<{
  text: string;
index: MentionIndex;
  /** 与 textarea 同步的纵向滚动偏移（px）。 */
  scrollTop?: number;
}>();

const segments = computed(() => segmentMentionText(props.text, props.index));
</script>

<template>
  <div
    class="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 text-sm leading-relaxed text-text-primary"
    :style="{ transform: `translateY(${-(scrollTop ?? 0)}px)` }"
    aria-hidden="true"
  >
    <template v-for="(segment, i) in segments" :key="i"
      ><span v-if="segment.type === 'text'">{{ segment.value }}</span
      ><span
        v-else-if="segment.type === 'mention'"
        class="rounded-sm bg-signal-accent/15 text-signal-accent"
        >{{ segment.value }}</span
    ></template>
  </div>
</template>
