<script setup lang="ts">
import { Download, X } from "lucide-vue-next";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { nodeGraphApi, NodeGraphApiError, type NodeGraphExportResponse } from "../../../lib/nodegraph-api";
import UiButton from "../../../ui/UiButton.vue";
import UiIconButton from "../../../ui/UiIconButton.vue";

const props = defineProps<{ projectId: string; graphId: string; versionId: string | null; graphName: string }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();

const result = ref<NodeGraphExportResponse | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const contentHash = computed(() => {
  const integrity = result.value?.package?.integrity as { contentHash?: string } | undefined;
  return integrity?.contentHash ?? "";
});

const dependencySummary = computed(() => {
  const dependencies = result.value?.package?.dependencies as
    | { nodeTypes?: unknown[]; capabilities?: string[]; mcpServers?: unknown[]; sessionStateNamespaces?: unknown[] }
    | undefined;
  if (!dependencies) {
    return [];
  }
  return [
    { key: "nodeTypes", value: String(dependencies.nodeTypes?.length ?? 0) },
    { key: "capabilities", value: (dependencies.capabilities ?? []).join(", ") || "—" },
    { key: "mcpServers", value: String(dependencies.mcpServers?.length ?? 0) },
    { key: "sessionStateNamespaces", value: String(dependencies.sessionStateNamespaces?.length ?? 0) },
  ];
});

const permissions = computed(
  () => (result.value?.package?.permissions as { permission: string }[] | undefined) ?? [],
);

onMounted(() => {
  void runExport();
});

async function runExport(): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    result.value = await nodeGraphApi.exportPackage(
      props.projectId,
      props.graphId,
      props.versionId ? { version_id: props.versionId } : undefined,
    );
  } catch (cause) {
    error.value = cause instanceof NodeGraphApiError ? `${cause.status}` : cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}

function onDownload(): void {
  if (!result.value) {
    return;
  }
  const blob = new Blob([JSON.stringify(result.value.package, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${props.graphName || "nodegraph"}.package.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-app/70 p-4" @click.self="emit('close')">
    <div class="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-line-active bg-panel">
      <header class="flex items-center justify-between border-b border-line-subtle px-4 py-2.5">
        <span class="text-sm font-medium text-text-primary">{{ t("graph.package.exportTitle") }}</span>
        <UiIconButton :label="t('graph.package.close')" @click="emit('close')">
          <X :size="14" :stroke-width="1.5" />
        </UiIconButton>
      </header>

      <div class="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <p v-if="loading" class="text-xs text-text-muted">{{ t("graph.package.exporting") }}</p>
        <p v-if="error" class="font-mono text-xs text-signal-error">{{ error }}</p>

        <template v-if="result">
          <div class="space-y-1 rounded-md border border-line-subtle p-3 font-mono text-xs">
            <div class="flex justify-between gap-3">
              <span class="text-text-muted">{{ t("graph.package.contentHash") }}</span>
              <span class="truncate text-text-secondary">{{ contentHash }}</span>
            </div>
            <div class="flex justify-between gap-3">
              <span class="text-text-muted">{{ t("graph.package.version") }}</span>
              <span class="text-text-secondary">v{{ result.version_no }}</span>
            </div>
          </div>

          <section class="space-y-1">
            <h4 class="text-xs font-medium text-text-secondary">{{ t("graph.package.dependencies") }}</h4>
            <dl class="space-y-1">
              <div
                v-for="entry in dependencySummary"
                :key="entry.key"
                class="flex justify-between gap-3 rounded-md border border-line-subtle px-2.5 py-1.5 text-xs"
              >
                <dt class="text-text-muted">{{ entry.key }}</dt>
                <dd class="truncate font-mono text-text-secondary">{{ entry.value }}</dd>
              </div>
            </dl>
          </section>

          <section class="space-y-1">
            <h4 class="text-xs font-medium text-text-secondary">{{ t("graph.package.permissions") }}</h4>
            <p v-if="permissions.length === 0" class="text-xs text-text-muted">{{ t("graph.package.noPermissions") }}</p>
            <ul v-else class="flex flex-wrap gap-1.5">
              <li
                v-for="permission in permissions"
                :key="permission.permission"
                class="rounded border border-line-subtle px-1.5 py-px font-mono text-[10px] text-text-muted"
              >
                {{ permission.permission }}
              </li>
            </ul>
          </section>
        </template>
      </div>

      <footer class="flex items-center gap-2 border-t border-line-subtle px-4 py-3">
        <UiButton :disabled="!result" @click="onDownload">
          <Download :size="14" :stroke-width="1.5" />
          {{ t("graph.package.download") }}
        </UiButton>
        <UiButton variant="ghost" @click="emit('close')">{{ t("graph.package.close") }}</UiButton>
      </footer>
    </div>
  </div>
</template>
