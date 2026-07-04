<script setup lang="ts">
/**
 * 回复查看器模态（图助手 · 回复查看器）。
 *
 * 把一条助手回复拆开展示：回复正文（可复制）、思考内容、内容片段（按类型）、
 * 从正文解析出的工具调用、元信息。主要用途是排查原生协议下工具往返文本块是否
 * 泄漏进落库正文：若片段里出现工具块，会在头部给出泄漏提示。
 *
 * 纯展示组件，数据由 `buildReplyInspectorView` 装配；经 Teleport 覆盖到 body。
 */
import { AlertTriangle, Brain, Check, Copy, FileText, Wrench, X } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import type { AssistantFloorMessageView, AssistantFloorView } from "./floor-view-model";
import type { ReplyFragment, ReplyFragmentType } from "./parse-reply-fragments";
import { buildReplyInspectorView } from "./reply-inspector-view";

const props = defineProps<{
  floor: AssistantFloorView;
  message: AssistantFloorMessageView;
}>();

const emit = defineEmits<{ (event: "close"): void }>();

const { t } = useI18n();

const view = computed(() => buildReplyInspectorView({ floor: props.floor, message: props.message }));

const copied = ref(false);

async function copyBody(): Promise<void> {
  try {
    await navigator.clipboard.writeText(view.value.content);
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 1500);
  } catch {
    // 复制失败不致命：忽略（无剪贴板权限的环境）。
  }
}

function fragmentTypeLabel(type: ReplyFragmentType): string {
  return t(`graphAssistant.inspector.fragmentType.${type}`);
}

/** 片段展示文本：文本片段取原文，工具块取标签内内容（无 inner 时回退含标签原文）。 */
function fragmentText(fragment: ReplyFragment): string {
  if (fragment.type === "text") {
    return fragment.raw;
  }
  return fragment.inner ?? fragment.raw;
}

/** 内容片段类型对应的徽标配色类。 */
function fragmentChipClass(type: ReplyFragmentType): string {
  return type === "text" ? "chip--text" : "chip--tool";
}

const metaItems = computed(() => {
  const m = view.value.meta;
  return [
    { key: "floorId", label: t("graphAssistant.inspector.meta.floorId"), value: m.floorId },
    { key: "state", label: t("graphAssistant.inspector.meta.state"), value: m.state },
    { key: "tokenIn", label: t("graphAssistant.inspector.meta.tokenIn"), value: String(m.tokenIn) },
    { key: "tokenOut", label: t("graphAssistant.inspector.meta.tokenOut"), value: String(m.tokenOut) },
    { key: "totalTokens", label: t("graphAssistant.inspector.meta.totalTokens"), value: String(m.totalTokens) },
    {
      key: "duration",
      label: t("graphAssistant.inspector.meta.duration"),
      value: m.durationMs > 0 ? `${(m.durationMs / 1000).toFixed(1)}s` : "—",
    },
  ];
});
</script>

<template>
  <Teleport to="body">
    <div class="inspector" role="dialog" aria-modal="true" @click.self="emit('close')">
      <div class="inspector__panel">
        <header class="inspector__head">
          <span class="inspector__title">{{ t("graphAssistant.inspector.title") }}</span>
          <button type="button" class="inspector__close" :title="t('graphAssistant.inspector.close')" @click="emit('close')">
            <X :size="16" :stroke-width="1.5" />
          </button>
        </header>

        <div class="inspector__body">
          <!-- 泄漏提示：正文里检测到工具往返文本块 -->
          <div v-if="view.stats.hasLeakedToolBlocks" class="inspector__warn">
            <AlertTriangle :size="14" :stroke-width="1.5" />
            <span>{{ t("graphAssistant.inspector.leakWarning", { count: view.stats.toolCallCount + view.stats.toolResultCount }) }}</span>
          </div>

          <!-- 回复正文 -->
          <section class="inspector__section">
            <div class="inspector__sectionHead">
              <span class="inspector__sectionTitle">{{ t("graphAssistant.inspector.sectionBody") }}</span>
              <button type="button" class="inspector__copy" @click="copyBody">
                <component :is="copied ? Check : Copy" :size="12" :stroke-width="1.5" />
                {{ copied ? t("graphAssistant.inspector.copied") : t("graphAssistant.inspector.copyBody") }}
              </button>
            </div>
            <pre v-if="view.content" class="inspector__pre">{{ view.content }}</pre>
            <p v-else class="inspector__empty">{{ t("graphAssistant.inspector.emptyBody") }}</p>
          </section>

          <!-- 思考内容 -->
          <section class="inspector__section">
            <div class="inspector__sectionHead">
              <Brain :size="13" :stroke-width="1.5" />
              <span class="inspector__sectionTitle">{{ t("graphAssistant.inspector.sectionReasoning") }}</span>
            </div>
            <pre v-if="view.reasoning" class="inspector__pre inspector__pre--reasoning">{{ view.reasoning }}</pre>
            <p v-else class="inspector__empty">{{ t("graphAssistant.inspector.noReasoning") }}</p>
          </section>

          <!-- 内容片段 -->
          <section class="inspector__section">
            <div class="inspector__sectionHead">
              <FileText :size="13" :stroke-width="1.5" />
              <span class="inspector__sectionTitle">{{ t("graphAssistant.inspector.sectionFragments") }}</span>
              <span class="inspector__count">{{ view.fragments.length }}</span>
            </div>
            <p v-if="view.fragments.length === 0" class="inspector__empty">{{ t("graphAssistant.inspector.noFragments") }}</p>
            <ol v-else class="inspector__fragments">
              <li v-for="(fragment, index) in view.fragments" :key="index" class="inspector__fragment">
                <div class="inspector__fragmentHead">
                  <span class="inspector__chip" :class="fragmentChipClass(fragment.type)">{{ fragmentTypeLabel(fragment.type) }}</span>
                  <span v-if="fragment.malformed" class="inspector__chip chip--warn">{{ t("graphAssistant.inspector.toolMalformed") }}</span>
                </div>
                <pre class="inspector__pre inspector__pre--fragment">{{ fragmentText(fragment) }}</pre>
              </li>
            </ol>
          </section>

          <!-- 工具调用 -->
          <section class="inspector__section">
            <div class="inspector__sectionHead">
              <Wrench :size="13" :stroke-width="1.5" />
              <span class="inspector__sectionTitle">{{ t("graphAssistant.inspector.sectionToolCalls") }}</span>
              <span class="inspector__count">{{ view.toolCalls.length }}</span>
            </div>
            <p v-if="view.toolCalls.length === 0" class="inspector__empty">{{ t("graphAssistant.inspector.noToolCalls") }}</p>
            <ol v-else class="inspector__tools">
              <li v-for="call in view.toolCalls" :key="call.index" class="inspector__tool">
                <div class="inspector__toolHead">
                  <span class="inspector__toolName">{{ call.name ?? "—" }}</span>
                  <span v-if="call.malformed" class="inspector__chip chip--warn">{{ t("graphAssistant.inspector.toolMalformed") }}</span>
                </div>
                <div class="inspector__toolField">
            <span class="inspector__toolLabel">{{ t("graphAssistant.inspector.toolArgs") }}</span>
                  <pre class="inspector__pre inspector__pre--fragment">{{ call.argsText }}</pre>
                </div>
                <div v-if="call.resultText !== null" class="inspector__toolField">
                  <span class="inspector__toolLabel">{{ t("graphAssistant.inspector.toolResult") }}</span>
                  <pre class="inspector__pre inspector__pre--fragment">{{ call.resultText }}</pre>
                </div>
              </li>
            </ol>
          </section>

          <!-- 元信息 -->
          <section class="inspector__section">
            <div class="inspector__sectionHead">
              <span class="inspector__sectionTitle">{{ t("graphAssistant.inspector.sectionMeta") }}</span>
            </div>
            <dl class="inspector__meta">
              <div v-for="item in metaItems" :key="item.key" class="inspector__metaRow">
                <dt class="inspector__metaLabel">{{ item.label }}</dt>
                <dd class="inspector__metaValue">{{ item.value }}</dd>
              </div>
            </dl>
          </section>
   </div>

        <footer class="inspector__foot">
          <button type="button" class="inspector__btn" @click="emit('close')">{{ t("graphAssistant.inspector.close") }}</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.inspector {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.5);
}

