<script setup lang="ts">
import { ChevronRight } from "lucide-vue-next";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { useContextStore } from "../../../stores/context";
import { useGraphAssistantPromptStore } from "../../../stores/graph-assistant-prompt";
import type { GraphAssistantStaticPromptMode } from "../../../lib/graph-assistant-prompt-config-api";
import {
  CONTEXT_BLOCK_KEYS,
  CONTEXT_BLOCK_PLACEHOLDER,
} from "./context-config";
import { buildGraphContextSnapshot } from "./build-context-snapshot";
import { collectContextBlocks } from "./collect-context-blocks";
import { renderDynamicPrompt } from "./render-dynamic-prompt";
import { estimateTokens } from "./estimate-tokens";

const { t } = useI18n();
const context = useContextStore();
const store = useGraphAssistantPromptStore();

/** 静态段本地编辑态：模式 + 自定义文本。加载 / 保存后与 store 同步。 */
const mode = ref<GraphAssistantStaticPromptMode>("append");
const text = ref("");
/** 内置默认折叠态。 */
const builtinExpanded = ref(false);

/** 动态段本地编辑态：模板文本。 */
const dynamicText = ref("");
const templateRef = ref<HTMLTextAreaElement | null>(null);

/** 静态段本地编辑态相对已保存配置是否有改动。 */
const dirty = computed(() => {
  const cfg = store.config;
  if (!cfg) {
    return false;
  }
  return mode.value !== cfg.static_mode || text.value !== cfg.static_text;
});

/** 合成预览：内置默认 + 自定义（按当前本地编辑态实时合成）。 */
const preview = computed(() => {
  const builtin = store.builtinDefault;
  const custom = text.value.trim();
  if (mode.value === "override") {
    return custom.length > 0 ? custom : builtin;
  }
  return custom.length > 0 ? `${builtin}\n\n${custom}` : builtin;
});

/** 动态段本地编辑态相对已保存配置是否有改动。 */
const dynamicDirty = computed(() => {
  const cfg = store.config;
  if (!cfg) {
    return false;
  }
  return dynamicText.value !== cfg.dynamic_template;
});

/** 占位符清单：每个数据块一项，标注是否已在上下文页开启。 */
const placeholderItems = computed(() =>
  CONTEXT_BLOCK_KEYS.map((key) => ({
    key,
    token: CONTEXT_BLOCK_PLACEHOLDER[key],
    /** 预先拼好的占位符展示文本（避免在模板插值内出现 {{ 导致编译器误解）。 */
    display: `{{${CONTEXT_BLOCK_PLACEHOLDER[key]}}}`,
    enabled: store.contextConfig[key].enabled,
  })),
);

/** 实时预览：按当前画布状态收集数据块，再用本地模板渲染。 */
const dynamicPreview = computed(() => {
  try {
    const snapshot = buildGraphContextSnapshot();
    const blocks = collectContextBlocks(snapshot, store.contextConfig);
    return renderDynamicPrompt(blocks, dynamicText.value);
  } catch {
    return "";
  }
});

/** 预览文本的估算 token 数。 */
const dynamicPreviewTokens = computed(() => estimateTokens(dynamicPreview.value));

/** 预览是否超出总 token 预算（-1 不限制）。 */
const dynamicOverBudget = computed(() => {
  const max = store.contextConfig.maxTokens;
  return max >= 0 && dynamicPreviewTokens.value > max;
});

function syncFromStore(): void {
  const cfg = store.config;
  if (cfg) {
    mode.value = cfg.static_mode;
    text.value = cfg.static_text;
    dynamicText.value = cfg.dynamic_template;
  }
}

async function loadForCurrentProject(): Promise<void> {
  if (context.currentProjectId) {
    await store.load(context.currentProjectId);
    syncFromStore();
  }
}

onMounted(loadForCurrentProject);
watch(() => context.currentProjectId, loadForCurrentProject);

async function onSave(): Promise<void> {
  if (store.saving || !dirty.value) {
    return;
  }
  try {
    await store.saveStatic(mode.value, text.value);
    syncFromStore();
  } catch {
    // 错误已写入 store.error，UI 顶部已展示。
  }
}

function onReset(): void {
  syncFromStore();
}

/** 在光标处插入占位符；无法获取光标时退化为追加到末尾。 */
function insertPlaceholder(token: string): void {
  const snippet = `{{${token}}}`;
  const el = templateRef.value;
  if (!el) {
    dynamicText.value += snippet;
    return;
  }
  const start = el.selectionStart ?? dynamicText.value.length;
  const end = el.selectionEnd ?? dynamicText.value.length;
 dynamicText.value = dynamicText.value.slice(0, start) + snippet + dynamicText.value.slice(end);
  void nextTick(() => {
    el.focus();
    const pos = start + snippet.length;
    el.setSelectionRange(pos, pos);
  });
}

