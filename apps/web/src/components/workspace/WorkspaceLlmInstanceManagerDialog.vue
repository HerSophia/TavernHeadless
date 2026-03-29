<script setup lang="ts">
import { AlertDialogAction, AlertDialogCancel } from "radix-vue";
import { computed, nextTick, ref, watch } from "vue";

import {
  workspaceLlmInstanceSlotLabelKeyMap,
  workspaceLlmInstanceSlots
} from "../../composables/workspace/llm";
import type {
  WorkspaceLlmDiscoveredModel,
  WorkspaceLlmGenerationParams,
  WorkspaceLlmInstanceSlot,
  WorkspaceLlmProfile,
  WorkspaceLlmProvider,
  WorkspaceLlmRuntimeSlot
} from "../../lib/workspace-api";
import UiAlertDialogShell from "../ui/UiAlertDialogShell.vue";
import UiCheckboxField from "../ui/UiCheckboxField.vue";
import UiDialogActions from "../ui/UiDialogActions.vue";
import UiDialogButton from "../ui/UiDialogButton.vue";
import UiDialogRow from "../ui/UiDialogRow.vue";
import UiDialogShell from "../ui/UiDialogShell.vue";
import UiSelectShell from "../ui/UiSelectShell.vue";
import UiTextInput from "../ui/UiTextInput.vue";

type Translator = (key: string, vars?: Record<string, number | string>) => string;

type LlmProfileDraft = {
  apiKey: string;
  apiKeyName: string;
  baseUrl: string;
  id: string;
  mode: "create" | "edit";
  modelId: string;
  presetName: string;
  provider: WorkspaceLlmProvider;
  status: "active" | "disabled";
};

type LlmProfileStatusFilter = "active" | "all" | "deleted" | "disabled";

const runtimeSourceLabelKeyMap: Record<WorkspaceLlmRuntimeSlot["source"], string> = {
  env: "dialogs.llmManagerSourceEnv",
  global_profile: "dialogs.llmManagerSourceGlobalProfile",
  session_profile: "dialogs.llmManagerSourceSessionProfile"
};

const props = defineProps<{
  applyingSlot: WorkspaceLlmInstanceSlot | null;
  drawerOpen: boolean;
  drawerSlot: WorkspaceLlmInstanceSlot | null;
  errorMessage: string;
  hasActiveSession: boolean;
  applyingPresetParams: boolean;
  loading: boolean;
  open: boolean;
  page: "instances" | "profiles";
  profileDeletingId: string | null;
  profileDraft: LlmProfileDraft;
  profileDraftTitle: string;
  profileEditorOpen: boolean;
  profileModelOptions: WorkspaceLlmDiscoveredModel[];
  profileModelsLoading: boolean;
  profileSaving: boolean;
  profileTesting: boolean;
  profiles: WorkspaceLlmProfile[];
  presetAssets: Array<{ id: string; name: string }>;
  runtimeSlots: WorkspaceLlmRuntimeSlot[];
  scope: "global" | "session";
  selectedPresetBySlot: Record<WorkspaceLlmInstanceSlot, string>;
  selectedProfileBySlot: Record<WorkspaceLlmInstanceSlot, string>;
  slotParamsDraft: WorkspaceLlmGenerationParams;
  t: Translator;
  unbindingSlot: WorkspaceLlmInstanceSlot | null;
}>();

const emit = defineEmits<{
  applySlotPresetParams: [];
  cancelProfileDraft: [];
  closeSlotDrawer: [];
  createProfileDraft: [];
  deleteProfile: [profileId: string];
  discoverProfileModels: [];
  editProfileDraft: [profileId: string];
  openSlotDrawer: [slot: WorkspaceLlmInstanceSlot];
  patchSlotParams: [patch: Partial<WorkspaceLlmGenerationParams>];
  refresh: [];
  resetSlotParams: [];
  submitProfileDraft: [];
  unbindSlotDrawer: [];
  submitSlotDrawer: [];
  testProfileModel: [];
  "update:open": [value: boolean];
  "update:page": [value: "instances" | "profiles"];
  "update:profileDraft": [patch: Partial<LlmProfileDraft>];
  "update:selectedPreset": [payload: { presetId: string; slot: WorkspaceLlmInstanceSlot }];
  "update:scope": [value: "global" | "session"];
  "update:selectedProfile": [payload: { profileId: string; slot: WorkspaceLlmInstanceSlot }];
}>();

const profileSearchText = ref("");
const profileProviderFilter = ref<"all" | WorkspaceLlmProvider>("all");
const profileStatusFilter = ref<LlmProfileStatusFilter>("all");
const profileDeleteConfirmId = ref<string | null>(null);

const profileOptions = computed(() => {
  return props.profiles.map((profile) => ({
    disabled: profile.status !== "active",
    label: `${profile.presetName} (${profile.provider} / ${profile.modelId})`,
    value: profile.id
  }));
});

const presetOptions = computed(() => {
  return props.presetAssets.map((preset) => ({
    label: preset.name,
    value: preset.id
  }));
});

