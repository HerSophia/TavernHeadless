import { computed } from "vue";

export type AssetKind = "character" | "preset" | "user" | "worldbook";
export type AssetMenuAction =
  | "bindWorldbook"
  | "delete"
  | "duplicate"
  | "edit"
  | "export"
  | "unbindWorldbook"
  | "update";

export type AssetContextMenuLogicProps = {
  assetKind: AssetKind;
  worldbookBound: boolean;
};

export type AssetContextMenuEmits = {
  action: [action: AssetMenuAction];
};

type AssetContextMenuEmitFn = <EventKey extends keyof AssetContextMenuEmits>(
  event: EventKey,
  ...args: AssetContextMenuEmits[EventKey]
) => void;

type AssetMenuEntry = {
  action: AssetMenuAction;
  danger?: boolean;
  key: string;
};

export function useAssetContextMenu(
  props: AssetContextMenuLogicProps,
  emit: AssetContextMenuEmitFn
) {
  const menuEntries = computed<AssetMenuEntry[]>(() => {
    if (props.assetKind === "worldbook") {
      return [
        { action: "edit", key: "assetMenu.edit" },
        { action: "update", key: "assetMenu.update" },
        { action: "duplicate", key: "assetMenu.duplicate" },
        { action: "export", key: "assetMenu.export" },
        props.worldbookBound
          ? { action: "unbindWorldbook", key: "assetMenu.unbindWorldbook" }
          : { action: "bindWorldbook", key: "assetMenu.bindWorldbook" },
        { action: "delete", danger: true, key: "assetMenu.delete" }
      ];
    }

    if (props.assetKind === "character") {
      return [
        { action: "edit", key: "assetMenu.edit" },
        { action: "update", key: "assetMenu.update" },
        { action: "delete", danger: true, key: "assetMenu.delete" }
      ];
    }

    if (props.assetKind === "preset") {
      return [
        { action: "edit", key: "assetMenu.edit" },
        { action: "update", key: "assetMenu.update" },
        { action: "duplicate", key: "assetMenu.duplicate" },
        { action: "delete", danger: true, key: "assetMenu.delete" }
      ];
    }

    return [{ action: "delete", danger: true, key: "assetMenu.delete" }];
  });

  function triggerAction(action: AssetMenuAction): void {
    emit("action", action);
  }

  return {
    menuEntries,
    triggerAction
  };
}
