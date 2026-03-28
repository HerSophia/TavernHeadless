<script setup lang="ts">
import { DialogClose } from "radix-vue";
import { computed, ref } from "vue";

import {
  workspaceToolHandlerTypes,
  workspaceToolManagerSlots,
  workspaceToolSideEffectLevels,
  workspaceToolSources,
  type WorkspaceToolManagerDialogState
} from "../../composables/workspace/tools";
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
  activeSessionId: string | null;
  toolManagerDialog: WorkspaceToolManagerDialogState;
  t: Translator;
}>();

const emit = defineEmits<{
  createDefinitionDraft: [];
  deleteDefinition: [definitionId: string];
  refresh: [];
  saveDefinition: [];
  savePermissions: [];
  selectDefinition: [definitionId: string];
  toggleDefinition: [payload: { definitionId: string; enabled: boolean }];
  "update:open": [value: boolean];
}>();

const definitionSearchText = ref("");
const executionSearchText = ref("");

const permissionToggleOptions = computed(() => {
  return [
    { label: props.t("dialogs.toolManagerDraftInherit"), value: "inherit" },
    { label: props.t("dialogs.toolManagerDraftTrue"), value: "true" },
    { label: props.t("dialogs.toolManagerDraftFalse"), value: "false" }
  ];
});

const definitionSourceOptions = computed(() => {
  return workspaceToolSources.map((source) => ({
    label: source,
    value: source
  }));
});

const definitionHandlerOptions = computed(() => {
  return workspaceToolHandlerTypes.map((handlerType) => ({
    label: handlerType,
    value: handlerType
  }));
});

const definitionSideEffectOptions = computed(() => {
  return workspaceToolSideEffectLevels.map((level) => ({
    label: level,
    value: level
  }));
});

const filteredDefinitions = computed(() => {
  const keyword = definitionSearchText.value.trim().toLowerCase();
  if (!keyword) {
    return props.toolManagerDialog.definitions;
  }

  return props.toolManagerDialog.definitions.filter((definition) => {
    return (
      definition.name.toLowerCase().includes(keyword) ||
      definition.description.toLowerCase().includes(keyword) ||
      definition.source.toLowerCase().includes(keyword)
    );
  });
});

const filteredExecutions = computed(() => {
  const keyword = executionSearchText.value.trim().toLowerCase();
  if (!keyword) {
    return props.toolManagerDialog.executions;
  }

  return props.toolManagerDialog.executions.filter((record) => {
    return (
      record.toolName.toLowerCase().includes(keyword) ||
      record.status.toLowerCase().includes(keyword) ||
      record.providerId.toLowerCase().includes(keyword)
    );
  });
});

const definitionModeTitle = computed(() => {
  return props.toolManagerDialog.definitionDraft.mode === "create"
    ? props.t("dialogs.toolManagerCreateDefinition")
    : props.t("dialogs.toolManagerEditDefinition");
});

