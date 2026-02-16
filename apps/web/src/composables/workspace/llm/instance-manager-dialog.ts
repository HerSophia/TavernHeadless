import { computed, reactive, type Ref } from "vue";

import {
  activateLlmProfileBinding,
  createLlmProfile,
  deleteLlmProfile,
  discoverLlmModels,
  fetchLlmProfiles,
  fetchLlmRuntime,
  testLlmModel,
  updateLlmProfile,
  type WorkspaceLlmDiscoveredModel,
  type WorkspaceLlmInstanceSlot,
  type WorkspaceLlmProfile,
  type WorkspaceLlmProvider,
  type WorkspaceLlmRuntimeSlot
} from "../../../lib/workspace-api";
import type { EventTone } from "../../../stores/workspace-ui";

type AddEvent = (key: string, tone?: EventTone, vars?: Record<string, number | string>) => void;

type UseWorkspaceLlmManagerDialogOptions = {
  activeSessionId: Ref<string | null>;
  addEvent: AddEvent;
  currentAccount: Ref<string>;
  t: (key: string, vars?: Record<string, number | string>) => string;
};

type LlmManagerPage = "instances" | "profiles";

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

export const workspaceLlmInstanceSlots: WorkspaceLlmInstanceSlot[] = ["narrator", "director", "verifier", "memory", "*"];

export const workspaceLlmInstanceSlotLabelKeyMap: Record<WorkspaceLlmInstanceSlot, string> = {
  "*": "dialogs.llmManagerSlotWildcard",
  narrator: "dialogs.llmManagerSlotNarrator",
  director: "dialogs.llmManagerSlotDirector",
  verifier: "dialogs.llmManagerSlotVerifier",
  memory: "dialogs.llmManagerSlotMemory"
};

const runtimeSourceLabelKeyMap: Record<WorkspaceLlmRuntimeSlot["source"], string> = {
  env: "dialogs.llmManagerSourceEnv",
  global_profile: "dialogs.llmManagerSourceGlobalProfile",
  session_profile: "dialogs.llmManagerSourceSessionProfile"
};

function createSlotProfileSelection(): Record<WorkspaceLlmInstanceSlot, string> {
  return {
    "*": "",
    narrator: "",
    director: "",
    verifier: "",
    memory: ""
  };
}

function createProfileDraft(mode: "create" | "edit", profile?: WorkspaceLlmProfile): LlmProfileDraft {
  if (mode === "edit" && profile) {
    return {
      apiKey: "",
      apiKeyName: profile.apiKeyName ?? "",
      baseUrl: profile.baseUrl ?? "",
      id: profile.id,
      mode,
      modelId: profile.modelId,
      presetName: profile.presetName,
      provider: profile.provider,
      status: profile.status === "disabled" ? "disabled" : "active"
    };
  }

  return {
    apiKey: "",
    apiKeyName: "",
    baseUrl: "",
    id: "",
    mode,
    modelId: "",
    presetName: "",
    provider: "openai-compatible",
    status: "active"
  };
}

