<script setup lang="ts">
import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import { computed } from "vue";

type MessageFormat = "json" | "markdown" | "text";

const props = defineProps<{
  content: string;
  format: MessageFormat;
}>();

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false
});

const renderedHtml = computed(() => {
  const source = props.format === "json" ? `\`\`\`json\n${props.content}\n\`\`\`` : props.content;
  const unsafeHtml = markdown.render(source);
  return DOMPurify.sanitize(unsafeHtml);
});
</script>

<template>
  <article class="markdown-block" v-html="renderedHtml" />
</template>
