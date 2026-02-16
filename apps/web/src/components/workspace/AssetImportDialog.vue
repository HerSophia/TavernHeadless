<script setup lang="ts">
import { DialogClose } from "radix-vue";
import { computed, ref, watch } from "vue";

import {
  validateAssetImportFile,
  type AssetImportReadyEntry,
  type AssetImportValidationResult
} from "../../lib/asset-import";
import type {
  LibraryImportDuplicatePolicy,
  LibraryImportFailure,
  LibraryImportProgress,
  WorkspaceAsset
} from "../../stores/workspace";
import AssetImportFailurePanel from "./asset-import/AssetImportFailurePanel.vue";
import AssetImportPrecheckPanel from "./asset-import/AssetImportPrecheckPanel.vue";
import UiDialogActions from "../ui/UiDialogActions.vue";
import UiDialogButton from "../ui/UiDialogButton.vue";
import UiDialogRow from "../ui/UiDialogRow.vue";
import UiSelectShell from "../ui/UiSelectShell.vue";
import UiDialogShell from "../ui/UiDialogShell.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  duplicatePolicy: LibraryImportDuplicatePolicy;
  importing: boolean;
  importFailures: LibraryImportFailure[];
  kind: WorkspaceAsset["kind"];
  open: boolean;
  progress: LibraryImportProgress;
  t: Translator;
}>();

const emit = defineEmits<{
  clearFailures: [];
  submit: [entries: AssetImportReadyEntry[]];
  "update:duplicatePolicy": [value: LibraryImportDuplicatePolicy];
  "update:kind": [value: WorkspaceAsset["kind"]];
  "update:open": [value: boolean];
}>();

const queuedFiles = ref<File[]>([]);
const dragActive = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const precheckRows = ref<AssetImportValidationResult[]>([]);
const prechecking = ref(false);

let precheckTicket = 0;

const kindOptions: Array<{ key: WorkspaceAsset["kind"]; labelKey: string }> = [
  { key: "character", labelKey: "nav.characters" },
  { key: "worldbook", labelKey: "nav.worldbooks" },
  { key: "preset", labelKey: "nav.presets" },
  { key: "user", labelKey: "nav.users" }
];

const kindOptionValues = new Set<WorkspaceAsset["kind"]>(kindOptions.map((option) => option.key));

const kindSelectOptions = computed(() => {
  return kindOptions.map((option) => ({
    label: props.t(option.labelKey),
    value: option.key
  }));
});

const duplicatePolicyOptions = computed(() => [
  { label: props.t("dialogs.assetImportDuplicateSkip"), value: "skip" },
  { label: props.t("dialogs.assetImportDuplicateAllow"), value: "allow" }
]);

const readyEntries = computed<AssetImportReadyEntry[]>(() => {
  return precheckRows.value
    .filter((row) => row.ok && row.payload)
    .map((row) => ({
      fileName: row.fileName,
      payload: row.payload
    }));
});

const canSubmit = computed(() => readyEntries.value.length > 0 && !props.importing && !prechecking.value);

const precheckStats = computed(() => {
  const valid = precheckRows.value.filter((row) => row.ok).length;
  const invalid = precheckRows.value.length - valid;
  return {
    invalid,
    valid
  };
});

const acceptPattern = computed(() => {
  return props.kind === "character" ? "application/json,.json,.png,.webp,image/png,image/webp" : "application/json,.json";
});

const formatHintKey = computed(() => {
  return props.kind === "character" ? "dialogs.assetImportCharacterFormats" : "dialogs.assetImportJsonOnly";
});

const failedReadyEntries = computed(() => {
  const pending = new Map<string, number>();
  for (const failure of props.importFailures) {
    if (failure.reason === "api") {
      pending.set(failure.fileName, (pending.get(failure.fileName) ?? 0) + 1);
    }
  }

  return readyEntries.value.filter((entry) => {
    const remaining = pending.get(entry.fileName) ?? 0;
    if (remaining <= 0) {
      return false;
    }
    pending.set(entry.fileName, remaining - 1);
    return true;
  });
});

const canRetryFailures = computed(() => {
  return failedReadyEntries.value.length > 0 && !props.importing && !prechecking.value;
});

const importProgressVisible = computed(() => props.progress.total > 0);

const importProgressPercent = computed(() => {
  if (props.progress.total <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((props.progress.processed / props.progress.total) * 100));
});

const importProgressLabelKey = computed(() => `dialogs.assetImportProgressPhase.${props.progress.phase}`);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      queuedFiles.value = [];
      dragActive.value = false;
      precheckRows.value = [];
      prechecking.value = false;
      emit("clearFailures");
    }
  }
);

watch(
  [queuedFiles, () => props.kind, () => props.duplicatePolicy],
  () => {
    emit("clearFailures");
    void runPrecheck();
  },
  {
    deep: true
  }
);

function mergeFiles(next: FileList | File[]): void {
  const incoming = Array.from(next);
  if (incoming.length === 0) {
    return;
  }

  const dedupe = new Map<string, File>();
  for (const file of queuedFiles.value) {
    dedupe.set(fileKey(file), file);
  }
  for (const file of incoming) {
    dedupe.set(fileKey(file), file);
  }

  queuedFiles.value = Array.from(dedupe.values());
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function openFilePicker(): void {
  fileInputRef.value?.click();
}

function handleInputChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.files) {
    return;
  }

  mergeFiles(target.files);
  target.value = "";
}

