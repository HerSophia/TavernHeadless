<script setup lang="ts">
import { createDefaultNodeTypeRegistry } from "@tavern/core/node-graph";
import { AlertTriangle, X } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import { nodeGraphApi, NodeGraphApiError } from "../../../lib/nodegraph-api";
import UiButton from "../../../ui/UiButton.vue";
import UiIconButton from "../../../ui/UiIconButton.vue";
import { mapPreflight, type PreflightView } from "./map-preflight";

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ imported: [graphId: string]; close: [] }>();

const { t } = useI18n();

const registry = createDefaultNodeTypeRegistry();
const titleByType = new Map(registry.list().map((entry) => [entry.type, entry.title]));
const resolveTypeTitle = (type: string): string | undefined => titleByType.get(type);

const pkg = ref<Record<string, unknown> | null>(null);
const view = ref<PreflightView | null>(null);
const fileName = ref("");
const name = ref("");
const phase = ref<"idle" | "parsing" | "preflighting" | "installing">("idle");
const error = ref<string | null>(null);

const installable = computed(() => Boolean(view.value?.installable));

function statusTone(status: string): string {
  if (status === "missing") {
    return "text-signal-error";
  }
  if (status === "degradable") {
    return "text-signal-warn";
  }
  return "text-text-muted";
}

function severityTone(severity: string): string {
  if (severity === "error") {
    return "text-signal-error";
  }
  if (severity === "warning") {
    return "text-signal-warn";
  }
  return "text-signal-info";
}

const securityEntries = computed(() => {
  const security = view.value?.security ?? {};
  const entries: { key: string; value: string }[] = [];
  const push = (key: string, value: string | undefined) => {
    if (value) {
      entries.push({ key, value });
    }
  };
  const list = (value?: string[]): string | undefined => (value && value.length > 0 ? value.join(", ") : undefined);
  const flag = (value?: boolean): string | undefined => (value ? t("graph.package.yes") : undefined);
  push("long_term_data_reads", list(security.long_term_data_reads));
  push("session_state_namespace_reads", list(security.session_state_namespace_reads));
  push("proposes_committed_writes", flag(security.proposes_committed_writes));
  push("persistent_output_targets", list(security.persistent_output_targets));
  push("mcp_servers", list(security.mcp_servers));
  push("requests_network_access", flag(security.requests_network_access));
  push("requests_file_write", flag(security.requests_file_write));
  push("required_permissions", list(security.required_permissions));
  return entries;
});

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  view.value = null;
  pkg.value = null;
  error.value = null;
  if (!file) {
    fileName.value = "";
    return;
  }
  fileName.value = file.name;
  phase.value = "parsing";
  try {
    const text = await file.text();
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      error.value = t("graph.package.parseError");
      phase.value = "idle";
      return;
    }
    pkg.value = parsed as Record<string, unknown>;
    await runPreflight();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    phase.value = "idle";
  }
}

async function runPreflight(): Promise<void> {
  if (!pkg.value) {
    return;
  }
  phase.value = "preflighting";
  error.value = null;
  try {
    const response = await nodeGraphApi.importPreflight(props.projectId, pkg.value);
    view.value = mapPreflight(response, resolveTypeTitle);
  } catch (cause) {
    error.value = cause instanceof NodeGraphApiError ? `${cause.status}` : cause instanceof Error ? cause.message : String(cause);
  } finally {
    phase.value = "idle";
  }
}