function handleAllowedSlotToggle(slot: string, checked: boolean): void {
  const next = new Set(props.toolManagerDialog.definitionDraft.allowedSlots);
  if (checked) {
    next.add(slot);
  } else {
    next.delete(slot);
  }

  props.toolManagerDialog.definitionDraft.allowedSlots = [...next];
}

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
    :content-class="'tool-manager-dialog'"
    :description="props.t('dialogs.toolManagerDescription')"
    :open="props.toolManagerDialog.open"
    :title="props.t('dialogs.toolManagerTitle')"
    @update:open="emit('update:open', $event)"
  >
    <div class="mt-3 flex flex-wrap gap-2">
      <UiDialogButton type="button" @click="emit('refresh')">{{ props.t("actions.refresh") }}</UiDialogButton>
      <UiDialogButton type="button" variant="primary" @click="emit('createDefinitionDraft')">
        {{ props.t("dialogs.toolManagerCreateDefinition") }}
      </UiDialogButton>
    </div>

    <div v-if="props.toolManagerDialog.loading" class="asset-manager-loading">
      {{ props.t("dialogs.toolManagerLoading") }}
    </div>

    <div v-else class="tool-manager-dialog-body mt-3 space-y-5">
      <section class="space-y-3 rounded border border-white/5 bg-white/[0.02] p-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-sm font-semibold text-zinc-100">{{ props.t("dialogs.toolManagerPermissions") }}</div>
            <div class="mt-1 text-xs text-zinc-500">{{ props.t("dialogs.toolManagerSessionHint") }}</div>
          </div>
          <div class="font-mono text-[10px] text-zinc-500">{{ props.activeSessionId ?? "—" }}</div>
        </div>

        <div v-if="!props.activeSessionId" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
          {{ props.t("dialogs.toolManagerNoActiveSession") }}
        </div>

        <template v-else>
          <div class="grid gap-3 md:grid-cols-2">
            <UiDialogRow :label="props.t('dialogs.toolManagerPermissionEnabled')">
              <UiSelectShell v-model="props.toolManagerDialog.permissionsDraft.enabledMode" :options="permissionToggleOptions" />
            </UiDialogRow>
            <UiDialogRow :label="props.t('dialogs.toolManagerPermissionAllowIrreversible')">
              <UiSelectShell v-model="props.toolManagerDialog.permissionsDraft.allowIrreversibleMode" :options="permissionToggleOptions" />
            </UiDialogRow>
            <UiDialogRow :label="props.t('dialogs.toolManagerPermissionMaxCalls')">
              <UiTextInput v-model="props.toolManagerDialog.permissionsDraft.maxCallsPerTurn" inputmode="numeric" />
            </UiDialogRow>
            <UiDialogRow :label="props.t('dialogs.toolManagerPermissionMaxSteps')">
              <UiTextInput v-model="props.toolManagerDialog.permissionsDraft.maxStepsPerGeneration" inputmode="numeric" />
            </UiDialogRow>
          </div>

          <UiDialogRow :label="props.t('dialogs.toolManagerPermissionSlotAllow')">
            <UiTextArea v-model="props.toolManagerDialog.permissionsDraft.slotAllowListJson" rows="4" textarea-class="mt-1 font-mono text-[11px]" />
          </UiDialogRow>

          <UiDialogRow :label="props.t('dialogs.toolManagerPermissionSlotDeny')">
            <UiTextArea v-model="props.toolManagerDialog.permissionsDraft.slotDenyListJson" rows="4" textarea-class="mt-1 font-mono text-[11px]" />
          </UiDialogRow>

          <div class="flex justify-end">
            <UiDialogButton
              :disabled="props.toolManagerDialog.permissionsSaving"
              type="button"
              variant="primary"
              @click="emit('savePermissions')"
            >
              {{ props.toolManagerDialog.permissionsSaving ? props.t("dialogs.toolManagerSaving") : props.t("dialogs.toolManagerPermissionsSave") }}
            </UiDialogButton>
          </div>
        </template>
      </section>

      <section class="space-y-3 rounded border border-white/5 bg-white/[0.02] p-3">
        <div>
          <div class="text-sm font-semibold text-zinc-100">{{ props.t("dialogs.toolManagerRuntimeCatalog") }}</div>
          <div class="mt-1 text-xs text-zinc-500">{{ props.t("dialogs.toolManagerRuntimeHint") }}</div>
        </div>

        <div v-if="!props.activeSessionId" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
          {{ props.t("dialogs.toolManagerNoActiveSession") }}
        </div>

        <template v-else>
          <div v-if="!props.toolManagerDialog.runtimeCatalog || (props.toolManagerDialog.runtimeCatalog.tools.length === 0 && props.toolManagerDialog.runtimeCatalog.conflicts.length === 0)" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
            {{ props.t("dialogs.toolManagerEmptyCatalog") }}
          </div>

          <div v-else class="space-y-3">
            <div class="grid gap-2 lg:grid-cols-2">
              <div
                v-for="tool in props.toolManagerDialog.runtimeCatalog?.tools ?? []"
                :key="`${tool.providerId}:${tool.name}`"
                class="rounded border border-white/5 bg-black/20 px-3 py-2 text-xs text-zinc-300"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="font-mono text-[11px] text-zinc-100">{{ tool.name }}</div>
                  <div class="font-mono text-[10px] text-zinc-500">{{ tool.providerType }}</div>
                </div>
                <div class="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
                  <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.toolManagerCatalogAvailability") }}</span>
                  <span class="text-[11px]">{{ tool.availability }}</span>
                  <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.toolManagerCatalogReplaySafety") }}</span>
                  <span class="text-[11px]">{{ tool.replaySafety }}</span>
                  <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.toolManagerCatalogSideEffect") }}</span>
                  <span class="text-[11px]">{{ tool.sideEffectLevel }}</span>
                  <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.toolManagerCatalogAllowedSlots") }}</span>
                  <span class="text-[11px]">{{ tool.allowedSlots.join(", ") || "—" }}</span>
                </div>
                <div v-if="tool.availabilityReason" class="mt-2 rounded border border-white/5 bg-white/[0.03] px-2 py-1 text-[11px] text-zinc-400">
                  {{ tool.availabilityReason }}
                </div>
              </div>
            </div>

            <div>
              <div class="mb-2 text-xs font-semibold text-zinc-200">{{ props.t("dialogs.toolManagerConflicts") }}</div>
              <div v-if="(props.toolManagerDialog.runtimeCatalog?.conflicts.length ?? 0) === 0" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
                {{ props.t("dialogs.toolManagerConflictsEmpty") }}
              </div>
              <div v-else class="space-y-2">
                <div
                  v-for="conflict in props.toolManagerDialog.runtimeCatalog?.conflicts ?? []"
                  :key="conflict.toolName"
                  class="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-zinc-300"
                >
                  <div class="font-mono text-[11px] text-amber-200">{{ conflict.toolName }}</div>
                  <div class="mt-1 text-[11px] text-zinc-300">{{ conflict.providerIds.join(", ") }}</div>
                  <div class="mt-1 font-mono text-[10px] text-zinc-500">{{ conflict.reason }}</div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </section>

      <section class="space-y-3 rounded border border-white/5 bg-white/[0.02] p-3">
        <div>
          <div class="text-sm font-semibold text-zinc-100">{{ props.t("dialogs.toolManagerDefinitions") }}</div>
          <div class="mt-1 text-xs text-zinc-500">{{ props.t("dialogs.toolManagerDefinitionsHint") }}</div>
        </div>

        <div class="grid gap-3 lg:grid-cols-[260px,minmax(0,1fr)]">
          <div class="space-y-3">
            <UiTextInput v-model="definitionSearchText" :placeholder="props.t('dialogs.toolManagerFilterPlaceholder')" />
            <div v-if="filteredDefinitions.length === 0" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
              {{ props.t("dialogs.toolManagerEmptyDefinitions") }}
            </div>
            <div v-else class="max-h-80 space-y-2 overflow-y-auto pr-1">
              <button
                v-for="definition in filteredDefinitions"
                :key="definition.id"
                class="w-full rounded border px-3 py-2 text-left transition"
                :class="definition.id === props.toolManagerDialog.selectedDefinitionId ? 'border-signal-accent/40 bg-signal-accent/10' : 'border-white/5 bg-black/20 hover:border-white/10'"
                type="button"
                @click="emit('selectDefinition', definition.id)"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="font-mono text-[11px] text-zinc-100">{{ definition.name }}</div>
                  <div class="font-mono text-[10px]" :class="definition.enabled ? 'text-emerald-300' : 'text-zinc-500'">
                    {{ definition.enabled ? props.t("dialogs.toolManagerDraftTrue") : props.t("dialogs.toolManagerDraftFalse") }}
                  </div>
                </div>
                <div class="mt-1 truncate text-[11px] text-zinc-400">{{ definition.description || definition.source }}</div>
              </button>
            </div>
          </div>

          <div class="space-y-3 rounded border border-white/5 bg-black/20 p-3">
            <div class="flex items-center justify-between gap-2">
              <div class="text-xs font-semibold text-zinc-100">{{ definitionModeTitle }}</div>
              <div class="font-mono text-[10px] text-zinc-500">{{ props.toolManagerDialog.definitionDraft.mode === 'edit' ? props.toolManagerDialog.definitionDraft.id : 'new' }}</div>
            </div>

            <div class="grid gap-3 md:grid-cols-2">
              <UiDialogRow :label="props.t('dialogs.toolManagerDefinitionName')">
                <UiTextInput v-model="props.toolManagerDialog.definitionDraft.name" />
              </UiDialogRow>
              <UiDialogRow :label="props.t('dialogs.toolManagerDefinitionSource')">
                <UiSelectShell v-model="props.toolManagerDialog.definitionDraft.source" :options="definitionSourceOptions" />
              </UiDialogRow>
              <UiDialogRow :label="props.t('dialogs.toolManagerDefinitionHandlerType')">
                <UiSelectShell v-model="props.toolManagerDialog.definitionDraft.handlerType" :options="definitionHandlerOptions" />
              </UiDialogRow>
              <UiDialogRow :label="props.t('dialogs.toolManagerDefinitionSideEffectLevel')">
                <UiSelectShell v-model="props.toolManagerDialog.definitionDraft.sideEffectLevel" :options="definitionSideEffectOptions" />
              </UiDialogRow>
              <UiDialogRow :label="props.t('dialogs.toolManagerDefinitionSourceId')" row-class="md:col-span-2">
                <UiTextInput v-model="props.toolManagerDialog.definitionDraft.sourceId" />
              </UiDialogRow>
            </div>

            <UiDialogRow :label="props.t('dialogs.toolManagerDefinitionDescription')">
              <UiTextInput v-model="props.toolManagerDialog.definitionDraft.description" />
            </UiDialogRow>

            <div>
              <div class="text-xs text-zinc-400">{{ props.t("dialogs.toolManagerDefinitionAllowedSlots") }}</div>
              <div class="mt-2 flex flex-wrap gap-3">
                <UiCheckboxField
                  v-for="slot in workspaceToolManagerSlots"
                  :key="slot"
                  :checked="props.toolManagerDialog.definitionDraft.allowedSlots.includes(slot)"
                  @update:checked="handleAllowedSlotToggle(slot, $event)"
                >
                  {{ slot }}
                </UiCheckboxField>
              </div>
            </div>

            <UiCheckboxField v-model:checked="props.toolManagerDialog.definitionDraft.enabled">
              {{ props.t("dialogs.toolManagerDefinitionEnabled") }}
            </UiCheckboxField>

            <UiDialogRow :label="props.t('dialogs.toolManagerDefinitionParameters')">
              <UiTextArea v-model="props.toolManagerDialog.definitionDraft.parametersJson" rows="6" textarea-class="mt-1 font-mono text-[11px]" />
            </UiDialogRow>

            <UiDialogRow :label="props.t('dialogs.toolManagerDefinitionHandler')">
              <UiTextArea v-model="props.toolManagerDialog.definitionDraft.handlerJson" rows="8" textarea-class="mt-1 font-mono text-[11px]" />
            </UiDialogRow>

            <div class="flex flex-wrap justify-end gap-2">
              <UiDialogButton
                v-if="props.toolManagerDialog.definitionDraft.mode === 'edit'"
                :disabled="props.toolManagerDialog.definitionDeletingId === props.toolManagerDialog.definitionDraft.id"
                type="button"
                variant="danger"
                @click="emit('deleteDefinition', props.toolManagerDialog.definitionDraft.id)"
              >
                {{ props.t("dialogs.toolManagerDefinitionDelete") }}
              </UiDialogButton>
              <UiDialogButton
                v-if="props.toolManagerDialog.definitionDraft.mode === 'edit'"
                :disabled="props.toolManagerDialog.definitionTogglingId === props.toolManagerDialog.definitionDraft.id"
                type="button"
                @click="emit('toggleDefinition', { definitionId: props.toolManagerDialog.definitionDraft.id, enabled: !props.toolManagerDialog.definitionDraft.enabled })"
              >
                {{ props.toolManagerDialog.definitionDraft.enabled ? props.t("dialogs.toolManagerDefinitionToggleOff") : props.t("dialogs.toolManagerDefinitionToggleOn") }}
              </UiDialogButton>
              <UiDialogButton
                :disabled="props.toolManagerDialog.definitionSaving"
                type="button"
                variant="primary"
                @click="emit('saveDefinition')"
              >
                {{ props.toolManagerDialog.definitionSaving ? props.t("dialogs.toolManagerSaving") : props.t("dialogs.toolManagerDefinitionSave") }}
              </UiDialogButton>
            </div>
          </div>
        </div>
      </section>

      <section class="space-y-3 rounded border border-white/5 bg-white/[0.02] p-3">
        <div>
          <div class="text-sm font-semibold text-zinc-100">{{ props.t("dialogs.toolManagerExecutions") }}</div>
          <div class="mt-1 text-xs text-zinc-500">{{ props.t("dialogs.toolManagerExecutionsHint") }}</div>
        </div>

        <div v-if="!props.activeSessionId" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
          {{ props.t("dialogs.toolManagerNoActiveSession") }}
        </div>

        <template v-else>
          <UiTextInput v-model="executionSearchText" :placeholder="props.t('dialogs.toolManagerFilterPlaceholder')" />
          <div v-if="filteredExecutions.length === 0" class="rounded border border-dashed border-white/10 px-3 py-4 text-xs text-zinc-500">
            {{ props.t("dialogs.toolManagerEmptyExecutions") }}
          </div>
          <div v-else class="max-h-80 space-y-2 overflow-y-auto pr-1">
            <div
              v-for="record in filteredExecutions"
              :key="record.id"
              class="rounded border border-white/5 bg-black/20 px-3 py-2 text-xs text-zinc-300"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="font-mono text-[11px] text-zinc-100">{{ record.toolName }}</div>
                <div class="font-mono text-[10px] text-zinc-500">{{ record.status }}</div>
              </div>
              <div class="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
                <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.toolManagerExecutionProvider") }}</span>
                <span class="break-all text-[11px]">{{ record.providerId }} / {{ record.providerType }}</span>
                <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.toolManagerExecutionOutcome") }}</span>
                <span class="text-[11px]">{{ record.commitOutcome }}</span>
                <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.toolManagerExecutionDuration") }}</span>
                <span class="text-[11px]">{{ formatOptional(record.durationMs) }}ms</span>
                <span class="font-mono text-[10px] text-zinc-500">{{ props.t("dialogs.toolManagerExecutionStartedAt") }}</span>
                <span class="text-[11px]">{{ formatTimestamp(record.startedAt) }}</span>
              </div>
              <div v-if="record.errorMessage" class="mt-2 rounded border border-white/5 bg-white/[0.03] px-2 py-1 font-mono text-[10px] text-amber-200">
                {{ record.errorMessage }}
              </div>
            </div>
          </div>
        </template>
      </section>
    </div>

    <p v-if="props.toolManagerDialog.errorMessage" class="asset-manager-error mt-3">{{ props.toolManagerDialog.errorMessage }}</p>

    <UiDialogActions>
      <DialogClose as-child>
        <UiDialogButton type="button">{{ props.t("dialogs.cancel") }}</UiDialogButton>
      </DialogClose>
    </UiDialogActions>
  </UiDialogShell>
</template>

<style>
.tool-manager-dialog {
  width: min(1080px, calc(100vw - 1rem));
  max-height: min(90vh, 960px);
  overflow: hidden;
}

.tool-manager-dialog-body {
  max-height: min(72vh, 760px);
  overflow-y: auto;
  padding-right: 0.1rem;
}
</style>
