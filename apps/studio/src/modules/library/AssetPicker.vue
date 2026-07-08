<script setup lang="ts">
/**
 * 资产选择器（SC2-3）。
 *
 * 单一 `kind` 的资产选择控件（内联形态）：搜索 + 选择 + 可选选版本 + 可选清除，
 * 产出统一 `AssetSelection`。只做「选择」，不做绑定编排（SC2-4）。
 *
 * 数据：`store.ensurePickerList(kind)` 按需加载 + 轻量缓存（与库视图 `lists` 解耦）。
 * 搜索：第一版四类均前端按名称过滤（character 服务端 keyword 待 SC2-2 补 list 透传后接入）。
 */
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { AssetKind, AssetSelection, AssetVersionItem, LibraryAsset } from "../../lib/assets/types";
import { useAssetsStore } from "../../stores/assets";
import UiCard from "../../ui/UiCard.vue";
import UiSearchInput from "../../ui/UiSearchInput.vue";
import UiSelect from "../../ui/UiSelect.vue";

const props = withDefaults(
  defineProps<{
    kind: AssetKind;
    modelValue: AssetSelection | null;
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

watch(
  () => props.kind,
  () => {
    searchTerm.value = "";
    void load();
  },
);

// --- 版本选择 ---
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
  () => [props.kind, props.withVersion, props.modelValue?.id] as const,
  ([, withVersion, id]) => {
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
  <div class="space-y-2" :class="disabled ? 'pointer-events-none opacity-60' : ''">
    <UiSearchInput
      v-model="searchTerm"
      :placeholder="t('library.picker_search')"
      :aria-label="t('library.picker_search')"
      :disabled="disabled"
      :debounce-ms="200"
    />

    <div class="max-h-60 space-y-1.5 overflow-auto pr-0.5">
      <UiCard
        v-if="allowEmpty"
        clickable
        :selected="modelValue === null"
        :disabled="disabled"
        @click="onClear"
      >
        <span class="text-sm" :class="modelValue === null ? 'text-text-primary' : 'text-text-muted'">
          {{ t("library.picker_none") }}
        </span>
      </UiCard>

      <p v-if="loading" class="px-1 py-3 text-center text-xs text-text-muted">{{ t("library.validating") }}</p>
      <p v-else-if="filtered.length === 0" class="px-1 py-3 text-center text-xs text-text-muted">
        {{ t("library.picker_empty") }}
      </p>

      <UiCard
        v-for="item in filtered"
        :key="item.id"
        clickable
        :selected="modelValue?.id === item.id"
        :disabled="disabled"
        @click="onSelect(item)"
      >
        <div class="flex items-center gap-2">
          <span class="truncate text-sm text-text-primary">{{ item.name }}</span>
          <span
            v-if="item.version !== null"
            class="shrink-0 font-mono text-[10px] text-text-muted"
          >v{{ item.version }}</span>
        </div>
        <div class="mt-0.5 truncate font-mono text-xs text-text-muted">{{ item.source }}</div>
      </UiCard>
    </div>

    <div v-if="withVersion && modelValue" class="flex items-center gap-2">
      <span class="shrink-0 text-xs text-text-muted">{{ t("library.picker_version") }}</span>
      <div class="min-w-0 flex-1">
        <UiSelect
          :model-value="versionValue"
          :options="versionOptions"
          :disabled="disabled || versionsLoading"
          @update:model-value="onSelectVersion"
        />
      </div>
    </div>
  </div>
</template>

