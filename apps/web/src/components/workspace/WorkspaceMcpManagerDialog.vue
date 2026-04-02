<script setup lang="ts">
import { DialogClose } from "radix-vue";
import { computed, ref } from "vue";

import {
  workspaceMcpSideEffectLevels,
  workspaceMcpTransports,
  type WorkspaceMcpManagerDialogState
} from "../../composables/workspace/mcp";
import UiCheckboxField from "../ui/UiCheckboxField.vue";
import UiDialogActions from "../ui/UiDialogActions.vue";
import UiDialogButton from "../ui/UiDialogButton.vue";
import UiDialogRow from "../ui/UiDialogRow.vue";
import UiDialogShell from "../ui/UiDialogShell.vue";
import UiSelectShell from "../ui/UiSelectShell.vue";
import UiTextArea from "../ui/UiTextArea.vue";
import UiTextInput from "../ui/UiTextInput.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

const props = defineProps<{
  mcpManagerDialog: WorkspaceMcpManagerDialogState;
  t: Translator;
}>();

const emit = defineEmits<{
  connectServer: [];
  createServerDraft: [];
  deleteServer: [serverId: string];
  disconnectServer: [];
  refresh: [];
  saveServer: [];
  selectServer: [serverId: string];
  testServer: [];
  toggleServer: [payload: { enabled: boolean; serverId: string }];
  "update:open": [value: boolean];
}>();

const serverSearchText = ref("");

const transportOptions = computed(() => {
  return workspaceMcpTransports.map((transport) => ({
    label: transport,
    value: transport
  }));
});

const sideEffectOptions = computed(() => {
  return workspaceMcpSideEffectLevels.map((level) => ({
    label: level,
    value: level
  }));
});

const filteredServers = computed(() => {
  const keyword = serverSearchText.value.trim().toLowerCase();
  if (!keyword) {
    return props.mcpManagerDialog.servers;
  }

  return props.mcpManagerDialog.servers.filter((server) => {
    return (
      server.name.toLowerCase().includes(keyword) ||
      server.transport.toLowerCase().includes(keyword) ||
      (server.toolPrefix ?? "").toLowerCase().includes(keyword)
    );
  });
});

const statusByServerId = computed(() => {
  const entries = props.mcpManagerDialog.statuses.map((status) => [status.serverId, status] as const);
  return Object.fromEntries(entries) as Record<string, (typeof props.mcpManagerDialog.statuses)[number]>;
});

const selectedServer = computed(() => {
  return props.mcpManagerDialog.servers.find((server) => server.id === props.mcpManagerDialog.selectedServerId) ?? null;
});

const selectedStatusLabel = computed(() => {
  return props.mcpManagerDialog.selectedStatus?.state ?? "disconnected";
});

function formatOptional(value: number | string | null | undefined): string {
  if (value === undefined || value === null || value === "") {
    return "—";
  }

  return String(value);
}

function formatTimestamp(value: number | null | undefined): string {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString();
}
</script>

