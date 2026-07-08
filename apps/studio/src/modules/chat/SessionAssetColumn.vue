<script setup lang="ts">
/**
 * 会话资产浏览列（批次六：新建会话对话框多列浏览器）。
 *
 * 单一 `kind` 的密集资产浏览列：列头（类型色点 + 标题 + 计数）+ 搜索 + 「不绑定」选项 + 密集行列表
 * （monogram chip + 名称 + 弱化元信息 + 选中 accent 竖条 / 勾选）+ 选中时按需露出的版本选择。
 * 复用 assets store 的选择器缓存（`ensurePickerList`）与 `KIND_STYLE`，视觉对齐资产库 `AssetRow`，
 * 产出统一 `AssetSelection`。角色卡的同步策略等附加控件经 `#footer` 插槽注入。
 */
import { Check, Minus } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { AssetKind, AssetSelection, AssetVersionItem, LibraryAsset } from "../../lib/assets/types";
import { useAssetsStore } from "../../stores/assets";
import UiSearchInput from "../../ui/UiSearchInput.vue";
import UiSelect from "../../ui/UiSelect.vue";
import { KIND_STYLE, monogram } from "../library/asset-kind-style";

const props = withDefaults(
  defineProps<{
    kind: AssetKind;
    modelValue: AssetSelection | null;
    title: string;
    /** 是否允许「不选 / 清除」。 */
    allowEmpty?: boolean;
    /** 是否提供「选版本」。 */
    withVersion?: boolean;
    disabled?: boolean;
  }>(),
  { allowEmpty: true, withVersion: true, disabled: false },
);

const emit = defineEmits<{ "update:modelValue": [value: AssetSelection | null] }>();

const { t } = useI18n();
const store = useAssetsStore();

const style = computed(() => KIND_STYLE[props.kind]);

const searchTerm = ref("");
const loading = ref(false);

const items = computed<LibraryAsset[]>(() => store.pickerCache[props.kind]?.items ?? []);

const filtered = computed<LibraryAsset[]>(() => {
  const term = searchTerm.value.trim().toLowerCase();
  if (!term) {
    return items.value;
  }
  return items.value.filter((item) => item.name.toLowerCase().includes(term));
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    await store.ensurePickerList(props.kind);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void load();
});

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

function onSelect(item: LibraryAsset): void {
  if (props.disabled) {
    return;
  }
  emit("update:modelValue", { kind: props.kind, id: item.id, name: item.name, version: null });
}

function onClear(): void {
  if (props.disabled) {
    return;
  }
  emit("update:modelValue", null);
}

// --- 版本选择（与 AssetPicker 一致：选具体版本锁版本，最新则不带 versionId） ---
const versions = ref<AssetVersionItem[]>([]);
const versionsLoading = ref(false);

async function loadVersions(id: string): Promise<void> {
  versionsLoading.value = true;
  try {
    versions.value = await store.listVersions(props.kind, id);
  } finally {
    versionsLoading.value = false;
  }
}

watch(
  () => [props.withVersion, props.modelValue?.id] as const,
  ([withVersion, id]) => {
    if (withVersion && id) {
      void loadVersions(id);
    } else {
      versions.value = [];
    }
  },
  { immediate: true },
);

const versionValue = computed<string>(() => props.modelValue?.versionId ?? "");

const versionOptions = computed(() => [
  { value: "", label: t("library.picker_latest") },
  ...versions.value.map((version) => ({ value: version.id, label: `v${version.versionNo}` })),
]);

function onSelectVersion(value: string): void {
  const current = props.modelValue;
  if (!current) {
    return;
  }
  if (value === "") {
    emit("update:modelValue", { kind: current.kind, id: current.id, name: current.name, version: null });
    return;
  }
  const version = versions.value.find((entry) => entry.id === value);
  emit("update:modelValue", {
    kind: current.kind,
    id: current.id,
    name: current.name,
    version: version?.versionNo ?? null,
    versionId: value,
  });
}
</script>

