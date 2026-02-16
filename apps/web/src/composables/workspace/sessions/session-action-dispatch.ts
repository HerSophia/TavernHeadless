import type { SessionAction } from "./session-context-menu-state";

type UseWorkspaceSessionActionDispatchOptions = {
  archiveSession: (index: number) => Promise<void>;
  closeSessionContextMenu: () => void;
  createSession: () => Promise<void>;
  deleteSession: (index: number) => Promise<void>;
  openSession: (index: number) => void;
  renameSession: (index: number) => Promise<void>;
  resolveTargetIndex: () => number;
};

export function useWorkspaceSessionActionDispatch(
  options: UseWorkspaceSessionActionDispatchOptions
) {
  function handleSessionAction(action: SessionAction): void {
    const index = options.resolveTargetIndex();

    switch (action) {
      case "create":
        void options.createSession();
        break;
      case "open":
        options.openSession(index);
        break;
      case "rename":
        void options.renameSession(index);
        break;
      case "archive":
        void options.archiveSession(index);
        break;
      case "delete":
        void options.deleteSession(index);
        break;
      default:
        break;
    }

    options.closeSessionContextMenu();
  }

  return {
    handleSessionAction
  };
}
