<script setup lang="ts">
import { ref, watch } from "vue";

import type { LibraryImportFailure } from "../../../stores/workspace";
import UiDialogButton from "../../ui/UiDialogButton.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  canRetryFailures: boolean;
  failures: LibraryImportFailure[];
  t: Translator;
}>();

const emit = defineEmits<{
  retry: [];
}>();

const expandedRows = ref<Set<string>>(new Set());

watch(() => props.failures, () => {
  expandedRows.value = new Set();
}, {
  deep: true
});

function failureRowKey(failure: LibraryImportFailure, rowIndex: number): string {
  return `${failure.fileName}:${rowIndex}`;
}

function isFailureExpanded(failure: LibraryImportFailure, rowIndex: number): boolean {
  return expandedRows.value.has(failureRowKey(failure, rowIndex));
}

function toggleFailureDetails(failure: LibraryImportFailure, rowIndex: number): void {
  const key = failureRowKey(failure, rowIndex);
  const next = new Set(expandedRows.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  expandedRows.value = next;
}

function failurePreview(message: string): string {
  const firstLine = message.split(/\r?\n/u, 1)[0] ?? "";
  if (firstLine.length <= 90) {
    return firstLine;
  }
  return `${firstLine.slice(0, 87)}...`;
}

function getFailureReasonLabel(failure: LibraryImportFailure): string {
  const mapping: Record<LibraryImportFailure["reason"], string> = {
    api: "dialogs.assetImportFailureReason.api",
    duplicate_batch: "dialogs.assetImportFailureReason.duplicateBatch",
    duplicate_existing: "dialogs.assetImportFailureReason.duplicateExisting"
  };

  return props.t(mapping[failure.reason]);
}

function getFailureDetail(failure: LibraryImportFailure): string {
  if (failure.reason === "api") {
    return failure.message?.trim() ?? "";
  }

  if (failure.assetName) {
    return props.t("dialogs.assetImportFailureName", {
      name: failure.assetName
    });
  }

  return "";
}

function getFailureSummary(failure: LibraryImportFailure): string {
  const reason = getFailureReasonLabel(failure);
  if (failure.reason !== "api" || !failure.message) {
    return reason;
  }

  const preview = failurePreview(failure.message);
  return preview ? `${reason}: ${preview}` : reason;
}

function hasFailureDetail(failure: LibraryImportFailure): boolean {
  return getFailureDetail(failure).length > 0;
}
</script>

<template>
  <div v-if="failures.length > 0" class="asset-import-diagnostics mt-3">
    <div class="asset-import-precheck-head">
      <span>{{ t("dialogs.assetImportDiagnosticsTitle") }}</span>
      <span class="font-mono text-[10px] text-zinc-500">
        {{ t("dialogs.assetImportDiagnosticsCount", { count: failures.length }) }}
      </span>
    </div>

    <div class="asset-import-precheck-list">
      <div
        v-for="(failure, rowIndex) in failures"
        :key="failureRowKey(failure, rowIndex)"
        class="asset-import-precheck-row error"
      >
        <div class="asset-import-row-main">
          <div class="min-w-0">
            <div class="truncate text-[11px] text-zinc-200">{{ failure.fileName }}</div>
            <div class="text-[10px] text-zinc-500">{{ getFailureSummary(failure) }}</div>
          </div>
          <div class="asset-import-row-end">
            <button
              v-if="hasFailureDetail(failure)"
              class="asset-import-row-expand"
              type="button"
              @click="toggleFailureDetails(failure, rowIndex)"
            >
              {{ isFailureExpanded(failure, rowIndex) ? t("dialogs.hideDetail") : t("dialogs.showDetail") }}
            </button>
            <span class="asset-import-precheck-badge">{{ t("dialogs.assetImportFailure") }}</span>
          </div>
        </div>
        <pre v-if="hasFailureDetail(failure) && isFailureExpanded(failure, rowIndex)" class="asset-import-row-detail">{{ getFailureDetail(failure) }}</pre>
      </div>
    </div>

    <div class="mt-2 flex justify-end">
      <UiDialogButton
        type="button"
        :disabled="!canRetryFailures"
        @click="emit('retry')"
      >
        {{ t("dialogs.assetImportRetryFailed") }}
      </UiDialogButton>
    </div>
  </div>
</template>
