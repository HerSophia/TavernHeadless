<script setup lang="ts">
/**
 * 资产库视图（SC2-9 大改进）。
 *
 * 布局：左类目侧栏（`LibrarySidebar`，带即时计数）+ 全宽内容区（工具条 + 密集列表行）+ 右详情抽屉。
 * 取代 SC2-2 的「顶部 Tabs + 居中卡片网格」。首屏并发预载四类（`loadAllKinds`）→ 侧栏计数即时、切类不重拉
 * （`ensureLoaded`）。character 走服务端 keyword/sort/status；preset/worldbook/regex 前端过滤/排序
 * （`store.visibleAssets`）。加载用 skeleton 行，空态含导入 CTA，Esc 关抽屉；删除 `UiConfirmDialog`、导入 `UiDialog`。
 */
import { Plus } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { AssetKind, AssetSortBy, AssetSortOrder, LibraryAsset } from "../../lib/assets/types";
import { ASSET_KINDS, useAssetsStore } from "../../stores/assets";
import UiButton from "../../ui/UiButton.vue";
import UiConfirmDialog from "../../ui/UiConfirmDialog.vue";
import UiDialog from "../../ui/UiDialog.vue";
import UiSearchInput from "../../ui/UiSearchInput.vue";
import UiSelect from "../../ui/UiSelect.vue";
import { KIND_STYLE } from "./asset-kind-style";
import AssetDetailDrawer from "./AssetDetailDrawer.vue";
import AssetImportPanel from "./AssetImportPanel.vue";
import AssetRow from "./AssetRow.vue";
import CharacterEditorDialog from "./CharacterEditorDialog.vue";
import LibrarySidebar from "./LibrarySidebar.vue";
import PresetEditorDialog from "./PresetEditorDialog.vue";
import WorldbookEditorDialog from "./WorldbookEditorDialog.vue";

const { t } = useI18n();
const store = useAssetsStore();

/** 哪些 kind 可编辑（worldbook/preset/character 已落地编辑器；regex 暂未）。 */
const EDITABLE: Record<AssetKind, boolean> = { character: true, preset: true, worldbook: true, regex: false };

const activeKind = ref<AssetKind>("character");
const selected = ref<LibraryAsset | null>(null);
const confirmDelete = ref<LibraryAsset | null>(null);
const deleting = ref(false);
const importOpen = ref(false);
/** 当前正在编辑的世界书（SC2-6）；仅 worldbook 可编辑。 */
const editingWorldbook = ref<LibraryAsset | null>(null);
/** 当前正在编辑的预设（SC2-7）；仅 preset 可编辑。 */
const editingPreset = ref<LibraryAsset | null>(null);
/** 当前正在编辑的角色卡（SC2-8）；仅 character 可编辑。 */
const editingCharacter = ref<LibraryAsset | null>(null);

const sidebarItems = computed(() =>
  ASSET_KINDS.map((kind) => ({
    id: kind,
    label: t(`library.tab_${kind}`),
    icon: KIND_STYLE[kind].icon,
    count: store.totals[kind],
  })),
);

const query = computed(() => store.query[activeKind.value]);
const assets = computed(() => store.visibleAssets(activeKind.value));
const isLoading = computed(() => store.loadingKinds[activeKind.value]);
const isCharacter = computed(() => activeKind.value === "character");
const canEditActive = computed(() => EDITABLE[activeKind.value]);

/** 三态：首载 skeleton / 空态 / 列表。旧结果在重载期间保留，故 skeleton 仅首载出现。 */
const showSkeleton = computed(() => isLoading.value && assets.value.length === 0);
const showEmpty = computed(() => !isLoading.value && assets.value.length === 0);

// --- 搜索 ---
function onSearch(value: string): void {
  query.value.keyword = value;
  if (isCharacter.value) {
    void store.loadAssets("character");
  }
}

// --- 排序（合并 sortBy × order 为有序选项）---
type SortValue = `${AssetSortBy}:${AssetSortOrder}`;

const sortOptions = computed<Array<{ value: SortValue; label: string }>>(() => [
  { value: "updated_at:desc", label: `${t("library.sort_updated")} · ${t("library.order_desc")}` },
  { value: "updated_at:asc", label: `${t("library.sort_updated")} · ${t("library.order_asc")}` },
  { value: "created_at:desc", label: `${t("library.sort_created")} · ${t("library.order_desc")}` },
  { value: "created_at:asc", label: `${t("library.sort_created")} · ${t("library.order_asc")}` },
  { value: "name:asc", label: `${t("library.sort_name")} · ${t("library.order_asc")}` },
  { value: "name:desc", label: `${t("library.sort_name")} · ${t("library.order_desc")}` },
]);