async function onSaveDynamic(): Promise<void> {
  if (store.saving || !dynamicDirty.value) {
    return;
  }
  try {
    await store.saveDynamic(dynamicText.value);
    syncFromStore();
  } catch {
    // 错误已写入 store.error，UI 顶部已展示。
  }
}

function onResetDynamic(): void {
syncFromStore();
}
</script>

<template>
  <section class="space-y-3">
    <div class="space-y-0.5">
      <h3 class="text-xs font-medium text-text-primary">{{ t("graphAssistant.prompt.title") }}</h3>
      <p class="text-[11px] leading-snug text-text-muted">{{ t("graphAssistant.prompt.subtitle") }}</p>
    </div>

    <p
      v-if="!context.currentProjectId"
      class="rounded-md border border-line-subtle px-3 py-6 text-center text-[11px] text-text-muted"
    >
      {{ t("graphAssistant.prompt.noProject") }}
    </p>

    <template v-else>
      <p
        class="rounded-md border border-line-subtle bg-float px-2.5 py-2 text-[11px] leading-snug text-text-muted"
      >
        {{ t("graphAssistant.prompt.injectOnceNotice") }}
      </p>

      <p v-if="store.error" class="text-[11px] text-signal-error">{{ store.error }}</p>

      <!-- 内置默认（只读，可折叠查看） -->
      <div class="overflow-hidden rounded-md border border-line-subtle">
        <button
          type="button"
          class="flex w-full items-center gap-1.5 px-2.5 py-2 text-left text-[11px] text-text-secondary transition-colors duration-150 hover:bg-float focus:outline-none"
          @click="builtinExpanded = !builtinExpanded"
        >
          <ChevronRight
            :size="13"
            :stroke-width="1.5"
            class="shrink-0 transition-transform duration-150"
            :class="builtinExpanded ? 'rotate-90' : ''"
          />
          <span class="flex-1">{{ t("graphAssistant.prompt.builtinDefault") }}</span>
        </button>
        <pre
          v-if="builtinExpanded"
          class="max-h-48 overflow-auto whitespace-pre-wrap border-t border-line-subtle px-2.5 py-2 font-mono text-[11px] leading-relaxed text-text-muted"
        >{{ store.builtinDefault }}</pre>
      </div>

      <!-- 叠加模式 -->
      <div class="space-y-1.5">
        <span class="text-[11px] font-medium text-text-secondary">{{ t("graphAssistant.prompt.modeLabel") }}</span>
        <div class="flex gap-1.5">
          <button
            v-for="option in (['append', 'override'] as const)"
            :key="option"
            type="button"
            class="flex-1 rounded-md border px-2 py-1.5 text-[11px] transition-colors duration-150 focus:outline-none"
            :class="
              mode === option
                ? 'border-signal-accent text-text-primary'
                : 'border-line-subtle text-text-muted hover:text-text-secondary'
            "
            @click="mode = option"
          >
            {{ t(`graphAssistant.prompt.mode.${option}`) }}
          </button>
        </div>
        <p class="text-[11px] leading-snug text-text-muted">
          {{ t(`graphAssistant.prompt.modeHint.${mode}`) }}
        </p>
      </div>

      <!-- 自定义文本 -->
      <div class="space-y-1.5">
        <span class="text-[11px] font-medium text-text-secondary">{{ t("graphAssistant.prompt.customLabel") }}</span>
        <textarea
          v-model="text"
          rows="6"
          :placeholder="t('graphAssistant.prompt.customPlaceholder')"
          class="w-full resize-y rounded-md border border-line-subtle bg-panel px-2.5 py-2 font-mono text-[11px] leading-relaxed text-text-primary focus:border-signal-accent focus:outline-none"
        ></textarea>
      </div>

      <!-- 合成预览 -->
      <div class="space-y-1.5">
        <span class="text-[11px] font-medium text-text-secondary">{{ t("graphAssistant.prompt.previewLabel") }}</span>
        <pre
          class="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-line-subtle bg-float px-2.5 py-2 font-mono text-[11px] leading-relaxed text-text-muted"
        >{{ preview }}</pre>
      </div>

      <!-- 静态段操作 -->
      <div class="flex items-center justify-end gap-2">
        <button
          type="button"
          :disabled="!dirty || store.saving"
          class="rounded-md px-2.5 py-1.5 text-[11px] text-text-muted transition-colors duration-150 hover:text-text-secondary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          @click="onReset"
        >
          {{ t("graphAssistant.prompt.reset") }}
        </button>
        <button
          type="button"
          :disabled="!dirty || store.saving"
          class="rounded-md border border-signal-accent px-3 py-1.5 text-[11px] text-signal-accent transition-colors duration-150 hover:bg-float focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          @click="onSave"
        >
          {{ store.saving ? t("graphAssistant.prompt.saving") : t("graphAssistant.prompt.save") }}
        </button>
      </div>

      <!-- 动态提示词段 -->
      <div class="space-y-3 border-t border-line-subtle pt-3">
        <div class="space-y-0.5">
          <h3 class="text-xs font-medium text-text-primary">{{ t("graphAssistant.prompt.dynamic.title") }}</h3>
          <p class="text-[11px] leading-snug text-text-muted">{{ t("graphAssistant.prompt.dynamic.subtitle") }}</p>
        </div>

        <!-- 占位符清单（点击插入） -->
        <div class="space-y-1.5">
          <span class="text-[11px] font-medium text-text-secondary">{{ t("graphAssistant.prompt.dynamic.placeholderLabel") }}</span>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="item in placeholderItems"
              :key="item.key"
              type="button"
         :disabled="!item.enabled"
              :title="item.enabled ? '' : t('graphAssistant.prompt.dynamic.placeholderDisabledHint')"
              class="rounded-md border px-2 py-1 font-mono text-[11px] transition-colors duration-150 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
              :class="
                item.enabled
                  ? 'border-line-subtle text-text-secondary hover:border-signal-accent hover:text-text-primary'
                  : 'border-line-subtle text-text-muted'
              "
              @click="insertPlaceholder(item.token)"
            >
              {{ item.display }}
            </button>
          </div>
        </div>

        <!-- 模板文本 -->
        <div class="space-y-1.5">
          <span class="text-[11px] font-medium text-text-secondary">{{ t("graphAssistant.prompt.dynamic.templateLabel") }}</span>
    <textarea
            ref="templateRef"
            v-model="dynamicText"
            rows="6"
            :placeholder="t('graphAssistant.prompt.dynamic.templatePlaceholder')"
            class="w-full resize-y rounded-md border border-line-subtle bg-panel px-2.5 py-2 font-mono text-[11px] leading-relaxed text-text-primary focus:border-signal-accent focus:outline-none"
          ></textarea>
        </div>

        <!-- 实时预览 -->
        <div class="space-y-1.5">
          <div class="flex items-center gap-2">
            <span class="text-[11px] font-medium text-text-secondary">{{ t("graphAssistant.prompt.dynamic.previewLabel") }}</span>
            <span
              class="ml-auto font-mono text-[10px]"
              :class="dynamicOverBudget ? 'text-signal-error' : 'text-text-muted'"
            >{{ t("graphAssistant.prompt.dynamic.previewTokens", { tokens: dynamicPreviewTokens }) }}</span>
          </div>
          <p v-if="dynamicOverBudget" class="text-[11px] text-signal-error">
            {{ t("graphAssistant.prompt.dynamic.previewOverBudget", { max: store.contextConfig.maxTokens }) }}
          </p>
          <pre
           v-if="dynamicPreview"
            class="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-line-subtle bg-float px-2.5 py-2 font-mono text-[11px] leading-relaxed text-text-muted"
          >{{ dynamicPreview }}</pre>
          <p
            v-else
            class="rounded-md border border-line-subtle px-2.5 py-2 text-[11px] text-text-muted"
          >
            {{ t("graphAssistant.prompt.dynamic.previewEmpty") }}
          </p>
        </div>

        <!-- 动态段操作 -->
        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            :disabled="!dynamicDirty || store.saving"
            class="rounded-md px-2.5 py-1.5 text-[11px] text-text-muted transition-colors duration-150 hover:text-text-secondary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
     @click="onResetDynamic"
          >
            {{ t("graphAssistant.prompt.dynamic.reset") }}
          </button>
          <button
            type="button"
            :disabled="!dynamicDirty || store.saving"
            class="rounded-md border border-signal-accent px-3 py-1.5 text-[11px] text-signal-accent transition-colors duration-150 hover:bg-float focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            @click="onSaveDynamic"
          >
            {{ store.saving ? t("graphAssistant.prompt.dynamic.saving") : t("graphAssistant.prompt.dynamic.save") }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>
