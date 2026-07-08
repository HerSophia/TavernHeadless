<script setup lang="ts">
/**
 * 资产列表行（SC2-9，取代 SC2-2 的卡片网格）。
 *
 * 密集单行：monogram chip（名称首字符 + 类型色）+ 名称 + 弱化元信息（来源 · 版本 · 更新日期）+ 悬停操作。
 * 点整行 = 打开详情（`open`）；悬停露出「编辑 / 删除」（`edit` / `delete`）。类目侧栏已表达 kind，
 * 故行内不再重复类型图标，改 monogram 增强按名扫读。文案由消费方经 i18n 注入。
 */
import { Pencil, Trash2 } from "lucide-vue-next";
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import type { LibraryAsset } from "../../lib/assets/types";
import UiBadge from "../../ui/UiBadge.vue";
import UiIconButton from "../../ui/UiIconButton.vue";
import { KIND_STYLE, monogram } from "./asset-kind-style";

const props = withDefaults(
  defineProps<{
    asset: LibraryAsset;
    selected?: boolean;
    busy?: boolean;
    canEdit?: boolean;
  }>(),
  { selected: false, busy: false, canEdit: false },
);

const emit = defineEmits<{ open: []; edit: []; delete: [] }>();

const { t } = useI18n();

const style = computed(() => KIND_STYLE[props.asset.kind]);
const mono = computed(() => monogram(props.asset.name));
/** 内置资产（source=="builtin"）：显示徽标且不可删除，仅允许编辑。 */
const isBuiltin = computed(() => props.asset.source === "builtin");

function formatTs(ts: number): string {
  if (!ts) {
    return "—";
  }
  try {
    return new Date(ts).toLocaleDateString();
  } catch {
    return String(ts);
  }
}
</script>

<template>
  <div
    class="group relative flex w-full items-center gap-3 py-2.5 pl-4 pr-3 text-left transition-colors duration-150"
    :class="[
      selected ? 'bg-float' : 'hover:bg-float/60',
      busy ? 'opacity-50' : 'cursor-pointer',
    ]"
    :role="busy ? undefined : 'button'"
    :tabindex="busy ? undefined : 0"
    :aria-selected="selected"
    @click="!busy && emit('open')"
    @keydown.enter.prevent="!busy && emit('open')"
    @keydown.space.prevent="!busy && emit('open')"
  >
    <span
      v-if="selected"
      class="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-signal-accent"
      aria-hidden="true"
    />

    <div class="flex size-8 shrink-0 items-center justify-center rounded-md" :class="[style.bg, style.text]">
      <span v-if="mono" class="text-xs font-medium">{{ mono }}</span>
      <component :is="style.icon" v-else :size="15" :stroke-width="1.5" />
    </div>

    <div class="flex min-w-0 flex-1 flex-col">
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="truncate text-sm text-text-primary" :title="asset.name">{{ asset.name }}</span>
        <UiBadge v-if="isBuiltin" tone="accent">{{ t("library.builtin") }}</UiBadge>
      </span>
      <span class="truncate text-[11px] text-text-muted">
        {{ asset.source }}
        <template v-if="asset.version !== null">
          · <span class="font-mono">v{{ asset.version }}</span>
        </template>
        · <span class="font-mono">{{ formatTs(asset.updatedAt) }}</span>
      </span>
    </div>

    <div
      class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100"
      @click.stop
    >
      <UiIconButton
        :label="canEdit ? t('library.edit') : t('library.editComingSoon')"
        :disabled="!canEdit || busy"
        @click="emit('edit')"
      >
        <Pencil :size="14" :stroke-width="1.5" />
      </UiIconButton>
      <UiIconButton v-if="!isBuiltin" :label="t('library.delete')" :disabled="busy" @click="emit('delete')">
        <Trash2 :size="14" :stroke-width="1.5" />
      </UiIconButton>
    </div>
  </div>
</template>
