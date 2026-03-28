import { reactive, watch, type Ref } from "vue";

import {
  createToolDefinition,
  deleteToolDefinition,
  fetchSessionRuntimeToolCatalog,
  fetchSessionToolPermissions,
  fetchToolDefinition,
  fetchToolDefinitions,
  fetchToolExecutions,
  putSessionToolPermissions,
  toggleToolDefinition,
  updateToolDefinition,
  type WorkspaceRuntimeToolCatalog,
  type WorkspaceSessionToolPermissions,
  type WorkspaceToolDefinition,
  type WorkspaceToolDefinitionSource,
  type WorkspaceToolExecutionRecord,
  type WorkspaceToolHandlerType,
  type WorkspaceToolSideEffectLevel
} from "../../../lib/workspace-api";
import type { EventTone } from "../../../stores/workspace-ui";

type AddEvent = (key: string, tone?: EventTone, vars?: Record<string, number | string>) => void;

type ToolPermissionToggleMode = "inherit" | "true" | "false";

type UseWorkspaceToolManagerDialogOptions = {
  activeSessionId: Ref<string | null>;
  addEvent: AddEvent;
  currentAccount: Ref<string>;
  t: (key: string, vars?: Record<string, number | string>) => string;
};

export type ToolPermissionsDraft = {
  allowIrreversibleMode: ToolPermissionToggleMode;
  enabledMode: ToolPermissionToggleMode;
  maxCallsPerTurn: string;
  maxStepsPerGeneration: string;
  slotAllowListJson: string;
  slotDenyListJson: string;
};

export type ToolDefinitionDraft = {
  allowedSlots: string[];
  description: string;
  enabled: boolean;
  handlerJson: string;
  handlerType: WorkspaceToolHandlerType;
  id: string;
  mode: "create" | "edit";
  name: string;
  parametersJson: string;
  sideEffectLevel: WorkspaceToolSideEffectLevel;
  source: WorkspaceToolDefinitionSource;
  sourceId: string;
};

export type WorkspaceToolManagerDialogState = {
  definitionDeletingId: string | null;
  definitionDraft: ToolDefinitionDraft;
  definitionSaving: boolean;
  definitionTogglingId: string | null;
  definitions: WorkspaceToolDefinition[];
  errorMessage: string;
  executions: WorkspaceToolExecutionRecord[];
  loading: boolean;
  open: boolean;
  permissionsDraft: ToolPermissionsDraft;
  permissionsLoaded: boolean;
  permissionsSaving: boolean;
  runtimeCatalog: WorkspaceRuntimeToolCatalog | null;
  selectedDefinitionId: string;
};

export const workspaceToolManagerSlots = ["narrator", "director", "verifier", "memory"] as const;
export const workspaceToolHandlerTypes: WorkspaceToolHandlerType[] = ["script", "prompt", "delegate"];
export const workspaceToolSideEffectLevels: WorkspaceToolSideEffectLevel[] = ["none", "sandbox", "irreversible"];
export const workspaceToolSources: WorkspaceToolDefinitionSource[] = ["custom", "preset", "character"];

type ToolDefinitionSavePayload = {
  allowedSlots: string[];
  description: string;
  enabled: boolean;
  handler: Record<string, unknown>;
  handlerType: WorkspaceToolHandlerType;
  name: string;
  parameters: Record<string, unknown>;
  sideEffectLevel: WorkspaceToolSideEffectLevel;
  source: WorkspaceToolDefinitionSource;
  sourceId: string;
};

function serializeJson(value: unknown, fallback = "{}"): string {
  if (value === undefined) {
    return fallback;
  }

  return JSON.stringify(value, null, 2);
}

function toToggleMode(value: boolean | undefined): ToolPermissionToggleMode {
  if (value === true) {
    return "true";
  }

  if (value === false) {
    return "false";
  }

  return "inherit";
}

function fromToggleMode(value: ToolPermissionToggleMode): boolean | undefined {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
}

function createToolPermissionsDraft(permissions?: WorkspaceSessionToolPermissions): ToolPermissionsDraft {
  return {
    allowIrreversibleMode: toToggleMode(permissions?.allowIrreversible),
    enabledMode: toToggleMode(permissions?.enabled),
    maxCallsPerTurn: permissions?.maxCallsPerTurn !== undefined ? String(permissions.maxCallsPerTurn) : "",
    maxStepsPerGeneration: permissions?.maxStepsPerGeneration !== undefined ? String(permissions.maxStepsPerGeneration) : "",
    slotAllowListJson: serializeJson(permissions?.slotAllowList, ""),
    slotDenyListJson: serializeJson(permissions?.slotDenyList, "")
  };
}