export function useWorkspaceLlmManagerDialog(options: UseWorkspaceLlmManagerDialogOptions) {
  const llmManagerDialog = reactive({
    applyingSlot: null as WorkspaceLlmInstanceSlot | null,
    errorMessage: "",
    loading: false,
    open: false,
    page: "instances" as LlmManagerPage,
    profileDeletingId: null as string | null,
    profileDraft: createProfileDraft("create"),
    profileEditorOpen: false,
    profileModelOptions: [] as WorkspaceLlmDiscoveredModel[],
    profileModelsLoading: false,
    profileSaving: false,
    profileTesting: false,
    profiles: [] as WorkspaceLlmProfile[],
    runtimeSlots: [] as WorkspaceLlmRuntimeSlot[],
    scope: "session" as "global" | "session",
    selectedProfileBySlot: createSlotProfileSelection()
  });

  const runtimeBySlot = computed(() => {
    const entries = llmManagerDialog.runtimeSlots.map((slot) => [slot.slot, slot] as const);
    return Object.fromEntries(entries) as Partial<Record<WorkspaceLlmInstanceSlot, WorkspaceLlmRuntimeSlot>>;
  });

  const activeNarratorRuntime = computed(() => {
    return runtimeBySlot.value.narrator ?? runtimeBySlot.value["*"] ?? null;
  });

  const activeModelName = computed(() => {
    const runtime = activeNarratorRuntime.value;
    if (!runtime) {
      return options.t("nav.activeModelUnavailable");
    }

    return runtime.modelId;
  });

  const activeModelDetail = computed(() => {
    const runtime = activeNarratorRuntime.value;
    if (!runtime) {
      return options.t("dialogs.llmManagerNoRuntime");
    }

    const sourceLabel = options.t(runtimeSourceLabelKeyMap[runtime.source]);
    if (runtime.presetName) {
      return `${runtime.provider} | ${sourceLabel} | ${runtime.presetName}`;
    }

    return `${runtime.provider} | ${sourceLabel}`;
  });

  const hasActiveSession = computed(() => Boolean(options.activeSessionId.value));

  const profileDraftTitle = computed(() => {
    return llmManagerDialog.profileDraft.mode === "create"
      ? options.t("dialogs.llmManagerProfileCreate")
      : options.t("dialogs.llmManagerProfileEdit");
  });

  function resolveErrorMessage(error: unknown, fallbackKey: string): string {
    if (error instanceof Error) {
      if (error.message.includes("APP_SECRETS_MASTER_KEY")) {
        return options.t("dialogs.llmManagerProfileMasterKeyRequired");
      }

      return error.message;
    }

    return options.t(fallbackKey);
  }

  function resolveScope(nextScope: "global" | "session"): "global" | "session" {
    if (nextScope === "session" && !options.activeSessionId.value) {
      return "global";
    }

    return nextScope;
  }

  function setLlmManagerScope(scope: "global" | "session"): void {
    llmManagerDialog.scope = resolveScope(scope);
  }

  function setLlmManagerPage(page: LlmManagerPage): void {
    if (page !== llmManagerDialog.page) {
      llmManagerDialog.profileEditorOpen = false;
      llmManagerDialog.profileDraft = createProfileDraft("create");
      llmManagerDialog.errorMessage = "";
      llmManagerDialog.profileTesting = false;
      resetProfileModelOptions();
    }

    llmManagerDialog.page = page;
  }

  function setLlmManagerProfileSelection(payload: { profileId: string; slot: WorkspaceLlmInstanceSlot }): void {
    llmManagerDialog.selectedProfileBySlot[payload.slot] = payload.profileId;
  }

  function resetProfileModelOptions(): void {
    llmManagerDialog.profileModelOptions = [];
  }

  function patchLlmProfileDraft(patch: Partial<LlmProfileDraft>): void {
    if (!llmManagerDialog.profileEditorOpen) {
      return;
    }

    llmManagerDialog.profileDraft = {
      ...llmManagerDialog.profileDraft,
      ...patch
    };

    if (patch.apiKey !== undefined || patch.baseUrl !== undefined || patch.provider !== undefined) {
      resetProfileModelOptions();
    }
  }

  function beginCreateLlmProfileDraft(): void {
    llmManagerDialog.profileDraft = createProfileDraft("create");
    llmManagerDialog.profileEditorOpen = true;
    llmManagerDialog.errorMessage = "";
    llmManagerDialog.profileTesting = false;
    resetProfileModelOptions();
  }

  function beginEditLlmProfileDraft(profileId: string): void {
    const profile = llmManagerDialog.profiles.find((item) => item.id === profileId);
    if (!profile) {
      return;
    }

    llmManagerDialog.profileDraft = createProfileDraft("edit", profile);
    llmManagerDialog.profileEditorOpen = true;
    llmManagerDialog.errorMessage = "";
    llmManagerDialog.profileTesting = false;
    resetProfileModelOptions();
  }

  function cancelLlmProfileDraft(): void {
    llmManagerDialog.profileDraft = createProfileDraft("create");
    llmManagerDialog.profileEditorOpen = false;
    llmManagerDialog.errorMessage = "";
    llmManagerDialog.profileTesting = false;
    resetProfileModelOptions();
  }

  function primeProfileSelection(runtimeSlots: WorkspaceLlmRuntimeSlot[]): void {
    const nextSelection = createSlotProfileSelection();

    for (const slot of workspaceLlmInstanceSlots) {
      const runtime = runtimeSlots.find((item) => item.slot === slot);
      if (runtime?.profileId) {
        nextSelection[slot] = runtime.profileId;
      }
    }

    llmManagerDialog.selectedProfileBySlot = nextSelection;
  }

  async function refreshLlmRuntime(): Promise<void> {
    try {
      const runtimeSlots = await fetchLlmRuntime(options.activeSessionId.value ?? undefined, options.currentAccount.value);
      llmManagerDialog.runtimeSlots = runtimeSlots;
    } catch {
      llmManagerDialog.runtimeSlots = [];
      options.addEvent("events.llmRuntimeSyncFailed", "warn");
    }
  }

  async function refreshLlmManagerDialog(): Promise<void> {
    llmManagerDialog.loading = true;
    llmManagerDialog.errorMessage = "";

    try {
      const [profiles, runtimeSlots] = await Promise.all([
        fetchLlmProfiles(options.currentAccount.value),
        fetchLlmRuntime(options.activeSessionId.value ?? undefined, options.currentAccount.value)
      ]);

      llmManagerDialog.profiles = profiles;
      llmManagerDialog.runtimeSlots = runtimeSlots;
      primeProfileSelection(runtimeSlots);

      if (llmManagerDialog.profileEditorOpen && llmManagerDialog.profileDraft.mode === "edit") {
        const editing = profiles.find((item) => item.id === llmManagerDialog.profileDraft.id);
        if (editing) {
          llmManagerDialog.profileDraft = createProfileDraft("edit", editing);
        } else {
          llmManagerDialog.profileDraft = createProfileDraft("create");
          llmManagerDialog.profileEditorOpen = false;
        }

        resetProfileModelOptions();
      }
    } catch (error) {
      llmManagerDialog.profiles = [];
      llmManagerDialog.runtimeSlots = [];
      llmManagerDialog.errorMessage = error instanceof Error ? error.message : options.t("dialogs.llmManagerLoadFailed");
      options.addEvent("events.llmRuntimeSyncFailed", "warn");
    } finally {
      llmManagerDialog.loading = false;
    }
  }

  function closeLlmManagerDialog(): void {
    llmManagerDialog.open = false;
    llmManagerDialog.errorMessage = "";
    llmManagerDialog.profileDraft = createProfileDraft("create");
    llmManagerDialog.profileEditorOpen = false;
    llmManagerDialog.profileModelsLoading = false;
    llmManagerDialog.profileTesting = false;
    resetProfileModelOptions();
  }

  async function openLlmManagerDialog(page: LlmManagerPage = "instances"): Promise<void> {
    llmManagerDialog.open = true;
    llmManagerDialog.page = page;
    llmManagerDialog.scope = resolveScope("session");
    llmManagerDialog.profileDraft = createProfileDraft("create");
    llmManagerDialog.profileEditorOpen = false;
    llmManagerDialog.profileTesting = false;
    await refreshLlmManagerDialog();
  }

  async function applyLlmSlotBinding(slot: WorkspaceLlmInstanceSlot): Promise<void> {
    const profileId = llmManagerDialog.selectedProfileBySlot[slot];
    if (!profileId) {
      llmManagerDialog.errorMessage = options.t("dialogs.llmManagerSelectProfileFirst");
      return;
    }

    const scope = resolveScope(llmManagerDialog.scope);
    const sessionId = scope === "session" ? options.activeSessionId.value ?? undefined : undefined;
    if (scope === "session" && !sessionId) {
      llmManagerDialog.errorMessage = options.t("dialogs.llmManagerSessionRequired");
      return;
    }

    llmManagerDialog.applyingSlot = slot;
    llmManagerDialog.errorMessage = "";

    try {
      const activated = await activateLlmProfileBinding(
        profileId,
        {
          instanceSlot: slot,
          scope,
          sessionId
        },
        options.currentAccount.value
      );

      if (!activated) {
        throw new Error(options.t("dialogs.llmManagerApplyFailed"));
      }

      const profileName = llmManagerDialog.profiles.find((item) => item.id === profileId)?.presetName ?? profileId;
      options.addEvent("events.llmBindingUpdated", "success", {
        profile: profileName,
        slot: options.t(workspaceLlmInstanceSlotLabelKeyMap[slot])
      });

      await refreshLlmManagerDialog();
    } catch (error) {
      llmManagerDialog.errorMessage = error instanceof Error ? error.message : options.t("dialogs.llmManagerApplyFailed");
      options.addEvent("events.llmBindingFailed", "warn", {
        slot: options.t(workspaceLlmInstanceSlotLabelKeyMap[slot])
      });
    } finally {
      llmManagerDialog.applyingSlot = null;
    }
  }

  async function fetchLlmProfileModels(): Promise<void> {
    if (!llmManagerDialog.profileEditorOpen) {
      return;
    }

    const draft = llmManagerDialog.profileDraft;
    const apiKey = draft.apiKey.trim();

    if (!apiKey) {
      llmManagerDialog.errorMessage = options.t("dialogs.llmManagerProfileModelFetchApiKeyRequired");
      return;
    }

    llmManagerDialog.profileModelsLoading = true;
    llmManagerDialog.errorMessage = "";

    try {
      const models = await discoverLlmModels(
        {
          apiKey,
          baseUrl: draft.baseUrl.trim() || undefined,
          provider: draft.provider
        },
        options.currentAccount.value
      );

      llmManagerDialog.profileModelOptions = models;
      if (models.length > 0) {
        options.addEvent("events.llmProfileModelsFetched", "success", { count: models.length });
      } else {
        options.addEvent("events.llmProfileModelsEmpty", "warn");
      }
    } catch (error) {
      resetProfileModelOptions();
      llmManagerDialog.errorMessage = resolveErrorMessage(error, "dialogs.llmManagerProfileModelFetchFailed");
      options.addEvent("events.llmProfileModelFetchFailed", "warn");
    } finally {
      llmManagerDialog.profileModelsLoading = false;
    }
  }

  async function testLlmProfileModel(): Promise<void> {
    if (!llmManagerDialog.profileEditorOpen) {
      return;
    }

    const draft = llmManagerDialog.profileDraft;
    const apiKey = draft.apiKey.trim();
    const modelId = draft.modelId.trim();

    if (!apiKey) {
      llmManagerDialog.errorMessage = options.t("dialogs.llmManagerProfileModelTestApiKeyRequired");
      return;
    }

    if (!modelId) {
      llmManagerDialog.errorMessage = options.t("dialogs.llmManagerProfileModelTestModelRequired");
      return;
    }

    llmManagerDialog.profileTesting = true;
    llmManagerDialog.errorMessage = "";

    try {
      const tested = await testLlmModel(
        {
          apiKey,
          baseUrl: draft.baseUrl.trim() || undefined,
          modelId,
          provider: draft.provider
        },
        options.currentAccount.value
      );

      const responsePreview = tested.responseText.trim().replace(/\s+/g, " ").slice(0, 80);
      options.addEvent("events.llmProfileModelTestPassed", "success", {
        response: responsePreview || tested.responseText
      });
    } catch (error) {
      llmManagerDialog.errorMessage = resolveErrorMessage(error, "dialogs.llmManagerProfileModelTestFailed");
      options.addEvent("events.llmProfileModelTestFailed", "warn");
    } finally {
      llmManagerDialog.profileTesting = false;
    }
  }

  async function submitLlmProfileDraft(): Promise<void> {
    if (!llmManagerDialog.profileEditorOpen) {
      return;
    }

    const draft = llmManagerDialog.profileDraft;
    const presetName = draft.presetName.trim();
    const modelId = draft.modelId.trim();

    if (!presetName || !modelId) {
      llmManagerDialog.errorMessage = options.t("dialogs.llmManagerProfileRequired");
      return;
    }

    if (draft.mode === "create" && draft.apiKey.trim().length === 0) {
      llmManagerDialog.errorMessage = options.t("dialogs.llmManagerProfileApiKeyRequired");
      return;
    }

    llmManagerDialog.profileSaving = true;
    llmManagerDialog.errorMessage = "";

    try {
      if (draft.mode === "create") {
        const created = await createLlmProfile(
          {
            apiKey: draft.apiKey.trim(),
            apiKeyName: draft.apiKeyName.trim() || undefined,
            baseUrl: draft.baseUrl.trim() || undefined,
            modelId,
            presetName,
            provider: draft.provider
          },
          options.currentAccount.value
        );

        options.addEvent("events.llmProfileCreated", "success", { profile: created.presetName });
        llmManagerDialog.profileDraft = createProfileDraft("edit", created);
      } else {
        const updated = await updateLlmProfile(
          draft.id,
          {
            apiKey: draft.apiKey.trim() || undefined,
            apiKeyName: draft.apiKeyName.trim() || null,
            baseUrl: draft.baseUrl.trim() || null,
            modelId,
            presetName,
            provider: draft.provider,
            status: draft.status
          },
          options.currentAccount.value
        );

        options.addEvent("events.llmProfileUpdated", "success", { profile: updated.presetName });
        llmManagerDialog.profileDraft = createProfileDraft("edit", updated);
      }

      await refreshLlmManagerDialog();
    } catch (error) {
      llmManagerDialog.errorMessage = resolveErrorMessage(error, "dialogs.llmManagerProfileSaveFailed");
      options.addEvent("events.llmProfileSaveFailed", "warn");
    } finally {
      llmManagerDialog.profileSaving = false;
    }
  }

  async function removeLlmProfile(profileId: string): Promise<void> {
    llmManagerDialog.profileDeletingId = profileId;
    llmManagerDialog.errorMessage = "";

    try {
      const profile = llmManagerDialog.profiles.find((item) => item.id === profileId);
      const deleted = await deleteLlmProfile(profileId, options.currentAccount.value);
      if (!deleted) {
        throw new Error(options.t("dialogs.llmManagerProfileDeleteFailed"));
      }

      options.addEvent("events.llmProfileDeleted", "success", { profile: profile?.presetName ?? profileId });
      if (
        llmManagerDialog.profileEditorOpen &&
        llmManagerDialog.profileDraft.mode === "edit" &&
        llmManagerDialog.profileDraft.id === profileId
      ) {
        llmManagerDialog.profileDraft = createProfileDraft("create");
        llmManagerDialog.profileEditorOpen = false;
        resetProfileModelOptions();
      }

      await refreshLlmManagerDialog();
    } catch (error) {
      llmManagerDialog.errorMessage = resolveErrorMessage(error, "dialogs.llmManagerProfileDeleteFailed");
      options.addEvent("events.llmProfileDeleteFailed", "warn");
    } finally {
      llmManagerDialog.profileDeletingId = null;
    }
  }

  return {
    activeModelDetail,
    activeModelName,
    applyLlmSlotBinding,
    beginCreateLlmProfileDraft,
    beginEditLlmProfileDraft,
    cancelLlmProfileDraft,
    closeLlmManagerDialog,
    fetchLlmProfileModels,
    hasActiveSession,
    llmManagerDialog,
    openLlmManagerDialog,
    patchLlmProfileDraft,
    profileDraftTitle,
    refreshLlmManagerDialog,
    refreshLlmRuntime,
    removeLlmProfile,
    runtimeBySlot,
    setLlmManagerPage,
    setLlmManagerProfileSelection,
    setLlmManagerScope,
    submitLlmProfileDraft,
    testLlmProfileModel
  };
}
