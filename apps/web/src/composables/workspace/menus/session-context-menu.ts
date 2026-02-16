import { computed } from "vue";

export type SessionAction = "create" | "open" | "rename" | "archive" | "delete";

export type SessionContextMenuLogicProps = {
  actionDisabled: {
    archive: boolean;
    delete: boolean;
  };
};

export type SessionContextMenuEmits = {
  action: [action: SessionAction];
};

type SessionContextMenuEmitFn = <EventKey extends keyof SessionContextMenuEmits>(
  event: EventKey,
  ...args: SessionContextMenuEmits[EventKey]
) => void;

type SessionMenuEntry =
  | {
      action: SessionAction;
      danger?: boolean;
      disabled?: boolean;
      key: string;
      kind: "item";
    }
  | {
      id: string;
      kind: "separator";
    };

export function useSessionContextMenu(
  props: SessionContextMenuLogicProps,
  emit: SessionContextMenuEmitFn
) {
  const menuEntries = computed<SessionMenuEntry[]>(() => {
    return [
      { action: "create", key: "session.create", kind: "item" },
      { id: "primary", kind: "separator" },
      { action: "open", key: "session.open", kind: "item" },
      { action: "rename", key: "session.rename", kind: "item" },
      {
        action: "archive",
        disabled: props.actionDisabled.archive,
        key: "session.archive",
        kind: "item"
      },
      { id: "danger", kind: "separator" },
      {
        action: "delete",
        danger: true,
        disabled: props.actionDisabled.delete,
        key: "session.delete",
        kind: "item"
      }
    ];
  });

  function triggerAction(action: SessionAction): void {
    emit("action", action);
  }

  return {
    menuEntries,
    triggerAction
  };
}
