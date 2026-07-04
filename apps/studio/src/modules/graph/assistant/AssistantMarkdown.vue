<script setup lang="ts">
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { computed, nextTick, onMounted, ref, watch } from "vue";

import{
  MERMAID_BLOCK_CLASS,
  MERMAID_SOURCE_CLASS,
  renderMarkdownToHtml,
} from "./assistant-markdown";

const props= defineProps<{
  content: string;
  /** 流式生成中：图定义可能不完整，不渲染 mermaid，只显示源码。 */
  streaming?: boolean;
}>();

const root = ref<HTMLElement | null>(null);

/** markdown-it 渲染 + DOMPurify 兜底净化（mermaid 占位容器与源码 pre 会被保留）。 */
const html = computed(() => DOMPurify.sanitize(renderMarkdownToHtml(props.content)));

/** 按当前明暗主题初始化 mermaid（幂等，便于主题切换后重新渲染时跟随）。 */
function configureMermaid(): void {
  const dark = document.documentElement.classList.contains("dark");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: dark ? "dark" : "default",
  });
}

/** 把占位容器内的 mermaid 源码渲染为 SVG；流式期间跳过，仅保留源码展示。 */
async function renderMermaidBlocks(): Promise<void> {
  const host = root.value;
  if (!host || props.streaming) {
    return;
  }
  const blocks = Array.from(host.querySelectorAll<HTMLElement>(`.${MERMAID_BLOCK_CLASS}`));
  if (blocks.length === 0) {
    return;
  }
  configureMermaid();
  let index =0;
  for (const block of blocks) {
    if (block.dataset.rendered === "1") {
      continue;
    }
    const source = block.querySelector(`.${MERMAID_SOURCE_CLASS}`)?.textContent ?? "";
    if (!source.trim()) {
      continue;
    }
  index += 1;
    const id = `am-mermaid-${Date.now().toString(36)}-${index}`;
    try {
      const { svg } = await mermaid.render(id, source);
      block.innerHTML = svg;
      block.dataset.rendered = "1";
    } catch {
      // 渲染失败（语法错误等）：保留源码展示，标记错误态。
      block.dataset.error = "1";
    }
  }
}

watch(
  () => [html.value, props.streaming] as const,
  () => {
    void nextTick(renderMermaidBlocks);
  },
);

onMounted(() => {
  void nextTick(renderMermaidBlocks);
});
</script>

<template>
<div ref="root" class="am" v-html="html" />
</template>

<style scoped>
.am{
  font-size: 13px;
  line-height: 1.6;
  color: var(--color-text-primary);
overflow-wrap: anywhere;
}

.am :deep(p) {
  margin: 0 0 8px;
}

.am :deep(p:last-child) {
  margin-bottom: 0;
}

.am :deep(h1),
.am :deep(h2),
.am :deep(h3),
.am :deep(h4) {
  margin: 12px 0 6px;
  font-weight: 600;
  line-height: 1.3;
}

.am :deep(h1) {
  font-size: 16px;
}

.am :deep(h2) {
  font-size: 15px;
}

.am :deep(h3) {
  font-size: 14px;
}

.am :deep(h4) {
  font-size: 13px;
}

.am :deep(ul),
.am :deep(ol) {
  margin: 0 0 8px;
  padding-left: 20px;
}

.am :deep(li) {
  margin: 2px 0;
}

.am :deep(li > ul),
.am :deep(li > ol) {
  margin: 2px 0;
}

.am :deep(a) {
  color: var(--color-signal-accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.am :deep(strong) {
 font-weight: 600;
}

.am :deep(em) {
  font-style: italic;
}

.am :deep(blockquote) {
  margin: 0 0 8px;
  padding: 2px 0 2px 10px;
border-left: 2px solid var(--color-line-active);
 color: var(--color-text-secondary);
}

.am :deep(hr) {
  margin: 10px 0;
  border: none;
  border-top: 1px solid var(--color-line-subtle);
}

.am :deep(code) {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--color-float);
}

.am :deep(pre) {
  margin: 0 0 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--color-float);
  overflow-x: auto;
}

.am :deep(pre code) {
  padding: 0;
  background: transparent;
  font-size: 12px;
  line-height: 1.5;
}

.am :deep(table) {
  margin: 0 0 8px;
  border-collapse: collapse;
  font-size: 12px;
}

.am :deep(th),
.am :deep(td) {
  padding: 4px 8px;
  border: 1px solid var(--color-line-subtle);
  text-align: left;
}

.am :deep(th) {
  background: var(--color-float);
  font-weight: 600;
}

.am :deep(img) {
  max-width: 100%;
  border-radius: 6px;
}

/* mermaid 占位：未渲染前显示源码（流式 / 渲染失败时）；渲染后内部替换为SVG 居中显示 */
.am :deep(.am-mermaid) {
  margin: 0 0 8px;
  display: flex;
  justify-content: center;
}

.am :deep(.am-mermaid svg) {
  max-width: 100%;
  height: auto;
}

.am :deep(.am-mermaid__src) {
  width: 100%;
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--color-float);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.am :deep(.am-mermaid[data-error="1"] .am-mermaid__src) {
  border: 1px solid var(--color-signal-error);
}
</style>