const runtimeBySlot = computed(() => {
  const entries = props.runtimeSlots.map((slot) => [slot.slot, slot] as const);
  return Object.fromEntries(entries) as Partial<Record<WorkspaceLlmInstanceSlot, WorkspaceLlmRuntimeSlot>>;
});

const scopeOptions = computed(() => {
  return [
    { label: props.t("dialogs.llmManagerScopeGlobal"), value: "global" },
    { disabled: !props.hasActiveSession, label: props.t("dialogs.llmManagerScopeSession"), value: "session" }
  ];
});

const providerOptions = computed(() => {
  return [
    { label: "OpenAI", value: "openai" },
    { label: "Anthropic", value: "anthropic" },
    { label: "Google", value: "google" },
    { label: "DeepSeek", value: "deepseek" },
    { label: "xAI", value: "xai" },
    { label: "OpenAI Compatible", value: "openai-compatible" }
  ];
});

const statusOptions = computed(() => {
  return [
    { label: props.t("dialogs.llmManagerProfileStatusActive"), value: "active" },
    { label: props.t("dialogs.llmManagerProfileStatusDisabled"), value: "disabled" }
  ];
});

const discoveredModelOptions = computed(() => {
  return props.profileModelOptions.map((model) => ({
    label: model.label,
    value: model.id
  }));
});

const profileProviderFilterOptions = computed(() => {
  const providers = [...new Set(props.profiles.map((profile) => profile.provider))].sort((left, right) => left.localeCompare(right));

  return [
    { label: props.t("dialogs.llmManagerFilterAll"), value: "all" },
    ...providers.map((provider) => ({ label: provider, value: provider }))
  ];
});

const profileStatusFilterOptions = computed(() => {
  return [
    { label: props.t("dialogs.llmManagerFilterAll"), value: "all" },
    { label: props.t("dialogs.llmManagerProfileStatusActive"), value: "active" },
    { label: props.t("dialogs.llmManagerProfileStatusDisabled"), value: "disabled" },
    { label: props.t("dialogs.llmManagerProfileStatusDeleted"), value: "deleted" }
  ];
});

const filteredProfiles = computed(() => {
  const keyword = profileSearchText.value.trim().toLowerCase();

  return props.profiles.filter((profile) => {
    if (profileProviderFilter.value !== "all" && profile.provider !== profileProviderFilter.value) {
      return false;
    }

    if (profileStatusFilter.value !== "all" && profile.status !== profileStatusFilter.value) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    return profile.presetName.toLowerCase().includes(keyword);
  });
});

const deleteProfileTarget = computed(() => {
  if (!profileDeleteConfirmId.value) {
    return null;
  }

  return props.profiles.find((profile) => profile.id === profileDeleteConfirmId.value) ?? null;
});

const deleteProfileTargetLabel = computed(() => {
  return deleteProfileTarget.value?.presetName ?? profileDeleteConfirmId.value ?? "";
});

const drawerSlotLabel = computed(() => {
  if (!props.drawerSlot) {
    return "";
  }

  return props.t(workspaceLlmInstanceSlotLabelKeyMap[props.drawerSlot]);
});

const drawerRuntimeSummary = computed(() => {
  if (!props.drawerSlot) {
    return props.t("dialogs.llmManagerNoRuntime");
  }

  return buildRuntimeSummary(props.drawerSlot);
});

const drawerSelectedProfileId = computed(() => {
  if (!props.drawerSlot) {
    return "";
  }

  return props.selectedProfileBySlot[props.drawerSlot] ?? "";
});

const drawerSelectedPresetId = computed(() => {
  if (!props.drawerSlot) {
    return "";
  }

  return props.selectedPresetBySlot[props.drawerSlot] ?? "";
});

const drawerHasProfileSelection = computed(() => {
  return drawerSelectedProfileId.value.length > 0;
});

const drawerActionBusy = computed(() => {
  return !props.drawerSlot || props.loading || props.applyingSlot !== null || props.applyingPresetParams || props.unbindingSlot !== null;
});

const drawerCanUnbind = computed(() => {
  if (!props.drawerSlot) {
    return false;
  }

  const runtime = runtimeBySlot.value[props.drawerSlot];
  return Boolean(runtime?.profileId && runtime.source !== "env");
});

const drawerUnbindDisabled = computed(() => {
  return drawerActionBusy.value || props.unbindingSlot !== null || !drawerCanUnbind.value;
});

const drawerApplyPresetDisabled = computed(() => {
  return (
    drawerActionBusy.value ||
    props.applyingPresetParams ||
    drawerSelectedPresetId.value.length === 0
  );
});

const drawerSubmitDisabled = computed(() => {
  return drawerActionBusy.value || !drawerHasProfileSelection.value;
});

const drawerPanelRef = ref<HTMLElement | null>(null);

const drawerProfileHint = computed(() => {
  return drawerHasProfileSelection.value ? "" : props.t("dialogs.llmManagerDrawerProfileRequiredHint");
});