function createToolDefinitionDraft(
  mode: "create" | "edit" = "create",
  definition?: WorkspaceToolDefinition
): ToolDefinitionDraft {
  if (mode === "edit" && definition) {
    return {
      allowedSlots: [...definition.allowedSlots],
      description: definition.description,
      enabled: definition.enabled,
      handlerJson: serializeJson(definition.handler),
      handlerType: definition.handlerType,
      id: definition.id,
      mode,
      name: definition.name,
      parametersJson: serializeJson(definition.parameters),
      sideEffectLevel: definition.sideEffectLevel,
      source: definition.source,
      sourceId: definition.sourceId ?? ""
    };
  }

  return {
    allowedSlots: ["narrator"],
    description: "",
    enabled: true,
    handlerJson: JSON.stringify({ script: "return args;" }, null, 2),
    handlerType: "script",
    id: "",
    mode,
    name: "",
    parametersJson: "{}",
    sideEffectLevel: "none",
    source: "custom",
    sourceId: ""
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseJsonRecordText(
  raw: string,
  errorMessage: string,
  options: { allowBlank?: boolean; blankFallback?: Record<string, unknown> } = {}
): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) {
    if (options.allowBlank) {
      return options.blankFallback ?? {};
    }

    throw new Error(errorMessage);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(errorMessage);
  }

  const record = asRecord(parsed);
  if (!record) {
    throw new Error(errorMessage);
  }

  return record;
}

function parseStringArrayRecordText(raw: string, errorMessage: string): Record<string, string[]> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const record = parseJsonRecordText(trimmed, errorMessage);
  const mapped: Record<string, string[]> = {};

  for (const [key, value] of Object.entries(record)) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error(errorMessage);
    }

    mapped[key] = value.map((item) => item.trim()).filter((item) => item.length > 0);
  }

  return mapped;
}

function parseOptionalPositiveInteger(raw: string, errorMessage: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(errorMessage);
  }

  return parsed;
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

