<script setup lang="ts">
import { BookOpen, Braces, FileText, Plus, Trash2, User } from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { AssetKind, LibraryAsset } from "../../lib/assets/types";
import { useAssetsStore } from "../../stores/assets";
import UiButton from "../../ui/UiButton.vue";
import UiIconButton from "../../ui/UiIconButton.vue";
import AssetDetailDrawer from "./AssetDetailDrawer.vue";
import AssetImportPanel from "./AssetImportPanel.vue";

const { t } = useI18n();
const store = useAssetsStore();

const activeKind = ref<AssetKind>("character");
const importing = ref(false);
const selected = ref<LibraryAsset | null>(null);
const confirmingDelete = ref<string | null>(null);

const tabs = computed(() => [
  { id: "character" as const, label: t("library.tab_character"), icon: User },
  { id: "preset" as const, label: t("library.tab_preset"), icon: FileText },
  { id: "worldbook" as const, label: t("library.tab_worldbook"), icon: BookOpen },
  { id: "regex" as const, label: t("library.tab_regex"), icon: Braces },
]);

const assets = computed(() => store.lists[activeKind.value]);

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

onMounted(() => {
  void store.loadAssets(activeKind.value);
});

watch(activeKind, (kind) => {
  importing.value = false;
  selected.value = null;
  confirmingDelete.value = null;
  void store.loadAssets(kind);
});

function onImported(): void {
  importing.value = false;
}

async function onDelete(asset: LibraryAsset): Promise<void> {
  await store.removeAsset(asset.kind, asset.id);
  confirmingDelete.value = null;
  if (selected.value?.id === asset.id) {
    selected.value = null;
  }
}
</script>

<template>
  <div class="flex h-full min-h-0">
    <div class="flex min-w-0 flex-1 flex-col">
      <nav class="flex shrink-0 items-center gap-1 border-b border-line-subtle bg-panel px-3">
        <button
          v-for="item in tabs"
          :key="item.id"
          type="button"
          class="inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs transition-colors duration-150 focus:outline-none"
          :class="
            activeKind === item.id
              ? 'border-b-signal-accent text-text-primary'
              : 'border-b-transparent text-text-muted hover:text-text-secondary'
          "
          @click="activeKind = item.id"
        >
          <component :is="item.icon" :size="14" :stroke-width="1.5" />
          {{ item.label }}
        </button>
      </nav>

      <div class="min-h-0 flex-1 overflow-auto">
        <div class="mx-auto max-w-3xl space-y-4 p-5">
          <header class="flex items-center justify-between">
            <h2 class="text-sm font-medium text-text-primary">{{ t("library.title") }}</h2>
            <UiButton v-if="!importing" @click="importing = true">
              <Plus :size="14" :stroke-width="1.5" />
              {{ t("library.import") }}
            </UiButton>
          </header>

          <section v-if="importing" class="rounded-md border border-line-subtle bg-panel p-4">
            <AssetImportPanel :kind="activeKind" @imported="onImported" @cancel="importing = false" />
          </section>

          <section v-else class="divide-y divide-line-subtle overflow-hidden rounded-md border border-line-subtle bg-panel">
            <p v-if="assets.length === 0" class="px-4 py-6 text-center text-xs text-text-muted">
              {{ t("library.empty") }}
            </p>
            <div
              v-for="asset in assets"
              :key="asset.id"
              class="flex items-center gap-3 px-4 py-3"
              :class="selected?.id === asset.id ? 'bg-float/40' : ''"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="truncate text-sm text-text-primary">{{ asset.name }}</span>
                  <span
                    v-if="asset.version !== null"
                    class="shrink-0 font-mono text-[10px] text-text-muted"
                  >v{{ asset.version }}</span>
                </div>
                <div class="mt-0.5 flex items-center gap-2 font-mono text-xs text-text-muted">
                  <span>{{ asset.source }}</span>
                  <span>· {{ formatTs(asset.updatedAt) }}</span>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-1">
                <template v-if="confirmingDelete === asset.id">
                  <span class="text-xs text-text-muted">{{ t("library.confirmDelete") }}</span>
                  <UiButton variant="ghost" @click="onDelete(asset)">{{ t("library.confirm") }}</UiButton>
                  <UiButton variant="ghost" @click="confirmingDelete = null">{{ t("library.cancel") }}</UiButton>
                </template>
                <template v-else>
                  <UiButton variant="ghost" @click="selected = asset">{{ t("library.detail") }}</UiButton>
                  <UiIconButton :label="t('library.delete')" @click="confirmingDelete = asset.id">
                    <Trash2 :size="14" :stroke-width="1.5" />
                  </UiIconButton>
                </template>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>

    <AssetDetailDrawer v-if="selected" :key="selected.id" :asset="selected" @close="selected = null" />
  </div>
</template>
