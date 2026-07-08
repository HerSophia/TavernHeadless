<script setup lang="ts">
/**
 * 资产导入面板（SC2-2 微调）。
 *
 * 保留校验（`validateAssetImportFile`）+ 提交（`store.importValidated`）语义；
 * 微调：拖拽区（dragover/drop 复用同一校验路径）+ 命名预览（`deriveAssetName`）。
 * 由 `LibraryView` 以 `UiDialog` 承载（标题由对话框提供，故本面板不再自绘标题）。
 */
import { UploadCloud } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import { deriveAssetName } from "../../lib/assets/imports";
import type { AssetImportValidationResult, AssetKind } from "../../lib/assets/types";
import { validateAssetImportFile } from "../../lib/assets/validate-import";
import { useAssetsStore } from "../../stores/assets";
import UiButton from "../../ui/UiButton.vue";

const props = defineProps<{ kind: AssetKind }>();
const emit = defineEmits<{ imported: [name: string]; cancel: [] }>();

const { t } = useI18n();
const store = useAssetsStore();

const fileName = ref("");
const validation = ref<AssetImportValidationResult | null>(null);
const validating = ref(false);
const importError = ref<string | null>(null);
const dragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const accept = computed(() =>
  props.kind === "character"
    ? ".json,.png,.webp,application/json,image/png,image/webp"
    : ".json,application/json",
);

const canImport = computed(() => Boolean(validation.value?.ok) && !store.importing);

/** 有效文件时的推导资产名（命名预览）。 */
const previewName = computed(() => (validation.value?.ok ? deriveAssetName(fileName.value) : ""));

async function handleFile(file: File | undefined): Promise<void> {
  validation.value = null;
  importError.value = null;
  if (!file) {
    fileName.value = "";
    return;
  }
  fileName.value = file.name;
  validating.value = true;
  try {
    validation.value = await validateAssetImportFile(props.kind, file);
  } finally {
    validating.value = false;
  }
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  void handleFile(input.files?.[0]);
}

function onDrop(event: DragEvent): void {
  dragging.value = false;
  void handleFile(event.dataTransfer?.files?.[0]);
}

function openPicker(): void {
  fileInput.value?.click();
}

async function onImport(): Promise<void> {
  if (!validation.value?.ok) {
    return;
  }
  importError.value = null;
  try {
    const summary = await store.importValidated(props.kind, validation.value);
    emit("imported", summary.name);
  } catch (cause) {
    importError.value = cause instanceof Error ? cause.message : String(cause);
  }
}
</script>

<template>
  <div class="space-y-3">
    <!-- 拖拽区（点击 = 打开文件选择；拖入 = 走同一校验路径） -->
    <div
      role="button"
      tabindex="0"
      class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center transition-colors duration-150 focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
      :class="dragging ? 'border-signal-accent bg-signal-accent/5' : 'border-line-subtle hover:border-line-active'"
      @click="openPicker"
      @keydown.enter.prevent="openPicker"
      @keydown.space.prevent="openPicker"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <UploadCloud :size="24" :stroke-width="1.5" class="text-text-muted" />
      <span class="text-xs text-text-secondary">{{ t("library.dropZone") }}</span>
      <span class="text-[11px] text-text-muted">{{ t("library.dropHint") }}</span>
      <input ref="fileInput" type="file" :accept="accept" class="hidden" @change="onFileChange" />
    </div>

    <p v-if="fileName" class="truncate font-mono text-xs text-text-secondary">
      {{ fileName }}
    </p>

    <p v-if="validating" class="text-xs text-text-muted">{{ t("library.validating") }}</p>
    <template v-else-if="validation">
      <p
        class="font-mono text-xs"
        :class="validation.ok ? 'text-signal-success' : 'text-signal-error'"
      >
        {{ t(`library.reason_${validation.reason}`) }}
        <span v-if="validation.detail && !validation.ok" class="text-text-muted">· {{ validation.detail }}</span>
      </p>
      <p v-if="previewName" class="text-xs text-text-muted">
        {{ t("library.namePreview") }}：<span class="text-text-secondary">{{ previewName }}</span>
      </p>
    </template>

    <p v-if="importError" class="font-mono text-xs text-signal-error">{{ importError }}</p>

    <div class="flex items-center justify-end gap-2 border-t border-line-subtle pt-3">
      <UiButton variant="ghost" @click="emit('cancel')">{{ t("library.cancel") }}</UiButton>
      <UiButton :disabled="!canImport" @click="onImport">
        {{ store.importing ? t("library.importing") : t("library.doImport") }}
      </UiButton>
    </div>
  </div>
</template>