async function onInstall(): Promise<void> {
  if (!pkg.value || !installable.value) {
    return;
  }
  phase.value = "installing";
  error.value = null;
  try {
    const result = await nodeGraphApi.importPackage(props.projectId, pkg.value, {
      confirm: true,
      name: name.value.trim() || null,
    });
    if (result.confirmed && result.definition) {
      emit("imported", result.definition.id);
      return;
    }
    if (result.preflight) {
      view.value = mapPreflight(result.preflight, resolveTypeTitle);
    }
  } catch (cause) {
    error.value = cause instanceof NodeGraphApiError ? `${cause.status}` : cause instanceof Error ? cause.message : String(cause);
  } finally {
    phase.value = "idle";
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-app/70 p-4" @click.self="emit('close')">
    <div class="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line-active bg-panel">
      <header class="flex items-center justify-between border-b border-line-subtle px-4 py-2.5">
        <span class="text-sm font-medium text-text-primary">{{ t("graph.package.importTitle") }}</span>
        <UiIconButton :label="t('graph.package.close')" @click="emit('close')">
          <X :size="14" :stroke-width="1.5" />
        </UiIconButton>
      </header>

      <div class="min-h-0 flex-1 space-y-4 overflow-auto p-4">
        <label class="block space-y-1">
          <span class="text-xs text-text-secondary">{{ t("graph.package.pickPackage") }}</span>
          <input
            type="file"
            accept=".json,application/json"
            class="block w-full text-xs text-text-secondary file:mr-3 file:rounded-md file:border file:border-line-subtle file:bg-float file:px-3 file:py-1.5 file:text-text-primary hover:file:border-line-active"
            @change="onFileChange"
          />
        </label>

        <p v-if="phase === 'parsing' || phase === 'preflighting'" class="text-xs text-text-muted">
          {{ t("graph.package.preflighting") }}
        </p>
        <p v-if="error" class="font-mono text-xs text-signal-error">{{ error }}</p>

        <template v-if="view">
          <!-- Overview -->
          <section class="space-y-1.5 rounded-md border border-line-subtle p-3">
            <div class="flex items-center gap-2 text-sm">
              <span :class="view.installable ? 'text-signal-success' : 'text-signal-error'">
                {{ view.installable ? t("graph.package.installableYes") : t("graph.package.installableNo") }}
              </span>
              <span class="font-mono text-[11px] text-text-muted">· {{ t(`graph.package.migration_${view.migration}`) }}</span>
            </div>
            <div class="flex flex-wrap gap-x-3 font-mono text-xs text-text-muted">
              <span class="text-signal-error">err {{ view.counts.error }}</span>
              <span class="text-signal-warn">warn {{ view.counts.warning }}</span>
              <span>info {{ view.counts.info }}</span>
              <span class="truncate">hash {{ view.contentHash }}</span>
            </div>
          </section>

          <!-- Node types -->
          <section v-if="view.nodeTypes.length > 0" class="space-y-1">
            <h4 class="text-xs font-medium text-text-secondary">{{ t("graph.package.nodeTypes") }}</h4>
            <ul class="space-y-1">
              <li
                v-for="node in view.nodeTypes"
                :key="node.type"
                class="flex items-center justify-between gap-3 rounded-md border border-line-subtle px-2.5 py-1.5 text-xs"
              >
                <span class="truncate text-text-primary">{{ node.title }}</span>
                <span class="shrink-0 font-mono text-[10px]" :class="statusTone(node.status)">
                  {{ t(`graph.package.status_${node.status}`) }}
                </span>
              </li>
            </ul>
          </section>

          <!-- Diagnostics -->
          <section v-if="view.blockingDiagnostics.length > 0 || view.advisoryDiagnostics.length > 0" class="space-y-1">
            <h4 class="text-xs font-medium text-text-secondary">{{ t("graph.package.diagnostics") }}</h4>
            <ul class="space-y-1">
              <li
                v-for="(diagnostic, index) in [...view.blockingDiagnostics, ...view.advisoryDiagnostics]"
                :key="`${diagnostic.code}-${index}`"
                class="rounded-md border border-line-subtle px-2.5 py-1.5 text-xs"
              >
                <div class="flex items-center gap-2">
                  <span class="font-mono text-[10px]" :class="severityTone(diagnostic.severity)">{{ diagnostic.code }}</span>
                </div>
                <p class="mt-0.5 text-text-secondary">{{ diagnostic.message }}</p>
              </li>
            </ul>
          </section>

          <!-- Security summary -->
          <section v-if="securityEntries.length > 0" class="space-y-1">
            <h4 class="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
              <AlertTriangle :size="12" :stroke-width="1.5" class="text-signal-warn" />
              {{ t("graph.package.securityTitle") }}
            </h4>
            <dl class="space-y-1">
              <div
                v-for="entry in securityEntries"
                :key="entry.key"
                class="flex justify-between gap-3 rounded-md border border-line-subtle px-2.5 py-1.5 text-xs"
              >
                <dt class="text-text-muted">{{ t(`graph.package.sec_${entry.key}`) }}</dt>
                <dd class="truncate font-mono text-text-secondary">{{ entry.value }}</dd>
              </div>
            </dl>
          </section>

          <label class="block space-y-1">
            <span class="text-xs text-text-secondary">{{ t("graph.package.name") }}</span>
            <input
              v-model="name"
              class="w-full rounded-md border border-line-subtle bg-float px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-muted hover:border-line-active focus:outline-none focus-visible:ring-1 focus-visible:ring-signal-accent"
              :placeholder="t('graph.package.namePlaceholder')"
            />
          </label>
        </template>
      </div>

      <footer class="flex items-center gap-2 border-t border-line-subtle px-4 py-3">
        <UiButton :disabled="!installable || phase === 'installing'" @click="onInstall">
          {{ phase === "installing" ? t("graph.package.installing") : t("graph.package.install") }}
        </UiButton>
        <UiButton variant="ghost" @click="emit('close')">{{ t("graph.package.cancel") }}</UiButton>
        <span v-if="view && !view.installable" class="ml-auto text-xs text-text-muted">
          {{ t("graph.package.notInstallable") }}
        </span>
      </footer>
    </div>
  </div>
</template>