function handleDrop(event: DragEvent): void {
  dragActive.value = false;
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) {
    return;
  }

  mergeFiles(files);
}

function removeFile(index: number): void {
  if (index < 0 || index >= queuedFiles.value.length) {
    return;
  }
  queuedFiles.value.splice(index, 1);
}

async function runPrecheck(): Promise<void> {
  const files = [...queuedFiles.value];
  const ticket = precheckTicket + 1;
  precheckTicket = ticket;

  if (files.length === 0) {
    precheckRows.value = [];
    prechecking.value = false;
    return;
  }

  prechecking.value = true;
  const results = await Promise.all(files.map((file) => validateAssetImportFile(props.kind, file)));

  if (ticket !== precheckTicket) {
    return;
  }

  precheckRows.value = results;
  prechecking.value = false;
}

function updateDuplicatePolicy(value: string): void {
  const policy = value === "allow" ? "allow" : "skip";
  emit("update:duplicatePolicy", policy);
  emit("clearFailures");
}

function updateKind(value: string): void {
  if (!kindOptionValues.has(value as WorkspaceAsset["kind"])) {
    return;
  }

  emit("update:kind", value as WorkspaceAsset["kind"]);
  emit("clearFailures");
}

function submitImport(): void {
  if (!canSubmit.value) {
    return;
  }
  emit("submit", readyEntries.value);
}

function retryFailedImports(): void {
  if (!canRetryFailures.value) {
    return;
  }
  emit("submit", failedReadyEntries.value);
}
</script>



<template>
  <UiDialogShell
    :description="props.t('dialogs.assetImportDescription')"
    :open="props.open"
    :title="props.t('dialogs.assetImportTitle')"
    @update:open="emit('update:open', $event)"
  >
    <UiDialogRow :label="props.t('dialogs.assetImportKind')" row-class="mt-3">
      <UiSelectShell
        :model-value="props.kind"
        :options="kindSelectOptions"
        @update:model-value="updateKind"
      />
    </UiDialogRow>

    <UiDialogRow :label="props.t('dialogs.assetImportDuplicatePolicy')" row-class="mt-2">
      <UiSelectShell
        :model-value="props.duplicatePolicy"
        :options="duplicatePolicyOptions"
        @update:model-value="updateDuplicatePolicy"
      />
    </UiDialogRow>

    <div
      class="asset-import-dropzone mt-3"
      :class="dragActive ? 'active' : ''"
      @dragenter.prevent="dragActive = true"
      @dragover.prevent="dragActive = true"
      @dragleave.prevent="dragActive = false"
      @drop.prevent="handleDrop"
    >
      <p class="text-xs text-zinc-300">{{ props.t("dialogs.assetImportDropHint") }}</p>
      <p class="mt-1 font-mono text-[10px] text-zinc-500">{{ props.t(formatHintKey) }}</p>
      <UiDialogButton class="mt-3" type="button" @click="openFilePicker">
        {{ props.t("dialogs.assetImportChoose") }}
      </UiDialogButton>
      <input
        ref="fileInputRef"
        class="hidden"
        type="file"
        :accept="acceptPattern"
        multiple
        @change="handleInputChange"
      >
    </div>

    <div class="mt-3 space-y-1">
      <div class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.assetImportQueued", { count: queuedFiles.length }) }}</div>
      <div class="max-h-20 space-y-1 overflow-y-auto">
        <div
          v-for="(file, index) in queuedFiles"
          :key="fileKey(file)"
          class="asset-import-file-row"
        >
          <span class="truncate">{{ file.name }}</span>
          <button class="asset-import-file-remove" type="button" @click="removeFile(index)">x</button>
        </div>
      </div>
    </div>

    <div v-if="importProgressVisible" class="asset-import-progress mt-3">
      <div class="asset-import-precheck-head">
        <span>{{ props.t("dialogs.assetImportProgressTitle") }}</span>
        <span class="font-mono text-[10px] text-zinc-500">
          {{ props.t("dialogs.assetImportProgressCounter", { processed: props.progress.processed, total: props.progress.total }) }}
        </span>
      </div>
      <div class="asset-import-progress-bar mt-2">
        <div class="asset-import-progress-fill" :style="{ width: `${importProgressPercent}%` }" />
      </div>
      <div class="mt-2 text-[10px] text-zinc-400">
        {{ props.t(importProgressLabelKey) }}
        <span v-if="props.progress.currentFile">- {{ props.progress.currentFile }}</span>
      </div>
      <div class="mt-1 font-mono text-[10px] text-zinc-500">
        {{ props.t("dialogs.assetImportProgressStats", { imported: props.progress.imported, failed: props.progress.failed, skipped: props.progress.skipped }) }}
      </div>
    </div>

    <AssetImportPrecheckPanel
      :prechecking="prechecking"
      :precheck-rows="precheckRows"
      :stats="precheckStats"
      :t="props.t"
    />

    <AssetImportFailurePanel
      :can-retry-failures="canRetryFailures"
      :failures="props.importFailures"
      :t="props.t"
      @retry="retryFailedImports"
    />

    <UiDialogActions>
      <DialogClose as-child>
        <UiDialogButton type="button">{{ props.t("dialogs.cancel") }}</UiDialogButton>
      </DialogClose>
      <UiDialogButton type="button" variant="primary" :disabled="!canSubmit" @click="submitImport">
        {{ props.importing ? props.t("dialogs.assetImporting") : props.t("dialogs.assetImportSubmit") }}
      </UiDialogButton>
    </UiDialogActions>
  </UiDialogShell>
</template>
