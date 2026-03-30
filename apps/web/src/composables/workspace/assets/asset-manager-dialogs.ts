import { reactive } from "vue";

import type {
  WorkspaceCharacterAssetSnapshot,
  WorkspacePresetEditorDocument
} from "../../../lib/workspace-api";
import type {
  CharacterAssetDetailResult,
  CharacterAssetMutationResult,
  PresetAssetDeleteResult,
  PresetAssetDetailResult,
  PresetAssetMutationResult,
  PresetAssetSaveMode,
  WorldbookAssetDetailResult,
  WorldbookAssetMutationResult,
  WorldbookAssetSaveMode
} from "../../../stores/workspace";
import type { EventTone } from "../../../stores/workspace-ui";

type AddEvent = (key: string, tone?: EventTone, vars?: Record<string, number | string>) => void;

type WorkspaceAssetManagerStore = {
  deleteCharacterLibraryAsset: (assetId: string) => Promise<CharacterAssetMutationResult>;
  deletePresetLibraryAsset: (assetId: string, expectedVersion: number | undefined) => Promise<PresetAssetDeleteResult>;
  deleteWorldbookLibraryAsset: (assetId: string, expectedVersion: number | undefined) => Promise<WorldbookAssetMutationResult>;
  loadCharacterAssetDetail: (assetId: string) => Promise<CharacterAssetDetailResult>;
  loadPresetAssetDetail: (assetId: string) => Promise<PresetAssetDetailResult>;
  loadWorldbookAssetDetail: (assetId: string) => Promise<WorldbookAssetDetailResult>;
  restoreCharacterLibraryAsset: (assetId: string) => Promise<CharacterAssetMutationResult>;
  saveCharacterAsset: (assetId: string, snapshot: WorkspaceCharacterAssetSnapshot) => Promise<CharacterAssetMutationResult>;
  savePresetAsset: (
    assetId: string,
    name: string,
    editor: WorkspacePresetEditorDocument,
    expectedVersion: number | undefined,
    mode: PresetAssetSaveMode
  ) => Promise<PresetAssetMutationResult>;
  saveWorldbookAsset: (
    assetId: string,
    name: string,
    data: Record<string, unknown>,
    expectedVersion: number | undefined,
    mode: WorldbookAssetSaveMode
  ) => Promise<WorldbookAssetMutationResult>;
};

export type PresetManagerMode = "delete" | "duplicate" | "edit" | "update";

type PresetEntryDraft = WorkspacePresetEditorDocument["entries"][number];

export type PresetEntryPatch = Partial<Pick<PresetEntryDraft, "content" | "forbidOverrides" | "injectionDepth" | "injectionOrder" | "injectionPosition" | "marker" | "name" | "role" | "systemPrompt">>;

export type CharacterManagerMode = "delete" | "edit" | "restore" | "update";

export type WorldbookManagerMode = "delete" | "duplicate" | "edit" | "update";

type UseWorkspaceAssetManagerDialogsOptions = {
  addEvent: AddEvent;
  t: (key: string, vars?: Record<string, number | string>) => string;
  workspace: WorkspaceAssetManagerStore;
};