watch(
  () => props.open,
  (open) => {
    if (open) {
      return;
    }

    resetProfileFilters();
    closeProfileDeleteConfirm();

    if (props.drawerOpen) {
      emit("closeSlotDrawer");
    }
  }
);

watch(
  () => props.page,
  (page) => {
    if (page !== "profiles") {
      closeProfileDeleteConfirm();
    }

    if (page !== "instances" && props.drawerOpen) {
      emit("closeSlotDrawer");
    }
  }
);

watch(
  () => props.drawerOpen,
  async (open) => {
    if (!open) {
      return;
    }

    await nextTick();

    const root = drawerPanelRef.value;
    if (!root) {
      return;
    }

    const focusTarget = root.querySelector<HTMLElement>(".ui-select-trigger, .dialog-input, .llm-manager-param-slider");
    focusTarget?.focus();
  }
);

function updateSelectedProfile(slot: WorkspaceLlmInstanceSlot, profileId: string): void {
  emit("update:selectedProfile", { profileId, slot });
}

function updateSelectedPreset(slot: WorkspaceLlmInstanceSlot, presetId: string): void {
  emit("update:selectedPreset", { presetId, slot });
}

function updateDrawerSelectedProfile(profileId: string): void {
  if (!props.drawerSlot) {
    return;
  }

  updateSelectedProfile(props.drawerSlot, profileId);
}

function updateDrawerSelectedPreset(presetId: string): void {
  if (!props.drawerSlot) {
    return;
  }

  updateSelectedPreset(props.drawerSlot, presetId);
}

function buildRuntimeSummary(slot: WorkspaceLlmInstanceSlot): string {
  const runtime = runtimeBySlot.value[slot];
  if (!runtime) {
    return props.t("dialogs.llmManagerNoRuntime");
  }

  const source = props.t(runtimeSourceLabelKeyMap[runtime.source]);
  if (runtime.presetName) {
    return `${runtime.provider} / ${runtime.modelId} (${source} · ${runtime.presetName})`;
  }

  return `${runtime.provider} / ${runtime.modelId} (${source})`;
}

function buildSlotSelectedProfile(slot: WorkspaceLlmInstanceSlot): string {
  const selectedProfileId = props.selectedProfileBySlot[slot];
  if (!selectedProfileId) {
    return props.t("dialogs.llmManagerSelectProfile");
  }

  const profile = props.profiles.find((item) => item.id === selectedProfileId);
  return profile?.presetName ?? selectedProfileId;
}

function isSlotParamOverridden(key: keyof WorkspaceLlmGenerationParams): boolean {
  return props.slotParamsDraft[key] !== undefined;
}

function getSlotParamStateLabel(key: keyof WorkspaceLlmGenerationParams): string {
  return props.t(
    isSlotParamOverridden(key)
      ? "dialogs.llmManagerParamStateOverridden"
      : "dialogs.llmManagerParamStateInherited"
  );
}

function openSlotDrawer(slot: WorkspaceLlmInstanceSlot): void {
  emit("openSlotDrawer", slot);
}

function patchDraft(patch: Partial<LlmProfileDraft>): void {
  emit("update:profileDraft", patch);
}

function resetProfileFilters(): void {
  profileSearchText.value = "";
  profileProviderFilter.value = "all";
  profileStatusFilter.value = "all";
}

function getProfileStatusLabel(status: WorkspaceLlmProfile["status"]): string {
  if (status === "disabled") {
    return props.t("dialogs.llmManagerProfileStatusDisabled");
  }

  if (status === "deleted") {
    return props.t("dialogs.llmManagerProfileStatusDeleted");
  }

  return props.t("dialogs.llmManagerProfileStatusActive");
}

function requestDeleteProfile(profileId: string): void {
  if (props.profileDeletingId !== null) {
    return;
  }

  profileDeleteConfirmId.value = profileId;
}

function closeProfileDeleteConfirm(): void {
  profileDeleteConfirmId.value = null;
}

function handleDeleteConfirmOpenChange(open: boolean): void {
  if (!open) {
    closeProfileDeleteConfirm();
  }
}

function confirmDeleteProfile(): void {
  if (!profileDeleteConfirmId.value) {
    return;
  }

  emit("deleteProfile", profileDeleteConfirmId.value);
  closeProfileDeleteConfirm();
}

function parseOptionalNumber(raw: string): number | undefined {
  const value = raw.trim();
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
}

function parseOptionalInteger(raw: string): number | undefined {
  const parsed = parseOptionalNumber(raw);
  if (parsed === undefined) {
    return undefined;
  }

  return parsed;
}

function getInputValue(event: Event): string {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return "";
  }

  return target.value;
}

function patchSlotParam<K extends keyof WorkspaceLlmGenerationParams>(
  key: K,
  value: WorkspaceLlmGenerationParams[K]
): void {
  emit("patchSlotParams", { [key]: value } as Partial<WorkspaceLlmGenerationParams>);
}

function handleRangeParamInput(
  key: "temperature" | "top_p" | "frequency_penalty" | "presence_penalty",
  event: Event
): void {
  const value = parseOptionalNumber(getInputValue(event));
  patchSlotParam(key, value as WorkspaceLlmGenerationParams[typeof key]);
}

