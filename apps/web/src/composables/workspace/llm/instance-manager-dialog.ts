import { computed, reactive, type Ref } from "vue";

import {
  activateLlmProfileBinding,
  createLlmProfile,
  deleteLlmProfile,
  discoverLlmModels,
  fetchLlmProfiles,
  fetchPresetAssetDetail,
  fetchPresetAssets,
  fetchLlmRuntime,
  testLlmModel,
  updateLlmProfile,
  type WorkspaceLlmDiscoveredModel,
  type WorkspaceLlmGenerationParams,
  type WorkspaceLlmInstanceSlot,
  type WorkspaceLlmProfile,
  type WorkspaceLlmProvider,
  type WorkspaceLlmRuntimeSlot,
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

type WorkspacePresetSummary = {
  id: string;
  name: string;
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

function createSlotPresetSelection(): Record<WorkspaceLlmInstanceSlot, string> {
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

const workspaceLlmGenerationParamKeys: Array<keyof WorkspaceLlmGenerationParams> = [
  "max_context_tokens",
  "max_output_tokens",
  "temperature",
  "top_p",
  "top_k",
  "frequency_penalty",
  "presence_penalty",
  "stream",
  "timeout_ms",
  "max_retries"
];

function createSlotParamsDraft(params?: WorkspaceLlmGenerationParams | null): WorkspaceLlmGenerationParams {
  return Object.fromEntries(
    workspaceLlmGenerationParamKeys
      .map((key) => [key, params?.[key]] as const)
      .filter(([, value]) => value !== undefined)
  ) as WorkspaceLlmGenerationParams;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function createPresetParamCandidates(data: Record<string, unknown>): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [];

  const append = (value: unknown): void => {
    const record = asRecord(value);
    if (!record) {
      return;
    }

    if (!candidates.includes(record)) {
      candidates.push(record);
    }
  };

  append(data);
  append(data.data);
  append(data.top_level);

  const editor = asRecord(data.editor);
  if (editor) {
    append(editor);
    append(editor.top_level);
  }

  return candidates;
}

function parseNumericPresetParam(records: Record<string, unknown>[], aliases: string[]): number | undefined {
  for (const record of records) {
    for (const key of aliases) {
      const value = record[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }

      if (typeof value === "string" && value.trim().length > 0 && Number.isFinite(Number(value))) {
        return Number(value);
      }
    }
  }

  return undefined;
}

function parseBooleanPresetParam(records: Record<string, unknown>[], aliases: string[]): boolean | undefined {
  for (const record of records) {
    for (const key of aliases) {
      const value = record[key];
      if (typeof value === "boolean") {
        return value;
      }

      if (typeof value === "number") {
        if (value === 1) {
          return true;
        }
        if (value === 0) {
          return false;
        }
      }

      if (typeof value === "string") {
        if (value === "true" || value === "1") return true;
        if (value === "false" || value === "0") return false;
      }
    }
  }

  return undefined;
}

function extractPresetGenerationParams(data: Record<string, unknown>): WorkspaceLlmGenerationParams {
  const candidates = createPresetParamCandidates(data);

  const mapped: WorkspaceLlmGenerationParams = {
    frequency_penalty: parseNumericPresetParam(candidates, ["frequency_penalty", "frequencyPenalty"]),
    max_context_tokens: parseNumericPresetParam(candidates, ["openai_max_context", "maxContext", "max_context_tokens"]),
    max_output_tokens: parseNumericPresetParam(candidates, ["openai_max_tokens", "maxTokens", "max_output_tokens"]),
    presence_penalty: parseNumericPresetParam(candidates, ["presence_penalty", "presencePenalty"]),
    stream: parseBooleanPresetParam(candidates, ["stream_openai", "stream"]),
    temperature: parseNumericPresetParam(candidates, ["temperature"]),
    top_k: parseNumericPresetParam(candidates, ["top_k", "topK"]),
    top_p: parseNumericPresetParam(candidates, ["top_p", "topP"])
  };

  return createSlotParamsDraft(mapped);
}

export function useWorkspaceLlmManagerDialog(options: UseWorkspaceLlmManagerDialogOptions) {
  const llmManagerDialog = reactive({
    applyingSlot: null as WorkspaceLlmInstanceSlot | null,
    applyingPresetParams: false,
    drawerOpen: false,
    drawerSlot: null as WorkspaceLlmInstanceSlot | null,
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
    presetAssets: [] as WorkspacePresetSummary[],
    runtimeSlots: [] as WorkspaceLlmRuntimeSlot[],
    slotParamsDraft: createSlotParamsDraft(),
    scope: "session" as "global" | "session",
    selectedPresetBySlot: createSlotPresetSelection(),
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
      closeSlotDrawer();
    }

    llmManagerDialog.page = page;
  }

  function setLlmManagerProfileSelection(payload: { profileId: string; slot: WorkspaceLlmInstanceSlot }): void {
    llmManagerDialog.selectedProfileBySlot[payload.slot] = payload.profileId;
  }

  function setLlmManagerPresetSelection(payload: { presetId: string; slot: WorkspaceLlmInstanceSlot }): void {
    llmManagerDialog.selectedPresetBySlot[payload.slot] = payload.presetId;
  }

  function openSlotDrawer(slot: WorkspaceLlmInstanceSlot): void {
    const runtime = runtimeBySlot.value[slot] ?? null;

    if (runtime?.profileId) {
      llmManagerDialog.selectedProfileBySlot[slot] = runtime.profileId;
    }

    if (runtime?.scope) {
      llmManagerDialog.scope = resolveScope(runtime.scope);
    }

    llmManagerDialog.drawerSlot = slot;
    llmManagerDialog.drawerOpen = true;
    llmManagerDialog.slotParamsDraft = createSlotParamsDraft(runtime?.params);
    llmManagerDialog.errorMessage = "";
  }

  function closeSlotDrawer(): void {
    llmManagerDialog.drawerOpen = false;
    llmManagerDialog.drawerSlot = null;
    llmManagerDialog.slotParamsDraft = createSlotParamsDraft();
  }

  function patchSlotParams(patch: Partial<WorkspaceLlmGenerationParams>): void {
    if (!llmManagerDialog.drawerOpen || !llmManagerDialog.drawerSlot) {
      return;
    }

    llmManagerDialog.slotParamsDraft = createSlotParamsDraft({
      ...llmManagerDialog.slotParamsDraft,
      ...patch
    });
  }

  function resetSlotParams(): void {
    if (!llmManagerDialog.drawerSlot) {
      return;
    }

    const runtime = runtimeBySlot.value[llmManagerDialog.drawerSlot] ?? null;
    llmManagerDialog.slotParamsDraft = createSlotParamsDraft(runtime?.params);
    llmManagerDialog.errorMessage = "";
  }

  function validateSlotParamsDraft(params: WorkspaceLlmGenerationParams): string | null {
    if (
      params.temperature !== undefined &&
      (!Number.isFinite(params.temperature) || params.temperature < 0 || params.temperature > 2)
    ) {
      return options.t("dialogs.llmManagerParamValidationTemperature");
    }

    if (params.max_output_tokens !== undefined && (!Number.isInteger(params.max_output_tokens) || params.max_output_tokens < 1)) {
      return options.t("dialogs.llmManagerParamValidationMaxOutputTokens");
    }

    if (params.max_context_tokens !== undefined && (!Number.isInteger(params.max_context_tokens) || params.max_context_tokens < 1)) {
      return options.t("dialogs.llmManagerParamValidationMaxContextTokens");
    }

    if (params.top_p !== undefined && (!Number.isFinite(params.top_p) || params.top_p < 0 || params.top_p > 1)) {
      return options.t("dialogs.llmManagerParamValidationTopP");
    }

    if (params.top_k !== undefined && (!Number.isInteger(params.top_k) || params.top_k < 0)) {
      return options.t("dialogs.llmManagerParamValidationTopK");
    }

    if (
      params.frequency_penalty !== undefined &&
      (!Number.isFinite(params.frequency_penalty) || params.frequency_penalty < -2 || params.frequency_penalty > 2)
    ) {
      return options.t("dialogs.llmManagerParamValidationFrequencyPenalty");
    }

    if (
      params.presence_penalty !== undefined &&
      (!Number.isFinite(params.presence_penalty) || params.presence_penalty < -2 || params.presence_penalty > 2)
    ) {
      return options.t("dialogs.llmManagerParamValidationPresencePenalty");
    }

    if (params.timeout_ms !== undefined && (!Number.isInteger(params.timeout_ms) || params.timeout_ms < 1)) {
      return options.t("dialogs.llmManagerParamValidationTimeoutMs");
    }

    if (params.max_retries !== undefined && (!Number.isInteger(params.max_retries) || params.max_retries < 0 || params.max_retries > 10)) {
      return options.t("dialogs.llmManagerParamValidationMaxRetries");
    }

    if (params.stream !== undefined && typeof params.stream !== "boolean") {
      return options.t("dialogs.llmManagerParamValidationStream");
    }

    return null;
  }

  async function applySlotPresetParams(slot?: WorkspaceLlmInstanceSlot): Promise<void> {
    const targetSlot = slot ?? llmManagerDialog.drawerSlot;
    if (!targetSlot) {
      return;
    }

    const presetId = llmManagerDialog.selectedPresetBySlot[targetSlot];
    if (!presetId) {
      llmManagerDialog.errorMessage = options.t("dialogs.llmManagerPresetSelectFirst");
      return;
    }

    const preset = llmManagerDialog.presetAssets.find((item) => item.id === presetId) ?? null;
    llmManagerDialog.applyingPresetParams = true;
    llmManagerDialog.errorMessage = "";

    try {
      const detail = await fetchPresetAssetDetail(presetId, options.currentAccount.value);
      const mappedParams = extractPresetGenerationParams(detail.data);

      if (Object.keys(mappedParams).length === 0) {
        throw new Error(options.t("dialogs.llmManagerPresetNoSupportedParams"));
      }

      if (llmManagerDialog.drawerOpen && llmManagerDialog.drawerSlot === targetSlot) {
        llmManagerDialog.slotParamsDraft = createSlotParamsDraft({
          ...llmManagerDialog.slotParamsDraft,
          ...mappedParams
        });
      }

      options.addEvent("events.llmSlotPresetParamsApplied", "success", {
        preset: preset?.name ?? presetId,
        slot: options.t(workspaceLlmInstanceSlotLabelKeyMap[targetSlot])
      });
    } catch (error) {
      llmManagerDialog.errorMessage = error instanceof Error ? error.message : options.t("dialogs.llmManagerPresetApplyFailed");
      options.addEvent("events.llmSlotPresetParamsApplyFailed", "warn", {
        slot: options.t(workspaceLlmInstanceSlotLabelKeyMap[targetSlot])
      });
    } finally {
      llmManagerDialog.applyingPresetParams = false;
    }
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
      const [profiles, runtimeSlots, presetAssets] = await Promise.all([
        fetchLlmProfiles(options.currentAccount.value),
        fetchLlmRuntime(options.activeSessionId.value ?? undefined, options.currentAccount.value),
        fetchPresetAssets(options.currentAccount.value)
      ]);

      llmManagerDialog.profiles = profiles;
      llmManagerDialog.presetAssets = presetAssets.map((asset) => ({ id: asset.id, name: asset.name }));
      llmManagerDialog.runtimeSlots = runtimeSlots;
      primeProfileSelection(runtimeSlots);

      if (llmManagerDialog.drawerOpen && llmManagerDialog.drawerSlot) {
        const drawerRuntime = runtimeSlots.find((item) => item.slot === llmManagerDialog.drawerSlot) ?? null;
        if (drawerRuntime?.scope) {
          llmManagerDialog.scope = resolveScope(drawerRuntime.scope);
        }

        llmManagerDialog.slotParamsDraft = createSlotParamsDraft(drawerRuntime?.params);
      }

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
      llmManagerDialog.presetAssets = [];
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
    llmManagerDialog.selectedPresetBySlot = createSlotPresetSelection();
    llmManagerDialog.applyingPresetParams = false;
    llmManagerDialog.profileTesting = false;
    resetProfileModelOptions();
    closeSlotDrawer();
  }

  async function openLlmManagerDialog(page: LlmManagerPage = "instances"): Promise<void> {
    llmManagerDialog.open = true;
    llmManagerDialog.page = page;
    llmManagerDialog.scope = resolveScope("session");
    llmManagerDialog.profileDraft = createProfileDraft("create");
    llmManagerDialog.profileEditorOpen = false;
    llmManagerDialog.selectedPresetBySlot = createSlotPresetSelection();
    llmManagerDialog.applyingPresetParams = false;
    llmManagerDialog.profileTesting = false;
    closeSlotDrawer();
    await refreshLlmManagerDialog();
  }

  async function applyLlmSlotBinding(
    slot: WorkspaceLlmInstanceSlot,
    params?: WorkspaceLlmGenerationParams
  ): Promise<boolean> {
    const profileId = llmManagerDialog.selectedProfileBySlot[slot];
    if (!profileId) {
      llmManagerDialog.errorMessage = options.t("dialogs.llmManagerSelectProfileFirst");
      return false;
    }

    const scope = resolveScope(llmManagerDialog.scope);
    const sessionId = scope === "session" ? options.activeSessionId.value ?? undefined : undefined;
    if (scope === "session" && !sessionId) {
      llmManagerDialog.errorMessage = options.t("dialogs.llmManagerSessionRequired");
      return false;
    }

    const normalizedParams = params === undefined ? undefined : createSlotParamsDraft(params);
    const activateParams =
      normalizedParams === undefined ? undefined : Object.keys(normalizedParams).length > 0 ? normalizedParams : null;

    llmManagerDialog.applyingSlot = slot;
    llmManagerDialog.errorMessage = "";

    try {
      const activated = await activateLlmProfileBinding(
        profileId,
        {
          instanceSlot: slot,
          params: activateParams,
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
      return true;
    } catch (error) {
      llmManagerDialog.errorMessage = error instanceof Error ? error.message : options.t("dialogs.llmManagerApplyFailed");
      options.addEvent("events.llmBindingFailed", "warn", {
        slot: options.t(workspaceLlmInstanceSlotLabelKeyMap[slot])
      });
      return false;
    } finally {
      llmManagerDialog.applyingSlot = null;
    }
  }

  async function submitSlotDrawer(): Promise<void> {
    if (!llmManagerDialog.drawerOpen || !llmManagerDialog.drawerSlot) {
      return;
    }

    const slot = llmManagerDialog.drawerSlot;
    const validationError = validateSlotParamsDraft(llmManagerDialog.slotParamsDraft);
    if (validationError) {
      llmManagerDialog.errorMessage = validationError;
      options.addEvent("events.llmSlotParamsFailed", "warn", {
        slot: options.t(workspaceLlmInstanceSlotLabelKeyMap[slot])
      });
      return;
    }

    const applied = await applyLlmSlotBinding(slot, llmManagerDialog.slotParamsDraft);
    if (applied) {
      options.addEvent("events.llmSlotParamsUpdated", "success", {
        slot: options.t(workspaceLlmInstanceSlotLabelKeyMap[slot])
      });
      return;
    }

    options.addEvent("events.llmSlotParamsFailed", "warn", {
      slot: options.t(workspaceLlmInstanceSlotLabelKeyMap[slot])
    });
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
    applySlotPresetParams,
    applyLlmSlotBinding,
    beginCreateLlmProfileDraft,
    beginEditLlmProfileDraft,
    cancelLlmProfileDraft,
    closeSlotDrawer,
    closeLlmManagerDialog,
    fetchLlmProfileModels,
    hasActiveSession,
    llmManagerDialog,
    openLlmManagerDialog,
    openSlotDrawer,
    patchLlmProfileDraft,
    patchSlotParams,
    profileDraftTitle,
    refreshLlmManagerDialog,
    refreshLlmRuntime,
    resetSlotParams,
    removeLlmProfile,
    runtimeBySlot,
    setLlmManagerPage,
    setLlmManagerPresetSelection,
    setLlmManagerProfileSelection,
    setLlmManagerScope,
    submitLlmProfileDraft,
    submitSlotDrawer,
    testLlmProfileModel
  };
}
