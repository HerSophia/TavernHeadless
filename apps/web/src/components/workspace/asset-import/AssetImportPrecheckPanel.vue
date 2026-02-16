<script setup lang="ts">
import { ref, watch } from "vue";

import type {
  AssetImportValidationReason,
  AssetImportValidationResult
} from "../../../lib/asset-import";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  prechecking: boolean;
  precheckRows: AssetImportValidationResult[];
  stats: {
    invalid: number;
    valid: number;
  };
  t: Translator;
}>();

const expandedRows = ref<Set<string>>(new Set());

watch(() => props.precheckRows, () => {
  expandedRows.value = new Set();
}, {
  deep: true
});

function precheckRowKey(item: AssetImportValidationResult, rowIndex: number): string {
  return `${item.fileName}:${rowIndex}`;
}

function hasPrecheckDetail(item: AssetImportValidationResult): boolean {
  return typeof item.detail === "string" && item.detail.trim().length > 0;
}

function isPrecheckExpanded(item: AssetImportValidationResult, rowIndex: number): boolean {
  return expandedRows.value.has(precheckRowKey(item, rowIndex));
}

function togglePrecheckDetails(item: AssetImportValidationResult, rowIndex: number): void {
  const key = precheckRowKey(item, rowIndex);
  const next = new Set(expandedRows.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  expandedRows.value = next;
}

function getReasonLabel(reason: AssetImportValidationReason): string {
  const mapping: Record<AssetImportValidationReason, string> = {
    errorCharacterImageUnsupported: "dialogs.assetPrecheckReason.errorCharacterImageUnsupported",
    errorCharacterMetadataMissing: "dialogs.assetPrecheckReason.errorCharacterMetadataMissing",
    errorCharacterMetadataParse: "dialogs.assetPrecheckReason.errorCharacterMetadataParse",
    errorFileRead: "dialogs.assetPrecheckReason.errorFileRead",
    errorJsonObjectExpected: "dialogs.assetPrecheckReason.errorJsonObjectExpected",
    errorJsonParse: "dialogs.assetPrecheckReason.errorJsonParse",
    errorUnsupportedFormat: "dialogs.assetPrecheckReason.errorUnsupportedFormat",
    okCharacterImage: "dialogs.assetPrecheckReason.okCharacterImage",
    okJson: "dialogs.assetPrecheckReason.okJson"
  };

  return props.t(mapping[reason]);
}
</script>

<template>
  <div class="asset-import-precheck mt-3">
    <div class="asset-import-precheck-head">
      <span>{{ t("dialogs.assetPrecheckTitle") }}</span>
      <span class="font-mono text-[10px] text-zinc-500">
        {{ t("dialogs.assetPrecheckStats", { valid: stats.valid, invalid: stats.invalid }) }}
      </span>
    </div>

    <div v-if="prechecking" class="asset-import-precheck-empty">{{ t("dialogs.assetPrecheckRunning") }}</div>
    <div v-else-if="precheckRows.length === 0" class="asset-import-precheck-empty">{{ t("dialogs.assetPrecheckNone") }}</div>

    <div v-else class="asset-import-precheck-list">
      <div
        v-for="(item, rowIndex) in precheckRows"
        :key="precheckRowKey(item, rowIndex)"
        class="asset-import-precheck-row"
        :class="item.ok ? 'ok' : 'error'"
      >
        <div class="asset-import-row-main">
          <div class="min-w-0">
            <div class="truncate text-[11px] text-zinc-200">{{ item.fileName }}</div>
            <div class="text-[10px] text-zinc-500">{{ getReasonLabel(item.reason) }}</div>
          </div>
          <div class="asset-import-row-end">
            <button
              v-if="hasPrecheckDetail(item)"
              class="asset-import-row-expand"
              type="button"
              @click="togglePrecheckDetails(item, rowIndex)"
            >
              {{ isPrecheckExpanded(item, rowIndex) ? t("dialogs.hideDetail") : t("dialogs.showDetail") }}
            </button>
            <span class="asset-import-precheck-badge">{{ item.ok ? t("dialogs.assetPrecheckValid") : t("dialogs.assetPrecheckInvalid") }}</span>
          </div>
        </div>
        <pre v-if="hasPrecheckDetail(item) && isPrecheckExpanded(item, rowIndex)" class="asset-import-row-detail">{{ item.detail }}</pre>
      </div>
    </div>
  </div>
</template>