export function useWorkspaceAssetManagerDialogs(options: UseWorkspaceAssetManagerDialogsOptions) {
  const presetManagerDialog = reactive({
    assetId: "",
    draftName: "",
    activeEntryId: "",
    editorDraft: null as WorkspacePresetEditorDocument | null,
    errorMessage: "",
    expectedVersion: 0,
    loading: false,
    mode: "edit" as PresetManagerMode,
    open: false,
    saving: false,
    sourceName: "",
    view: "overview" as "entry" | "overview"
  });

  const characterManagerDialog = reactive({
    assetId: "",
    draftDescription: "",
    draftFirstMessage: "",
    draftName: "",
    draftPersonality: "",
    draftScenario: "",
    errorMessage: "",
    latestVersionNo: null as number | null,
    loading: false,
    mode: "edit" as CharacterManagerMode,
    open: false,
    saving: false,
    snapshotBase: {} as Record<string, unknown>,
    sourceName: "",
    status: "active" as "active" | "deleted" | string
  });

  const worldbookManagerDialog = reactive({
    assetId: "",
    draftJson: "",
    draftName: "",
    errorMessage: "",
    expectedVersion: 0,
    loading: false,
    mode: "edit" as WorldbookManagerMode,
    open: false,
    saving: false,
    sourceName: ""
  });

  function resetPresetManagerDialog(): void {
    presetManagerDialog.assetId = "";
    presetManagerDialog.draftName = "";
    presetManagerDialog.activeEntryId = "";
    presetManagerDialog.editorDraft = null;
    presetManagerDialog.errorMessage = "";
    presetManagerDialog.expectedVersion = 0;
    presetManagerDialog.loading = false;
    presetManagerDialog.mode = "edit";
    presetManagerDialog.open = false;
    presetManagerDialog.saving = false;
    presetManagerDialog.sourceName = "";
    presetManagerDialog.view = "overview";
  }

  function resetCharacterManagerDialog(): void {
    characterManagerDialog.assetId = "";
    characterManagerDialog.draftDescription = "";
    characterManagerDialog.draftFirstMessage = "";
    characterManagerDialog.draftName = "";
    characterManagerDialog.draftPersonality = "";
    characterManagerDialog.draftScenario = "";
    characterManagerDialog.errorMessage = "";
    characterManagerDialog.latestVersionNo = null;
    characterManagerDialog.loading = false;
    characterManagerDialog.mode = "edit";
    characterManagerDialog.open = false;
    characterManagerDialog.saving = false;
    characterManagerDialog.snapshotBase = {};
    characterManagerDialog.sourceName = "";
    characterManagerDialog.status = "active";
  }

  function resetWorldbookManagerDialog(): void {
    worldbookManagerDialog.assetId = "";
    worldbookManagerDialog.draftJson = "";
    worldbookManagerDialog.draftName = "";
    worldbookManagerDialog.errorMessage = "";
    worldbookManagerDialog.expectedVersion = 0;
    worldbookManagerDialog.loading = false;
    worldbookManagerDialog.mode = "edit";
    worldbookManagerDialog.open = false;
    worldbookManagerDialog.saving = false;
    worldbookManagerDialog.sourceName = "";
  }

  function clearPresetManagerError(): void {
    presetManagerDialog.errorMessage = "";
  }

  function clearCharacterManagerError(): void {
    characterManagerDialog.errorMessage = "";
  }

  function clearWorldbookManagerError(): void {
    worldbookManagerDialog.errorMessage = "";
  }

  function handlePresetManagerFailure(reason: PresetAssetDeleteResult["reason"] | PresetAssetMutationResult["reason"] | undefined): void {
    if (reason === "preset_conflict") {
      presetManagerDialog.errorMessage = options.t("dialogs.presetManagerConflict");
      options.addEvent("events.assetPresetConflict", "warn");
      return;
    }

    if (reason === "resource_busy") {
      presetManagerDialog.errorMessage = options.t("dialogs.presetManagerBusy");
      options.addEvent("events.assetResourceBusy", "warn");
      return;
    }

    options.addEvent("events.assetManageFailed", "warn");
  }

  function handleWorldbookManagerFailure(reason: WorldbookAssetMutationResult["reason"] | undefined): void {
    if (reason === "worldbook_conflict") {
      worldbookManagerDialog.errorMessage = options.t("dialogs.worldbookManagerConflict");
      options.addEvent("events.assetWorldbookConflict", "warn");
      return;
    }

    if (reason === "resource_busy") {
      worldbookManagerDialog.errorMessage = options.t("dialogs.worldbookManagerBusy");
      options.addEvent("events.assetResourceBusy", "warn");
      return;
    }

    options.addEvent("events.assetManageFailed", "warn");
  }

  function buildPresetDuplicateName(name: string): string {
    const base = name.trim() || "Preset";
    return `${base} Copy`;
  }

  function clonePresetEditorDraft(editor: WorkspacePresetEditorDocument): WorkspacePresetEditorDocument {
    return {
      defaultCharacterId: editor.defaultCharacterId,
      entries: editor.entries.map((entry) => ({
        identifier: entry.identifier,
        name: entry.name,
        role: entry.role,
        content: entry.content,
        systemPrompt: entry.systemPrompt,
        marker: entry.marker,
        injectionPosition: entry.injectionPosition,
        injectionDepth: entry.injectionDepth,
        injectionOrder: entry.injectionOrder,
        forbidOverrides: entry.forbidOverrides,
        injectionTrigger: entry.injectionTrigger ? [...entry.injectionTrigger] : undefined,
        enabled: entry.enabled,
        extra: { ...entry.extra }
      })),
      format: editor.format,
      orderContexts: editor.orderContexts.map((context) => ({
        characterId: context.characterId,
        order: context.order.map((item) => ({ identifier: item.identifier, enabled: item.enabled })),
        extra: { ...context.extra }
      })),
      topLevel: { ...editor.topLevel }
    };
  }

  function syncPresetEditorOrderContexts(): void {
    const editor = presetManagerDialog.editorDraft;
    if (!editor) {
      return;
    }

    const identifiers = editor.entries.map((entry) => entry.identifier);
    const identifierSet = new Set(identifiers);

    editor.orderContexts.forEach((context) => {
      const seen = new Set<string>();
      const nextOrder = context.order.filter((item) => {
        if (!identifierSet.has(item.identifier) || seen.has(item.identifier)) {
          return false;
        }
        seen.add(item.identifier);
        return true;
      });

      identifiers.forEach((identifier) => {
        if (!seen.has(identifier)) {
          nextOrder.push({ identifier, enabled: true });
        }
      });

      context.order = nextOrder;
    });

    let defaultContext = editor.orderContexts.find((context) => context.characterId === editor.defaultCharacterId);
    if (!defaultContext) {
      defaultContext = {
        characterId: editor.defaultCharacterId,
        order: [],
        extra: {}
      };
      editor.orderContexts.push(defaultContext);
    }

    defaultContext.order = editor.entries.map((entry) => ({
      identifier: entry.identifier,
      enabled: entry.enabled
    }));
  }

  function setPresetManagerView(view: "entry" | "overview"): void {
    presetManagerDialog.view = view;
  }

  function openPresetManagerEntry(identifier: string): void {
    presetManagerDialog.activeEntryId = identifier;
    presetManagerDialog.view = "entry";
  }

  function createPresetEntryIdentifier(): string {
    const existing = new Set((presetManagerDialog.editorDraft?.entries ?? []).map((entry) => entry.identifier));
    let index = existing.size + 1;
    while (existing.has(`entry_${index}`)) {
      index += 1;
    }
    return `entry_${index}`;
  }

  function addPresetManagerEntry(): void {
    const editor = presetManagerDialog.editorDraft;
    if (!editor) {
      return;
    }

    const identifier = createPresetEntryIdentifier();
    editor.entries.push({
      identifier,
      name: `Entry ${editor.entries.length + 1}`,
      role: "system",
      content: "",
      systemPrompt: false,
      marker: false,
      injectionPosition: 0,
      enabled: true,
      extra: {}
    });
    syncPresetEditorOrderContexts();
    openPresetManagerEntry(identifier);
  }

  function togglePresetManagerEntryEnabled(identifier: string): void {
    const editor = presetManagerDialog.editorDraft;
    const entry = editor?.entries.find((item) => item.identifier === identifier);
    if (!editor || !entry) {
      return;
    }
    entry.enabled = !entry.enabled;
    syncPresetEditorOrderContexts();
  }

  function movePresetManagerEntry(payload: { delta: -1 | 1; identifier: string }): void {
    const editor = presetManagerDialog.editorDraft;
    if (!editor) {
      return;
    }

    const index = editor.entries.findIndex((entry) => entry.identifier === payload.identifier);
    if (index < 0) {
      return;
    }

    const nextIndex = index + payload.delta;
    if (nextIndex < 0 || nextIndex >= editor.entries.length) {
      return;
    }

    const [target] = editor.entries.splice(index, 1);
    editor.entries.splice(nextIndex, 0, target!);
    syncPresetEditorOrderContexts();
  }

  function deletePresetManagerEntry(identifier: string): void {
    const editor = presetManagerDialog.editorDraft;
    if (!editor) {
      return;
    }

    editor.entries = editor.entries.filter((entry) => entry.identifier !== identifier);
    syncPresetEditorOrderContexts();

    if (presetManagerDialog.activeEntryId === identifier) {
      presetManagerDialog.activeEntryId = editor.entries[0]?.identifier ?? "";
      presetManagerDialog.view = editor.entries.length > 0 ? "entry" : "overview";
    }
  }

  function updatePresetManagerEntry(payload: { identifier: string; patch: PresetEntryPatch }): void {
    const editor = presetManagerDialog.editorDraft;
    const entry = editor?.entries.find((item) => item.identifier === payload.identifier);
    if (!editor || !entry) {
      return;
    }

    Object.assign(entry, payload.patch);
    syncPresetEditorOrderContexts();
  }

  async function openPresetManagerDialog(mode: PresetManagerMode, assetId: string): Promise<void> {
    resetPresetManagerDialog();
    resetCharacterManagerDialog();
    resetWorldbookManagerDialog();
    presetManagerDialog.assetId = assetId;
    presetManagerDialog.mode = mode;
    presetManagerDialog.open = true;
    presetManagerDialog.loading = true;

    const detailResult = await options.workspace.loadPresetAssetDetail(assetId);
    if (!detailResult.ok || !detailResult.detail) {
      resetPresetManagerDialog();

      if (detailResult.reason === "missing") {
        options.addEvent("events.assetMissing", "warn");
        return;
      }

      if (detailResult.reason === "unsupported") {
        options.addEvent("events.assetManagePresetOnly", "warn");
        return;
      }

      options.addEvent("events.assetManageFailed", "warn");
      return;
    }

    const detail = detailResult.detail;
    presetManagerDialog.assetId = detail.id;
    presetManagerDialog.sourceName = detail.name;
    presetManagerDialog.expectedVersion = detail.version;
    presetManagerDialog.draftName = mode === "duplicate" ? buildPresetDuplicateName(detail.name) : detail.name;
    presetManagerDialog.editorDraft = clonePresetEditorDraft(detail.editor);
    presetManagerDialog.activeEntryId = detail.editor.entries[0]?.identifier ?? "";
    presetManagerDialog.view = "overview";
    presetManagerDialog.loading = false;
  }

  async function openCharacterManagerDialog(mode: CharacterManagerMode, assetId: string): Promise<void> {
    resetCharacterManagerDialog();
    resetPresetManagerDialog();
    resetWorldbookManagerDialog();
    characterManagerDialog.assetId = assetId;
    characterManagerDialog.mode = mode;
    characterManagerDialog.open = true;
    characterManagerDialog.loading = true;

    const detailResult = await options.workspace.loadCharacterAssetDetail(assetId);
    if (!detailResult.ok || !detailResult.detail) {
      resetCharacterManagerDialog();

      if (detailResult.reason === "missing") {
        options.addEvent("events.assetMissing", "warn");
        return;
      }

      if (detailResult.reason === "unsupported") {
        options.addEvent("events.assetManagePresetCharacterOnly", "warn");
        return;
      }

      options.addEvent("events.assetManageFailed", "warn");
      return;
    }

    const detail = detailResult.detail;
    const snapshot = detail.snapshot;
    characterManagerDialog.assetId = detail.id;
    characterManagerDialog.sourceName = detail.name;
    characterManagerDialog.status = detail.status;
    characterManagerDialog.latestVersionNo = detail.latestVersionNo;
    characterManagerDialog.draftName = snapshot.name;
    characterManagerDialog.draftDescription = typeof snapshot.description === "string" ? snapshot.description : "";
    characterManagerDialog.draftPersonality = typeof snapshot.personality === "string" ? snapshot.personality : "";
    characterManagerDialog.draftFirstMessage = typeof snapshot.first_mes === "string" ? snapshot.first_mes : "";
    characterManagerDialog.draftScenario = typeof snapshot.scenario === "string" ? snapshot.scenario : "";
    characterManagerDialog.snapshotBase = { ...snapshot };

    if (detail.status === "deleted") {
      characterManagerDialog.mode = "restore";
    }

    characterManagerDialog.loading = false;
  }

  async function openWorldbookManagerDialog(mode: WorldbookManagerMode, assetId: string): Promise<void> {
    resetWorldbookManagerDialog();
    resetPresetManagerDialog();
    resetCharacterManagerDialog();
    worldbookManagerDialog.assetId = assetId;
    worldbookManagerDialog.mode = mode;
    worldbookManagerDialog.open = true;
    worldbookManagerDialog.loading = true;

    const detailResult = await options.workspace.loadWorldbookAssetDetail(assetId);
    if (!detailResult.ok || !detailResult.detail) {
      resetWorldbookManagerDialog();

      if (detailResult.reason === "missing") {
        options.addEvent("events.assetMissing", "warn");
        return;
      }

      if (detailResult.reason === "unsupported") {
        options.addEvent("events.assetManageWorldbookOnly", "warn");
        return;
      }

      options.addEvent("events.assetManageFailed", "warn");
      return;
    }

    const detail = detailResult.detail;
    worldbookManagerDialog.assetId = detail.id;
    worldbookManagerDialog.sourceName = detail.name;
    worldbookManagerDialog.expectedVersion = detail.version;
    worldbookManagerDialog.draftName = mode === "duplicate" ? buildPresetDuplicateName(detail.name) : detail.name;
    worldbookManagerDialog.draftJson = JSON.stringify(detail.data, null, 2);
    worldbookManagerDialog.loading = false;
  }

  function buildCharacterSnapshotPayload(name: string): WorkspaceCharacterAssetSnapshot {
    const payload: WorkspaceCharacterAssetSnapshot = {
      ...characterManagerDialog.snapshotBase,
      name,
      description: characterManagerDialog.draftDescription,
      first_mes: characterManagerDialog.draftFirstMessage,
      personality: characterManagerDialog.draftPersonality,
      scenario: characterManagerDialog.draftScenario
    };
    return payload;
  }

  async function confirmPresetManagerAction(): Promise<void> {
    if (!presetManagerDialog.open || presetManagerDialog.loading || presetManagerDialog.saving) {
      return;
    }

    const assetId = presetManagerDialog.assetId;
    if (!assetId) {
      options.addEvent("events.assetMissing", "warn");
      return;
    }

    presetManagerDialog.errorMessage = "";
    presetManagerDialog.saving = true;

    try {
      if (presetManagerDialog.mode === "delete") {
        const result = await options.workspace.deletePresetLibraryAsset(assetId, presetManagerDialog.expectedVersion);
        if (!result.ok) {
          handlePresetManagerFailure(result.reason);
          return;
        }

        if (result.apiSyncFailed) {
          options.addEvent("events.librarySyncFailed", "warn");
        }

        options.addEvent("events.assetDeleted", "warn", {
          asset: presetManagerDialog.sourceName
        });
        resetPresetManagerDialog();
        return;
      }

      const name = presetManagerDialog.draftName.trim();
      if (!name) {
        presetManagerDialog.errorMessage = options.t("dialogs.presetManagerErrorName");
        return;
      }

      const editor = presetManagerDialog.editorDraft;
      if (!editor) {
        presetManagerDialog.errorMessage = options.t("dialogs.presetManagerEntryMissing");
        return;
      }

      const saveMode = presetManagerDialog.mode === "duplicate" ? "duplicate" : "update";
      const result = await options.workspace.savePresetAsset(
        assetId,
        name,
        editor,
        presetManagerDialog.mode === "duplicate" ? undefined : presetManagerDialog.expectedVersion,
        saveMode
      );

      if (!result.ok) {
        handlePresetManagerFailure(result.reason);
        return;
      }

      if (result.apiSyncFailed) {
        options.addEvent("events.librarySyncFailed", "warn");
      }

      if (result.deleteSyncFailed) {
        options.addEvent("events.assetOverwriteDeleteSyncFailed", "warn", {
          asset: presetManagerDialog.sourceName
        });
      }

      if (presetManagerDialog.mode === "duplicate") {
        options.addEvent("events.assetDuplicated", "success", {
          asset: name
        });
      } else if (presetManagerDialog.mode === "update") {
        options.addEvent("events.assetOverwritten", "success", {
          asset: name
        });
      } else {
        options.addEvent("events.assetEdited", "success", {
          asset: name
        });
      }

      resetPresetManagerDialog();
    } finally {
      presetManagerDialog.saving = false;
    }
  }

  async function confirmCharacterManagerAction(): Promise<void> {
    if (!characterManagerDialog.open || characterManagerDialog.loading || characterManagerDialog.saving) {
      return;
    }

    const assetId = characterManagerDialog.assetId;
    if (!assetId) {
      options.addEvent("events.assetMissing", "warn");
      return;
    }

    characterManagerDialog.errorMessage = "";
    characterManagerDialog.saving = true;

    try {
      if (characterManagerDialog.mode === "delete") {
        const result = await options.workspace.deleteCharacterLibraryAsset(assetId);
        if (!result.ok) {
          options.addEvent("events.assetManageFailed", "warn");
          return;
        }
        if (result.apiSyncFailed) {
          options.addEvent("events.librarySyncFailed", "warn");
        }
        options.addEvent("events.characterDeleted", "warn", { asset: characterManagerDialog.sourceName });
        characterManagerDialog.status = "deleted";
        characterManagerDialog.mode = "restore";
        return;
      }

      if (characterManagerDialog.mode === "restore") {
        const result = await options.workspace.restoreCharacterLibraryAsset(assetId);
        if (!result.ok) {
          options.addEvent("events.assetManageFailed", "warn");
          return;
        }
        if (result.apiSyncFailed) {
          options.addEvent("events.librarySyncFailed", "warn");
        }
        options.addEvent("events.characterRestored", "success", { asset: result.asset?.name ?? characterManagerDialog.sourceName });
        resetCharacterManagerDialog();
        return;
      }

      const name = characterManagerDialog.draftName.trim();
      if (!name) {
        characterManagerDialog.errorMessage = options.t("dialogs.characterManagerErrorName");
        return;
      }

      const result = await options.workspace.saveCharacterAsset(assetId, buildCharacterSnapshotPayload(name));
      if (!result.ok) {
        options.addEvent("events.assetManageFailed", "warn");
        return;
      }

      if (result.apiSyncFailed) {
        options.addEvent("events.librarySyncFailed", "warn");
      }

      options.addEvent("events.characterUpdated", "success", {
        asset: result.asset?.name ?? name,
        version: (characterManagerDialog.latestVersionNo ?? 0) + 1
      });
      resetCharacterManagerDialog();
    } finally {
      characterManagerDialog.saving = false;
    }
  }

  async function confirmWorldbookManagerAction(): Promise<void> {
    if (!worldbookManagerDialog.open || worldbookManagerDialog.loading || worldbookManagerDialog.saving) {
      return;
    }

    const assetId = worldbookManagerDialog.assetId;
    if (!assetId) {
      options.addEvent("events.assetMissing", "warn");
      return;
    }

    worldbookManagerDialog.errorMessage = "";
    worldbookManagerDialog.saving = true;

    try {
      if (worldbookManagerDialog.mode === "delete") {
        const result = await options.workspace.deleteWorldbookLibraryAsset(assetId, worldbookManagerDialog.expectedVersion);
        if (!result.ok) {
          handleWorldbookManagerFailure(result.reason);
          return;
        }
        if (result.apiSyncFailed) {
          options.addEvent("events.librarySyncFailed", "warn");
        }
        options.addEvent("events.worldbookDeleted", "warn", { asset: worldbookManagerDialog.sourceName });
        resetWorldbookManagerDialog();
        return;
      }

      const name = worldbookManagerDialog.draftName.trim();
      if (!name) {
        worldbookManagerDialog.errorMessage = options.t("dialogs.worldbookManagerErrorName");
        return;
      }

      let data: Record<string, unknown>;
      try {
        const parsed = JSON.parse(worldbookManagerDialog.draftJson);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          worldbookManagerDialog.errorMessage = options.t("dialogs.worldbookManagerErrorJsonObject");
          return;
        }
        data = parsed as Record<string, unknown>;
      } catch {
        worldbookManagerDialog.errorMessage = options.t("dialogs.worldbookManagerErrorJson");
        return;
      }

      const mode = worldbookManagerDialog.mode === "duplicate" ? "duplicate" : "update";
      const result = await options.workspace.saveWorldbookAsset(
        assetId,
        name,
        data,
        mode === "duplicate" ? undefined : worldbookManagerDialog.expectedVersion,
        mode
      );

      if (!result.ok) {
        handleWorldbookManagerFailure(result.reason);
        return;
      }

      if (result.apiSyncFailed) {
        options.addEvent("events.librarySyncFailed", "warn");
      }

      options.addEvent(mode === "duplicate" ? "events.worldbookDuplicated" : "events.worldbookUpdated", "success", { asset: name });
      resetWorldbookManagerDialog();
    } finally {
      worldbookManagerDialog.saving = false;
    }
  }

  function requestCharacterDelete(): void {
    characterManagerDialog.mode = "delete";
  }

  function requestCharacterRestore(): void {
    characterManagerDialog.mode = "restore";
  }

  return {
    addPresetManagerEntry,
    characterManagerDialog,
    clearCharacterManagerError,
    clearPresetManagerError,
    clearWorldbookManagerError,
    confirmCharacterManagerAction,
    confirmPresetManagerAction,
    confirmWorldbookManagerAction,
    deletePresetManagerEntry,
    movePresetManagerEntry,
    openCharacterManagerDialog,
    openPresetManagerDialog,
    openPresetManagerEntry,
    openWorldbookManagerDialog,
    presetManagerDialog,
    requestCharacterDelete,
    requestCharacterRestore,
    resetCharacterManagerDialog,
    resetPresetManagerDialog,
    resetWorldbookManagerDialog,
    setPresetManagerView,
    togglePresetManagerEntryEnabled,
    updatePresetManagerEntry,
    worldbookManagerDialog
  };
}