<template>
  <section
    class="flex min-w-0 flex-1 flex-col"
    :class="disabled ? 'pointer-events-none opacity-60' : ''"
  >
    <!-- 列头 -->
    <header class="flex h-10 shrink-0 items-center gap-2 px-3">
      <span class="flex size-5 shrink-0 items-center justify-center rounded" :class="[style.bg, style.text]">
        <component :is="style.icon" :size="12" :stroke-width="1.5" />
      </span>
      <span class="min-w-0 flex-1 truncate text-xs font-medium tracking-wide text-text-secondary">{{ title }}</span>
      <span class="shrink-0 font-mono text-[11px] tabular-nums text-text-muted">{{ filtered.length }}</span>
    </header>

    <!-- 搜索 -->
    <div class="shrink-0 px-3 pb-2">
      <UiSearchInput
        v-model="searchTerm"
        :placeholder="t('library.picker_search')"
        :aria-label="t('library.picker_search')"
        :disabled="disabled"
        :debounce-ms="200"
      />
    </div>

    <!-- 列表 -->
    <div class="min-h-0 flex-1 overflow-auto">
      <!-- 不绑定 -->
      <button
        v-if="allowEmpty"
        type="button"
        class="group relative flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-signal-accent"
        :class="modelValue === null ? 'bg-float' : 'hover:bg-float/60'"
        :disabled="disabled"
        :aria-pressed="modelValue === null"
        @click="onClear"
      >
        <span
          v-if="modelValue === null"
          class="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-signal-accent"
          aria-hidden="true"
        />
        <span class="flex size-7 shrink-0 items-center justify-center rounded-md border border-dashed border-line-active text-text-muted">
          <Minus :size="13" :stroke-width="1.5" />
        </span>
        <span class="min-w-0 flex-1 truncate text-sm" :class="modelValue === null ? 'text-text-primary' : 'text-text-muted'">
          {{ t("chat.createDialog.none") }}
        </span>
        <Check v-if="modelValue === null" :size="14" :stroke-width="1.5" class="shrink-0 text-signal-accent" />
      </button>

      <p v-if="loading" class="px-3 py-6 text-center text-xs text-text-muted">{{ t("library.validating") }}</p>
      <p v-else-if="filtered.length === 0" class="px-3 py-6 text-center text-xs text-text-muted">
        {{ t("library.picker_empty") }}
      </p>

      <button
        v-for="item in filtered"
        :key="item.id"
        type="button"
        class="group relative flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-signal-accent"
        :class="modelValue?.id === item.id ? 'bg-float' : 'hover:bg-float/60'"
        :disabled="disabled"
        :aria-pressed="modelValue?.id === item.id"
        @click="onSelect(item)"
      >
        <span
          v-if="modelValue?.id === item.id"
          class="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-signal-accent"
          aria-hidden="true"
        />
        <span class="flex size-7 shrink-0 items-center justify-center rounded-md" :class="[style.bg, style.text]">
          <span v-if="monogram(item.name)" class="text-[11px] font-medium">{{ monogram(item.name) }}</span>
          <component :is="style.icon" v-else :size="13" :stroke-width="1.5" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="truncate text-sm text-text-primary" :title="item.name">{{ item.name }}</span>
          <span class="truncate text-[11px] text-text-muted">
            {{ item.source }}
            <template v-if="item.version !== null">
              · <span class="font-mono">v{{ item.version }}</span>
            </template>
            · <span class="font-mono">{{ formatTs(item.updatedAt) }}</span>
          </span>
        </span>
        <Check
          v-if="modelValue?.id === item.id"
          :size="14"
          :stroke-width="1.5"
          class="shrink-0 text-signal-accent"
        />
      </button>
    </div>

    <!-- 版本 + 附加控件（如角色卡同步策略经 #footer 注入） -->
    <div
      v-if="(withVersion && modelValue) || $slots.footer"
      class="shrink-0 space-y-2 border-t border-line-subtle px-3 py-2.5"
    >
      <div v-if="withVersion && modelValue" class="flex items-center gap-2">
        <span class="shrink-0 text-[11px] text-text-muted">{{ t("library.picker_version") }}</span>
        <div class="min-w-0 flex-1">
          <UiSelect
            :model-value="versionValue"
            :options="versionOptions"
            :disabled="disabled || versionsLoading"
            @update:model-value="onSelectVersion"
          />
        </div>
      </div>
      <slot name="footer" />
    </div>
  </section>
</template>