export function useWorkspaceToolManagerDialog(options: UseWorkspaceToolManagerDialogOptions) {
  const toolManagerDialog = reactive<WorkspaceToolManagerDialogState>({
    definitionDeletingId: null,
    definitionDraft: createToolDefinitionDraft(),
    definitionSaving: false,
    definitionTogglingId: null,
    definitions: [],
    errorMessage: "",
    executions: [],
    loading: false,
    open: false,
    permissionsDraft: createToolPermissionsDraft(),
    permissionsLoaded: false,
    permissionsSaving: false,
    runtimeCatalog: null,
    selectedDefinitionId: ""
  });

  function clearToolManagerError(): void {
    toolManagerDialog.errorMessage = "";
  }

  function applyPermissionsDraft(permissions?: WorkspaceSessionToolPermissions): void {
    toolManagerDialog.permissionsDraft = createToolPermissionsDraft(permissions);
    toolManagerDialog.permissionsLoaded = Boolean(options.activeSessionId.value);
  }

  function beginCreateToolDefinitionDraft(): void {
    toolManagerDialog.selectedDefinitionId = "";
    toolManagerDialog.definitionDraft = createToolDefinitionDraft();
    clearToolManagerError();
  }

  async function refreshToolDefinitions(): Promise<void> {
    const result = await fetchToolDefinitions({
      accountId: options.currentAccount.value,
      limit: 100,
      sortBy: "updated_at",
      sortOrder: "desc"
    });

    toolManagerDialog.definitions = result.definitions;

    if (
      toolManagerDialog.selectedDefinitionId &&
      !result.definitions.some((definition) => definition.id === toolManagerDialog.selectedDefinitionId)
    ) {
      beginCreateToolDefinitionDraft();
    }
  }

  async function refreshSessionToolContext(): Promise<void> {
    const sessionId = options.activeSessionId.value;
    if (!sessionId) {
      toolManagerDialog.runtimeCatalog = null;
      toolManagerDialog.executions = [];
      toolManagerDialog.permissionsLoaded = false;
      toolManagerDialog.permissionsDraft = createToolPermissionsDraft();
      return;
    }

    const [permissions, runtimeCatalog, executions] = await Promise.all([
      fetchSessionToolPermissions(sessionId, options.currentAccount.value),
      fetchSessionRuntimeToolCatalog(sessionId, options.currentAccount.value),
      fetchToolExecutions({
        accountId: options.currentAccount.value,
        limit: 20,
        sessionId,
        sortBy: "started_at",
        sortOrder: "desc"
      })
    ]);

    applyPermissionsDraft(permissions);
    toolManagerDialog.runtimeCatalog = runtimeCatalog;
    toolManagerDialog.executions = executions.records;
  }

  async function refreshToolManagerDialog(): Promise<void> {
    toolManagerDialog.loading = true;
    clearToolManagerError();

    try {
      await Promise.all([
        refreshToolDefinitions(),
        refreshSessionToolContext()
      ]);
    } catch (error) {
      toolManagerDialog.errorMessage = resolveErrorMessage(error, options.t("dialogs.toolManagerLoadFailed"));
      options.addEvent("events.toolManagerLoadFailed", "warn");
    } finally {
      toolManagerDialog.loading = false;
    }
  }

  async function openToolManagerDialog(): Promise<void> {
    toolManagerDialog.open = true;
    await refreshToolManagerDialog();
  }

  function closeToolManagerDialog(): void {
    toolManagerDialog.open = false;
  }

  function resetToolManagerDialog(): void {
    toolManagerDialog.definitionDeletingId = null;
    toolManagerDialog.definitionDraft = createToolDefinitionDraft();
    toolManagerDialog.definitionSaving = false;
    toolManagerDialog.definitionTogglingId = null;
    toolManagerDialog.definitions = [];
    toolManagerDialog.errorMessage = "";
    toolManagerDialog.executions = [];
    toolManagerDialog.loading = false;
    toolManagerDialog.open = false;
    toolManagerDialog.permissionsDraft = createToolPermissionsDraft();
    toolManagerDialog.permissionsLoaded = false;
    toolManagerDialog.permissionsSaving = false;
    toolManagerDialog.runtimeCatalog = null;
    toolManagerDialog.selectedDefinitionId = "";
  }

  async function selectToolDefinition(definitionId: string): Promise<void> {
    toolManagerDialog.selectedDefinitionId = definitionId;
    clearToolManagerError();

    try {
      const definition = await fetchToolDefinition(definitionId, options.currentAccount.value);
      toolManagerDialog.definitionDraft = createToolDefinitionDraft("edit", definition);
    } catch (error) {
      toolManagerDialog.errorMessage = resolveErrorMessage(error, options.t("dialogs.toolManagerLoadFailed"));
    }
  }

  function buildPermissionsPayload(): WorkspaceSessionToolPermissions {
    const integerErrorMessage = options.t("dialogs.toolManagerValidationPositiveInteger");
    const slotMapErrorMessage = options.t("dialogs.toolManagerValidationStringArrayRecord");

    return {
      allowIrreversible: fromToggleMode(toolManagerDialog.permissionsDraft.allowIrreversibleMode),
      enabled: fromToggleMode(toolManagerDialog.permissionsDraft.enabledMode),
      maxCallsPerTurn: parseOptionalPositiveInteger(toolManagerDialog.permissionsDraft.maxCallsPerTurn, integerErrorMessage),
      maxStepsPerGeneration: parseOptionalPositiveInteger(toolManagerDialog.permissionsDraft.maxStepsPerGeneration, integerErrorMessage),
      slotAllowList: parseStringArrayRecordText(toolManagerDialog.permissionsDraft.slotAllowListJson, slotMapErrorMessage),
      slotDenyList: parseStringArrayRecordText(toolManagerDialog.permissionsDraft.slotDenyListJson, slotMapErrorMessage)
    };
  }

  async function saveSessionToolPermissions(): Promise<void> {
    const sessionId = options.activeSessionId.value;
    if (!sessionId) {
      toolManagerDialog.errorMessage = options.t("dialogs.toolManagerSessionRequired");
      return;
    }

    toolManagerDialog.permissionsSaving = true;
    clearToolManagerError();

    try {
      const saved = await putSessionToolPermissions(
        sessionId,
        buildPermissionsPayload(),
        options.currentAccount.value
      );
      applyPermissionsDraft(saved);
      options.addEvent("events.toolManagerPermissionsSaved", "success", { session: sessionId });
    } catch (error) {
      toolManagerDialog.errorMessage = resolveErrorMessage(error, options.t("dialogs.toolManagerLoadFailed"));
    } finally {
      toolManagerDialog.permissionsSaving = false;
    }
  }

  function buildDefinitionPayload(): ToolDefinitionSavePayload {
    const name = toolManagerDialog.definitionDraft.name.trim();
    if (!name) {
      throw new Error(options.t("dialogs.toolManagerDefinitionRequired"));
    }

    const jsonErrorMessage = options.t("dialogs.toolManagerValidationJsonObject");

    return {
      allowedSlots: [...new Set(toolManagerDialog.definitionDraft.allowedSlots.map((slot) => slot.trim()).filter((slot) => slot.length > 0))],
      description: toolManagerDialog.definitionDraft.description.trim(),
      enabled: toolManagerDialog.definitionDraft.enabled,
      handler: parseJsonRecordText(toolManagerDialog.definitionDraft.handlerJson, jsonErrorMessage, { allowBlank: true, blankFallback: {} }),
      handlerType: toolManagerDialog.definitionDraft.handlerType,
      name,
      parameters: parseJsonRecordText(toolManagerDialog.definitionDraft.parametersJson, jsonErrorMessage, { allowBlank: true, blankFallback: {} }),
      sideEffectLevel: toolManagerDialog.definitionDraft.sideEffectLevel,
      source: toolManagerDialog.definitionDraft.source,
      sourceId: toolManagerDialog.definitionDraft.sourceId.trim()
    };
  }

  async function saveToolDefinition(): Promise<void> {
    toolManagerDialog.definitionSaving = true;
    clearToolManagerError();

    try {
      const mode = toolManagerDialog.definitionDraft.mode;
      const payload = buildDefinitionPayload();
      const saved = mode === "create"
        ? await createToolDefinition({
            accountId: options.currentAccount.value,
            allowedSlots: payload.allowedSlots,
            description: payload.description,
            enabled: payload.enabled,
            handler: payload.handler,
            handlerType: payload.handlerType,
            name: payload.name,
            parameters: payload.parameters,
            sideEffectLevel: payload.sideEffectLevel,
            source: payload.source,
            sourceId: payload.sourceId || null
          })
        : await updateToolDefinition({
            accountId: options.currentAccount.value,
            allowedSlots: payload.allowedSlots,
            definitionId: toolManagerDialog.definitionDraft.id,
            description: payload.description,
            handler: payload.handler,
            handlerType: payload.handlerType,
            name: payload.name,
            parameters: payload.parameters,
            sideEffectLevel: payload.sideEffectLevel,
            source: payload.source,
            sourceId: payload.sourceId || null
          });

      await refreshToolDefinitions();
      await selectToolDefinition(saved.id);
      options.addEvent(
        mode === "create"
          ? "events.toolManagerDefinitionCreated"
          : "events.toolManagerDefinitionUpdated",
        "success",
        { tool: saved.name }
      );
    } catch (error) {
      toolManagerDialog.errorMessage = resolveErrorMessage(error, options.t("dialogs.toolManagerLoadFailed"));
    } finally {
      toolManagerDialog.definitionSaving = false;
    }
  }

  async function toggleToolDefinitionEnabled(definitionId: string, enabled: boolean): Promise<void> {
    toolManagerDialog.definitionTogglingId = definitionId;
    clearToolManagerError();

    try {
      const saved = await toggleToolDefinition(definitionId, enabled, options.currentAccount.value);
      toolManagerDialog.definitions = toolManagerDialog.definitions.map((definition) => {
        return definition.id === saved.id ? saved : definition;
      });

      if (toolManagerDialog.selectedDefinitionId === saved.id) {
        toolManagerDialog.definitionDraft.enabled = saved.enabled;
      }

      options.addEvent("events.toolManagerDefinitionToggled", "success", {
        state: saved.enabled ? options.t("dialogs.toolManagerDraftTrue") : options.t("dialogs.toolManagerDraftFalse"),
        tool: saved.name
      });
    } catch (error) {
      toolManagerDialog.errorMessage = resolveErrorMessage(error, options.t("dialogs.toolManagerLoadFailed"));
    } finally {
      toolManagerDialog.definitionTogglingId = null;
    }
  }

  async function deleteToolDefinitionById(definitionId: string): Promise<void> {
    toolManagerDialog.definitionDeletingId = definitionId;
    clearToolManagerError();

    try {
      const target = toolManagerDialog.definitions.find((definition) => definition.id === definitionId) ?? null;
      await deleteToolDefinition(definitionId, options.currentAccount.value);
      await refreshToolDefinitions();

      if (toolManagerDialog.selectedDefinitionId === definitionId) {
        beginCreateToolDefinitionDraft();
      }

      options.addEvent("events.toolManagerDefinitionDeleted", "warn", {
        tool: target?.name ?? definitionId
      });
    } catch (error) {
      toolManagerDialog.errorMessage = resolveErrorMessage(error, options.t("dialogs.toolManagerLoadFailed"));
    } finally {
      toolManagerDialog.definitionDeletingId = null;
    }
  }

  watch(
    () => options.activeSessionId.value,
    () => {
      if (!toolManagerDialog.open) {
        return;
      }

      void refreshSessionToolContext().catch((error: unknown) => {
        toolManagerDialog.errorMessage = resolveErrorMessage(error, options.t("dialogs.toolManagerLoadFailed"));
      });
    }
  );

  return {
    beginCreateToolDefinitionDraft,
    clearToolManagerError,
    closeToolManagerDialog,
    deleteToolDefinitionById,
    openToolManagerDialog,
    refreshToolManagerDialog,
    resetToolManagerDialog,
    saveSessionToolPermissions,
    saveToolDefinition,
    selectToolDefinition,
    toggleToolDefinitionEnabled,
    toolManagerDialog
  };
}