const sortValue = computed<SortValue>(() => `${query.value.sortBy}:${query.value.sortOrder}`);

function onSort(value: SortValue): void {
  const [sortBy, sortOrder] = value.split(":") as [AssetSortBy, AssetSortOrder];
  query.value.sortBy = sortBy;
  query.value.sortOrder = sortOrder;
  if (isCharacter.value) {
    void store.loadAssets("character");
  }
}

// --- 状态（character 专属）---
const statusOptions = computed(() => [
  { value: "active", label: t("library.status_active") },
  { value: "archived", label: t("library.status_archived") },
  { value: "all", label: t("library.status_all") },
]);

function onStatus(value: string): void {
  query.value.status = value;
  void store.loadAssets("character");
}

// --- 生命周期 / 切类 ---
onMounted(() => {
  void store.loadAllKinds();
  window.addEventListener("keydown", onWindowKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onWindowKeydown);
});

/** Esc 关抽屉（仅在无对话框 / 编辑器打开时，避免与其自身 Esc 冲突）。 */
function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") {
    return;
  }
  const overlayOpen =
    importOpen.value ||
    confirmDelete.value !== null ||
    editingWorldbook.value !== null ||
    editingPreset.value !== null ||
    editingCharacter.value !== null;
  if (selected.value && !overlayOpen) {
    selected.value = null;
  }
}

watch(activeKind, (kind) => {
  selected.value = null;
  confirmDelete.value = null;
  importOpen.value = false;
  editingWorldbook.value = null;
  editingPreset.value = null;
  editingCharacter.value = null;
  void store.ensureLoaded(kind);
});

// --- 详情 / 删除 / 导入 ---
function onOpen(asset: LibraryAsset): void {
  selected.value = asset;
}

function requestDelete(asset: LibraryAsset): void {
  confirmDelete.value = asset;
}

async function onConfirmDelete(): Promise<void> {
  const asset = confirmDelete.value;
  if (!asset) {
    return;
  }
  deleting.value = true;
  try {
    await store.removeAsset(asset.kind, asset.id);
    if (selected.value?.id === asset.id) {
      selected.value = null;
    }
    confirmDelete.value = null;
  } finally {
    deleting.value = false;
  }
}

function onImported(): void {
  importOpen.value = false;
}

// --- 编辑（SC2-6：worldbook / SC2-7：preset / SC2-8：character）---
function openEditor(asset: LibraryAsset): void {
  if (asset.kind === "worldbook") {
    editingWorldbook.value = asset;
  } else if (asset.kind === "preset") {
    editingPreset.value = asset;
  } else if (asset.kind === "character") {
    editingCharacter.value = asset;
  }
}

function onEditSelected(): void {
  if (selected.value) {
    openEditor(selected.value);
  }
}

function onEditorClose(): void {
  editingWorldbook.value = null;
  // 编辑改动了 version/updatedAt：对账库列表；选择器缓存已加载时一并失效重拉。
  void store.loadAssets("worldbook");
  if (store.pickerCache.worldbook) {
    void store.refreshPickerList("worldbook");
  }
}

function onPresetEditorClose(): void {
  editingPreset.value = null;
  // 保存成功时 store 已对账 preset 列表；选择器缓存已加载时一并失效重拉。
  void store.loadAssets("preset");
  if (store.pickerCache.preset) {
    void store.refreshPickerList("preset");
  }
}

function onCharacterEditorClose(): void {
  editingCharacter.value = null;
  // 保存成功时 store 已对账 character 列表；选择器缓存已加载时一并失效重拉。
  void store.loadAssets("character");
  if (store.pickerCache.character) {
    void store.refreshPickerList("character");
  }
}
</script>