<template>
  <UiDialogShell
    :content-class="'mcp-manager-dialog'"
    :description="props.t('dialogs.mcpManagerDescription')"
    :open="props.mcpManagerDialog.open"
    :title="props.t('dialogs.mcpManagerTitle')"
    @update:open="emit('update:open', $event)"
  >
    <div class="mt-3 flex flex-wrap gap-2">
      <UiDialogButton type="button" @click="emit('refresh')">{{ props.t("actions.refresh") }}</UiDialogButton>
      <UiDialogButton type="button" variant="primary" @click="emit('createServerDraft')">
        {{ props.t("dialogs.mcpManagerCreateServer") }}
      </UiDialogButton>
    </div>

    <div v-if="props.mcpManagerDialog.loading" class="asset-manager-loading">
      {{ props.t("dialogs.mcpManagerLoading") }}
    </div>

    <div v-else class="mcp-manager-dialog-body mt-3 space-y-5">
      <section class="space-y-3 rounded border border-white/5 bg-white/[0.02] p-3">
        <div>
          <div class="text-sm font-semibold text-zinc-100">{{ props.t("dialogs.mcpManagerServers") }}</div>
          <div class="mt-1 text-xs text-zinc-500">{{ props.t("dialogs.mcpManagerServersHint") }}</div>
        </div>

        <UiTextInput v-model="serverSearchText" :placeholder="props.t('dialogs.mcpManagerFilterPlaceholder')" />

        <div v-if="filteredServers.length === 0" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
          {{ props.t("dialogs.mcpManagerServersEmpty") }}
        </div>

        <div v-else class="grid gap-2 lg:grid-cols-2">
          <button
            v-for="server in filteredServers"
            :key="server.id"
            class="rounded border px-3 py-2 text-left transition"
            :class="server.id === props.mcpManagerDialog.selectedServerId ? 'border-signal-accent/40 bg-signal-accent/10' : 'border-white/5 bg-black/20 hover:border-white/10'"
            type="button"
            @click="emit('selectServer', server.id)"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="font-mono text-[11px] text-zinc-100">{{ server.name }}</div>
              <div class="font-mono text-[10px] text-zinc-500">{{ statusByServerId[server.id]?.state ?? 'disconnected' }}</div>
            </div>
            <div class="mt-1 text-[11px] text-zinc-400">{{ server.transport }} / {{ server.toolPrefix || '—' }}</div>
          </button>
        </div>
      </section>

      <section class="space-y-3 rounded border border-white/5 bg-white/[0.02] p-3">
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="text-sm font-semibold text-zinc-100">{{ props.t("dialogs.mcpManagerEditor") }}</div>
            <div class="mt-1 text-xs text-zinc-500">{{ props.t("dialogs.mcpManagerEditorHint") }}</div>
          </div>
          <div class="font-mono text-[10px] text-zinc-500">{{ props.mcpManagerDialog.serverDraft.mode === 'edit' ? props.mcpManagerDialog.serverDraft.id : 'new' }}</div>
        </div>

        <div class="grid gap-3 md:grid-cols-2">
          <UiDialogRow :label="props.t('dialogs.mcpManagerServerName')">
            <UiTextInput v-model="props.mcpManagerDialog.serverDraft.name" />
          </UiDialogRow>
          <UiDialogRow :label="props.t('dialogs.mcpManagerTransport')">
            <UiSelectShell v-model="props.mcpManagerDialog.serverDraft.transport" :options="transportOptions" />
          </UiDialogRow>
          <UiDialogRow :label="props.t('dialogs.mcpManagerDefaultSideEffectLevel')">
            <UiSelectShell v-model="props.mcpManagerDialog.serverDraft.defaultSideEffectLevel" :options="sideEffectOptions" />
          </UiDialogRow>
          <UiDialogRow :label="props.t('dialogs.mcpManagerToolPrefix')">
            <UiTextInput v-model="props.mcpManagerDialog.serverDraft.toolPrefix" />
          </UiDialogRow>
          <UiDialogRow :label="props.t('dialogs.mcpManagerConnectTimeoutMs')">
            <UiTextInput v-model="props.mcpManagerDialog.serverDraft.connectTimeoutMs" inputmode="numeric" />
          </UiDialogRow>
          <UiDialogRow :label="props.t('dialogs.mcpManagerCallTimeoutMs')">
            <UiTextInput v-model="props.mcpManagerDialog.serverDraft.callTimeoutMs" inputmode="numeric" />
          </UiDialogRow>
          <UiDialogRow :label="props.t('dialogs.mcpManagerToolRefreshIntervalMs')" row-class="md:col-span-2">
            <UiTextInput v-model="props.mcpManagerDialog.serverDraft.toolRefreshIntervalMs" inputmode="numeric" />
          </UiDialogRow>
        </div>

        <UiCheckboxField v-model:checked="props.mcpManagerDialog.serverDraft.enabled">
          {{ props.t("dialogs.mcpManagerEnabled") }}
        </UiCheckboxField>

        <template v-if="props.mcpManagerDialog.serverDraft.transport === 'stdio'">
          <div class="grid gap-3 md:grid-cols-2">
            <UiDialogRow :label="props.t('dialogs.mcpManagerStdioCommand')" row-class="md:col-span-2">
              <UiTextInput v-model="props.mcpManagerDialog.serverDraft.stdioCommand" />
            </UiDialogRow>
            <UiDialogRow :label="props.t('dialogs.mcpManagerStdioCwd')">
              <UiTextInput v-model="props.mcpManagerDialog.serverDraft.stdioCwd" />
            </UiDialogRow>
            <UiDialogRow :label="props.t('dialogs.mcpManagerStdioArgs')">
              <UiTextArea v-model="props.mcpManagerDialog.serverDraft.stdioArgsJson" rows="4" textarea-class="mt-1 font-mono text-[11px]" />
            </UiDialogRow>
            <UiDialogRow v-if="props.mcpManagerDialog.serverDraft.stdioEnvMaskedJson" :label="props.t('dialogs.mcpManagerStdioEnvMasked')" row-class="md:col-span-2">
              <UiTextArea :value="props.mcpManagerDialog.serverDraft.stdioEnvMaskedJson" readonly rows="4" textarea-class="mt-1 font-mono text-[11px] opacity-70" />
              <div class="mt-1 text-[11px] text-zinc-500">
                {{ props.t("dialogs.mcpManagerMaskedSecretHint") }}
              </div>
            </UiDialogRow>
            <UiDialogRow :label="props.t('dialogs.mcpManagerStdioEnv')" row-class="md:col-span-2">
              <UiTextArea v-model="props.mcpManagerDialog.serverDraft.stdioEnvJson" rows="5" textarea-class="mt-1 font-mono text-[11px]" />
            </UiDialogRow>
          </div>
        </template>

        <template v-else>
          <UiDialogRow :label="props.t('dialogs.mcpManagerHttpUrl')">
            <UiTextInput v-model="props.mcpManagerDialog.serverDraft.httpUrl" />
          </UiDialogRow>
          <UiDialogRow v-if="props.mcpManagerDialog.serverDraft.httpHeadersMaskedJson" :label="props.t('dialogs.mcpManagerHttpHeadersMasked')">
            <UiTextArea :value="props.mcpManagerDialog.serverDraft.httpHeadersMaskedJson" readonly rows="4" textarea-class="mt-1 font-mono text-[11px] opacity-70" />
            <div class="mt-1 text-[11px] text-zinc-500">
              {{ props.t("dialogs.mcpManagerMaskedSecretHint") }}
            </div>
          </UiDialogRow>
          <UiDialogRow :label="props.t('dialogs.mcpManagerHttpHeaders')">
            <UiTextArea v-model="props.mcpManagerDialog.serverDraft.httpHeadersJson" rows="5" textarea-class="mt-1 font-mono text-[11px]" />
          </UiDialogRow>
        </template>

        <div class="flex flex-wrap justify-end gap-2">
          <UiDialogButton
            v-if="props.mcpManagerDialog.serverDraft.mode === 'edit'"
            :disabled="props.mcpManagerDialog.actionServerId === props.mcpManagerDialog.serverDraft.id"
            type="button"
            variant="danger"
            @click="emit('deleteServer', props.mcpManagerDialog.serverDraft.id)"
          >
            {{ props.t("dialogs.mcpManagerDelete") }}
          </UiDialogButton>
          <UiDialogButton
            v-if="props.mcpManagerDialog.serverDraft.mode === 'edit'"
            :disabled="props.mcpManagerDialog.actionServerId === props.mcpManagerDialog.serverDraft.id"
            type="button"
            @click="emit('toggleServer', { serverId: props.mcpManagerDialog.serverDraft.id, enabled: !props.mcpManagerDialog.serverDraft.enabled })"
          >
            {{ props.mcpManagerDialog.serverDraft.enabled ? props.t("dialogs.mcpManagerToggleOff") : props.t("dialogs.mcpManagerToggleOn") }}
          </UiDialogButton>
          <UiDialogButton
            :disabled="props.mcpManagerDialog.saving"
            type="button"
            variant="primary"
            @click="emit('saveServer')"
          >
            {{ props.mcpManagerDialog.saving ? props.t("dialogs.mcpManagerSaving") : props.t("dialogs.mcpManagerSave") }}
          </UiDialogButton>
        </div>
      </section>

      <section class="space-y-3 rounded border border-white/5 bg-white/[0.02] p-3">
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="text-sm font-semibold text-zinc-100">{{ props.t("dialogs.mcpManagerStatus") }}</div>
            <div class="mt-1 text-xs text-zinc-500">{{ props.t("dialogs.mcpManagerStatusHint") }}</div>
          </div>
          <div class="font-mono text-[10px] text-zinc-500">{{ selectedStatusLabel }}</div>
        </div>

        <div v-if="!selectedServer" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
          {{ props.t("dialogs.mcpManagerSelectServerFirst") }}
        </div>

        <template v-else>
          <div class="grid gap-3 md:grid-cols-2">
            <div class="rounded border border-white/5 bg-black/20 px-3 py-2 text-xs text-zinc-300">
              <div class="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
                <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.mcpManagerStatusState") }}</span>
                <span>{{ props.mcpManagerDialog.selectedStatus?.state ?? 'disconnected' }}</span>
                <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.mcpManagerStatusReconnectRequired") }}</span>
                <span>{{ props.mcpManagerDialog.selectedStatus?.reconnectRequired ? props.t("dialogs.toolManagerDraftTrue") : props.t("dialogs.toolManagerDraftFalse") }}</span>
                <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.mcpManagerStatusLastTimeoutAt") }}</span>
                <span>{{ formatTimestamp(props.mcpManagerDialog.selectedStatus?.lastTimeoutAt) }}</span>
                <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.mcpManagerStatusToolCount") }}</span>
                <span>{{ formatOptional(props.mcpManagerDialog.selectedStatus?.toolCount) }}</span>
                <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.mcpManagerStatusConnectedAt") }}</span>
                <span>{{ formatTimestamp(props.mcpManagerDialog.selectedStatus?.connectedAt) }}</span>
              </div>
              <div v-if="props.mcpManagerDialog.selectedStatus?.error" class="mt-2 rounded border border-white/5 bg-white/[0.03] px-2 py-1 text-[11px] text-amber-200">
                {{ props.mcpManagerDialog.selectedStatus.error }}
              </div>
            </div>

            <div class="space-y-2 rounded border border-white/5 bg-black/20 px-3 py-2">
              <div class="text-xs font-semibold text-zinc-200">{{ props.t("dialogs.mcpManagerRuntimeActions") }}</div>
              <div class="flex flex-wrap gap-2">
                <UiDialogButton
                  :disabled="props.mcpManagerDialog.actionServerId === props.mcpManagerDialog.selectedServerId"
                  type="button"
                  @click="emit('connectServer')"
                >
                  {{ props.t("dialogs.mcpManagerConnect") }}
                </UiDialogButton>
                <UiDialogButton
                  :disabled="props.mcpManagerDialog.actionServerId === props.mcpManagerDialog.selectedServerId"
                  type="button"
                  @click="emit('disconnectServer')"
                >
                  {{ props.t("dialogs.mcpManagerDisconnect") }}
                </UiDialogButton>
                <UiDialogButton
                  :disabled="props.mcpManagerDialog.actionServerId === props.mcpManagerDialog.selectedServerId"
                  type="button"
                  @click="emit('testServer')"
                >
                  {{ props.t("dialogs.mcpManagerTest") }}
                </UiDialogButton>
              </div>
              <div class="rounded border border-white/5 bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
                {{ props.t("dialogs.mcpManagerLastTest") }}:
                <span v-if="props.mcpManagerDialog.lastTestResult">
                  {{ props.mcpManagerDialog.lastTestResult.success ? props.t("dialogs.toolManagerDraftTrue") : props.t("dialogs.toolManagerDraftFalse") }} /
                  {{ props.mcpManagerDialog.lastTestResult.toolCount }} /
                  {{ props.mcpManagerDialog.lastTestResult.durationMs }}ms
                </span>
                <span v-else>{{ props.t("dialogs.mcpManagerLastTestEmpty") }}</span>
              </div>
            </div>
          </div>
        </template>
      </section>

      <section class="space-y-3 rounded border border-white/5 bg-white/[0.02] p-3">
        <div>
          <div class="text-sm font-semibold text-zinc-100">{{ props.t("dialogs.mcpManagerTools") }}</div>
          <div class="mt-1 text-xs text-zinc-500">{{ props.t("dialogs.mcpManagerToolsHint") }}</div>
        </div>

        <div v-if="props.mcpManagerDialog.selectedTools.length === 0" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
          {{ props.t("dialogs.mcpManagerToolsEmpty") }}
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="tool in props.mcpManagerDialog.selectedTools"
            :key="tool.name"
            class="rounded border border-white/5 bg-black/20 px-3 py-2 text-xs text-zinc-300"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="font-mono text-[11px] text-zinc-100">{{ tool.name }}</div>
              <div class="font-mono text-[10px] text-zinc-500">{{ tool.sideEffectLevel }}</div>
            </div>
            <div class="mt-1 text-[11px] text-zinc-400">{{ tool.description || '—' }}</div>
          </div>
        </div>
      </section>
    </div>

    <p v-if="props.mcpManagerDialog.errorMessage" class="asset-manager-error mt-3">{{ props.mcpManagerDialog.errorMessage }}</p>

    <UiDialogActions>
      <DialogClose as-child>
        <UiDialogButton type="button">{{ props.t("dialogs.cancel") }}</UiDialogButton>
      </DialogClose>
    </UiDialogActions>
  </UiDialogShell>
</template>

<style>
.mcp-manager-dialog {
  width: min(1080px, calc(100vw - 1rem));
  max-height: min(90vh, 960px);
  overflow: hidden;
}

.mcp-manager-dialog-body {
  max-height: min(72vh, 760px);
  overflow-y: auto;
  padding-right: 0.1rem;
}
</style>
