import { computed, reactive } from "vue";

import type { SessionState } from "../../../stores/workspace";

export type SessionAction = "create" | "open" | "rename" | "archive" | "delete";

type UseWorkspaceSessionContextMenuStateOptions = {
  sessions: {
    value: SessionState[];
  };
};

export function useWorkspaceSessionContextMenuState(
  options: UseWorkspaceSessionContextMenuStateOptions
) {
  const contextMenu = reactive({
    targetIndex: 0,
    visible: false,
    x: 0,
    y: 0
  });

  const contextActionDisabled = computed(() => {
    const session = options.sessions.value[contextMenu.targetIndex];
    return {
      archive: !session || session.archived,
      delete: options.sessions.value.length <= 1
    };
  });

  function closeSessionContextMenu(): void {
    contextMenu.visible = false;
  }

  function openSessionContextMenu(event: MouseEvent, index: number): void {
    const width = 170;
    const height = 210;
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - width - 10));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - height - 10));

    contextMenu.targetIndex = index;
    contextMenu.x = x;
    contextMenu.y = y;
    contextMenu.visible = true;
  }

  return {
    closeSessionContextMenu,
    contextActionDisabled,
    contextMenu,
    openSessionContextMenu
  };
}
