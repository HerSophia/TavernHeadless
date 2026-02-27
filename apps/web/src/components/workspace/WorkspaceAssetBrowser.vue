<script setup lang="ts">
import {
  BookOpenText,
  Contact,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  UserCircle2,
  Upload,
  Users
} from "lucide-vue-next";
import { toRef } from "vue";

import { useWorkspaceAssetBrowser } from "../../composables/workspace/assets";
import UiIconActionButton from "../ui/UiIconActionButton.vue";
import type { WorkspaceAsset, WorkspaceAssetKind } from "../../stores/workspace";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = withDefaults(defineProps<{
  assets: WorkspaceAsset[];
  t: Translator;
  variant?: "sidebar" | "dialog";
}>(), {
  variant: "sidebar"
});

const emit = defineEmits<{
  applyAsset: [assetId: string];
  openAsset: [assetId: string];
  toggleFavorite: [assetId: string];
  openImport: [kind: WorkspaceAssetKind];
  openAssetContextMenu: [event: MouseEvent, assetId: string];
}>();

const {
  cycleSortMode,
  filter,
  filterOptions,
  formatAssetUpdatedAt,
  handleBrowserKeydown,
  importKind,
  openAsset,
  openAssetContextMenu,
  openSelectedAsset,
  openImport,
  searchInputRef,
  searchText,
  selectAsset,
  selectedAsset,
  selectedAssetId,
  setFilter,
  applySelectedAsset,
  sortMode,
  visibleAssets
} = useWorkspaceAssetBrowser({
  assets: toRef(props, "assets"),
  onApplyAsset(assetId) {
    emit("applyAsset", assetId);
  },
  onOpenAsset(assetId) {
    emit("openAsset", assetId);
  },
  onOpenAssetContextMenu(event, assetId) {
    emit("openAssetContextMenu", event, assetId);
  },
  onOpenImport(kind) {
    emit("openImport", kind);
  }
});
</script>

<template>
  <section class="asset-browser rounded border border-white/5 bg-white/[0.02] p-2" :class="props.variant === 'dialog' ? 'asset-browser--dialog' : ''" tabindex="0" @keydown="handleBrowserKeydown">
    <div class="asset-browser-toolbar">
      <div class="flex items-center gap-2">
        <span class="font-mono text-[10px] uppercase tracking-widest text-zinc-500">{{ props.t("nav.assetBrowser") }}</span>
        <span class="font-mono text-[10px] text-zinc-600">{{ props.t("dynamic.assetCount", { count: visibleAssets.length }) }}</span>
        <button class="asset-browser-action" type="button" @click="openImport">
          <Upload class="h-3 w-3" />
          <span class="font-mono text-[10px]">{{ props.t("actions.importAssets") }}</span>
        </button>
      </div>
      <button
        class="asset-browser-sort"
        type="button"
        @click="cycleSortMode"
      >
        <SlidersHorizontal class="h-3 w-3" />
        <span>{{ sortMode === "updated" ? props.t("nav.assetSortUpdated") : props.t("nav.assetSortName") }}</span>
      </button>
    </div>

    <label class="asset-browser-search">
      <Search class="h-3.5 w-3.5 text-zinc-600" />
      <input
        ref="searchInputRef"
        v-model="searchText"
        type="text"
        :placeholder="props.t('nav.assetSearchPlaceholder')"
      >
    </label>

    <div class="asset-browser-filters">
      <button
        v-for="option in filterOptions"
        :key="option.key"
        class="asset-browser-filter"
        :class="filter === option.key ? 'active' : ''"
        type="button"
        @click="setFilter(option.key)"
      >
        {{ props.t(option.labelKey) }}
      </button>
    </div>

    <div class="asset-browser-list">
      <div
        v-for="asset in visibleAssets"
        :key="asset.id"
        class="asset-browser-item"
        :class="selectedAssetId === asset.id ? 'active' : ''"
        data-asset-item
      >
        <button
          class="asset-browser-item-main"
          type="button"
          @click="selectAsset(asset.id)"
          @dblclick="openAsset(asset.id)"
          @contextmenu.prevent="openAssetContextMenu($event, asset.id)"
        >
          <div class="asset-browser-item-head">
            <div class="flex min-w-0 items-center gap-1.5">
              <UserCircle2 v-if="asset.kind === 'character'" class="h-3.5 w-3.5 shrink-0 text-teal-300" />
              <BookOpenText v-else-if="asset.kind === 'worldbook'" class="h-3.5 w-3.5 shrink-0 text-sky-300" />
              <Contact v-else-if="asset.kind === 'user'" class="h-3.5 w-3.5 shrink-0 text-amber-300" />
              <Sparkles v-else class="h-3.5 w-3.5 shrink-0 text-violet-300" />
              <span class="truncate text-[11px] text-zinc-100">{{ asset.name }}</span>
            </div>
            <span class="font-mono text-[10px] text-zinc-600">{{ formatAssetUpdatedAt(asset.updatedAt) }}</span>
          </div>
          <div class="asset-browser-item-meta">
            <span>{{ props.t(`dynamic.assetKind.${asset.kind}`) }}</span>
            <span>{{ props.t("dynamic.assetUseCount", { count: asset.uses }) }}</span>
          </div>
          <p class="line-clamp-2 text-[11px] leading-relaxed text-zinc-500">{{ asset.summary }}</p>
          <div class="asset-browser-tags">
            <span v-for="tag in asset.tags.slice(0, 2)" :key="tag" class="asset-browser-tag">#{{ tag }}</span>
          </div>
        </button>

        <div class="asset-browser-item-actions">
          <UiIconActionButton
            class="asset-browser-action"
            @click="emit('toggleFavorite', asset.id)"
          >
            <Star class="h-3 w-3" :class="asset.favorite ? 'fill-current text-amber-300' : ''" />
          </UiIconActionButton>
          <UiIconActionButton class="asset-browser-action apply" @click="emit('applyAsset', asset.id)">
            <Users class="h-3 w-3" />
          </UiIconActionButton>
        </div>
      </div>

      <div v-if="visibleAssets.length === 0" class="rounded border border-dashed border-white/10 p-2 text-[11px] text-zinc-500">
        {{ props.t("nav.assetEmpty") }}
      </div>
    </div>

    <div v-if="selectedAsset" class="asset-browser-preview">
      <div class="asset-browser-item-head">
        <span class="text-[11px] text-zinc-200">{{ selectedAsset.name }}</span>
        <span class="font-mono text-[10px] text-zinc-600">{{ selectedAsset.id }}</span>
      </div>
      <div class="asset-browser-item-meta">
        <span>{{ props.t(`dynamic.assetKind.${selectedAsset.kind}`) }}</span>
        <span>{{ props.t("dynamic.assetUseCount", { count: selectedAsset.uses }) }}</span>
      </div>
      <p class="text-[11px] leading-relaxed text-zinc-400">{{ selectedAsset.summary }}</p>
      <div class="asset-browser-tags">
        <span v-for="tag in selectedAsset.tags" :key="tag" class="asset-browser-tag">#{{ tag }}</span>
      </div>
      <div class="asset-browser-preview-actions">
        <button class="asset-browser-action" type="button" @click="openSelectedAsset">
          {{ props.t("actions.openAsset") }}
        </button>
        <button class="asset-browser-action apply" type="button" @click="applySelectedAsset">
          {{ props.t("actions.applyAsset") }}
        </button>
      </div>
    </div>

    <div class="mt-2 font-mono text-[10px] text-zinc-600">
      {{ props.t("nav.assetBrowserHint") }}
    </div>
  </section>
</template>
