import { computed } from "vue";

export type CharacterManagerMode = "delete" | "edit" | "restore" | "update";
export type Translator = (key: string, vars?: Record<string, number | string>) => string;

export type CharacterManagerDialogProps = {
  draftDescription: string;
  draftFirstMessage: string;
  draftName: string;
  draftPersonality: string;
  draftScenario: string;
  errorMessage: string;
  latestVersionNo: number | null;
  loading: boolean;
  mode: CharacterManagerMode;
  open: boolean;
  saving: boolean;
  sourceName: string;
  status: "active" | "deleted" | string;
  t: Translator;
};

export type CharacterManagerDialogEmits = {
  clearError: [];
  confirm: [];
  requestDelete: [];
  requestRestore: [];
  "update:draftDescription": [value: string];
  "update:draftFirstMessage": [value: string];
  "update:draftName": [value: string];
  "update:draftPersonality": [value: string];
  "update:draftScenario": [value: string];
  "update:open": [value: boolean];
};

type CharacterManagerDialogEmitFn = <EventKey extends keyof CharacterManagerDialogEmits>(
  event: EventKey,
  ...args: CharacterManagerDialogEmits[EventKey]
) => void;

export function useCharacterManagerDialog(
  props: CharacterManagerDialogProps,
  emit: CharacterManagerDialogEmitFn
) {
  const isDeleteMode = computed(() => props.mode === "delete");
  const isRestoreMode = computed(() => props.mode === "restore");
  const isEditingMode = computed(() => props.mode === "edit" || props.mode === "update");
  const isDeletedStatus = computed(() => props.status === "deleted");

  const titleKey = computed(() => {
    if (props.mode === "delete") {
      return "dialogs.characterManagerDeleteTitle";
    }

    if (props.mode === "restore") {
      return "dialogs.characterManagerRestoreTitle";
    }

    if (props.mode === "update") {
      return "dialogs.characterManagerUpdateTitle";
    }

    return "dialogs.characterManagerEditTitle";
  });

  const descriptionKey = computed(() => {
    if (props.mode === "delete") {
      return "dialogs.characterManagerDeleteDescription";
    }

    if (props.mode === "restore") {
      return "dialogs.characterManagerRestoreDescription";
    }

    if (props.mode === "update") {
      return "dialogs.characterManagerUpdateDescription";
    }

    return "dialogs.characterManagerEditDescription";
  });

  const confirmKey = computed(() => {
    if (props.mode === "delete") {
      return "dialogs.characterManagerDeleteConfirm";
    }

    if (props.mode === "restore") {
      return "dialogs.characterManagerRestoreConfirm";
    }

    if (props.mode === "update") {
      return "dialogs.characterManagerUpdateConfirm";
    }

    return "dialogs.characterManagerEditConfirm";
  });

  const statusKey = computed(() => {
    return isDeletedStatus.value
      ? "dialogs.characterManagerStatusDeleted"
      : "dialogs.characterManagerStatusActive";
  });

  function updateStringField(
    event: Event,
    eventName:
      | "update:draftDescription"
      | "update:draftFirstMessage"
      | "update:draftName"
      | "update:draftPersonality"
      | "update:draftScenario"
  ): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
      return;
    }

    emit("clearError");
    emit(eventName, target.value);
  }

  function updateDraftName(event: Event): void {
    updateStringField(event, "update:draftName");
  }

  function updateDraftDescription(event: Event): void {
    updateStringField(event, "update:draftDescription");
  }

  function updateDraftPersonality(event: Event): void {
    updateStringField(event, "update:draftPersonality");
  }

  function updateDraftFirstMessage(event: Event): void {
    updateStringField(event, "update:draftFirstMessage");
  }

  function updateDraftScenario(event: Event): void {
    updateStringField(event, "update:draftScenario");
  }

  function requestDelete(): void {
    emit("requestDelete");
  }

  function requestRestore(): void {
    emit("requestRestore");
  }

  function confirm(): void {
    emit("confirm");
  }

  return {
    confirm,
    confirmKey,
    descriptionKey,
    isDeletedStatus,
    isDeleteMode,
    isEditingMode,
    isRestoreMode,
    requestDelete,
    requestRestore,
    statusKey,
    titleKey,
    updateDraftDescription,
    updateDraftFirstMessage,
    updateDraftName,
    updateDraftPersonality,
    updateDraftScenario
  };
}
