<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

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

const accept = computed(() =>
  props.kind === "character"
    ? ".json,.png,.webp,application/json,image/png,image/webp"
    : ".json,application/json",
);

const canImport = computed(() => Boolean(validation.value?.ok) && !store.importing);

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
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
    <h3 class="text-sm font-medium text-text-primary">{{ t("library.importTitle") }}</h3>

    <label class="block space-y-1">
      <span class="text-xs text-text-secondary">{{ t("library.pickFile") }}</span>
      <input
        type="file"
        :accept="accept"
        class="block w-full text-xs text-text-secondary file:mr-3 file:rounded-md file:border file:border-line-subtle file:bg-float file:px-3 file:py-1.5 file:text-text-primary hover:file:border-line-active"
        @change="onFileChange"
      />
      <span class="block text-xs text-text-muted">{{ t("library.dropHint") }}</span>
    </label>

    <p v-if="validating" class="text-xs text-text-muted">{{ t("library.validating") }}</p>
    <p
      v-else-if="validation"
      class="font-mono text-xs"
      :class="validation.ok ? 'text-signal-success' : 'text-signal-error'"
    >
      {{ t(`library.reason_${validation.reason}`) }}
      <span v-if="validation.detail && !validation.ok" class="text-text-muted">· {{ validation.detail }}</span>
    </p>

    <p v-if="importError" class="font-mono text-xs text-signal-error">{{ importError }}</p>

    <div class="flex items-center gap-2 border-t border-line-subtle pt-3">
      <UiButton :disabled="!canImport" @click="onImport">
        {{ store.importing ? t("library.importing") : t("library.doImport") }}
      </UiButton>
      <UiButton variant="ghost" @click="emit('cancel')">{{ t("library.cancel") }}</UiButton>
    </div>
  </div>
</template>
