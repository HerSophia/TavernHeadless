import { computed } from "vue";

import type { WorkspacePresetEditorDocument } from "../../../../lib/workspace-api";

export type PresetManagerMode = "delete" | "duplicate" | "edit" | "update";
export type PresetManagerView = "entry" | "overview";
export type Translator = (key: string, vars?: Record<string, number | string>) => string;
export type PresetEntryRole = "assistant" | "system" | "user";

export type EntryPatch = {
  content?: string;
  forbidOverrides?: boolean;
  injectionDepth?: number | undefined;
  injectionOrder?: number | undefined;
  injectionPosition?: number;
  marker?: boolean;
  name?: string;
  role?: PresetEntryRole;
  systemPrompt?: boolean;
};

export type PresetManagerDialogProps = {
  activeEntryId: string;
  draftName: string;
  editorDraft: WorkspacePresetEditorDocument | null;
  errorMessage: string;
  loading: boolean;
  mode: PresetManagerMode;
  open: boolean;
  saving: boolean;
  sourceName: string;
  t: Translator;
  view: PresetManagerView;
};

export type PresetManagerDialogEmits = {
  addEntry: [];
  clearError: [];
  confirm: [];
  deleteEntry: [identifier: string];
  moveEntry: [payload: { delta: -1 | 1; identifier: string }];
  openEntry: [identifier: string];
  toggleEntryEnabled: [identifier: string];
  updateEntry: [payload: { identifier: string; patch: EntryPatch }];
  updateView: [view: PresetManagerView];
  "update:draftName": [value: string];
  "update:open": [value: boolean];
};

type PresetManagerDialogEmitFn = <EventKey extends keyof PresetManagerDialogEmits>(
  event: EventKey,
  ...args: PresetManagerDialogEmits[EventKey]
) => void;

export function usePresetManagerDialog(
  props: PresetManagerDialogProps,
  emit: PresetManagerDialogEmitFn
) {
  const isDeleteMode = computed(() => props.mode === "delete");
  const entries = computed(() => props.editorDraft?.entries ?? []);
  const activeEntry = computed(() => {
    return entries.value.find((entry) => entry.identifier === props.activeEntryId) ?? null;
  });

  const titleKey = computed(() => {
    if (props.mode === "delete") {
      return "dialogs.presetManagerDeleteTitle";
    }

    if (props.mode === "duplicate") {
      return "dialogs.presetManagerDuplicateTitle";
    }

    if (props.mode === "update") {
      return "dialogs.presetManagerUpdateTitle";
    }

    return "dialogs.presetManagerEditTitle";
  });

  const descriptionKey = computed(() => {
    if (props.mode === "delete") {
      return "dialogs.presetManagerDeleteDescription";
    }

    if (props.mode === "duplicate") {
      return "dialogs.presetManagerDuplicateDescription";
    }

    if (props.mode === "update") {
      return "dialogs.presetManagerUpdateDescription";
    }

    return "dialogs.presetManagerEditDescription";
  });

  const confirmKey = computed(() => {
    if (props.mode === "delete") {
      return "dialogs.presetManagerDeleteConfirm";
    }

    if (props.mode === "duplicate") {
      return "dialogs.presetManagerDuplicateConfirm";
    }

    if (props.mode === "update") {
      return "dialogs.presetManagerUpdateConfirm";
    }

    return "dialogs.presetManagerEditConfirm";
  });

  function handleNameInput(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    emit("clearError");
    emit("update:draftName", target.value);
  }

  function parseOptionalInteger(value: string): number | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function updateEntry(identifier: string, patch: EntryPatch): void {
    emit("clearError");
    emit("updateEntry", { identifier, patch });
  }

  function patchActiveEntry(patch: EntryPatch): void {
    const entry = activeEntry.value;
    if (!entry) {
      return;
    }
    updateEntry(entry.identifier, patch);
  }

  function addEntry(): void {
    emit("addEntry");
  }

  function openEntry(identifier: string): void {
    emit("openEntry", identifier);
  }

  function openOverview(): void {
    emit("updateView", "overview");
  }

  function toggleEntryEnabled(identifier: string): void {
    emit("toggleEntryEnabled", identifier);
  }

  function toggleActiveEntryEnabled(): void {
    const entry = activeEntry.value;
    if (!entry) {
      return;
    }
    emit("toggleEntryEnabled", entry.identifier);
  }

  function moveEntry(identifier: string, delta: -1 | 1): void {
    emit("moveEntry", { delta, identifier });
  }

  function moveEntryUp(identifier: string): void {
    moveEntry(identifier, -1);
  }

  function moveEntryDown(identifier: string): void {
    moveEntry(identifier, 1);
  }

  function deleteEntry(identifier: string): void {
    emit("deleteEntry", identifier);
  }

  function updateActiveEntryName(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    patchActiveEntry({ name: target.value });
  }

  function updateActiveEntryRole(nextRole: string): void {
    if (nextRole !== "assistant" && nextRole !== "system" && nextRole !== "user") {
      return;
    }

    patchActiveEntry({ role: nextRole });
  }

  function updateActiveEntrySystemPrompt(checked: boolean): void {
    patchActiveEntry({ systemPrompt: checked });
  }

  function updateActiveEntryMarker(checked: boolean): void {
    patchActiveEntry({ marker: checked });
  }

  function updateActiveEntryContent(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) {
      return;
    }
    patchActiveEntry({ content: target.value });
  }

  function updateActiveEntryInjectionPosition(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    patchActiveEntry({
      injectionPosition: Number.parseInt(target.value || "0", 10) || 0
    });
  }

  function updateActiveEntryInjectionDepth(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    patchActiveEntry({
      injectionDepth: parseOptionalInteger(target.value)
    });
  }

  function updateActiveEntryInjectionOrder(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    patchActiveEntry({
      injectionOrder: parseOptionalInteger(target.value)
    });
  }

  function updateActiveEntryForbidOverrides(checked: boolean): void {
    patchActiveEntry({ forbidOverrides: checked });
  }

  function confirm(): void {
    emit("confirm");
  }

  return {
    activeEntry,
    addEntry,
    confirm,
    confirmKey,
    deleteEntry,
    descriptionKey,
    entries,
    handleNameInput,
    isDeleteMode,
    moveEntryDown,
    moveEntryUp,
    openEntry,
    openOverview,
    titleKey,
    toggleActiveEntryEnabled,
    toggleEntryEnabled,
    updateActiveEntryContent,
    updateActiveEntryForbidOverrides,
    updateActiveEntryInjectionDepth,
    updateActiveEntryInjectionOrder,
    updateActiveEntryInjectionPosition,
    updateActiveEntryMarker,
    updateActiveEntryName,
    updateActiveEntryRole,
    updateActiveEntrySystemPrompt
  };
}