function handleTemperatureNumberInput(event: Event): void {
  patchSlotParam("temperature", parseOptionalNumber(getInputValue(event)));
}

function handleMaxOutputTokensInput(event: Event): void {
  patchSlotParam("max_output_tokens", parseOptionalInteger(getInputValue(event)));
}

function handleMaxContextTokensInput(event: Event): void {
  patchSlotParam("max_context_tokens", parseOptionalInteger(getInputValue(event)));
}

function handleTopPNumberInput(event: Event): void {
  patchSlotParam("top_p", parseOptionalNumber(getInputValue(event)));
}

function handleTopKInput(event: Event): void {
  patchSlotParam("top_k", parseOptionalInteger(getInputValue(event)));
}

function handleFrequencyPenaltyNumberInput(event: Event): void {
  patchSlotParam("frequency_penalty", parseOptionalNumber(getInputValue(event)));
}

function handlePresencePenaltyNumberInput(event: Event): void {
  patchSlotParam("presence_penalty", parseOptionalNumber(getInputValue(event)));
}

function handleTimeoutMsInput(event: Event): void {
  patchSlotParam("timeout_ms", parseOptionalInteger(getInputValue(event)));
}

function handleMaxRetriesInput(event: Event): void {
  patchSlotParam("max_retries", parseOptionalInteger(getInputValue(event)));
}
</script>

