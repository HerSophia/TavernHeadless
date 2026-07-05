<script setup lang="ts">
/**
 * 快捷键说明浮层（NG2-6）。
 *
 * 列出当前支持的快捷键，按分区展示。键位来自 `keyboard-shortcuts` 单一事实源，
 * 说明文案走 i18n。纯展示组件，不持有编辑态。
 */
import { X } from "lucide-vue-next";
import { useI18n } from "vue-i18n";

import { groupShortcutsBySection } from "../keyboard-shortcuts";

defineEmits<{ (event: "close"): void }>();

const { t } = useI18n();
const sections = groupShortcutsBySection();
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-app/70 p-4" @click.self="$emit('close')">
    <div class="w-full max-w-md rounded-lg border border-line-active bg-panel p-4">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-medium text-text-primary">{{ t("graph.shortcuts.title") }}</h2>
        <button
          type="button"
          class="rounded p-0.5 text-text-muted transition-colors hover:text-text-primary"
          :title="t('graph.shortcuts.close')"
          @click="$emit('close')"
        >
          <X :size="14" :stroke-width="1.5" />
        </button>
   </div>

      <section v-for="group in sections" :key="group.section" class="mt-3">
        <h3 class="pb-1 font-mono text-[10px] uppercase tracking-wide text-text-muted">
          {{ t(`graph.shortcuts.section.${group.section}`) }}
        </h3>
        <ul class="flex flex-col gap-1">
          <li
            v-for="shortcut in group.items"
            :key="shortcut.id"
            class="flex items-center justify-between gap-3 text-xs"
          >
            <span class="text-text-secondary">{{ t(shortcut.labelKey) }}</span>
            <kbd class="rounded border border-line-subtle bg-float px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
              {{ shortcut.keys }}
            </kbd>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
