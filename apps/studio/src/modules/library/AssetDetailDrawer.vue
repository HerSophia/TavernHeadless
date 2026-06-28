<script setup lang="ts">
import { X } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import type { AssetVersionItem, LibraryAsset } from "../../lib/assets/types";
import { useAssetsStore } from "../../stores/assets";
import UiIconButton from "../../ui/UiIconButton.vue";

const props = defineProps<{ asset: LibraryAsset }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const store = useAssetsStore();

const versions = ref<AssetVersionItem[]>([]);
const loading = ref(false);

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
    <header class="flex items-center justify-between border-b border-line-subtle px-4 py-2.5">
      <span class="truncate text-sm font-medium text-text-primary">{{ asset.name }}</span>
      <UiIconButton :label="t('library.close')" @click="emit('close')">
        <X :size="14" :stroke-width="1.5" />
      </UiIconButton>
    </header>

    <div class="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      <dl class="space-y-2 text-xs">
        <div class="flex justify-between gap-3">
          <dt class="text-text-muted">id</dt>
          <dd class="truncate font-mono text-text-secondary">{{ asset.id }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-text-muted">{{ t("library.source") }}</dt>
          <dd class="font-mono text-text-secondary">{{ asset.source }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-text-muted">{{ t("library.version") }}</dt>
          <dd class="font-mono text-text-secondary">{{ asset.version ?? "—" }}</dd>
        </div>
        <div class="flex justify-between gap-3">
          <dt class="text-text-muted">{{ t("library.updated") }}</dt>
          <dd class="font-mono text-text-secondary">{{ formatTs(asset.updatedAt) }}</dd>
        </div>
      </dl>

      <section class="space-y-1.5">
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
  </aside>
</template>
