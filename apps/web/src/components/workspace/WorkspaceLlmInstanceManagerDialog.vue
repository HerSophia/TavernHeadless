<script setup lang="ts">
import { AlertDialogAction, AlertDialogCancel } from "radix-vue";
import { computed, ref, watch } from "vue";

import {
  workspaceLlmInstanceSlotLabelKeyMap,
  workspaceLlmInstanceSlots
} from "../../composables/workspace/llm";
import type {
  WorkspaceLlmDiscoveredModel,
  WorkspaceLlmInstanceSlot,
  WorkspaceLlmProfile,
  WorkspaceLlmProvider,
  WorkspaceLlmRuntimeSlot
} from "../../lib/workspace-api";
import UiAlertDialogShell from "../ui/UiAlertDialogShell.vue";
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
  errorMessage: string;
  hasActiveSession: boolean;
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
  runtimeSlots: WorkspaceLlmRuntimeSlot[];
  scope: "global" | "session";
  selectedProfileBySlot: Record<WorkspaceLlmInstanceSlot, string>;
  t: Translator;
}>();

const emit = defineEmits<{
  applySlotBinding: [slot: WorkspaceLlmInstanceSlot];
  cancelProfileDraft: [];
  createProfileDraft: [];
  deleteProfile: [profileId: string];
  discoverProfileModels: [];
  editProfileDraft: [profileId: string];
  refresh: [];
  submitProfileDraft: [];
  testProfileModel: [];
  "update:open": [value: boolean];
  "update:page": [value: "instances" | "profiles"];
  "update:profileDraft": [patch: Partial<LlmProfileDraft>];
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

watch(
  () => props.open,
  (open) => {
    if (open) {
      return;
    }

    resetProfileFilters();
    closeProfileDeleteConfirm();
  }
);

watch(
  () => props.page,
  (page) => {
    if (page !== "profiles") {
      closeProfileDeleteConfirm();
    }
  }
);

function updateSelectedProfile(slot: WorkspaceLlmInstanceSlot, profileId: string): void {
  emit("update:selectedProfile", { profileId, slot });
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

    <div v-if="props.page === 'instances'" class="llm-manager-list mt-3">
      <UiDialogRow :label="props.t('dialogs.llmManagerScope')">
        <UiSelectShell
          :model-value="props.scope"
          :options="scopeOptions"
          @update:model-value="emit('update:scope', $event as 'global' | 'session')"
        />
        <UiDialogButton type="button" @click="emit('refresh')">{{ props.t("dialogs.llmManagerRefresh") }}</UiDialogButton>
      </UiDialogRow>

      <div v-if="props.loading" class="llm-manager-empty">{{ props.t("dialogs.llmManagerLoading") }}</div>

      <template v-else>
        <div v-if="profileOptions.length === 0" class="llm-manager-empty">{{ props.t("dialogs.llmManagerNoProfiles") }}</div>

        <section
          v-for="slot in workspaceLlmInstanceSlots"
          :key="slot"
          class="llm-manager-slot"
        >
          <div class="llm-manager-slot-head">
            <div class="llm-manager-slot-title">{{ props.t(workspaceLlmInstanceSlotLabelKeyMap[slot]) }}</div>
            <div class="llm-manager-slot-runtime">{{ buildRuntimeSummary(slot) }}</div>
          </div>

          <div class="llm-manager-slot-controls">
            <UiSelectShell
              :model-value="props.selectedProfileBySlot[slot]"
              :options="profileOptions"
              :placeholder="props.t('dialogs.llmManagerSelectProfile')"
              @update:model-value="updateSelectedProfile(slot, $event)"
            />
            <UiDialogButton
              type="button"
              variant="primary"
              :disabled="props.loading || props.applyingSlot !== null"
              @click="emit('applySlotBinding', slot)"
            >
              {{ props.applyingSlot === slot ? props.t("dialogs.llmManagerApplying") : props.t("dialogs.llmManagerApply") }}
            </UiDialogButton>
          </div>
        </section>
      </template>
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
