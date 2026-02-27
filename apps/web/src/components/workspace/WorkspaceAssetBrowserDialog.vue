<script setup lang="ts">
import type { WorkspaceAsset, WorkspaceAssetKind } from "../../stores/workspace";
import UiDialogShell from "../ui/UiDialogShell.vue";
import WorkspaceAssetBrowser from "./WorkspaceAssetBrowser.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  assets: WorkspaceAsset[];
  open: boolean;
  t: Translator;
}>();

const emit = defineEmits<{
  applyAsset: [assetId: string];
  openAsset: [assetId: string];
  openAssetContextMenu: [event: MouseEvent, assetId: string];
  openImport: [kind: WorkspaceAssetKind];
  toggleFavorite: [assetId: string];
  "update:open": [value: boolean];
}>();
</script>

<template>
  <UiDialogShell
    :content-class="'asset-browser-dialog'"
    :description="props.t('dialogs.assetBrowserDescription')"
    :open="props.open"
    :title="props.t('dialogs.assetBrowserTitle')"
    @update:open="emit('update:open', $event)"
  >
    <div class="asset-browser-dialog-body mt-3">
      <WorkspaceAssetBrowser
        :assets="props.assets"
        :t="props.t"
        variant="dialog"
        @apply-asset="emit('applyAsset', $event)"
        @open-asset="emit('openAsset', $event)"
        @open-asset-context-menu="(event, assetId) => emit('openAssetContextMenu', event, assetId)"
        @open-import="emit('openImport', $event)"
        @toggle-favorite="emit('toggleFavorite', $event)"
      />
    </div>
  </UiDialogShell>
</template>
