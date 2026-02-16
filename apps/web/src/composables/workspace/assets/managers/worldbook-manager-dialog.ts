import { computed } from "vue";

export type WorldbookManagerMode = "delete" | "duplicate" | "edit" | "update";
export type Translator = (key: string, vars?: Record<string, number | string>) => string;

export type WorldbookManagerDialogProps = {
  draftJson: string;
  draftName: string;
  errorMessage: string;
  loading: boolean;
  mode: WorldbookManagerMode;
  open: boolean;
  saving: boolean;
  sourceName: string;
  t: Translator;
};

export type WorldbookManagerDialogEmits = {
  clearError: [];
  confirm: [];
  "update:draftJson": [value: string];
  "update:draftName": [value: string];
  "update:open": [value: boolean];
};

type WorldbookManagerDialogEmitFn = <EventKey extends keyof WorldbookManagerDialogEmits>(
  event: EventKey,
  ...args: WorldbookManagerDialogEmits[EventKey]
) => void;

export function useWorldbookManagerDialog(
  props: WorldbookManagerDialogProps,
  emit: WorldbookManagerDialogEmitFn
) {
  const isDeleteMode = computed(() => props.mode === "delete");

  const titleKey = computed(() => {
    if (props.mode === "delete") {
      return "dialogs.worldbookManagerDeleteTitle";
    }

    if (props.mode === "duplicate") {
      return "dialogs.worldbookManagerDuplicateTitle";
    }

    if (props.mode === "update") {
      return "dialogs.worldbookManagerUpdateTitle";
    }

    return "dialogs.worldbookManagerEditTitle";
  });

  const descriptionKey = computed(() => {
    if (props.mode === "delete") {
      return "dialogs.worldbookManagerDeleteDescription";
    }

    if (props.mode === "duplicate") {
      return "dialogs.worldbookManagerDuplicateDescription";
    }

    if (props.mode === "update") {
      return "dialogs.worldbookManagerUpdateDescription";
    }

    return "dialogs.worldbookManagerEditDescription";
  });

  const confirmKey = computed(() => {
    if (props.mode === "delete") {
      return "dialogs.worldbookManagerDeleteConfirm";
    }

    if (props.mode === "duplicate") {
      return "dialogs.worldbookManagerDuplicateConfirm";
    }

    if (props.mode === "update") {
      return "dialogs.worldbookManagerUpdateConfirm";
    }

    return "dialogs.worldbookManagerEditConfirm";
  });

  function updateDraftName(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    emit("update:draftName", target.value);
  }

  function updateDraftJson(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement)) {
      return;
    }
    emit("update:draftJson", target.value);
  }

  function clearError(): void {
    emit("clearError");
  }

  function confirm(): void {
    emit("confirm");
  }

  return {
    clearError,
    confirm,
    confirmKey,
    descriptionKey,
    isDeleteMode,
    titleKey,
    updateDraftJson,
    updateDraftName
  };
}
