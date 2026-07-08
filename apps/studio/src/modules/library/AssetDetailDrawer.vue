<script setup lang="ts">
/**
 * 资产详情抽屉（SC2-9 精修）。
 *
 * 只读展示元信息（kind / id / source / version / created / updated）+ 版本历史；头部 kind 色 chip + 名称，
 * 头 / 底提供「编辑」入口：worldbook（SC2-6）/ preset（SC2-7）/ character（SC2-8）已接线（`@edit`），
 * regex 为禁用占位（`editComingSoon`）；删除经 `@delete` 上抛由库视图的 `UiConfirmDialog` 承接。
 * `canEdit` 可由消费方显式传入，未传时按 kind 兜底推断。
 */
import { Pencil, Trash2, X } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import type { AssetKind, AssetVersionItem, LibraryAsset } from "../../lib/assets/types";
import { useAssetsStore } from "../../stores/assets";
import UiBadge from "../../ui/UiBadge.vue";
import UiButton from "../../ui/UiButton.vue";
import UiIconButton from "../../ui/UiIconButton.vue";
import { KIND_STYLE, monogram } from "./asset-kind-style";

const props = defineProps<{ asset: LibraryAsset; canEdit?: boolean }>();
const emit = defineEmits<{ close: []; delete: []; edit: [] }>();

const { t } = useI18n();
const store = useAssetsStore();

/** worldbook / preset / character 支持编辑；regex 维持禁用占位。可由 props 覆盖。 */
const canEdit = computed(
  () =>
    props.canEdit ??
    (props.asset.kind === "worldbook" || props.asset.kind === "preset" || props.asset.kind === "character"),
);
const editLabel = computed(() => (canEdit.value ? t("library.edit") : t("library.editComingSoon")));
/** 内置资产（source=="builtin"）：显示徽标且不可删除，仅允许编辑（决策 D）。 */
const isBuiltin = computed(() => props.asset.source === "builtin");

const style = computed(() => KIND_STYLE[props.asset.kind]);
const mono = computed(() => monogram(props.asset.name));

const versions = ref<AssetVersionItem[]>([]);
const loading = ref(false);

const KIND_LABEL: Record<AssetKind, string> = {
  character: "tab_character",
  preset: "tab_preset",
  worldbook: "tab_worldbook",
  regex: "tab_regex",
};

function formatTs(ts: number): string {
  if (!ts) {
    return "—";
  }
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

onMounted(async () => {
  loading.value = true;
  try {
    versions.value = await store.listVersions(props.asset.kind, props.asset.id);
  } catch {
    versions.value = [];
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <aside class="flex w-80 shrink-0 flex-col border-l border-line-subtle bg-panel">
    <header class="flex h-11 shrink-0 items-center gap-2.5 border-b border-line-subtle px-4">
      <div class="flex size-7 shrink-0 items-center justify-center rounded-md" :class="[style.bg, style.text]">
        <span v-if="mono" class="text-[11px] font-medium">{{ mono }}</span>
        <component :is="style.icon" v-else :size="14" :stroke-width="1.5" />
      </div>
      <span class="min-w-0 flex-1 truncate text-sm font-medium text-text-primary" :title="asset.name">
        {{ asset.name }}
      </span>
      <UiBadge v-if="isBuiltin" tone="accent" class="shrink-0">{{ t("library.builtin") }}</UiBadge>
      <div class="flex shrink-0 items-center gap-0.5">
        <UiIconButton :label="editLabel" :disabled="!canEdit" @click="emit('edit')">
          <Pencil :size="14" :stroke-width="1.5" />
        </UiIconButton>
        <UiIconButton :label="t('library.close')" @click="emit('close')">
          <X :size="14" :stroke-width="1.5" />
        </UiIconButton>
      </div>
    </header>

    <div class="min-h-0 flex-1 space-y-5 overflow-auto p-4">
      <dl class="space-y-2 text-xs">
        <div class="flex items-center justify-between gap-3">
          <dt class="text-text-muted">{{ t("library.kind") }}</dt>
          <dd class="text-text-secondary">{{ t(`library.${KIND_LABEL[asset.kind]}`) }}</dd>
        </div>
        <div class="flex items-center justify-between gap-3">
          <dt class="text-text-muted">id</dt>
          <dd class="truncate font-mono text-text-secondary" :title="asset.id">{{ asset.id }}</dd>
        </div>
        <div class="flex items-center justify-between gap-3">
          <dt class="text-text-muted">{{ t("library.source") }}</dt>
          <dd class="font-mono text-text-secondary">{{ asset.source }}</dd>
        </div>
        <div class="flex items-center justify-between gap-3">
          <dt class="text-text-muted">{{ t("library.version") }}</dt>
          <dd class="font-mono text-text-secondary">{{ asset.version ?? "—" }}</dd>
        </div>
        <div class="flex items-center justify-between gap-3">
          <dt class="text-text-muted">{{ t("library.createdAt") }}</dt>
          <dd class="font-mono text-text-secondary">{{ formatTs(asset.createdAt) }}</dd>
        </div>
        <div class="flex items-center justify-between gap-3">
          <dt class="text-text-muted">{{ t("library.updated") }}</dt>
          <dd class="font-mono text-text-secondary">{{ formatTs(asset.updatedAt) }}</dd>
        </div>
      </dl>

      <section class="space-y-2">
        <h4 class="text-xs font-medium text-text-secondary">{{ t("library.versions") }}</h4>
        <p v-if="loading" class="text-xs text-text-muted">…</p>
        <p v-else-if="versions.length === 0" class="text-xs text-text-muted">{{ t("library.noVersions") }}</p>
        <ul v-else class="space-y-1">
          <li
            v-for="version in versions"
            :key="version.id"
            class="flex items-center justify-between gap-3 rounded-md border border-line-subtle px-2.5 py-1.5 font-mono text-xs"
          >
            <span class="text-text-primary">v{{ version.versionNo }}</span>
            <span class="text-text-muted">{{ formatTs(version.createdAt) }}</span>
          </li>
        </ul>
      </section>
    </div>

    <footer class="flex shrink-0 items-center justify-between gap-2 border-t border-line-subtle px-4 py-3">
      <UiButton :disabled="!canEdit" :title="editLabel" @click="emit('edit')">
        <Pencil :size="14" :stroke-width="1.5" />
        {{ t("library.edit") }}
      </UiButton>
      <UiButton
        v-if="!isBuiltin"
        variant="ghost"
        class="!border-signal-error !text-signal-error hover:!bg-signal-error/10"
        @click="emit('delete')"
      >
        <Trash2 :size="14" :stroke-width="1.5" />
        {{ t("library.delete") }}
      </UiButton>
      <span v-else class="text-[11px] text-text-muted">{{ t("library.builtinDeleteHint") }}</span>
    </footer>
  </aside>
</template>