.inspector__panel {
  display: flex;
  flex-direction: column;
  width: min(760px, 100%);
  max-height: min(86vh, 900px);
  background: var(--color-surface, #1b1b1f);
  border: 1px solid var(--color-line-subtle);
  border-radius: 12px;
  box-shadow: 0 16px 48px -16px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}

.inspector__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-line-subtle);
}

.inspector__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.inspector__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--color-text-muted);
  transition: background-color 150ms, color 150ms;
}

.inspector__close:hover {
  background: var(--color-float);
  color: var(--color-text-primary);
}

.inspector__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.inspector__warn {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-signal-warn, #b8860b);
  background: color-mix(in srgb, var(--color-signal-warn, #b8860b) 12%, transparent);
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-secondary);
}

.inspector__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.inspector__sectionHead {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-secondary);
}

.inspector__sectionTitle {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.inspector__count {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--color-text-muted);
}

.inspector__copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--color-text-muted);
  transition: background-color 150ms, color 150ms;
}

.inspector__copy:hover {
  background: var(--color-float);
  color: var(--color-text-primary);
}

.inspector__pre {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--color-float);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-text-primary);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.inspector__pre--reasoning {
  font-style: italic;
  color: var(--color-text-muted);
}

.inspector__pre--fragment {
  font-size: 11px;
}

.inspector__empty {
  font-size: 12px;
  color: var(--color-text-muted);
}

.inspector__fragments,
.inspector__tools {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.inspector__fragment,
.inspector__tool {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.inspector__fragmentHead,
.inspector__toolHead {
  display: flex;
  align-items: center;
  gap: 6px;
}

.inspector__chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 500;
}

.chip--text {
  background: color-mix(in srgb, var(--color-text-muted) 18%, transparent);
  color: var(--color-text-secondary);
}

.chip--tool {
  background: color-mix(in srgb, var(--color-signal-accent, #4f8cff) 18%, transparent);
  color: var(--color-signal-accent, #4f8cff);
}

.chip--warn {
  background: color-mix(in srgb, var(--color-signal-warn, #b8860b) 18%, transparent);
  color: var(--color-signal-warn, #b8860b);
}

.inspector__toolName {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-primary);
}

.inspector__toolField {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.inspector__toolLabel {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}

.inspector__meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 16px;
  margin: 0;
}

.inspector__metaRow {
  display: contents;
}

.inspector__metaLabel {
  font-size: 11px;
  color: var(--color-text-muted);
}

.inspector__metaValue {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-text-secondary);
  overflow-wrap: anywhere;
}

.inspector__foot {
  display: flex;
  justify-content: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--color-line-subtle);
}

.inspector__btn {
  padding: 6px 16px;
  border-radius: 8px;
  border: 1px solid var(--color-line-subtle);
  font-size: 12px;
  color: var(--color-text-secondary);
  transition: background-color 150ms, color 150ms;
}

.inspector__btn:hover {
  background: var(--color-float);
  color: var(--color-text-primary);
}
</style>