<template>
  <div class="flex h-full min-h-0">
    <LibrarySidebar v-model="activeKind" :heading="t('library.title')" :items="sidebarItems" />

    <div class="flex min-w-0 flex-1 flex-col">
      <!-- 工具条 -->
      <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line-subtle px-4">
        <div class="min-w-0 flex-1">
          <UiSearchInput
            :model-value="query.keyword"
            :placeholder="t('library.searchPlaceholder')"
            :aria-label="t('library.searchPlaceholder')"
            :debounce-ms="250"
            @update:model-value="onSearch"
          />
        </div>

        <div class="w-44 shrink-0">
          <UiSelect :model-value="sortValue" :options="sortOptions" @update:model-value="onSort" />
        </div>

        <div v-if="isCharacter" class="w-28 shrink-0">
          <UiSelect :model-value="query.status" :options="statusOptions" @update:model-value="onStatus" />
        </div>

        <UiButton class="shrink-0" @click="importOpen = true">
          <Plus :size="14" :stroke-width="1.5" />
          {{ t("library.import") }}
        </UiButton>
      </header>

      <!-- 列表体 -->
      <div class="min-h-0 flex-1 overflow-auto">
        <!-- 首载 skeleton -->
        <ul v-if="showSkeleton" class="divide-y divide-line-subtle" aria-hidden="true">
          <li v-for="n in 7" :key="n" class="flex items-center gap-3 py-3 pl-4 pr-3">
            <div class="size-8 shrink-0 animate-pulse rounded-md bg-float" />
            <div class="flex-1 space-y-1.5">
              <div class="h-3 w-1/3 animate-pulse rounded bg-float" />
              <div class="h-2.5 w-1/2 animate-pulse rounded bg-float" />
            </div>
          </li>
        </ul>

        <!-- 空态 -->
        <div
          v-else-if="showEmpty"
          class="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center"
        >
          <div
            class="flex size-12 items-center justify-center rounded-lg"
            :class="[KIND_STYLE[activeKind].bg, KIND_STYLE[activeKind].text]"
          >
            <component :is="KIND_STYLE[activeKind].icon" :size="22" :stroke-width="1.5" />
          </div>
          <p class="text-sm text-text-secondary">{{ t("library.empty") }}</p>
          <UiButton @click="importOpen = true">
            <Plus :size="14" :stroke-width="1.5" />
            {{ t("library.import") }}
          </UiButton>
        </div>

        <!-- 列表 -->
        <template v-else>
          <div class="px-4 py-2 text-[11px] text-text-muted">
            {{ t("library.resultsCount", { count: assets.length }) }}
          </div>
          <ul class="divide-y divide-line-subtle border-t border-line-subtle">
            <li v-for="asset in assets" :key="asset.id">
              <AssetRow
                :asset="asset"
                :selected="selected?.id === asset.id"
                :busy="deleting && confirmDelete?.id === asset.id"
                :can-edit="EDITABLE[asset.kind]"
                @open="onOpen(asset)"
                @edit="openEditor(asset)"
                @delete="requestDelete(asset)"
              />
            </li>
          </ul>
        </template>
      </div>
    </div>

    <AssetDetailDrawer
      v-if="selected"
      :key="selected.id"
      :asset="selected"
      :can-edit="canEditActive"
      @close="selected = null"
      @delete="requestDelete(selected)"
      @edit="onEditSelected"
    />

    <WorldbookEditorDialog
      :open="editingWorldbook !== null"
      :worldbook-id="editingWorldbook?.id ?? null"
      :worldbook-name="editingWorldbook?.name"
      @close="onEditorClose"
    />

    <PresetEditorDialog
      :open="editingPreset !== null"
      :preset-id="editingPreset?.id ?? null"
      :preset-name="editingPreset?.name"
      @close="onPresetEditorClose"
    />

    <CharacterEditorDialog
      :open="editingCharacter !== null"
      :character-id="editingCharacter?.id ?? null"
      :character-name="editingCharacter?.name"
      @close="onCharacterEditorClose"
    />

    <UiConfirmDialog
      :open="confirmDelete !== null"
      :title="t('library.confirmDeleteTitle')"
      :message="t('library.confirmDelete')"
      :confirm-label="t('library.delete')"
      :cancel-label="t('library.cancel')"
      :busy="deleting"
      @confirm="onConfirmDelete"
      @cancel="confirmDelete = null"
    />

    <UiDialog :open="importOpen" :title="t('library.importTitle')" size="md" :busy="store.importing" @close="importOpen = false">
      <AssetImportPanel :kind="activeKind" @imported="onImported" @cancel="importOpen = false" />
    </UiDialog>
  </div>
</template>