<template>
  <UiDialogShell
    :description="props.t('dialogs.llmManagerDescription')"
    :open="props.open"
    :title="props.t('dialogs.llmManagerTitle')"
    content-class="llm-manager-dialog"
    @update:open="emit('update:open', $event)"
  >
    <div class="llm-manager-tabs mt-3">
      <button
        class="llm-manager-tab-btn"
        :class="props.page === 'instances' ? 'active' : ''"
        type="button"
        @click="emit('update:page', 'instances')"
      >
        {{ props.t("dialogs.llmManagerTabInstances") }}
      </button>
      <button
        class="llm-manager-tab-btn"
        :class="props.page === 'profiles' ? 'active' : ''"
        type="button"
        @click="emit('update:page', 'profiles')"
      >
        {{ props.t("dialogs.llmManagerTabProfiles") }}
      </button>
    </div>

    <div v-if="props.page === 'instances'" class="llm-manager-instance-layout mt-3">
      <div class="llm-manager-list">
        <UiDialogButton type="button" class="justify-self-end" @click="emit('refresh')">
          {{ props.t("dialogs.llmManagerRefresh") }}
        </UiDialogButton>

        <div v-if="props.loading" class="llm-manager-empty">{{ props.t("dialogs.llmManagerLoading") }}</div>

        <template v-else>
          <div v-if="profileOptions.length === 0" class="llm-manager-empty">{{ props.t("dialogs.llmManagerNoProfiles") }}</div>

          <button
            v-for="slot in workspaceLlmInstanceSlots"
            :key="slot"
            class="llm-manager-slot llm-manager-slot-button"
            :class="props.drawerOpen && props.drawerSlot === slot ? 'active' : ''"
            type="button"
            @click="openSlotDrawer(slot)"
          >
            <div class="llm-manager-slot-head">
              <div class="llm-manager-slot-title">{{ props.t(workspaceLlmInstanceSlotLabelKeyMap[slot]) }}</div>
              <div class="llm-manager-slot-runtime">{{ buildRuntimeSummary(slot) }}</div>
            </div>
            <div class="llm-manager-slot-selected">
              {{ buildSlotSelectedProfile(slot) }}
            </div>
          </button>
        </template>
      </div>

      <button
        v-if="props.drawerOpen"
        class="llm-manager-drawer-overlay"
        type="button"
        @click="emit('closeSlotDrawer')"
      />

      <aside
        ref="drawerPanelRef"
        class="llm-manager-drawer"
        :class="props.drawerOpen ? 'open' : ''"
        :aria-hidden="!props.drawerOpen"
      >
        <template v-if="props.drawerSlot">
          <div class="llm-manager-drawer-head">
            <div class="llm-manager-drawer-title">
              {{ props.t("dialogs.llmManagerDrawerTitle", { slot: drawerSlotLabel }) }}
            </div>
            <button class="llm-manager-drawer-close" type="button" @click="emit('closeSlotDrawer')">×</button>
          </div>

          <div class="llm-manager-slot-runtime mt-1">{{ drawerRuntimeSummary }}</div>

          <section class="llm-manager-drawer-section mt-3">
            <h3 class="llm-manager-drawer-section-title">{{ props.t("dialogs.llmManagerDrawerBindingSection") }}</h3>
            <UiDialogRow :label="props.t('dialogs.llmManagerScope')" row-class="mt-2">
              <UiSelectShell
                :model-value="props.scope"
                :options="scopeOptions"
                @update:model-value="emit('update:scope', $event as 'global' | 'session')"
              />
            </UiDialogRow>

            <UiDialogRow :label="props.t('dialogs.llmManagerSelectProfile')" row-class="mt-2">
              <UiSelectShell
                :model-value="drawerSelectedProfileId"
                :options="profileOptions"
                :placeholder="props.t('dialogs.llmManagerSelectProfile')"
                @update:model-value="updateDrawerSelectedProfile"
              />
            </UiDialogRow>

            <UiDialogRow :label="props.t('dialogs.llmManagerPresetSelect')" row-class="mt-2">
              <UiSelectShell
                :model-value="drawerSelectedPresetId"
                :options="presetOptions"
                :placeholder="props.t('dialogs.llmManagerPresetSelect')"
                @update:model-value="updateDrawerSelectedPreset"
              />
            </UiDialogRow>

            <div class="mt-2 flex justify-end">
              <UiDialogButton type="button" :disabled="drawerApplyPresetDisabled" @click="emit('applySlotPresetParams')">
                {{
                  props.applyingPresetParams
                    ? props.t("dialogs.llmManagerPresetApplyingParams")
                    : props.t("dialogs.llmManagerPresetApplyParams")
                }}
              </UiDialogButton>
            </div>

            <p v-if="drawerProfileHint" class="llm-manager-drawer-hint mt-2">{{ drawerProfileHint }}</p>

            <div class="mt-2 flex justify-end">
              <UiDialogButton type="button" variant="primary" :disabled="drawerSubmitDisabled" @click="emit('submitSlotDrawer')">
                {{
                  props.applyingSlot === props.drawerSlot ? props.t("dialogs.llmManagerApplying") : props.t("dialogs.llmManagerApply")
                }}
              </UiDialogButton>
            </div>

            <div class="mt-2 flex justify-end">
              <UiDialogButton type="button" variant="danger" :disabled="drawerUnbindDisabled" @click="emit('unbindSlotDrawer')">
                {{
                  props.unbindingSlot === props.drawerSlot ? props.t("dialogs.llmManagerUnbinding") : props.t("dialogs.llmManagerUnbind")
                }}
              </UiDialogButton>
            </div>
          </section>

          <section class="llm-manager-drawer-section mt-3">
            <h3 class="llm-manager-drawer-section-title">{{ props.t("dialogs.llmManagerDrawerSamplingSection") }}</h3>
            <div class="llm-manager-param-grid mt-2">
              <label class="llm-manager-param-field">
                <span class="dialog-label llm-manager-param-label">
                  <span>{{ props.t("dialogs.llmManagerParamTemperature") }}</span>
                  <span class="llm-manager-param-state" :class="isSlotParamOverridden('temperature') ? 'override' : 'inherit'">
                    {{ getSlotParamStateLabel("temperature") }}
                  </span>
                </span>
                <div class="llm-manager-param-slider-wrap">
                  <input
                    class="llm-manager-param-slider"
                    type="range"
                    min="0"
                    max="2"
                    step="0.01"
                    :value="props.slotParamsDraft.temperature ?? 1"
                    @input="handleRangeParamInput('temperature', $event)"
                  >
                  <input
                    class="dialog-input llm-manager-param-input"
                    type="number"
                    min="0"
                    max="2"
                    step="0.01"
                    :value="props.slotParamsDraft.temperature ?? ''"
                    @input="handleTemperatureNumberInput"
                  >
                </div>
              </label>

              <label class="llm-manager-param-field">
                <span class="dialog-label llm-manager-param-label">
                  <span>{{ props.t("dialogs.llmManagerParamMaxOutputTokens") }}</span>
                  <span class="llm-manager-param-state" :class="isSlotParamOverridden('max_output_tokens') ? 'override' : 'inherit'">
                    {{ getSlotParamStateLabel("max_output_tokens") }}
                  </span>
                </span>
                <input
                  class="dialog-input llm-manager-param-input"
                  type="number"
                  min="1"
                  step="1"
                  :value="props.slotParamsDraft.max_output_tokens ?? ''"
                  @input="handleMaxOutputTokensInput"
                >
              </label>

              <label class="llm-manager-param-field">
                <span class="dialog-label llm-manager-param-label">
                  <span>{{ props.t("dialogs.llmManagerParamMaxContextTokens") }}</span>
                  <span class="llm-manager-param-state" :class="isSlotParamOverridden('max_context_tokens') ? 'override' : 'inherit'">
                    {{ getSlotParamStateLabel("max_context_tokens") }}
                  </span>
                </span>
                <input
                  class="dialog-input llm-manager-param-input"
                  type="number"
                  min="1"
                  step="1"
                  :value="props.slotParamsDraft.max_context_tokens ?? ''"
                  @input="handleMaxContextTokensInput"
                >
              </label>

              <label class="llm-manager-param-field">
                <span class="dialog-label llm-manager-param-label">
                  <span>{{ props.t("dialogs.llmManagerParamTopP") }}</span>
                  <span class="llm-manager-param-state" :class="isSlotParamOverridden('top_p') ? 'override' : 'inherit'">
                    {{ getSlotParamStateLabel("top_p") }}
                  </span>
                </span>
                <div class="llm-manager-param-slider-wrap">
                  <input
                    class="llm-manager-param-slider"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    :value="props.slotParamsDraft.top_p ?? 1"
                    @input="handleRangeParamInput('top_p', $event)"
                  >
                  <input
                    class="dialog-input llm-manager-param-input"
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    :value="props.slotParamsDraft.top_p ?? ''"
                    @input="handleTopPNumberInput"
                  >
                </div>
              </label>

              <label class="llm-manager-param-field">
                <span class="dialog-label llm-manager-param-label">
                  <span>{{ props.t("dialogs.llmManagerParamTopK") }}</span>
                  <span class="llm-manager-param-state" :class="isSlotParamOverridden('top_k') ? 'override' : 'inherit'">
                    {{ getSlotParamStateLabel("top_k") }}
                  </span>
                </span>
                <input
                  class="dialog-input llm-manager-param-input"
                  type="number"
                  min="0"
                  step="1"
                  :value="props.slotParamsDraft.top_k ?? ''"
                  @input="handleTopKInput"
                >
              </label>
            </div>
          </section>

          <section class="llm-manager-drawer-section mt-3">
            <h3 class="llm-manager-drawer-section-title">{{ props.t("dialogs.llmManagerDrawerAdvancedSection") }}</h3>
            <div class="llm-manager-param-grid mt-2">
              <label class="llm-manager-param-field">
                <span class="dialog-label llm-manager-param-label">
                  <span>{{ props.t("dialogs.llmManagerParamFrequencyPenalty") }}</span>
                  <span class="llm-manager-param-state" :class="isSlotParamOverridden('frequency_penalty') ? 'override' : 'inherit'">
                    {{ getSlotParamStateLabel("frequency_penalty") }}
                  </span>
                </span>
                <div class="llm-manager-param-slider-wrap">
                  <input
                    class="llm-manager-param-slider"
                    type="range"
                    min="-2"
                    max="2"
                    step="0.1"
                    :value="props.slotParamsDraft.frequency_penalty ?? 0"
                    @input="handleRangeParamInput('frequency_penalty', $event)"
                  >
                  <input
                    class="dialog-input llm-manager-param-input"
                    type="number"
                    min="-2"
                    max="2"
                    step="0.1"
                    :value="props.slotParamsDraft.frequency_penalty ?? ''"
                    @input="handleFrequencyPenaltyNumberInput"
                  >
                </div>
              </label>

              <label class="llm-manager-param-field">
                <span class="dialog-label llm-manager-param-label">
                  <span>{{ props.t("dialogs.llmManagerParamPresencePenalty") }}</span>
                  <span class="llm-manager-param-state" :class="isSlotParamOverridden('presence_penalty') ? 'override' : 'inherit'">
                    {{ getSlotParamStateLabel("presence_penalty") }}
                  </span>
                </span>
                <div class="llm-manager-param-slider-wrap">
                  <input
                    class="llm-manager-param-slider"
                    type="range"
                    min="-2"
                    max="2"
                    step="0.1"
                    :value="props.slotParamsDraft.presence_penalty ?? 0"
                    @input="handleRangeParamInput('presence_penalty', $event)"
                  >
                  <input
                    class="dialog-input llm-manager-param-input"
                    type="number"
                    min="-2"
                    max="2"
                    step="0.1"
                    :value="props.slotParamsDraft.presence_penalty ?? ''"
                    @input="handlePresencePenaltyNumberInput"
                  >
                </div>
              </label>

              <label class="llm-manager-param-field">
                <span class="dialog-label llm-manager-param-label">
                  <span>{{ props.t("dialogs.llmManagerParamStream") }}</span>
                  <span class="llm-manager-param-state" :class="isSlotParamOverridden('stream') ? 'override' : 'inherit'">
                    {{ getSlotParamStateLabel("stream") }}
                  </span>
                </span>
                <UiCheckboxField
                  class="mt-2"
                  :checked="props.slotParamsDraft.stream ?? true"
                  @update:checked="patchSlotParam('stream', $event)"
                >
                  <span>{{ props.t("dialogs.llmManagerParamStream") }}</span>
                </UiCheckboxField>
              </label>

              <label class="llm-manager-param-field">
                <span class="dialog-label llm-manager-param-label">
                  <span>{{ props.t("dialogs.llmManagerParamTimeoutMs") }}</span>
                  <span class="llm-manager-param-state" :class="isSlotParamOverridden('timeout_ms') ? 'override' : 'inherit'">
                    {{ getSlotParamStateLabel("timeout_ms") }}
                  </span>
                </span>
                <input
                  class="dialog-input llm-manager-param-input"
                  type="number"
                  min="1"
                  step="1"
                  :value="props.slotParamsDraft.timeout_ms ?? ''"
                  @input="handleTimeoutMsInput"
                >
              </label>

              <label class="llm-manager-param-field">
                <span class="dialog-label llm-manager-param-label">
                  <span>{{ props.t("dialogs.llmManagerParamMaxRetries") }}</span>
                  <span class="llm-manager-param-state" :class="isSlotParamOverridden('max_retries') ? 'override' : 'inherit'">
                    {{ getSlotParamStateLabel("max_retries") }}
                  </span>
                </span>
                <input
                  class="dialog-input llm-manager-param-input"
                  type="number"
                  min="0"
                  max="10"
                  step="1"
                  :value="props.slotParamsDraft.max_retries ?? ''"
                  @input="handleMaxRetriesInput"
                >
              </label>
            </div>
          </section>

          <div class="llm-manager-drawer-actions mt-3">
            <UiDialogButton type="button" :disabled="drawerActionBusy" @click="emit('resetSlotParams')">
              {{ props.t("dialogs.llmManagerDrawerReset") }}
            </UiDialogButton>
            <UiDialogButton type="button" variant="primary" :disabled="drawerSubmitDisabled" @click="emit('submitSlotDrawer')">
              {{
                props.applyingSlot === props.drawerSlot
                  ? props.t("dialogs.llmManagerApplying")
                  : props.t("dialogs.llmManagerDrawerSave")
              }}
            </UiDialogButton>
          </div>
        </template>

        <div v-else class="llm-manager-empty">{{ props.t("dialogs.llmManagerDrawerSelectSlot") }}</div>
      </aside>
    </div>

    <div v-else class="llm-manager-profile-layout mt-3">
      <div class="llm-manager-profile-toolbar">
        <UiDialogButton type="button" @click="emit('refresh')">{{ props.t("dialogs.llmManagerRefresh") }}</UiDialogButton>
        <UiDialogButton type="button" variant="primary" @click="emit('createProfileDraft')">
          {{ props.t("dialogs.llmManagerProfileCreate") }}
        </UiDialogButton>
      </div>

      <div v-if="!props.loading && props.profiles.length > 0" class="llm-manager-profile-filters">
        <label class="llm-manager-profile-filter">
          <span class="dialog-label">{{ props.t("dialogs.llmManagerFilterName") }}</span>
          <UiTextInput
            :model-value="profileSearchText"
            :placeholder="props.t('dialogs.llmManagerFilterNamePlaceholder')"
            @update:model-value="profileSearchText = $event"
          />
        </label>

        <label class="llm-manager-profile-filter">
          <span class="dialog-label">{{ props.t("dialogs.llmManagerFilterProvider") }}</span>
          <UiSelectShell
            :model-value="profileProviderFilter"
            :options="profileProviderFilterOptions"
            @update:model-value="profileProviderFilter = $event as 'all' | WorkspaceLlmProvider"
          />
        </label>

        <label class="llm-manager-profile-filter">
          <span class="dialog-label">{{ props.t("dialogs.llmManagerFilterStatus") }}</span>
          <UiSelectShell
            :model-value="profileStatusFilter"
            :options="profileStatusFilterOptions"
            @update:model-value="profileStatusFilter = $event as LlmProfileStatusFilter"
          />
        </label>
      </div>

      <div v-if="props.loading" class="llm-manager-empty">{{ props.t("dialogs.llmManagerLoading") }}</div>
      <div v-else-if="props.profiles.length === 0" class="llm-manager-empty">{{ props.t("dialogs.llmManagerNoProfiles") }}</div>
      <div v-else-if="filteredProfiles.length === 0" class="llm-manager-empty">{{ props.t("dialogs.llmManagerProfilesFilteredEmpty") }}</div>
      <div v-else class="llm-manager-profile-list">
        <article v-for="profile in filteredProfiles" :key="profile.id" class="llm-manager-profile-item">
          <div class="llm-manager-profile-main">
            <div class="llm-manager-profile-name">{{ profile.presetName }}</div>
            <div class="llm-manager-profile-meta">{{ profile.provider }} / {{ profile.modelId }}</div>
          </div>
          <div class="llm-manager-profile-actions">
            <span class="llm-manager-profile-status" :class="profile.status">
              {{ getProfileStatusLabel(profile.status) }}
            </span>
            <UiDialogButton type="button" @click="emit('editProfileDraft', profile.id)">{{ props.t("dialogs.llmManagerProfileEdit") }}</UiDialogButton>
            <UiDialogButton
              type="button"
              variant="danger"
              :disabled="props.profileDeletingId !== null"
              @click="requestDeleteProfile(profile.id)"
            >
              {{ props.profileDeletingId === profile.id ? props.t("dialogs.llmManagerProfileDeleting") : props.t("dialogs.llmManagerProfileDelete") }}
            </UiDialogButton>
          </div>
        </article>
      </div>

      <div v-if="!props.profileEditorOpen" class="llm-manager-empty">
        {{ props.t("dialogs.llmManagerProfileEditorIdle") }}
      </div>

      <section v-else class="llm-manager-profile-editor">
        <h3 class="llm-manager-profile-editor-title">{{ props.profileDraftTitle }}</h3>

        <UiDialogRow :label="props.t('dialogs.llmManagerProfilePresetName')" row-class="mt-2">
          <UiTextInput
            :model-value="props.profileDraft.presetName"
            @update:model-value="patchDraft({ presetName: $event })"
          />
        </UiDialogRow>

        <UiDialogRow :label="props.t('dialogs.llmManagerProfileProvider')" row-class="mt-2">
          <UiSelectShell
            :model-value="props.profileDraft.provider"
            :options="providerOptions"
            @update:model-value="patchDraft({ provider: $event as WorkspaceLlmProvider })"
          />
        </UiDialogRow>

        <UiDialogRow :label="props.t('dialogs.llmManagerProfileModelId')" row-class="mt-2">
          <div class="llm-manager-profile-model-controls">
            <UiTextInput
              :model-value="props.profileDraft.modelId"
              @update:model-value="patchDraft({ modelId: $event })"
            />
            <UiDialogButton
              type="button"
              :disabled="props.profileModelsLoading || props.profileSaving || props.profileTesting"
              @click="emit('discoverProfileModels')"
            >
              {{
                props.profileModelsLoading
                  ? props.t("dialogs.llmManagerProfileModelFetching")
                  : props.t("dialogs.llmManagerProfileModelFetch")
              }}
            </UiDialogButton>
            <UiDialogButton
              type="button"
              :disabled="props.profileTesting || props.profileSaving || props.profileModelsLoading"
              @click="emit('testProfileModel')"
            >
              {{
                props.profileTesting
                  ? props.t("dialogs.llmManagerProfileModelTesting")
                  : props.t("dialogs.llmManagerProfileModelTest")
              }}
            </UiDialogButton>
          </div>
        </UiDialogRow>

        <UiDialogRow v-if="discoveredModelOptions.length > 0" :label="props.t('dialogs.llmManagerProfileModelCandidates')" row-class="mt-2">
          <UiSelectShell
            :model-value="props.profileDraft.modelId"
            :options="discoveredModelOptions"
            :placeholder="props.t('dialogs.llmManagerProfileModelCandidatesPlaceholder')"
            @update:model-value="patchDraft({ modelId: $event })"
          />
        </UiDialogRow>

        <UiDialogRow :label="props.t('dialogs.llmManagerProfileBaseUrl')" row-class="mt-2">
          <UiTextInput
            :model-value="props.profileDraft.baseUrl"
            @update:model-value="patchDraft({ baseUrl: $event })"
          />
        </UiDialogRow>

        <UiDialogRow :label="props.t('dialogs.llmManagerProfileApiKeyName')" row-class="mt-2">
          <UiTextInput
            :model-value="props.profileDraft.apiKeyName"
            @update:model-value="patchDraft({ apiKeyName: $event })"
          />
        </UiDialogRow>

        <UiDialogRow :label="props.t('dialogs.llmManagerProfileApiKey')" row-class="mt-2">
          <UiTextInput
            :model-value="props.profileDraft.apiKey"
            @update:model-value="patchDraft({ apiKey: $event })"
          />
        </UiDialogRow>

        <UiDialogRow v-if="props.profileDraft.mode === 'edit'" :label="props.t('dialogs.llmManagerProfileStatus')" row-class="mt-2">
          <UiSelectShell
            :model-value="props.profileDraft.status"
            :options="statusOptions"
            @update:model-value="patchDraft({ status: $event as 'active' | 'disabled' })"
          />
        </UiDialogRow>

        <div class="llm-manager-profile-editor-actions">
          <UiDialogButton type="button" :disabled="props.profileSaving" @click="emit('cancelProfileDraft')">
            {{ props.t("dialogs.cancel") }}
          </UiDialogButton>
          <UiDialogButton type="button" variant="primary" :disabled="props.profileSaving" @click="emit('submitProfileDraft')">
            {{ props.profileSaving ? props.t("dialogs.llmManagerProfileSaving") : props.t("dialogs.llmManagerProfileSave") }}
          </UiDialogButton>
        </div>
      </section>
    </div>

    <p v-if="props.errorMessage" class="asset-manager-error mt-3">{{ props.errorMessage }}</p>
  </UiDialogShell>

  <UiAlertDialogShell
    :description="props.t('dialogs.llmManagerProfileDeleteConfirmDescription', { profile: deleteProfileTargetLabel })"
    :open="profileDeleteConfirmId !== null"
    :title="props.t('dialogs.llmManagerProfileDeleteConfirmTitle')"
    width="sm"
    @update:open="handleDeleteConfirmOpenChange"
  >
    <UiDialogActions>
      <AlertDialogCancel as-child>
        <UiDialogButton type="button">{{ props.t("dialogs.cancel") }}</UiDialogButton>
      </AlertDialogCancel>
      <AlertDialogAction as-child>
        <UiDialogButton
          type="button"
          variant="danger"
          :disabled="props.profileDeletingId !== null"
          @click="confirmDeleteProfile"
        >
          {{
            props.profileDeletingId === deleteProfileTarget?.id
              ? props.t("dialogs.llmManagerProfileDeleting")
              : props.t("dialogs.llmManagerProfileDeleteConfirm")
          }}
        </UiDialogButton>
      </AlertDialogAction>
    </UiDialogActions>
  </UiAlertDialogShell>
</template>
